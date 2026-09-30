// Cat identity: a stable look and a friendly Indonesian name for every agent.
// Pure and deterministic, so the API (which assigns names) and the web app
// (which renders coats) always agree for the same agent id.
import type { AgentRole } from "./enums";

/**
 * Coat ids are the contract; packages/cats owns the exact flat fills.
 * Only flat colors, never gradients: a coat is 1 to 3 flat shapes.
 */
export const COATS = ["ginger", "cream", "gray", "black", "tuxedo", "calico", "tabby", "siamese"] as const;
export type Coat = (typeof COATS)[number];

/** The CEO cat's name when the owner has not picked one (OwnerSettings.ceoName). */
export const LEAD_NAME = "Oyen";

/** Cute Indonesian cat names: coat nicknames, snacks, drinks and pet names. Unique, one word each. */
export const CAT_NAMES = [
  "Belang",
  "Cemong",
  "Tompel",
  "Garong",
  "Gembul",
  "Cimol",
  "Moci",
  "Bolu",
  "Kunyit",
  "Cireng",
  "Martabak",
  "Oreo",
  "Kopi",
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
  "Bakso",
  "Seblak",
  "Cilor",
  "Batagor",
  "Siomay",
  "Lumpia",
  "Pempek",
  "Rendang",
  "Sate",
  "Bakmi",
  "Kerupuk",
  "Rengginang",
  "Emping",
  "Opak",
  "Dawet",
  "Kolak",
  "Ketan",
  "Jenang",
  "Nastar",
  "Putu",
  "Apem",
  "Bika",
  "Lapis",
  "Donat",
  "Keju",
  "Coklat",
  "Madu",
  "Mentega",
  "Mimi",
  "Momo",
  "Meong",
  "Manis",
  "Nono",
  "Ciko",
  "Kiko",
  "Dudung",
  "Ucup",
  "Bombom",
  "Gemoy",
  "Unyil",
  "Loreng",
  "Kembang",
  "Mpus",
  "Tigor",
  "Cemplon",
  "Jeni",
  "Kiki",
  "Lili",
  "Pipi",
  "Bubu",
  "Cici",
  "Kribo",
  "Ndut",
  "Bleki",
  "Kuning",
  "Abu",
  "Mueza",
] as const;

/** Second words for playful combinations once every base name in a run is taken. */
export const NAME_TAILS = ["Kecil", "Junior", "Manis", "Imut", "Gembul", "Belang", "Kribo", "Ndut"] as const;

const LEAD_NAME_MAX = 24;

/** The CEO cat's name from the owner's setting: trimmed, one line, at most 24 chars, Oyen when empty. */
export function leadCatName(ceoName?: string | null): string {
  const name = (ceoName ?? "").replace(/\s+/g, " ").trim().slice(0, LEAD_NAME_MAX).trim();
  return name || LEAD_NAME;
}

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

/** The CEO cat's coat: Oyen is always the ginger tabby. */
export const LEAD_COAT: Coat = "ginger";

/**
 * The look of a new agent in a run, so coats never repeat inside one crew.
 * The lead is always LEAD_COAT; every other cat gets a coat no one in the run
 * wears yet (never the lead's), and only when all of them are taken the least
 * used one. `takenCoats` lists the coats already in the run, one entry per cat.
 * Deterministic for a given (agentId, role, takenCoats); the seed is catLook's.
 */
export function assignCoat(agentId: string, role: AgentRole, takenCoats: Iterable<string>): { coat: Coat; seed: number } {
  const { seed } = catLook(agentId);
  if (role === "lead") return { coat: LEAD_COAT, seed };
  const used = new Map<string, number>();
  for (const c of takenCoats) used.set(c, (used.get(c) ?? 0) + 1);
  const pool = COATS.filter((c) => c !== LEAD_COAT);
  const start = hash32(agentId + ":coat") % pool.length;
  let best = pool[start]!;
  for (let i = 0; i < pool.length; i++) {
    const coat = pool[(start + i) % pool.length]!;
    const n = used.get(coat) ?? 0;
    if (n === 0) return { coat, seed };
    if (n < (used.get(best) ?? 0)) best = coat;
  }
  return { coat: best, seed };
}

/**
 * Pick a unique name for a new agent in a run. Deterministic for a given
 * (agentId, role, taken, leadName). The lead gets `leadName` (the owner's
 * ceoName, Oyen by default) while it is free; every other cat draws from
 * CAT_NAMES, never the lead's name. When the pool runs out the names get a
 * playful second word ("Cireng Kecil"), then a number as the last resort.
 */
export function pickCatName(agentId: string, role: AgentRole, taken: ReadonlySet<string>, leadName: string = LEAD_NAME): string {
  const lead = leadCatName(leadName);
  if (role === "lead" && !taken.has(lead)) return lead;
  const pool = CAT_NAMES.filter((n) => n !== lead);
  const h = hash32(agentId + ":" + role);
  const start = h % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const name = pool[(start + i) % pool.length]!;
    if (!taken.has(name)) return name;
  }
  const tail0 = h % NAME_TAILS.length;
  for (let k = 0; k < NAME_TAILS.length; k++) {
    const tail = NAME_TAILS[(tail0 + k) % NAME_TAILS.length]!;
    for (let i = 0; i < pool.length; i++) {
      const base = pool[(start + i) % pool.length]!;
      if (base === tail) continue;
      const name = `${base} ${tail}`;
      if (!taken.has(name)) return name;
    }
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
