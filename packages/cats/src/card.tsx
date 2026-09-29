// CatCard: one agent at a glance. The cat on its flat cushion at the start,
// the text column beside it (a container query stacks them under 280 px):
// name and role, status, task, and the energy used. The whole card is the
// hit target when it can be selected; selection is a tonal fill with an ink
// hairline on all four sides (JEV ui.component_recipe: core.card.row, tonal).
import { useId, type CSSProperties } from "react";
import { ACTIVITY_LABEL, ROLE_LABEL, STATUS_LABEL } from "@mengai/shared";
import type { CatCardProps } from "./contract";
import { CatFigure } from "./cat";
import { clampEnergy, energyPercent } from "./poses";

export function CatCard(props: CatCardProps) {
  const { name, statusText, taskTitle, energy, selected, onSelect, size = 96, ...cat } = props;
  const ids = useId();
  const statusId = `${ids}-status`;
  const taskId = `${ids}-task`;
  const energyId = `${ids}-energy`;
  const percent = energyPercent(energy);
  const detail = statusText ?? ACTIVITY_LABEL[cat.activity];
  const task = taskTitle ?? "No task yet";

  const content = (
    <span className="cat-card-layout">
      <span className="cat-card-media">
        <CatFigure {...cat} size={size} cushion caption={false} host="figure" />
      </span>
      <span className="cat-card-body">
        <span className="cat-card-head">
          <span className="cat-card-name">{name}</span>
          <span className="cat-card-role">{ROLE_LABEL[cat.role]}</span>
        </span>
        <span className="cat-card-status" id={statusId}>
          <span className="cat-card-state">{STATUS_LABEL[cat.status]}</span>
          {detail !== STATUS_LABEL[cat.status] ? <span className="cat-card-detail">{detail}</span> : null}
        </span>
        <span className="cat-card-task" id={taskId} data-empty={taskTitle ? undefined : ""} title={taskTitle ?? undefined}>
          {task}
        </span>
        <span className="cat-card-meter" id={energyId}>
          <span className="cat-card-meter-label">Energy used</span>
          <span className="cat-card-meter-value">{percent}%</span>
          <span className="cat-card-bar" aria-hidden="true">
            <span className="cat-card-fill" style={{ "--cat-energy": String(clampEnergy(energy)) } as CSSProperties} />
          </span>
        </span>
      </span>
    </span>
  );

  const shared = {
    className: "cat-card",
    "data-cat-card": name,
    "data-status": cat.status,
    "data-selected": selected ? "" : undefined,
  };

  if (onSelect) {
    return (
      <button
        type="button"
        {...shared}
        aria-label={cat.label}
        aria-describedby={`${statusId} ${taskId} ${energyId}`}
        aria-pressed={selected === undefined ? undefined : selected}
        onClick={onSelect}
      >
        {content}
      </button>
    );
  }
  return (
    <article {...shared} aria-label={cat.label}>
      {content}
    </article>
  );
}
