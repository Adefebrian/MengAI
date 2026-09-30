// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What is in one cat's head (JEV ui.region_gate divided section inside the
// cat drawer; ui.component_recipe core.divided_section 0.61, with the an.R22
// disclosure layer at 0.62 and the mu.R01 fade-up at 0.63; motion tier 1).
// Labelled groups between hairlines, in the order a curious owner asks:
// which charter it runs, the strategies it learned, the lessons and skills
// in its latest prompt and why each was picked, the written skills it read
// on its last step (the built-in JAL-AIDev pack first, then the owner's;
// JEV ui.region_gate divided section, 0.75), what JEV decided about it
// with the eval evidence, how its strategy changed (a word diff per
// version), then its tools, its boss and its own crew, and its budget.
// From GET /api/runs/:id/agents/:agentId/mind; every text is already
// redacted by the server. The parts the page already knows (tools, org,
// budget) render even when the server cannot answer.
import { ROLE_LABEL, ROLE_TOOLS, type AgentDTO, type AgentMindDTO, type DecisionDTO, type StrategyVersionDTO } from "@mengai/shared";
import { Chip, DataRow, DataRows, Meter, ProductIcon, SkeletonRows } from "@mengai/ui/src/product";
import { motion } from "motion/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { ApiError, errorMessage } from "../../api/client";
import type { RunState } from "../../store/runStore";
import { crewOrder, tokensUsed } from "../../store/runStore";
import { useApp } from "../context";
import { fmtAgo, fmtInt, fmtPct, fmtUsd } from "../format";
import { T, useMotionLevel } from "../motion";
import type { AgentSpend } from "./derive";
import { diffCounts, wordDiff } from "./diff";
import { roleTitleOf } from "./office";

type Load = { kind: "loading" } | { kind: "ready"; mind: AgentMindDTO } | { kind: "missing" } | { kind: "error"; message: string };

function useMind(runId: string, agentId: string, refresh: string): [Load, () => void] {
  const { api } = useApp();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoad((prev) => (prev.kind === "ready" && prev.mind.agentId === agentId ? prev : { kind: "loading" }));
    api.call("GET /api/runs/:id/agents/:agentId/mind", { params: { id: runId, agentId }, signal: ctrl.signal }).then(
      (mind) => setLoad({ kind: "ready", mind }),
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 501)) setLoad({ kind: "missing" });
        else setLoad({ kind: "error", message: errorMessage(err) });
      },
    );
    return () => ctrl.abort();
  }, [api, runId, agentId, refresh, nonce]);
  return [load, () => setNonce((n) => n + 1)];
}

/** One labelled group of the panel: a small heading, an optional count line, then its body. */
function Group({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="mind-group" aria-labelledby={id}>
      <div className="mind-group-head">
        <h4 className="mind-h" id={id}>
          {title}
        </h4>
        {meta ? <p className="mind-meta">{meta}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A disclosure (an.R22): a 44px ghost button that shows its body in place. */
function Disclosure({ label, openLabel, children }: { label: string; openLabel?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mind-disclosure" data-open={open ? "" : undefined}>
      <button type="button" className="btn-ghost mind-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span className="mind-toggle-icon" aria-hidden="true">
          <ProductIcon name="chevronDown" size={16} />
        </span>
        <span>{open ? (openLabel ?? label) : label}</span>
      </button>
      <div id={id} className="mind-disclosure-body" hidden={!open}>
        {open ? children : null}
      </div>
    </div>
  );
}

function subjectWord(v: Pick<StrategyVersionDTO, "subject">, name: string): string {
  return v.subject === "agent" ? `${name}'s own strategy` : "Role strategy";
}

function decisionLine(d: StrategyVersionDTO["decision"]): ReactNode {
  if (!d) return null;
  return (
    <span className="mind-jev">
      <span className="mind-jev-icon" data-tone={d.verified ? "success" : "warning"}>
        <ProductIcon name={d.verified ? "checkCircle" : "alertTriangle"} size={16} />
      </span>
      <span>
        {d.verified ? "Verified by JEV" : (d.stamp ?? "UNVERIFIED BY JEV")}
        {typeof d.confidence === "number" ? (
          <>
            , confidence <span className="num">{fmtPct(d.confidence)}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}

function Evidence({ v }: { v: StrategyVersionDTO }) {
  const e = v.evidence;
  if (!e) return null;
  const score = (n: number) => n.toFixed(2);
  return (
    <p className="mind-evidence">
      Eval replay: score <span className="num">{score(e.scores.current)}</span> to <span className="num">{score(e.scores.candidate)}</span>, it answers{" "}
      <span className="num">{e.addressed.candidate}</span> of <span className="num">{e.addressed.losses}</span> recent failures, billable input{" "}
      <span className="num">{fmtInt(e.billableInputTokens.current)}</span> to <span className="num">{fmtInt(e.billableInputTokens.candidate)}</span> tokens.
    </p>
  );
}

const CHOICE_WORD: Record<string, string> = { adopt: "JEV adopted it", merge: "JEV merged it with the last one", keep: "JEV kept the last one" };
const STATUS_WORD: Record<StrategyVersionDTO["status"], string> = { active: "In use", retired: "Retired", rejected: "Kept out" };

function Addendum({ v, name }: { v: StrategyVersionDTO; name: string }) {
  return (
    <li className="mind-item">
      <p className="mind-item-title">
        {subjectWord(v, name)} <span className="num">v{v.version}</span>
        <span className="mind-item-side">
          <span className="num">{fmtInt(v.tokens)}</span> tokens
        </span>
      </p>
      <p className="mind-text">{v.text}</p>
      <p className="mind-why">
        {v.choice ? `${CHOICE_WORD[v.choice] ?? v.choice}. ` : ""}
        {v.reason}
      </p>
      {decisionLine(v.decision)}
      <Evidence v={v} />
    </li>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const parts = wordDiff(before, after);
  const c = diffCounts(parts);
  return (
    <div className="mind-diff">
      <p className="mind-diff-sum">
        <span className="num">{fmtInt(c.added)}</span> {c.added === 1 ? "word" : "words"} added, <span className="num">{fmtInt(c.removed)}</span> removed
      </p>
      <p className="mind-diff-text">
        {parts.map((p, i) =>
          p.kind === "same" ? (
            <span key={i}>{p.text}</span>
          ) : p.kind === "add" ? (
            <ins key={i} className="mind-ins">
              <span className="p-sr-wrap">
                <span className="p-sr-only">added: </span>
              </span>
              {p.text}
            </ins>
          ) : (
            <del key={i} className="mind-del">
              <span className="p-sr-wrap">
                <span className="p-sr-only">removed: </span>
              </span>
              {p.text}
            </del>
          ),
        )}
      </p>
    </div>
  );
}

/** Newest first: the highest version on top, the later write first on a tie. */
export function newestFirst(history: readonly StrategyVersionDTO[]): StrategyVersionDTO[] {
  return [...history].sort((a, b) => b.version - a.version || b.createdAt - a.createdAt);
}

/** "a engineer" reads "an engineer", for a reason written before the server fixed its article. */
export function withArticles(text: string): string {
  return text.replace(/\b([Aa]) (?=[aeioAEIO])/g, "$1n ");
}

function History({ history: raw, name, now }: { history: StrategyVersionDTO[]; name: string; now: number }) {
  if (raw.length === 0) return <p className="app-empty-line mind-empty">No versions yet. The first one appears after a check the cat learns from.</p>;
  const history = newestFirst(raw);
  return (
    <ol className="mind-list">
      {history.map((v) => {
        const prev = history.find((p) => p.subject === v.subject && p.subjectKey === v.subjectKey && p.version < v.version && p.status !== "rejected");
        return (
          <li className="mind-item" key={v.id}>
            <p className="mind-item-title">
              {subjectWord(v, name)} <span className="num">v{v.version}</span>
              <span className="mind-item-side">
                {STATUS_WORD[v.status]}, {fmtAgo(v.createdAt, now)}
              </span>
            </p>
            <p className="mind-why">{v.reason}</p>
            <Disclosure label={prev ? `Show the change from v${prev.version}` : "Show the first version"} openLabel="Hide the change">
              {prev ? <Diff before={prev.text} after={v.text} /> : <p className="mind-text">{v.text}</p>}
            </Disclosure>
          </li>
        );
      })}
    </ol>
  );
}

function answerText(d: DecisionDTO): string {
  const parts: string[] = [];
  for (const [k, raw] of Object.entries(d.answers ?? {})) {
    const v = raw as unknown;
    let text: string;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      text = typeof o.choice === "string" ? o.choice : typeof o.score === "number" ? o.score.toFixed(2) : typeof o.noul === "number" ? fmtPct(o.noul) : "";
    } else text = String(v);
    if (text) parts.push(`${k.replace(/_/g, " ")} ${text}`);
    if (parts.length >= 2) break;
  }
  return parts.join(", ");
}

function Decision({ d }: { d: DecisionDTO }) {
  const answer = answerText(d);
  return (
    <li className="mind-item">
      <p className="mind-item-title">
        <span className="num mind-decision-id">{d.decisionId}</span>
        <span className="mind-item-side">
          {typeof d.confidence === "number" ? (
            <>
              <span className="num">{fmtPct(d.confidence)}</span> sure
            </>
          ) : (
            "No confidence"
          )}
        </span>
      </p>
      <p className="mind-text">{d.action}</p>
      {answer ? <p className="mind-why">Answer: {answer}</p> : null}
      <span className="mind-jev">
        <span className="mind-jev-icon" data-tone={d.verified ? "success" : "warning"}>
          <ProductIcon name={d.verified ? "checkCircle" : "alertTriangle"} size={16} />
        </span>
        <span>{d.verified ? "Verified by JEV" : (d.stamp ?? "UNVERIFIED BY JEV")}</span>
      </span>
    </li>
  );
}

/** Written skills a cat read on its last step, in the order it read them (the built-in pack first). */
export function WrittenSkills({ skills }: { skills: AgentMindDTO["crewSkills"] }) {
  const read = skills.filter((k) => !k.skipped);
  const trimmed = skills.length - read.length;
  const tokens = read.reduce((n, k) => n + k.tokens, 0);
  const builtin = read.filter((k) => k.source === "builtin").length;
  const own = read.length - builtin;
  const counts = [builtin ? `${fmtInt(builtin)} built in` : "", own ? `${builtin ? "then " : ""}${fmtInt(own)} of yours` : ""].filter(Boolean).join(", ");
  return (
    <Group
      title="Written skills it read"
      meta={
        skills.length ? (
          <>
            {counts || "none read"}, <span className="num">{fmtInt(tokens)}</span> tokens in all
            {trimmed ? `, ${fmtInt(trimmed)} trimmed by the cap` : ""}
          </>
        ) : undefined
      }
    >
      {skills.length === 0 ? (
        <p className="app-empty-line mind-empty">No written skill matched its role on its last step.</p>
      ) : (
        <ul className="mind-list mind-written" aria-label="Written skills it read">
          {skills.map((k) => (
            <li className="mind-written-item" key={k.id}>
              <span className="mind-written-name">{k.name}</span>
              <span className="mind-written-side">
                <Chip>{k.source === "builtin" ? "Built in" : "Yours"}</Chip>
                {k.skipped ? (
                  <span>Trimmed by the cap</span>
                ) : (
                  <span>
                    <span className="num">{fmtInt(k.tokens)}</span> tokens
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mind-why">
        <a href="/app/skills">Manage written skills</a>
      </p>
    </Group>
  );
}

function CatLink({ agent, onOpen, note }: { agent: AgentDTO; onOpen: (id: string) => void; note?: string }) {
  return (
    <DataRow
      kind="org"
      onPress={() => onOpen(agent.id)}
      ariaLabel={`${agent.name}, ${note ?? roleTitleOf(agent)}. Open ${agent.name}`}
      title={agent.name}
      meta={<span>{note ?? roleTitleOf(agent)}</span>}
      trailing={<ProductIcon name="chevronRight" size={20} />}
    />
  );
}

export function Mind({
  runId,
  state,
  agent,
  spend,
  now,
  onOpenAgent,
}: {
  runId: string;
  state: RunState;
  agent: AgentDTO;
  spend: AgentSpend | undefined;
  now: number;
  onOpenAgent: (id: string) => void;
}) {
  const level = useMotionLevel();
  // A strategy the cat or its role adopts mid run reaches its next step: read the head again.
  const roleKey = agent.roleId ? (state.roles[agent.roleId]?.key ?? agent.roleId) : agent.role;
  const refresh = `${state.strategies[`agent:${agent.id}`]?.version ?? 0}:${state.strategies[`role:${roleKey}`]?.version ?? 0}`;
  const [load, retry] = useMind(runId, agent.id, refresh);

  const role = agent.roleId ? state.roles[agent.roleId] : undefined;
  const tools = role?.tools?.length ? role.tools : ROLE_TOOLS[agent.archetype ?? agent.role] ?? [];
  const bossId = agent.parentId ?? agent.hiredBy ?? null;
  const boss = bossId && bossId !== agent.id ? state.agents[bossId] : undefined;
  const crew = crewOrder(state).filter((a) => a.id !== agent.id && (a.parentId === agent.id || (!a.parentId && a.hiredBy === agent.id)));
  const used = spend ? spend.inputTokens + spend.outputTokens : tokensUsed(agent.usage);
  const cost = spend?.costUsd ?? agent.usage.costUsd;
  const budget = state.run?.budgetTokens ?? 0;
  const share = budget > 0 ? used / budget : 0;

  const mind = load.kind === "ready" ? load.mind : null;
  // an engine from before written skills sends none
  const written = mind?.crewSkills ?? [];
  const reveal = level === "off" ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: T.reduced } } : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0, transition: T.base } };

  let head: ReactNode;
  if (load.kind === "loading") head = <SkeletonRows rows={3} label={`Reading what is in ${agent.name}'s head`} />;
  else if (load.kind === "missing")
    head = <p className="app-empty-line mind-empty">This server does not share what is in a cat's head yet. Its tools, its boss and its budget are below.</p>;
  else if (load.kind === "error")
    head = (
      <div className="mind-error" role="alert">
        <p className="app-form-status" data-tone="danger">
          <ProductIcon name="alertCircle" size={16} />
          <span>{load.message}</span>
        </p>
        <button type="button" className="btn-secondary" onClick={retry}>
          <ProductIcon name="refresh" size={20} />
          <span>Try again</span>
        </button>
      </div>
    );
  else head = null;

  const summary = mind
    ? `${agent.name} runs the ${mind.charter.title} charter v${mind.charter.version} with ${mind.addenda.length} learned ${mind.addenda.length === 1 ? "strategy" : "strategies"}, ${mind.lessons.length} ${mind.lessons.length === 1 ? "lesson" : "lessons"}, ${mind.skills.length} saved ${mind.skills.length === 1 ? "skill" : "skills"} and ${written.length} written ${written.length === 1 ? "skill" : "skills"}.`
    : `What ${agent.name} works from: its charter, what it learned, and who it answers to.`;

  return (
    <section className="mind" data-container="divided" aria-labelledby="mind-h">
      <div className="mind-top">
        <h3 className="mind-title" id="mind-h">
          In its head
        </h3>
        <p className="mind-meta">{summary}</p>
      </div>
      {head}
      {mind ? (
        <motion.div className="mind-groups" key={mind.agentId} initial={reveal.initial} animate={reveal.animate}>
          <Group
            title="Charter"
            meta={
              <>
                {mind.charter.title}, version <span className="num">{mind.charter.version}</span>, <span className="num">{fmtInt(mind.charter.tokens)}</span> tokens
              </>
            }
          >
            <p className="mind-why">
              {mind.charter.dynamic ? `A role the crew defined on top of the ${ROLE_LABEL[mind.role]} role.` : `The base ${ROLE_LABEL[mind.role]} role.`} Prompt cache key{" "}
              <span className="num">{mind.layerVersion}</span>
            </p>
            <Disclosure label="Read the charter" openLabel="Hide the charter">
              <p className="mind-text mind-charter">{mind.charter.text}</p>
            </Disclosure>
          </Group>

          <Group title="Learned strategies" meta={mind.addenda.length ? "Injected into its charter, its role's first, then its own" : undefined}>
            {mind.addenda.length === 0 ? (
              <p className="app-empty-line mind-empty">None yet. The charter runs as written.</p>
            ) : (
              <ol className="mind-list">
                {mind.addenda.map((v) => (
                  <Addendum key={v.id} v={v} name={agent.name} />
                ))}
              </ol>
            )}
          </Group>

          <Group title="Lessons and skills in its prompt" meta={mind.lessons.length + mind.skills.length ? "Each one with why it was picked" : undefined}>
            {mind.lessons.length + mind.skills.length === 0 ? (
              <p className="app-empty-line mind-empty">Nothing picked for its current task.</p>
            ) : (
              <ul className="mind-list">
                {mind.lessons.map((l) => (
                  <li className="mind-item" key={l.id}>
                    <p className="mind-item-title">
                      Lesson
                      <span className="mind-item-side">
                        <ProductIcon name="memory" size={16} />
                      </span>
                    </p>
                    <p className="mind-text">{l.text}</p>
                    <p className="mind-why">Picked because {l.reason.charAt(0).toLowerCase() + l.reason.slice(1)}</p>
                  </li>
                ))}
                {mind.skills.map((k) => (
                  <li className="mind-item" key={k.id}>
                    <p className="mind-item-title">
                      Skill: {k.name}
                      <span className="mind-item-side">
                        <ProductIcon name="task" size={16} />
                      </span>
                    </p>
                    <p className="mind-text">{k.description}</p>
                    <p className="mind-why">Picked because {k.reason.charAt(0).toLowerCase() + k.reason.slice(1)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Group>

          <WrittenSkills skills={written} />

          <Group title="JEV decisions about it" meta={mind.decisions.length ? `${mind.decisions.length} ${mind.decisions.length === 1 ? "call" : "calls"}: its hire, its role, its strategies` : undefined}>
            {mind.decisions.length === 0 ? (
              <p className="app-empty-line mind-empty">No soft call about this cat yet.</p>
            ) : (
              <ol className="mind-list">
                {mind.decisions.map((d) => (
                  <Decision key={d.id} d={d} />
                ))}
              </ol>
            )}
          </Group>

          <Group title="Version history" meta={mind.history.length ? "Newest first" : undefined}>
            <History history={mind.history} name={agent.name} now={now} />
          </Group>
        </motion.div>
      ) : null}

      <Group title="Tools it may call" meta={`${tools.length} ${tools.length === 1 ? "tool" : "tools"}${role ? `, a subset of the ${ROLE_LABEL[role.archetype]} tools` : ""}`}>
        <p className="mind-tool-line num" aria-label={`${agent.name}'s tools`}>
          {tools.join(", ")}
        </p>
      </Group>

      <Group title="Boss and crew">
        {boss || crew.length ? (
          <DataRows label={`${agent.name}'s boss and crew`}>
            {boss ? <CatLink agent={boss} onOpen={onOpenAgent} note={`${roleTitleOf(boss)}, its boss`} /> : null}
            {crew.map((c) => (
              <CatLink key={c.id} agent={c} onOpen={onOpenAgent} note={`${roleTitleOf(c)}, reports to ${agent.name}`} />
            ))}
          </DataRows>
        ) : (
          <p className="app-empty-line mind-empty">{agent.role === "lead" ? "It runs the company and answers to you." : "No crew of its own."}</p>
        )}
        {agent.hireReason ? <p className="mind-why">Hired because {withArticles(agent.hireReason.charAt(0).toLowerCase() + agent.hireReason.slice(1))}</p> : null}
      </Group>

      <Group
        title="Budget used"
        meta={
          <>
            <span className="num">{fmtInt(used)}</span> tokens, <span className="num">{fmtUsd(cost)}</span>
            {budget > 0 ? (
              <>
                , <span className="num">{fmtPct(share)}</span> of the run budget
              </>
            ) : (
              ", the run has no token cap"
            )}
          </>
        }
      >
        {budget > 0 ? <Meter label={`${agent.name}'s share of the run budget`} value={share} valueText={`${fmtInt(used)} of ${fmtInt(budget)} tokens`} compact /> : null}
      </Group>
    </section>
  );
}
