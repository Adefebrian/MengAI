// Cat identity: a stable look and a friendly local name for every agent.
// Pure and deterministic, so the API (which assigns names) and the web app
// (which renders coats) always agree for the same agent id.
import type { AgentRole } from "./enums";

/**
 * Coat ids are the contract; packages/cats owns the exact flat fills.
 * Only flat colors, never gradients: a coat is 1 to 3 flat shapes.
 */
export const COATS = ["ginger", "cream", "gray", "black", "tuxedo", "calico", "tabby", "siamese"] as const;
export type Coat = (typeof COATS)[number];

/** Short, friendly Indonesian snack and drink names. */
export const CAT_NAMES = [
  "Kopi",
  "Mochi",
  "Tempe",
  "Klepon",
  "Onde",
  "Cilok",
  "Bakpao",
  "Serabi",
  "Lemper",
  "Dodol",
  "Cendol",
  "Getuk",
  "Lupis",
  "Wajik",
  "Tahu",
  "Bakwan",
  "Risol",
  "Pandan",
  "Jahe",
  "Kacang",
  "Kelapa",
  "Salak",
  "Duku",
  "Sawo",
  "Nangka",
  "Gula",
  "Susu",
  "Kencur",
  "Lontong",
  "Pukis",
] as const;

/** The lead cat is always Kopi when the name is free: it keeps the crew awake. */
export const LEAD_NAME = "Kopi";

/** FNV-1a 32-bit, stable across runtimes. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function catLook(agentId: string): { coat: Coat; seed: number } {
  const seed = hash32(agentId) & 0x7fffffff;
  return { coat: COATS[seed % COATS.length]!, seed };
}

/**
 * Pick a unique name for a new agent in a run. Deterministic for a given
 * (agentId, taken) pair. Falls back to "Name 2", "Name 3" when every base
 * name in the pool is taken.
 */
export function pickCatName(agentId: string, role: AgentRole, taken: ReadonlySet<string>): string {
  if (role === "lead" && !taken.has(LEAD_NAME)) return LEAD_NAME;
  const pool = CAT_NAMES.filter((n) => n !== LEAD_NAME || role === "lead");
  const start = hash32(agentId + ":" + role) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const name = pool[(start + i) % pool.length]!;
    if (!taken.has(name)) return name;
  }
  for (let n = 2; ; n++) {
    const name = `${pool[start]} ${n}`;
    if (!taken.has(name)) return name;
  }
}

export const ROLE_LABEL: Record<AgentRole, string> = {
  lead: "Lead",
  engineer: "Engineer",
  designer: "Designer",
  reviewer: "Reviewer",
  qa: "QA",
  security: "Security",
  researcher: "Researcher",
  operator: "Operator",
};
