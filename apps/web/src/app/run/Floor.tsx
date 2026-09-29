// The run floor: the ethogram of the crew at work (structure roll
// "MengAI" "/app/runs/:id", key 5525723a, drawn c3 ethogram swimlanes; JEV
// ui.region_gate rows, ui.component_recipe core.list 0.90 with layers
// an.R32 deal-in 0.76 and an.R21 shared layout 0.66).
//
// One lane per cat, the lead first, in three departments. The lane starts
// with the cat's CatCard (status, activity, mood, task and energy straight
// from the live store, so the cats package poses every scenario) and then
// the task cards the cat owns, in the column of their status: Planned,
// Working, In review, Done. Every card is one Framer Motion element keyed by
// handoffLayoutId(taskId), so each beat is the same card travelling:
//   plan        the lead's new cards are dealt into its Planned cell in order
//   pick up     a card flies from the lead's lane to the cat that starts it
//   status      a card slides across to its next column
//   handoff     a card flies down to the next cat's lane
//   bounce      a review that asks for changes flies the card back to its
//               maker with the next round number, then forward again
//   done        the card returns to its maker's Done cell, the cat celebrates
// Below 1280px the four columns fold into one list per lane with a status
// word on each card; the cards still travel between lanes. A card is a link
// to #task=<id>, so a task opens in its sheet, deep links, and Back closes it.
import { CatCard, handoffLayoutId, type CatSize } from "@mengai/cats";
import { ACTIVITY_LABEL, ROLE_LABEL, type AgentDTO, type TaskDTO } from "@mengai/shared";
import { Chip, StatusPill } from "@mengai/ui/src/product";
import { LayoutGroup, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { RunState } from "../../store/runStore";
import { T, dealDelay, type MotionLevel } from "../motion";
import { TASK_STATUS } from "../status";
import { RegionHead } from "../ui";
import { LANE_COLUMNS, LANE_COLUMN_LABEL, crewGroups, energyOf, floorOf, shortTitle, type AgentSpend, type LaneCells } from "./derive";

export interface FloorProps {
  state: RunState;
  spend: Record<string, AgentSpend>;
  selected: string | null;
  onSelect: (agentId: string) => void;
  still: boolean;
  catSize: CatSize;
  motion: MotionLevel;
}

function summary(state: RunState): string {
  const agents = state.agentOrder.map((id) => state.agents[id]).filter((a): a is AgentDTO => !!a);
  const working = agents.filter((a) => a.status === "working" || a.status === "thinking").length;
  const asking = agents.filter((a) => a.status === "approval").length;
  const parts = [`${agents.length} ${agents.length === 1 ? "cat" : "cats"}`, `${working} at work`];
  if (asking > 0) parts.push(`${asking} ${asking === 1 ? "needs" : "need"} you`);
  return parts.join(", ");
}

/** What the card under the cat's name says it is doing: the tool in flight, else its own words. */
function doingLine(state: RunState, a: AgentDTO): string | null {
  const tool = state.tools[a.id];
  if (tool) return `${tool.tool} ${tool.argsPreview}`;
  return a.statusText;
}

/**
 * Cards already on the board at first paint never replay an entrance; a
 * card that appears later is dealt in. Scrubbing a replay backwards resets
 * the memory, so playing forward deals the plan again.
 */
function useFreshCards(state: RunState): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const length = useRef(state.log.length);
  if (seen.current === null || state.log.length < length.current) seen.current = new Set(state.taskOrder);
  length.current = state.log.length;
  const fresh = new Set<string>();
  for (const id of state.taskOrder) if (!seen.current.has(id)) fresh.add(id);
  useEffect(() => {
    for (const id of fresh) seen.current?.add(id);
  });
  return fresh;
}

function TaskCard({ task, state, fresh, level }: { task: TaskDTO; state: RunState; fresh: boolean; level: MotionLevel }) {
  const look = TASK_STATUS[task.status];
  const round = state.rounds[task.id] ?? 0;
  const deps = task.deps.map((id) => state.tasks[id]).filter((d): d is TaskDTO => !!d);
  const off = level === "off";
  const delay = dealDelay(state.deal[task.id] ?? 0, level);
  const words = `${task.title}, ${look.word.toLowerCase()}${round > 1 ? `, review round ${round}` : ""}`;
  return (
    <motion.li
      layoutId={off ? undefined : handoffLayoutId(task.id)}
      layout={off ? false : "position"}
      className="tcard-item"
      initial={fresh && !off ? { opacity: 0, y: -8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={off ? T.none : { layout: T.slow, opacity: { ...T.slow, delay }, y: { ...T.slow, delay } }}
    >
      <a className="tcard" href={`#task=${encodeURIComponent(task.id)}`} data-status={task.status} aria-label={`${words}. Open the task`}>
        <span className="tcard-title">{task.title}</span>
        <span className="tcard-meta">
          <span className="tcard-status">
            <StatusPill tone={look.tone} icon={look.icon}>
              {look.word}
            </StatusPill>
          </span>
          {round > 0 ? (
            <span className="tcard-round">
              Round <span className="tnum">{round}</span>
            </span>
          ) : null}
        </span>
        {deps.length > 0 ? (
          <span className="tcard-deps">
            {deps.map((d) => (
              <Chip key={d.id} icon={d.status === "done" ? "checkCircle" : "hourglass"} tone={d.status === "done" ? "success" : "neutral"} title={`After ${d.title}`}>
                After {shortTitle(d.title, 24)}
              </Chip>
            ))}
          </span>
        ) : null}
      </a>
    </motion.li>
  );
}

function Lane({ agent, cells, fresh, props }: { agent: AgentDTO; cells: LaneCells; fresh: Set<string>; props: FloorProps }) {
  const { state, spend, selected, onSelect, still, catSize, motion: level } = props;
  const doing = agent.status === "approval" ? "Needs you" : ACTIVITY_LABEL[agent.activity];
  const label = `${agent.name}, ${ROLE_LABEL[agent.role]}, ${doing.toLowerCase()}`;
  const task = agent.currentTaskId ? state.tasks[agent.currentTaskId] : undefined;
  const energy = energyOf(spend[agent.id], state.run?.budgetTokens ?? 0);
  return (
    <li className="lane" data-status={agent.status} aria-label={`${agent.name}'s lane`}>
      <div className="lane-cat">
        <CatCard
          look={agent.look}
          role={agent.role}
          status={agent.status}
          activity={agent.activity}
          mood={agent.mood}
          label={label}
          size={catSize}
          still={still}
          celebrateKey={state.celebrate[agent.id]}
          name={agent.name}
          statusText={doingLine(state, agent)}
          taskTitle={task?.title ?? null}
          energy={energy}
          selected={selected === agent.id}
          onSelect={() => onSelect(agent.id)}
        />
      </div>
      <div className="lane-cells">
        {LANE_COLUMNS.map((col) => (
          <ul key={col} className="lane-cell" data-col={col} data-empty={cells[col].length > 0 ? undefined : ""} aria-label={`${agent.name}, ${LANE_COLUMN_LABEL[col]}`}>
            {cells[col].map((t) => (
              <TaskCard key={t.id} task={t} state={state} fresh={fresh.has(t.id)} level={level} />
            ))}
          </ul>
        ))}
      </div>
    </li>
  );
}

export function Floor(props: FloorProps) {
  const { state } = props;
  const groups = crewGroups(state);
  const floor = floorOf(state);
  const fresh = useFreshCards(state);
  return (
    <section className="app-region floor" data-container="rows" aria-labelledby="floor-h">
      <RegionHead title="The crew at work" id="floor-h" meta={groups.length > 0 ? summary(state) : undefined} />
      {groups.length === 0 ? (
        <p className="app-empty-line">No cats yet. Kopi joins the moment the run starts.</p>
      ) : (
        <div className="floor-board">
          <div className="floor-cols" aria-hidden="true">
            <span className="floor-col">Cat</span>
            {LANE_COLUMNS.map((c) => (
              <span className="floor-col" key={c}>
                <span>{LANE_COLUMN_LABEL[c]}</span>
                <span className="tnum floor-count">{floor.counts[c]}</span>
              </span>
            ))}
          </div>
          <LayoutGroup id="floor">
            {groups.map((g) => (
              <div className="floor-dept" key={g.id} role="group" aria-label={g.label}>
                <p className="floor-dept-label" aria-hidden="true">
                  <span>{g.label}</span>
                  <span className="tnum floor-count">{g.agents.length}</span>
                </p>
                <ul className="floor-lanes">
                  {g.agents.map((a) => (
                    <Lane key={a.id} agent={a} cells={floor.lanes[a.id] ?? { planned: [], working: [], review: [], done: [] }} fresh={fresh} props={props} />
                  ))}
                </ul>
              </div>
            ))}
          </LayoutGroup>
        </div>
      )}
    </section>
  );
}
