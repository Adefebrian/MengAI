// The sample run the landing replays. It is a scripted event log in the
// exact wire shape of a real MengAI run (MengaiEvent, packages/shared
// events.ts), so the recorded log that replaces it drops in unchanged:
// export a real run through the events replay, pass it through redact(),
// trim it to the events below, and swap SAMPLE_RUN for it. Until then the
// page labels it "Sample run, scripted for this page" and never calls it
// recorded.
//
// Nothing here is tool output: events carry short summaries only, no key,
// no absolute path from any machine, no personal data.
import {
  activityForTool,
  type Activity,
  type AgentDTO,
  type AgentRole,
  type AgentStatus,
  type EventMap,
  type EventType,
  type MengaiEvent,
  type Mood,
  type TaskDTO,
  type TaskStatus,
  type UsageTotals,
} from "@mengai/shared";

export type StageId = "plan" | "build" | "review" | "handoff";

/** One story beat: a stretch of real run time and the replay time it plays in. */
export interface StageMark {
  id: StageId;
  label: string;
  /** Real run time, epoch ms. */
  startTs: number;
  endTs: number;
  /** Replay time, ms from the start of the replay. */
  replayStartMs: number;
  replayEndMs: number;
  /** The real moment that stands for the stage as a still. */
  stillTs: number;
}

export interface ReplayFixture {
  runId: string;
  goal: string;
  /** true until a recorded run replaces the script. */
  scripted: boolean;
  startedAt: number;
  endedAt: number;
  events: MengaiEvent[];
  stages: StageMark[];
  /** Crew order on the stage (agent ids). */
  crew: string[];
}

const RUN_ID = "run_sample_csv_export";
const PROJECT_ID = "prj_sample_invoices";
const GOAL = "Add CSV export to the invoices page";
const BUDGET_TOKENS = 400_000;
const T0 = Date.UTC(2026, 8, 21, 2, 0, 0);
const at = (seconds: number) => T0 + Math.round(seconds * 1000);

const ZERO: UsageTotals = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0, calls: 0 };

interface CrewSpec {
  id: string;
  role: AgentRole;
  name: string;
  coat: string;
  seed: number;
}

// Ids, coats and names agree with catLook() and pickCatName() in
// packages/shared cats.ts, the way the API would assign them.
const KOPI: CrewSpec = { id: "agt_sample_lead_2", role: "lead", name: "Kopi", coat: "ginger", seed: 661888672 };
const KLEPON: CrewSpec = { id: "agt_sample_engineer_5", role: "engineer", name: "Klepon", coat: "tabby", seed: 66583270 };
const MOCHI: CrewSpec = { id: "agt_sample_designer_4", role: "designer", name: "Mochi", coat: "calico", seed: 1800746109 };
const TEMPE: CrewSpec = { id: "agt_sample_reviewer_0", role: "reviewer", name: "Tempe", coat: "black", seed: 589844755 };

function agentDTO(c: CrewSpec, status: AgentStatus, activity: Activity): AgentDTO {
  return {
    id: c.id,
    runId: RUN_ID,
    parentId: c.role === "lead" ? null : KOPI.id,
    role: c.role,
    name: c.name,
    look: { coat: c.coat, seed: c.seed },
    tier: c.role === "lead" || c.role === "reviewer" ? "deep" : "balanced",
    status,
    activity,
    mood: "calm",
    statusText: null,
    currentTaskId: null,
    steps: 0,
    usage: ZERO,
    createdAt: T0,
    updatedAt: T0,
  };
}

interface TaskSpec {
  id: string;
  title: string;
  role: AgentRole;
  deps: string[];
  review: boolean;
  parentId?: string;
  createdBy: string | null;
}

const T1: TaskSpec = { id: "tsk_csv_encoder", title: "Add a CSV encoder for invoice rows", role: "engineer", deps: [], review: true, createdBy: KOPI.id };
const T2: TaskSpec = { id: "tsk_export_route", title: "Add GET /invoices/export.csv", role: "engineer", deps: [T1.id], review: true, createdBy: KOPI.id };
const T3: TaskSpec = { id: "tsk_export_button", title: "Add an Export button to the invoices toolbar", role: "designer", deps: [], review: false, createdBy: KOPI.id };
const T5: TaskSpec = { id: "tsk_review_export", title: "Review the CSV export", role: "reviewer", deps: [T1.id, T2.id], review: false, createdBy: null };
const T4: TaskSpec = {
  id: "tsk_wire_button",
  title: "Wire the Export button to the endpoint",
  role: "designer",
  deps: [T2.id, T3.id],
  review: false,
  parentId: T2.id,
  createdBy: KLEPON.id,
};

function taskDTO(t: TaskSpec, status: TaskStatus, assigneeId: string | null, ts: number): TaskDTO {
  return {
    id: t.id,
    runId: RUN_ID,
    parentId: t.parentId ?? null,
    title: t.title,
    spec: "",
    acceptance: [],
    role: t.role,
    assigneeId,
    status,
    priority: 0,
    deps: t.deps,
    review: t.review,
    attempts: 0,
    resultSummary: null,
    createdBy: t.createdBy,
    createdAt: ts,
    updatedAt: ts,
    startedAt: status === "running" ? ts : null,
    endedAt: status === "done" ? ts : null,
  };
}

function buildEvents(): MengaiEvent[] {
  const events: MengaiEvent[] = [];
  let seq = 0;
  let call = 0;
  const emit = <T extends EventType>(s: number, type: T, data: EventMap[T], agentId: string | null = null, taskId: string | null = null) => {
    const event: MengaiEvent<T> = { seq: ++seq, ts: at(s), type, runId: RUN_ID, agentId, taskId, data };
    events.push(event as unknown as MengaiEvent);
  };
  const status = (s: number, c: CrewSpec, st: AgentStatus, activity: Activity, statusText: string | null, taskId: string | null, mood: Mood = "focused") =>
    emit(s, "agent.status", { status: st, activity, mood, statusText, taskId }, c.id, taskId);
  const tool = (s: number, c: CrewSpec, name: string, argsPreview: string, taskId: string | null) => {
    const callId = `call_${++call}`;
    emit(s, "tool.call", { callId, tool: name, activity: activityForTool(name), argsPreview }, c.id, taskId);
    return callId;
  };
  const result = (s: number, c: CrewSpec, callId: string, name: string, summary: string, durationMs: number, taskId: string | null) =>
    emit(s, "tool.result", { callId, tool: name, ok: true, summary, durationMs }, c.id, taskId);
  const task = (s: number, type: "task.created" | "task.updated", t: TaskSpec, st: TaskStatus, assignee: string | null) =>
    emit(s, type, { task: taskDTO(t, st, assignee, at(s)) }, assignee, t.id);
  const usage = (s: number, inputTokens: number, outputTokens: number, calls: number, progress: number) =>
    emit(s, "run.usage", {
      usage: { inputTokens, outputTokens, cachedTokens: Math.round(inputTokens * 0.42), cacheWriteTokens: 0, costUsd: 0, calls },
      budgetTokens: BUDGET_TOKENS,
      budgetUsd: 0,
      progress,
    });

  // Plan: Kopi reads the goal and splits it into tasks.
  emit(0, "run.created", {
    run: {
      id: RUN_ID,
      projectId: PROJECT_ID,
      goal: GOAL,
      status: "running",
      statusReason: null,
      budgetTokens: BUDGET_TOKENS,
      budgetUsd: 0,
      usage: ZERO,
      progress: 0,
      startedAt: T0,
      endedAt: null,
      createdAt: T0,
    },
  });
  emit(0, "agent.spawned", { agent: agentDTO(KOPI, "thinking", "think") }, KOPI.id);
  for (const c of [KLEPON, MOCHI, TEMPE]) emit(0, "agent.spawned", { agent: agentDTO(c, "idle", "rest") }, c.id);
  status(0.2, KOPI, "thinking", "think", "Reading the goal", null);
  tool(12, KOPI, "fs_list", "src/invoices", null);
  tool(24, KOPI, "create_tasks", "3 tasks", null);
  task(28, "task.created", T1, "queued", null);
  task(31, "task.created", T2, "queued", null);
  task(34, "task.created", T3, "queued", null);
  usage(35, 9_800, 1_400, 3, 0);
  task(38, "task.updated", T1, "running", KLEPON.id);
  task(39, "task.updated", T3, "running", MOCHI.id);

  // Build: the engineer and the designer work their tasks.
  status(40, KOPI, "waiting", "wait", "Watching the crew", null, "calm");
  status(40, KLEPON, "working", "read", "Reading the invoice table", T1.id);
  tool(40, KLEPON, "fs_read", "src/invoices/table.tsx", T1.id);
  status(44, MOCHI, "working", "read", "Reading the toolbar", T3.id);
  tool(44, MOCHI, "fs_read", "src/invoices/Toolbar.tsx", T3.id);
  tool(80, KLEPON, "fs_write", "src/lib/csv.ts", T1.id);
  tool(90, MOCHI, "fs_edit", "src/invoices/Toolbar.tsx", T3.id);
  tool(100, KOPI, "crew_status", "3 tasks", null);
  tool(100, TEMPE, "fs_read", "docs/invoices.md", null);
  usage(110, 48_600, 8_900, 17, 0);
  const csvTest = tool(120, KLEPON, "shell_run", "bun test src/lib/csv.test.ts", T1.id);
  status(140, KOPI, "waiting", "wait", "Watching the crew", null, "calm");
  status(140, TEMPE, "waiting", "wait", "Waiting for a review", null, "calm");
  result(150, KLEPON, csvTest, "shell_run", "4 tests pass", 2_400, T1.id);
  task(155, "task.updated", T1, "review", KLEPON.id);
  task(158, "task.updated", T2, "running", KLEPON.id);
  tool(160, KLEPON, "fs_edit", "src/api/invoices.ts", T2.id);
  tool(195, MOCHI, "fs_read", "src/ui/Button.tsx", T3.id);
  const routeTest = tool(220, KLEPON, "shell_run", "bun test src/api", T2.id);
  tool(230, MOCHI, "finish", "Export button added", T3.id);
  task(231, "task.updated", T3, "done", MOCHI.id);
  usage(240, 104_300, 19_600, 38, 0.33);
  result(260, KLEPON, routeTest, "shell_run", "12 tests pass", 3_100, T2.id);
  task(262, "task.updated", T2, "review", KLEPON.id);
  status(262, KLEPON, "waiting", "wait", "Waiting for review", T2.id, "calm");
  status(270, MOCHI, "waiting", "wait", "Waiting on Klepon", T3.id, "calm");

  // Review: the reviewer checks both engineering tasks, sends the encoder
  // back once with a note, and passes it in round 2.
  task(300, "task.created", T5, "running", TEMPE.id);
  status(300, TEMPE, "working", "read", "Reading the change", T5.id);
  tool(300, TEMPE, "fs_read", "src/lib/csv.ts", T5.id);
  const firstVerdict = tool(340, TEMPE, "submit_review", "changes", T5.id);
  result(345, TEMPE, firstVerdict, "submit_review", "Changes requested: quote fields that contain commas", 900, T5.id);
  status(380, TEMPE, "waiting", "wait", "Waiting on the fix", T5.id, "calm");
  task(380, "task.updated", T1, "running", KLEPON.id);
  status(380, KLEPON, "working", "code", "Quoting the commas", T1.id);
  tool(380, KLEPON, "fs_edit", "src/lib/csv.ts", T1.id);
  const fixTest = tool(420, KLEPON, "shell_run", "bun test src/lib/csv.test.ts", T1.id);
  result(455, KLEPON, fixTest, "shell_run", "5 tests pass", 2_600, T1.id);
  task(458, "task.updated", T1, "review", KLEPON.id);
  status(460, KLEPON, "waiting", "wait", "Waiting for review", T2.id, "calm");
  const reviewRun = tool(460, TEMPE, "shell_run", "bun test", T5.id);
  result(490, TEMPE, reviewRun, "shell_run", "17 tests pass", 4_800, T5.id);
  const verdict = tool(495, TEMPE, "submit_review", "pass", T5.id);
  result(500, TEMPE, verdict, "submit_review", "Passed in round 2", 900, T5.id);
  task(502, "task.updated", T1, "done", KLEPON.id);
  task(503, "task.updated", T2, "done", KLEPON.id);
  usage(504, 139_900, 25_300, 51, 0.8);
  tool(530, TEMPE, "finish", "Review passed", T5.id);
  task(531, "task.updated", T5, "done", TEMPE.id);

  // Hand off: the engineer hands the wiring to the designer.
  tool(540, KLEPON, "handoff", "designer", T2.id);
  task(541, "task.created", T4, "ready", null);
  emit(
    542,
    "handoff",
    {
      handoff: {
        id: "hof_wire_button",
        runId: RUN_ID,
        taskId: T4.id,
        fromAgentId: KLEPON.id,
        toAgentId: MOCHI.id,
        toRole: "designer",
        summary: "GET /invoices/export.csv streams the file; call it with the current filters.",
        createdAt: at(542),
      },
    },
    KLEPON.id,
    T4.id,
  );
  task(552, "task.updated", T4, "running", MOCHI.id);
  status(552, MOCHI, "working", "code", "Wiring the button", T4.id);
  tool(552, MOCHI, "fs_edit", "src/invoices/Toolbar.tsx", T4.id);
  status(560, KLEPON, "done", "rest", "Done", T2.id, "proud");
  status(560, TEMPE, "done", "rest", "Done", T5.id, "proud");
  tool(570, MOCHI, "finish", "Export button wired", T4.id);
  task(571, "task.updated", T4, "done", MOCHI.id);
  tool(578, KOPI, "finish", "Report ready", null);
  usage(580, 151_200, 31_200, 64, 1);
  status(585, MOCHI, "done", "rest", "Done", T4.id, "proud");
  emit(586, "run.status", { status: "done", reason: null });
  status(591, KOPI, "done", "rest", "Done", null, "proud");
  return events;
}

const STAGE_REAL: Array<[StageId, string, number, number, number, number]> = [
  // id, label, real start s, real end s, replay end ms, still s
  ["plan", "Plan", 0, 40, 4_000, 36],
  ["build", "Build", 40, 300, 13_000, 110],
  ["review", "Review", 300, 540, 22_000, 360],
  ["handoff", "Hand off", 540, 600, 28_000, 555],
];

function buildStages(): StageMark[] {
  let replayStartMs = 0;
  return STAGE_REAL.map(([id, label, start, end, replayEndMs, still]) => {
    const mark: StageMark = { id, label, startTs: at(start), endTs: at(end), replayStartMs, replayEndMs, stillTs: at(still) };
    replayStartMs = replayEndMs;
    return mark;
  });
}

export const SAMPLE_RUN: ReplayFixture = {
  runId: RUN_ID,
  goal: GOAL,
  scripted: true,
  startedAt: T0,
  endedAt: at(600),
  events: buildEvents(),
  stages: buildStages(),
  crew: [KOPI.id, KLEPON.id, MOCHI.id, TEMPE.id],
};

/** Tokens each cat used in the sample run (sums to the run total). */
export const SAMPLE_CREW_TOKENS: Record<string, number> = {
  [KOPI.id]: 38_200,
  [KLEPON.id]: 71_600,
  [MOCHI.id]: 41_900,
  [TEMPE.id]: 30_700,
};
