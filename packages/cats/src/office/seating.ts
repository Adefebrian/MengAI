// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Who sits where as the crew changes: the desks are handed out once (by
// role, so each team shares a pod) and then kept. A hire takes the first
// free desk or the next one at the end; a cat that leaves walks out first
// (it stays in the scene as a leaver until the director says it is gone),
// then its desk stays free, so nobody else has to move. At most two free
// desks stay; older ones close up. When most of the crew changes at once
// (another run), the floor starts over without walking anyone in or out.
// Pure functions, so the Office can derive the next state during render.
import type { AgentRole } from "@mengai/shared";
import type { OfficeAgent } from "../office-contract";
import { crewOrder, pickLead, type PlanAgent } from "./geometry";

export const VACANT = "~vacant:";
/** More joiners and leavers than this at once is a new crew, not a hire. */
export const BIG_CHANGE = 6;
export const MAX_VACANT = 2;

export interface Track {
  /** the last agents prop */
  agents: OfficeAgent[];
  /** cats that left the prop but are still walking out */
  leavers: Map<string, OfficeAgent>;
  /** crew seat order: agent ids and free desk markers */
  order: string[];
  /** roles of everyone seen, for free desks */
  roles: Map<string, AgentRole>;
  /** ids that joined in the latest change */
  arriving: string[];
  /** agents plus leavers: every cat in the scene */
  present: OfficeAgent[];
  /** what the floor plan seats: the lead, then the crew order with free desks */
  planAgents: PlanAgent[];
}

export function isVacant(id: string): boolean {
  return id.startsWith(VACANT);
}

function build(agents: OfficeAgent[], leavers: Map<string, OfficeAgent>, order: string[], roles: Map<string, AgentRole>, arriving: string[]): Track {
  const present = [...agents, ...[...leavers.values()].filter((l) => !agents.some((a) => a.id === l.id))];
  const byId = new Map(present.map((a) => [a.id, a]));
  const lead = pickLead(present);
  const leadId = lead?.id ?? null;
  let out = order.filter((id) => id !== leadId);
  // the gone become free desks
  out = out.map((id) => (isVacant(id) || byId.has(id) ? id : `${VACANT}${id}`));
  // a hire fills the first free desk, else the next desk at the end
  const seated = new Set(out);
  for (const a of crewOrder(present, leadId)) {
    if (seated.has(a.id)) continue;
    const free = out.findIndex(isVacant);
    if (free >= 0) out[free] = a.id;
    else out.push(a.id);
    seated.add(a.id);
  }
  // at most two desks stay free
  while (out.filter(isVacant).length > MAX_VACANT) out.splice(out.findIndex(isVacant), 1);
  const planAgents: PlanAgent[] = [];
  if (lead) planAgents.push({ id: lead.id, role: lead.role, parentId: lead.parentId });
  for (const id of out) {
    const a = byId.get(id);
    if (a) planAgents.push({ id: a.id, role: a.role, parentId: a.parentId ?? leadId });
    else {
      const role = roles.get(id.slice(VACANT.length)) ?? "engineer";
      planAgents.push({ id, role: role === "lead" ? "engineer" : role, parentId: leadId ?? VACANT });
    }
  }
  return { agents, leavers, order: out, roles, arriving, present, planAgents };
}

function rolesOf(prev: Map<string, AgentRole>, agents: OfficeAgent[]): Map<string, AgentRole> {
  const roles = new Map(prev);
  for (const a of agents) roles.set(a.id, a.role);
  return roles;
}

/** The first crew: desks by role. */
export function startTrack(agents: OfficeAgent[]): Track {
  const lead = pickLead(agents);
  const order = crewOrder(agents, lead?.id ?? null).map((a) => a.id);
  return build(agents, new Map(), order, rolesOf(new Map(), agents), []);
}

/** The next crew: hires walk in, leavers walk out, everyone else keeps their desk. */
export function advanceTrack(t: Track, agents: OfficeAgent[]): Track {
  const prevIds = new Set(t.agents.map((a) => a.id));
  const nextIds = new Set(agents.map((a) => a.id));
  const joined = agents.filter((a) => !prevIds.has(a.id) && !t.leavers.has(a.id));
  const left = t.agents.filter((a) => !nextIds.has(a.id));
  const kept = [...prevIds].filter((id) => nextIds.has(id)).length;
  const swap = prevIds.size > 0 && kept * 2 < prevIds.size;
  if (swap || joined.length + left.length > BIG_CHANGE) return startTrack(agents);
  const leavers = new Map(t.leavers);
  for (const id of nextIds) leavers.delete(id);
  for (const a of left) leavers.set(a.id, { ...a, statusText: null });
  return build(agents, leavers, t.order, rolesOf(t.roles, agents), joined.map((a) => a.id));
}

/** A leaver walked out of the door: its desk is free now. */
export function dropLeaver(t: Track, id: string): Track {
  if (!t.leavers.has(id)) return t;
  const leavers = new Map(t.leavers);
  leavers.delete(id);
  return build(t.agents, leavers, t.order, t.roles, []);
}
