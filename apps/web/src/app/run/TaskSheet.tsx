// One task up close, opened from its card on the floor (JEV: card, the
// JAL Core Sheet spec): what it is, who holds it, what it waits on, how
// it is judged, what came of it, and the two changes the owner may make
// (cancel a task that has not started, or put a stopped one back in the
// queue). A bottom sheet below 640px, a centred sheet above.
import { ROLE_LABEL, type TaskDTO } from "@mengai/shared";
import { Chip, KeyValue, ProductIcon, Sheet, StatusPill } from "@mengai/ui/src/product";
import type { RunState } from "../../store/runStore";
import { fmtClock } from "../format";
import { useAction } from "../hooks";
import { TASK_STATUS } from "../status";
import { laneOf } from "./derive";

export function TaskSheet({
  state,
  taskId,
  onClose,
  onPatch,
  readOnly,
}: {
  state: RunState;
  taskId: string | null;
  onClose: () => void;
  onPatch: (taskId: string, status: "queued" | "cancelled") => Promise<void>;
  readOnly: boolean;
}) {
  const act = useAction();
  const task: TaskDTO | undefined = taskId ? state.tasks[taskId] : undefined;
  const look = task ? TASK_STATUS[task.status] : null;
  const holder = task ? laneOf(state, task) : null;
  const who = holder ? state.agents[holder] : undefined;
  const maker = task?.assigneeId ? state.agents[task.assigneeId] : undefined;
  const planner = task?.createdBy ? state.agents[task.createdBy] : undefined;
  const round = task ? (state.rounds[task.id] ?? 0) : 0;
  const deps = task ? task.deps.map((id) => state.tasks[id]).filter((d): d is TaskDTO => !!d) : [];
  const parent = task?.parentId ? state.tasks[task.parentId] : undefined;
  const canCancel = !!task && !readOnly && (task.status === "queued" || task.status === "ready" || task.status === "waiting" || task.status === "blocked");
  const canRequeue = !!task && !readOnly && (task.status === "failed" || task.status === "cancelled");

  return (
    <Sheet
      open={!!task}
      onClose={onClose}
      title={task?.title ?? "Task"}
      description={task && look ? <StatusPill tone={look.tone} icon={look.icon}>{look.word}</StatusPill> : undefined}
      footer={
        canCancel || canRequeue ? (
          <>
            {act.error ? (
              <p className="app-form-status" data-tone="danger" role="alert">
                <ProductIcon name="alertCircle" size={16} />
                <span>{act.error}</span>
              </p>
            ) : null}
            {canCancel ? (
              <button type="button" className="btn-secondary app-btn-danger" aria-busy={act.busy || undefined} onClick={() => act.run(() => onPatch(task!.id, "cancelled"))}>
                <ProductIcon name="minusCircle" size={20} />
                <span>Cancel this task</span>
              </button>
            ) : null}
            {canRequeue ? (
              <button type="button" className="btn-secondary" aria-busy={act.busy || undefined} onClick={() => act.run(() => onPatch(task!.id, "queued"))}>
                <ProductIcon name="refresh" size={20} />
                <span>Put it back in the queue</span>
              </button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {task ? (
        <div className="task-sheet">
          {task.spec ? <p className="task-sheet-spec">{task.spec}</p> : null}
          <KeyValue
            label="Task facts"
            items={[
              { label: "With", value: who ? `${who.name}, ${ROLE_LABEL[who.role]}` : `Waiting for a ${ROLE_LABEL[task.role].toLowerCase()}` },
              ...(maker && maker.id !== who?.id ? [{ label: "Made by", value: `${maker.name}, ${ROLE_LABEL[maker.role]}` }] : []),
              ...(planner ? [{ label: "Planned by", value: planner.name }] : []),
              ...(round > 0 ? [{ label: "Review", value: `Round ${round}`, mono: false }] : []),
              ...(parent ? [{ label: "Fix for", value: parent.title }] : []),
              ...(task.startedAt ? [{ label: "Started", value: fmtClock(task.startedAt), mono: true }] : []),
              ...(task.endedAt ? [{ label: "Ended", value: fmtClock(task.endedAt), mono: true }] : []),
            ]}
          />
          {deps.length > 0 ? (
            <div className="task-sheet-block">
              <p className="task-sheet-label">Starts after</p>
              <p className="task-sheet-chips">
                {deps.map((d) => (
                  <Chip key={d.id} icon={d.status === "done" ? "checkCircle" : "hourglass"} tone={d.status === "done" ? "success" : "neutral"} title={d.title}>
                    {d.title}
                  </Chip>
                ))}
              </p>
            </div>
          ) : null}
          {task.acceptance.length > 0 ? (
            <div className="task-sheet-block">
              <p className="task-sheet-label">Done when</p>
              <ul className="task-sheet-list">
                {task.acceptance.map((a) => (
                  <li key={a}>
                    <span className="task-sheet-check" data-done={task.status === "done" ? "" : undefined}>
                      <ProductIcon name={task.status === "done" ? "checkCircle" : "task"} size={16} />
                    </span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {task.resultSummary ? (
            <div className="task-sheet-block">
              <p className="task-sheet-label">Result</p>
              <p className="task-sheet-result">{task.resultSummary}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
