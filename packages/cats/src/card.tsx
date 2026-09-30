// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// CatCard: one agent at a glance (JEV ui.component_recipe: core.card.row).
// The cat sits on its flat cushion in its own reserved square at the start;
// the text has its own rows beside it: name and role, status, a two line
// task, and the energy used. A container query stacks the square on top
// when the card is narrow. The square and the text column never share
// space, so nothing ever draws over a neighbour. The whole card is the hit
// target when it can be selected; selection is a tonal fill with an ink
// hairline on all four sides. From 85% of the budget the meter says
// "Running low" (JEV energy_low: word_only) and the cat turns tired.
import { useId, type CSSProperties } from "react";
import { ROLE_LABEL, STATUS_LABEL } from "@mengai/shared";
import type { CatCardProps } from "./contract";
import { CatFigure } from "./cat";
import { activityWords, clampEnergy, energyPercent, isLowEnergy } from "./poses";

export function CatCard(props: CatCardProps) {
  const { name, statusText, taskTitle, energy, selected, onSelect, size = 96, ...cat } = props;
  const ids = useId();
  const statusId = `${ids}-status`;
  const taskId = `${ids}-task`;
  const energyId = `${ids}-energy`;
  const percent = energyPercent(energy);
  const low = isLowEnergy(energy);
  const state = STATUS_LABEL[cat.status];
  const detail = statusText ?? activityWords(cat.activity);
  const task = taskTitle ?? "No task yet";

  const content = (
    <span className="cat-card-layout">
      <span className="cat-card-media">
        <CatFigure {...cat} size={size} energy={energy} cushion caption={false} host="figure" />
      </span>
      <span className="cat-card-body">
        <span className="cat-card-head">
          <span className="cat-card-name">{name}</span>
          <span className="cat-card-role">{ROLE_LABEL[cat.role]}</span>
        </span>
        <span className="cat-card-status" id={statusId}>
          <span className="cat-card-state">{state}</span>
          {detail !== state ? <span className="cat-card-detail">{detail}</span> : null}
        </span>
        <span className="cat-card-task" id={taskId} data-empty={taskTitle ? undefined : ""} title={taskTitle ?? undefined}>
          {task}
        </span>
        <span className="cat-card-meter" id={energyId}>
          <span className="cat-card-meter-label">Energy used</span>
          {low ? <span className="cat-card-meter-low">Running low</span> : null}
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
    "data-size": String(size),
    "data-status": cat.status,
    "data-energy": low ? "low" : undefined,
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
