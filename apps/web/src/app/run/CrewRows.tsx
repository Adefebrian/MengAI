// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The crew as rows (JEV ui.region_gate rows 0.82, ui.component_recipe
// core.list 0.9, the fade-up layer refused at 0.42): one button row per
// cat, the cat in its pose at the start of each row like the observation
// sheet, then its name, its role title (base or one the crew defined),
// what it is doing and its tokens. The cats that were let go follow in
// their own group with the reason. A row opens the same drawer as a click
// on the cat in the office.
import { Cat } from "@mengai/cats";
import { DataRow, DataRows, DataRowsGroup, ProductIcon } from "@mengai/ui/src/product";
import type { AgentDTO } from "@mengai/shared";
import type { RunState } from "../../store/runStore";
import { crewOrder, departedOrder, tokensUsed } from "../../store/runStore";
import { fmtAgo, fmtInt } from "../format";
import { AGENT_STATUS } from "../status";
import { RegionHead } from "../ui";
import type { AgentSpend } from "./derive";
import { clip, doingPhrase, roleTitleOf } from "./office";

function doing(a: AgentDTO, s: RunState): string {
  if (a.status === "approval") return "needs you";
  if (a.status === "done") return "done";
  if (a.status === "stopped") return "stopped";
  if (a.status === "error") return "hit an error";
  if (a.status === "idle") return "free for the next card";
  return doingPhrase(a, s);
}

export function CrewRows({
  state,
  spend,
  still,
  selectedId,
  onOpen,
  now,
}: {
  state: RunState;
  spend: Record<string, AgentSpend>;
  still: boolean;
  selectedId: string | null;
  onOpen: (agentId: string) => void;
  now: number;
}) {
  const crew = crewOrder(state);
  const gone = departedOrder(state);
  const tokens = (a: AgentDTO) => {
    const s = spend[a.id];
    return s ? s.inputTokens + s.outputTokens : tokensUsed(a.usage);
  };
  const nameOf = (id: string | null | undefined) => (id ? state.agents[id]?.name : undefined);
  return (
    <section className="app-region crew-rows" data-container="rows" aria-labelledby="crew-h">
      <RegionHead
        title="Crew"
        id="crew-h"
        meta={`${crew.length} ${crew.length === 1 ? "cat" : "cats"} at work${gone.length ? `, ${gone.length} let go` : ""}. Open a cat to see what is in its head.`}
      />
      <DataRows label="The crew">
        {crew.map((a) => {
          const look = AGENT_STATUS[a.status];
          const hiredBy = a.role === "lead" ? null : nameOf(a.hiredBy ?? a.parentId);
          return (
            <DataRow
              key={a.id}
              kind="crew"
              onPress={() => onOpen(a.id)}
              selected={selectedId === a.id}
              ariaLabel={`${a.name}, ${roleTitleOf(a)}, ${doing(a, state)}. Open ${a.name}`}
              leading={
                <span className="crew-cat" aria-hidden="true">
                  <Cat look={a.look} role={a.role} status={a.status} activity={a.activity} mood={a.mood} label={a.name} size={48} still={still} />
                </span>
              }
              title={
                <>
                  {a.name} <span className="crew-role">{roleTitleOf(a)}</span>
                </>
              }
              meta={
                <>
                  <span className="crew-doing">
                    <span className="crew-doing-icon" data-tone={look.tone}>
                      <ProductIcon name={look.icon} size={16} />
                    </span>
                    <span>{clip(doing(a, state).replace(/^./, (c) => c.toUpperCase()), 56)}</span>
                  </span>
                  <span>
                    <span className="num">{fmtInt(tokens(a))}</span> tokens
                  </span>
                  {hiredBy ? <span>Hired by {hiredBy}</span> : null}
                </>
              }
              trailing={<ProductIcon name="chevronRight" size={20} />}
            />
          );
        })}
        {gone.length > 0 ? <DataRowsGroup label="Left the company" count={gone.length} /> : null}
        {gone.map((a) => {
          const d = state.departed[a.id]!;
          const by = nameOf(d.byAgentId);
          return (
            <DataRow
              key={a.id}
              kind="departed"
              onPress={() => onOpen(a.id)}
              selected={selectedId === a.id}
              ariaLabel={`${a.name}, ${roleTitleOf(a)}, let go: ${d.reason}. Open ${a.name}`}
              leading={
                <span className="crew-cat" data-gone="" aria-hidden="true">
                  <Cat look={a.look} role={a.role} status="stopped" activity="rest" mood={a.mood} label={a.name} size={48} still />
                </span>
              }
              title={
                <>
                  {a.name} <span className="crew-role">{roleTitleOf(a)}</span>
                </>
              }
              meta={
                <>
                  <span className="crew-doing">
                    <span className="crew-doing-icon">
                      <ProductIcon name="logout" size={16} />
                    </span>
                    <span>
                      Let go{by ? ` by ${by}` : ""}: {clip(d.reason, 80)}
                    </span>
                  </span>
                  <span>{fmtAgo(d.at, now)}</span>
                  {d.requeued.length ? (
                    <span>
                      <span className="num">{d.requeued.length}</span> {d.requeued.length === 1 ? "card" : "cards"} back on the board
                    </span>
                  ) : null}
                </>
              }
              trailing={<ProductIcon name="chevronRight" size={20} />}
            />
          );
        })}
      </DataRows>
    </section>
  );
}
