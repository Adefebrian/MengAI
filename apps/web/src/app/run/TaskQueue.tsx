// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The task queue (JEV ui.region_gate rows, ui.component_recipe core.list
// 0.93 with layer an.R21 0.74, motion tier 1): every task in the group of
// its status, the way a team's board reads top to bottom: Doing, In review,
// Up next, Done. A row is a link to #task=<id>, so a task opens in its
// sheet, deep links, and Back closes it. A row that changes status travels
// to its new group by one layout transform; under reduced motion it just
// appears there. A row animates only when its own status changes
// (layoutDependency), so the page moving around the queue (the office above
// growing) never slides the rows. Review tasks ride under the task they review, so the
// queue shows the work, and the round number says how often it went back.
import type { TaskDTO, TaskStatus } from "@mengai/shared";
import { StatusPill } from "@mengai/ui/src/product";
import { LayoutGroup, motion } from "motion/react";
import type { RunState } from "../../store/runStore";
import { T, useMotionLevel } from "../motion";
import { TASK_STATUS } from "../status";
import { RegionHead } from "../ui";
import { shortTitle, taskCounts } from "./derive";
import { isReviewTask } from "./office";

type GroupId = "doing" | "review" | "next" | "done";

const GROUPS: Array<{ id: GroupId; label: string }> = [
  { id: "doing", label: "Doing" },
  { id: "review", label: "In review" },
  { id: "next", label: "Up next" },
  { id: "done", label: "Done" },
];

function groupOf(status: TaskStatus): GroupId {
  switch (status) {
    case "running":
      return "doing";
    case "review":
      return "review";
    case "done":
    case "failed":
    case "cancelled":
      return "done";
    default:
      return "next";
  }
}

export function queueGroups(state: RunState): Record<GroupId, TaskDTO[]> {
  const out: Record<GroupId, TaskDTO[]> = { doing: [], review: [], next: [], done: [] };
  for (const id of state.taskOrder) {
    const t = state.tasks[id];
    if (!t || isReviewTask(t, state)) continue;
    out[groupOf(t.status)].push(t);
  }
  // Done reads newest first; the rest keep the plan order.
  out.done.sort((a, b) => (b.endedAt ?? b.updatedAt) - (a.endedAt ?? a.updatedAt));
  return out;
}

function ownerName(state: RunState, t: TaskDTO): string | null {
  const id = t.assigneeId ?? state.holders[t.id] ?? null;
  return id ? (state.agents[id]?.name ?? null) : null;
}

export function TaskQueue({ state }: { state: RunState }) {
  const level = useMotionLevel();
  const off = level === "off";
  const groups = queueGroups(state);
  const c = taskCounts(state);
  const layout = off ? false : ("position" as const);
  const any = GROUPS.some((g) => groups[g.id].length > 0);
  return (
    <section className="app-region queue" data-container="rows" aria-labelledby="queue-h">
      <RegionHead title="Tasks" id="queue-h" meta={any ? `${groups.doing.length} doing, ${groups.review.length} in review, ${c.done} of ${c.total} done` : undefined} />
      {!any ? (
        <p className="app-empty-line">No tasks yet. The CEO plans them the moment the run starts.</p>
      ) : (
        <LayoutGroup id="queue">
          <div className="queue-groups">
            {GROUPS.filter((g) => groups[g.id].length > 0).map((g) => (
              <div className="queue-group" key={g.id} role="group" aria-labelledby={`queue-${g.id}`}>
                <p className="queue-group-head" id={`queue-${g.id}`}>
                  <span>{g.label}</span>
                  <span className="tnum queue-count">{groups[g.id].length}</span>
                </p>
                <ul className="queue-list">
                  {groups[g.id].map((t) => {
                    const look = TASK_STATUS[t.status];
                    const round = state.rounds[t.id] ?? 0;
                    const owner = ownerName(state, t);
                    const deps = t.deps.map((id) => state.tasks[id]).filter((d): d is TaskDTO => !!d && d.status !== "done");
                    const words = `${t.title}, ${look.word.toLowerCase()}${owner ? `, ${owner}` : ""}${round > 1 ? `, review round ${round}` : ""}`;
                    return (
                      <motion.li
                        key={t.id}
                        layoutId={off ? undefined : `queue-${t.id}`}
                        layout={layout}
                        layoutDependency={t.status}
                        transition={off ? T.none : { layout: T.slow }}
                        className="queue-item"
                      >
                        <a className="queue-row" href={`#task=${encodeURIComponent(t.id)}`} aria-label={`${words}. Open the task`}>
                          <span className="queue-title" title={t.title}>
                            {t.title}
                          </span>
                          <span className="queue-meta">
                            <StatusPill tone={look.tone} icon={look.icon}>
                              {look.word}
                            </StatusPill>
                            {owner ? <span>{owner}</span> : <span>Not picked up</span>}
                            {round > 1 ? (
                              <span>
                                Round <span className="tnum">{round}</span>
                              </span>
                            ) : null}
                            {g.id === "next" && deps.length > 0 ? <span title={deps.map((d) => d.title).join(", ")}>After {shortTitle(deps[0]!.title, 24)}</span> : null}
                          </span>
                        </a>
                      </motion.li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </LayoutGroup>
      )}
    </section>
  );
}
