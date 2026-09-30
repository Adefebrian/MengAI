// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The crew's coats, one rule everywhere a cat is drawn: the lead (Oyen by
// default) is always the ginger tabby, the landing and the roster's CEO, and
// no two cats in one crew wear the same coat. The server assigns looks this
// way for new runs; this pass keeps older runs and any look that breaks the
// rule in line, and leaves a valid crew exactly as it came (so it agrees
// with the server). Cats keep their seed; only the coat moves.
import { COATS, type AgentDTO, type Coat } from "@mengai/shared";

export const LEAD_COAT: Coat = "ginger";

/** Crew order for coats: the lead first, then by arrival. */
function arrival(agents: readonly AgentDTO[]): AgentDTO[] {
  return [...agents].sort((a, b) => (a.role === "lead" ? -1 : b.role === "lead" ? 1 : a.createdAt - b.createdAt));
}

/**
 * The same agents with coats that follow the crew rule, in the given order.
 * An agent whose look is already fine is returned as the same object.
 */
export function withCrewLooks<T extends AgentDTO>(agents: readonly T[]): T[] {
  const used = new Map<Coat, number>();
  const fixed = new Map<string, Coat>();
  const pool = COATS.filter((c) => c !== LEAD_COAT);
  for (const a of arrival(agents)) {
    let coat = a.look.coat as Coat;
    if (a.role === "lead") coat = LEAD_COAT;
    else if (coat === LEAD_COAT || (used.get(coat) ?? 0) > 0) {
      const start = Math.abs(a.look.seed) % pool.length;
      let best = pool[start]!;
      for (let i = 0; i < pool.length; i++) {
        const c = pool[(start + i) % pool.length]!;
        if ((used.get(c) ?? 0) === 0) {
          best = c;
          break;
        }
        if ((used.get(c) ?? 0) < (used.get(best) ?? 0)) best = c;
      }
      coat = best;
    }
    used.set(coat, (used.get(coat) ?? 0) + 1);
    fixed.set(a.id, coat);
  }
  return agents.map((a) => {
    const coat = fixed.get(a.id) ?? a.look.coat;
    return coat === a.look.coat ? a : { ...a, look: { ...a.look, coat } };
  });
}

/** The agent map with the crew rule applied; unchanged agents keep their objects. */
export function crewLooksMap(agents: Record<string, AgentDTO>): Record<string, AgentDTO> {
  const list = withCrewLooks(Object.values(agents));
  let changed = false;
  const out: Record<string, AgentDTO> = {};
  for (const a of list) {
    out[a.id] = a;
    if (agents[a.id] !== a) changed = true;
  }
  return changed ? out : agents;
}
