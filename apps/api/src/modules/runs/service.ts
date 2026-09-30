// RunsService: run lifecycle, estimates, snapshots and control. Holds one
// RunEngine per live run; runs that are not live (paused by a restart) are
// rebuilt from the tables on the first call that needs them.
import {
  ROLE_LABEL,
  type AgentDTO,
  type AgentMindDTO,
  type BudgetBody,
  type ContextXrayDTO,
  type CreateRunBody,
  type EstimateRunBody,
  type HumanMessageBody,
  type LlmCallDTO,
  type MeetingDTO,
  type MengaiEvent,
  type RunDTO,
  type RunEstimate,
  type RunSnapshotDTO,
  type RunStage,
  type RunStatus,
  type StrategyVersionDTO,
  type TaskDTO,
  type TaskPatchBody,
  type ToolCallDetail,
} from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { RunsService } from "../../core/services";
import { HttpError, conflict, notFound } from "../../lib/http";
import { clip, redact } from "../../lib/redact";
import { COMPANY, meetingsFromEvents } from "./company";
import { RunEngine, TERMINAL_RUN, companyOf, type EngineHooks, type EngineInit, type OrgSettings } from "./engine";
import { HEURISTIC, LIMITS, TITLES, bounded, estimatePlan, roundUsd } from "./policy";
import { brainOf, type RunsDeps } from "./ports";
import { createRunsRepo, emptyUsage } from "./repo";
import { stageFromBoard } from "./stage";

export interface RunsServiceImpl extends RunsService {
  /** resolves once boot recovery (running -> paused "restart") is done */
  readonly ready: Promise<void>;
  calls(runId: string): Promise<LlmCallDTO[]>;
  /** what is in one cat's head: charter, strategy addenda, lessons, skills, runtime JEV decisions, history */
  mind(runId: string, agentId: string): Promise<AgentMindDTO>;
  /** aborts live work without changing statuses; the next boot pauses those runs */
  close(): Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function orgOf(s: { ceoName?: string; maxAgents?: number; maxDepth?: number }): Partial<OrgSettings> {
  return { ceoName: s.ceoName, maxAgents: s.maxAgents, maxDepth: s.maxDepth };
}

const cleanText = (t: string, max = 4000) => clip(redact(t), max);

export function createRunsService(ctx: ModuleContext, deps: RunsDeps): RunsServiceImpl {
  const repo = createRunsRepo(ctx.db);
  const log = ctx.logger.child({ module: "runs" });
  const engines = new Map<string, RunEngine>();
  const hydrating = new Map<string, Promise<RunEngine>>();
  const lastSeq = new Map<string, number>();
  /** meetings of runs that ended here (or were rebuilt from the log), newest last, bounded */
  const pastMeetings = new Map<string, MeetingDTO[]>();
  let closed = false;

  function rememberMeetings(runId: string, meetings: MeetingDTO[]): void {
    pastMeetings.delete(runId);
    pastMeetings.set(runId, meetings);
    while (pastMeetings.size > COMPANY.closedRunsCached) pastMeetings.delete(pastMeetings.keys().next().value!);
  }

  /** Meetings of a run that is not live: the in-memory record, else the event log when it is wired. */
  async function meetingsOf(runId: string, run: RunDTO | null): Promise<MeetingDTO[]> {
    const known = pastMeetings.get(runId);
    if (known) return known;
    const reader = deps.eventLog;
    if (!reader) return [];
    const found: MeetingDTO[] = [];
    try {
      const events: MengaiEvent[] = [];
      let after = 0;
      for (let page = 0; page < COMPANY.eventPages; page++) {
        const batch = await reader.after(after, runId, COMPANY.eventPage);
        for (const e of batch) if (e.type === "meeting.started" || e.type === "meeting.ended") events.push(e);
        if (batch.length < COMPANY.eventPage) break;
        after = batch[batch.length - 1]!.seq;
      }
      found.push(...meetingsFromEvents(events));
    } catch (e) {
      log.log("warn", "meeting history read failed", { error: redact(errMsg(e)) });
      return [];
    }
    // an ended run never changes again: keep what was read
    if (run && TERMINAL_RUN.has(run.status)) rememberMeetings(runId, found);
    return found;
  }

  const hooks: EngineHooks = {
    onSeq(runId, seq) {
      if (seq > (lastSeq.get(runId) ?? 0)) lastSeq.set(runId, seq);
    },
    onClosed(runId, meetings) {
      rememberMeetings(runId, meetings);
      engines.delete(runId);
    },
  };

  async function publishStatus(runId: string, status: RunStatus, reason: string | null): Promise<void> {
    try {
      const ev = await ctx.events.publish({ type: "run.status", runId, data: { status, reason } });
      hooks.onSeq(runId, ev.seq);
    } catch (e) {
      log.log("warn", "event publish failed", { error: redact(errMsg(e)) });
    }
  }

  /** Boot: runs left mid-flight by a crash or restart are paused with reason "restart". */
  async function recover(): Promise<void> {
    const now = ctx.clock.now();
    for (const r of await repo.runIdsByStatus(["running", "queued", "stopping"])) {
      const status: RunStatus = r.status === "stopping" ? "stopped" : "paused";
      await repo.setRunStatus(r.id, status, "restart", now, status === "stopped" ? now : null);
      if (status === "stopped") await repo.closeRunRows(r.id, now);
      else await repo.resetLiveRows(r.id, now);
      await publishStatus(r.id, status, "restart");
    }
  }

  const ready = recover().catch((e) => {
    log.log("error", "runs boot recovery failed", { error: redact(errMsg(e)) });
  });

  async function loadRun(runId: string): Promise<RunDTO> {
    const live = engines.get(runId);
    if (live) return live.view;
    const run = await repo.getRun(runId);
    if (!run) throw notFound("run");
    return run;
  }

  /** The live engine, rebuilding it for a non-terminal run; null when the run has ended. */
  async function engineFor(runId: string): Promise<RunEngine | null> {
    await ready;
    const live = engines.get(runId);
    if (live) return live;
    const pending = hydrating.get(runId);
    if (pending) return pending;
    const run = await repo.getRun(runId);
    if (!run) throw notFound("run");
    if (TERMINAL_RUN.has(run.status)) return null;
    const p = (async () => {
      const init = await engineInit(run);
      init.meetings = await meetingsOf(runId, run);
      const e = await RunEngine.hydrate(init);
      engines.set(runId, e);
      return e;
    })().finally(() => hydrating.delete(runId));
    hydrating.set(runId, p);
    return p;
  }

  async function engineInit(run: RunDTO): Promise<EngineInit> {
    const [project, root, settings] = await Promise.all([
      deps.projects.get(run.projectId).catch(() => null),
      deps.projects.root(run.projectId).catch(() => ""),
      deps.settings.get(),
    ]);
    return {
      ctx,
      deps,
      repo,
      run,
      project: { id: run.projectId, name: project?.name ?? "Project" },
      root,
      maxConcurrent: settings.maxConcurrentAgents,
      hooks,
      org: orgOf(settings),
    };
  }

  async function liveEngine(runId: string): Promise<RunEngine> {
    const e = await engineFor(runId);
    if (!e) throw conflict("the run has ended");
    return e;
  }

  const service: RunsServiceImpl = {
    ready,

    async create(input: CreateRunBody): Promise<RunDTO> {
      await ready;
      if (closed) throw new HttpError(503, "unavailable", "shutting down");
      const project = await deps.projects.get(input.projectId);
      if (!(await deps.llm.configured())) {
        throw new HttpError(409, "llm_not_configured", "Add a chat provider with an API key before starting a run.");
      }
      const [root, settings] = await Promise.all([deps.projects.root(project.id), deps.settings.get()]);
      const now = ctx.clock.now();
      const run: RunDTO = {
        id: ctx.clock.id(),
        projectId: project.id,
        goal: bounded(input.goal, 4000),
        status: "running",
        statusReason: null,
        budgetTokens: input.budgetTokens ?? settings.defaultBudgetTokens,
        budgetUsd: input.budgetUsd ?? settings.defaultBudgetUsd,
        usage: emptyUsage(),
        progress: 0,
        startedAt: now,
        endedAt: null,
        createdAt: now,
        company: input.company ?? "studio",
      };
      await repo.insertRun(run, now);
      try {
        await deps.projects.touchRun(project.id, run.id);
      } catch (e) {
        log.log("warn", "touchRun failed", { error: redact(errMsg(e)) });
      }
      const e = await RunEngine.start({
        ctx,
        deps,
        repo,
        run,
        project: { id: project.id, name: project.name },
        root,
        maxConcurrent: settings.maxConcurrentAgents,
        hooks,
        org: orgOf(settings),
      });
      if (!TERMINAL_RUN.has(e.status)) engines.set(run.id, e);
      return e.view;
    },

    async estimate(input: EstimateRunBody): Promise<RunEstimate> {
      await ready;
      await deps.projects.get(input.projectId);
      const plan = estimatePlan(input.goal, await repo.projectHistory(input.projectId, 10));
      let cost = 0;
      if (plan.usdPerToken !== null) {
        cost = plan.tokens * plan.usdPerToken;
      } else {
        // Provider agnostic: price with the model the balanced tier resolves to;
        // with no provider yet there is no model to price, so the cost stays 0.
        let model: string | null = null;
        try {
          model = (await deps.llm.resolve({ tier: "balanced" })).model;
        } catch {
          model = null;
        }
        const inputTokens = Math.round(plan.tokens * HEURISTIC.inputShare);
        cost = model === null ? 0 : await deps.usage
          .cost(model, {
            inputTokens,
            outputTokens: plan.tokens - inputTokens,
            cachedTokens: Math.round(inputTokens * HEURISTIC.cachedShareOfInput),
            cacheWriteTokens: 0,
          })
          .catch(() => 0);
      }
      return { tasks: plan.tasks, tokens: plan.tokens, costUsd: roundUsd(cost), basis: plan.basis };
    },

    async list(): Promise<RunDTO[]> {
      await ready;
      const rows = await repo.listRuns(LIMITS.listLimit);
      return rows.map((r) => engines.get(r.id)?.view ?? r);
    },

    async snapshot(runId: string): Promise<RunSnapshotDTO> {
      await ready;
      // read the sequence first: anything newer is replayed over SSE
      const seq = lastSeq.get(runId) ?? 0;
      const live = engines.get(runId);
      const run = await loadRun(runId);
      const [all, tasks, handoffs, decisions, brainDecisions, approvals, meetings] = await Promise.all([
        live ? live.agentList() : repo.listAgents(runId),
        live ? live.taskList() : repo.listTasks(runId),
        live ? live.handoffList() : repo.listHandoffs(runId),
        deps.decisions.list(runId).catch(() => []),
        repo.brainDecisions(runId).catch(() => []),
        deps.approvals ? deps.approvals.list(runId).catch(() => []) : Promise.resolve([]),
        live ? live.meetingList() : meetingsOf(runId, run),
      ]);
      const roleIds = [...new Set([...all.map((a) => a.roleId), ...tasks.map((t) => t.roleId)].filter((x): x is string => !!x))];
      const roles = live ? live.roleList() : await repo.rolesByIds(roleIds).catch(() => []);
      // agents holds the crew still at work; cats that were let go are listed apart
      const agents = all.filter((a) => !a.leftReason);
      const departed = all.filter((a) => !!a.leftReason);
      const kindOf = (t: TaskDTO) =>
        t.role === "lead" && t.title === TITLES.plan
          ? "plan"
          : t.role === "lead" && t.title.startsWith(TITLES.final)
            ? "final"
            : t.role === "reviewer" && t.parentId && t.title.startsWith(TITLES.reviewPrefix)
              ? "review"
              : "work";
      const company = companyOf(run);
      const roleKeys = new Map(roles.map((r) => [r.id, r.key] as const));
      const companyStage =
        !live && company !== "studio" && deps.companies
          ? deps.companies.boardStage(
              company,
              tasks.map((t) => ({ title: t.title, roleKey: (t.roleId && roleKeys.get(t.roleId)) || t.role, archetype: t.role, kind: kindOf(t), status: t.status })),
              run.status,
            )
          : null;
      const stage = live
        ? live.stageNow
        : ((companyStage as RunStage | null) ??
          stageFromBoard(
            tasks.map((t) => ({ role: t.role, status: t.status, kind: t.role === "reviewer" && t.parentId && t.title.startsWith(TITLES.reviewPrefix) ? "review" : "work" })),
            run.status,
            agents.length,
          ));
      const merged = [...decisions, ...brainDecisions].sort((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1));
      return { run, agents, tasks, handoffs, decisions: merged, approvals, meetings, departed, roles, stage, lastSeq: seq };
    },

    async pause(runId: string): Promise<RunDTO> {
      const e = await engineFor(runId);
      const status = e ? e.status : (await loadRun(runId)).status;
      if (!e || status !== "running") throw conflict(`the run is ${status}`);
      await e.pause("user");
      return e.view;
    },

    async resume(runId: string): Promise<RunDTO> {
      const e = await engineFor(runId);
      const status = e ? e.status : (await loadRun(runId)).status;
      if (!e || status !== "paused") throw conflict(`the run is ${status}`);
      if (e.overBudget()) throw new HttpError(409, "budget_exhausted", "The run used its budget. Raise the budget, then resume.");
      await e.resume();
      return e.view;
    },

    async stop(runId: string, reason = "user"): Promise<RunDTO> {
      const e = await engineFor(runId);
      if (!e) return loadRun(runId);
      await e.stop(bounded(reason, 300));
      return e.view;
    },

    async message(runId: string, input: HumanMessageBody): Promise<void> {
      const e = await liveEngine(runId);
      await e.message(input);
    },

    async setBudget(runId: string, input: BudgetBody): Promise<RunDTO> {
      const e = await liveEngine(runId);
      await e.setBudget(input);
      return e.view;
    },

    async patchTask(runId: string, taskId: string, patch: TaskPatchBody): Promise<TaskDTO> {
      const e = await liveEngine(runId);
      return e.patchTask(taskId, patch);
    },

    async stopAgent(runId: string, agentId: string): Promise<AgentDTO> {
      const e = await liveEngine(runId);
      return e.stopAgent(agentId);
    },

    async xray(runId: string, agentId: string): Promise<ContextXrayDTO> {
      await loadRun(runId);
      const x = await repo.getSnapshot(runId, agentId);
      if (!x) throw notFound("context snapshot");
      return x;
    },

    async mind(runId: string, agentId: string): Promise<AgentMindDTO> {
      await ready;
      await loadRun(runId);
      const live = engines.get(runId);
      const agent = (live ? live.agentList() : await repo.listAgents(runId)).find((a) => a.id === agentId);
      if (!agent) throw notFound("agent");
      const snap = await repo.getMind(runId, agentId);
      const role = agent.roleId ? ((await repo.rolesByIds([agent.roleId]))[0] ?? null) : null;
      const roleKey = role?.key ?? agent.role;
      const brain = brainOf(deps.memory);
      let addenda: StrategyVersionDTO[] = [];
      let history: StrategyVersionDTO[] = [];
      if (brain) {
        try {
          addenda = snap?.addendumIds.length
            ? await brain.strategiesByIds(snap.addendumIds)
            : [await brain.activeStrategy({ kind: "role", key: roleKey }), await brain.activeStrategy({ kind: "agent", key: agentId })].filter((x): x is StrategyVersionDTO => !!x);
          const [r, own] = await Promise.all([brain.strategyHistory({ kind: "role", key: roleKey }, 20), brain.strategyHistory({ kind: "agent", key: agentId }, 20)]);
          history = [...r, ...own].sort((x, y) => y.createdAt - x.createdAt || (x.id < y.id ? 1 : -1)).slice(0, 30);
        } catch (e) {
          log.log("warn", "mind strategies read failed", { error: redact(errMsg(e)) });
        }
      }
      const decisions = await repo.brainDecisions(runId, { agentId, subjects: [roleKey, agentId, ...(agent.roleId ? [agent.roleId] : [])] }).catch(() => []);
      let skills: AgentMindDTO["skills"] = [];
      if (snap?.taskTitle) {
        try {
          const found = await deps.memory.findSkills({ text: snap.taskTitle, role: agent.role, limit: 3 });
          skills = found.map((k) => ({
            id: k.id,
            name: cleanText(k.name, 80),
            description: cleanText(k.description, 400),
            reason: cleanText(`A saved procedure that matches ${snap.taskTitle}; ${k.wins} of ${k.uses} uses went well.`, 240),
          }));
        } catch (e) {
          log.log("warn", "mind skills read failed", { error: redact(errMsg(e)) });
        }
      }
      const charterText = role ? role.charter : deps.context.charter(agent.role);
      const redactStrategy = (x: StrategyVersionDTO): StrategyVersionDTO => ({ ...x, text: cleanText(x.text, 800), reason: cleanText(x.reason, 400) });
      const layerVersion =
        snap?.layerVersion ??
        [role || addenda.length ? `c${role?.charterVersion ?? 1}` : "", ...addenda.map((x) => `${x.subject === "role" ? "r" : "a"}${x.version}`)].filter(Boolean).join(".");
      return {
        runId,
        agentId,
        name: agent.name,
        role: agent.role,
        roleTitle: role?.title ?? agent.roleTitle ?? ROLE_LABEL[agent.role],
        roleId: agent.roleId ?? null,
        charter: { version: role?.charterVersion ?? 1, title: role?.title ?? ROLE_LABEL[agent.role], dynamic: !!role, text: cleanText(charterText, 8000), tokens: deps.context.estimateTokens(charterText) },
        layerVersion,
        addenda: addenda.map(redactStrategy),
        lessons: (snap?.lessons ?? []).map((l) => ({ id: l.id, text: cleanText(l.text, 400), reason: cleanText(l.reason, 240) })),
        skills,
        decisions,
        history: history.map(redactStrategy),
        updatedAt: snap?.at ?? agent.updatedAt,
      };
    },

    async toolCall(runId: string, callId: string): Promise<ToolCallDetail> {
      const c = await repo.getToolCall(runId, callId);
      if (!c) throw notFound("tool call");
      return c;
    },

    async calls(runId: string): Promise<LlmCallDTO[]> {
      await loadRun(runId);
      return deps.usage.listCalls(runId);
    },

    async stopAll(reason: string): Promise<number> {
      await ready;
      const why = bounded(reason, 300);
      const live = [...engines.values()].filter((e) => !TERMINAL_RUN.has(e.status) && e.status !== "stopping");
      await Promise.all(live.map((e) => e.stop(why)));
      let n = live.length;
      const now = ctx.clock.now();
      for (const r of await repo.runIdsByStatus(["running", "paused", "queued", "stopping"])) {
        if (engines.has(r.id)) continue;
        await repo.setRunStatus(r.id, "stopped", why, now, now);
        await repo.closeRunRows(r.id, now);
        await publishStatus(r.id, "stopped", why);
        n++;
      }
      return n;
    },

    async close(): Promise<void> {
      closed = true;
      for (const e of engines.values()) e.shutdown();
      engines.clear();
    },
  };
  return service;
}
