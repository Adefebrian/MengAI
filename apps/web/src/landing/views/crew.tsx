// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Small shared pieces for the landing's live views: the crew by id and a
// cat at 48 px with its accessible name. Every view is sample data from
// the same scripted morning as the hero (story/script.ts).
import { Cat } from "@mengai/cats";
import { ROLE_LABEL, type Activity, type AgentStatus } from "@mengai/shared";
import { CREW } from "../story/script";

export function crew(id: string) {
  const c = CREW.find((x) => x.id === id);
  if (!c) throw new Error(`unknown crew id ${id}`);
  return c;
}

export function CrewCat({ id, activity, status = "working", still }: { id: string; activity: Activity; status?: AgentStatus; still?: boolean }) {
  const c = crew(id);
  return (
    <Cat
      look={{ coat: c.coat, seed: c.seed }}
      role={c.role}
      status={status}
      activity={activity}
      mood="focused"
      label={`${c.name}, ${c.role === "lead" ? "CEO" : ROLE_LABEL[c.role]}`}
      size={48}
      still={still}
    />
  );
}
