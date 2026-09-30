// The shared crew roster: one name, coat, seed and default role per cat, so
// every scene that shows a named cat (the landing's stories, the Office
// preview, the run page) gives the same cat the same coat. Cemong is always
// the tuxedo engineer, Tempe always the gray reviewer, wherever they appear.
// A name that is not on the roster keeps the look its agent id hashes to
// (catLook in @mengai/shared), so live runs still get a stable coat. Inside
// one crew, crewLooks keeps coats apart: Oyen, the CEO, is always the ginger
// tabby, nobody else wears ginger, and no coat repeats while the palette
// lasts.
import { COATS, catLook, type AgentRole, type CatLook, type Coat } from "@mengai/shared";

export interface RosterCat {
  /** a stable id for sample stories: the name in lower case */
  id: string;
  name: string;
  coat: Coat;
  seed: number;
  /** the role the cat plays when a story does not say otherwise */
  role: AgentRole;
}

const cat = (name: string, coat: Coat, seed: number, role: AgentRole): RosterCat => ({ id: name.toLowerCase(), name, coat, seed, role });

/** Every named cat the product shows, the CEO first. */
export const ROSTER: readonly RosterCat[] = [
  cat("Oyen", "ginger", 1204, "lead"),
  cat("Belang", "calico", 2291, "engineer"),
  cat("Cemong", "tuxedo", 88213, "engineer"),
  cat("Tempe", "gray", 71002, "reviewer"),
  cat("Tompel", "cream", 3373, "qa"),
  cat("Gembul", "tabby", 4447, "designer"),
  cat("Cimol", "siamese", 6607, "researcher"),
  cat("Garong", "tuxedo", 7703, "security"),
  cat("Moci", "black", 8849, "operator"),
  cat("Belo", "cream", 5023, "engineer"),
  cat("Unyil", "gray", 1033, "qa"),
  cat("Ciko", "black", 2477, "designer"),
  cat("Mpus", "tabby", 3719, "researcher"),
  cat("Klepon", "calico", 5530, "designer"),
  cat("Onde", "black", 3319, "qa"),
  cat("Cilok", "siamese", 90417, "security"),
  cat("Bakwan", "tabby", 60231, "engineer"),
  cat("Serabi", "cream", 44120, "designer"),
  cat("Risol", "siamese", 27514, "engineer"),
  cat("Salak", "tabby", 31877, "researcher"),
  cat("Jahe", "cream", 52409, "engineer"),
  cat("Kencur", "gray", 17736, "engineer"),
  cat("Duku", "black", 80115, "reviewer"),
  cat("Pukis", "calico", 64350, "qa"),
  cat("Lontong", "siamese", 9921, "engineer"),
];

const BY_NAME = new Map(ROSTER.map((c) => [c.name.toLowerCase(), c]));

/** The roster cat with this name (any case, surrounding space ignored), or null. */
export function rosterCat(name: string): RosterCat | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/**
 * The look for a named cat: the roster's coat and seed when the name is on
 * it, else the look the agent id hashes to. Use it wherever a cat is drawn
 * by name, so one name never wears two coats.
 */
export function lookFor(name: string, agentId: string = name): CatLook {
  const c = rosterCat(name);
  return c ? { coat: c.coat, seed: c.seed } : catLook(agentId);
}

/** A sample crew from the roster by name, in the given order; a role override per name when a story casts a cat differently. */
export function rosterCrew(names: readonly string[], roles: Partial<Record<string, AgentRole>> = {}): RosterCat[] {
  return names.map((n) => {
    const c = rosterCat(n);
    if (!c) throw new Error(`${n} is not on the crew roster`);
    const role = roles[c.name] ?? roles[c.id];
    return role ? { ...c, role } : c;
  });
}

/** The CEO cat and its coat: Oyen is always the ginger tabby, in every crew. */
export const CEO_NAME = "Oyen";
export const CEO_COAT: Coat = "ginger";

function nameHash(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The looks for one crew, in the given order: Oyen is pinned to the ginger
 * tabby and nobody else wears ginger; every other cat keeps its roster coat
 * unless a cat earlier in the list has the same roster coat, and the cats
 * left over take the free coats of the fixed palette (COATS without ginger)
 * from a start keyed by the name. Only a crew larger than the palette
 * repeats a coat, and then the least worn one. Seeds are the roster's (or
 * the name's own look), so a cat keeps its markings. Deterministic for a
 * given list of names.
 */
export function crewLooks(names: readonly string[]): Array<CatLook & { coat: Coat }> {
  const pool = COATS.filter((c) => c !== CEO_COAT);
  const used = new Map<Coat, number>();
  const worn = (c: Coat) => used.get(c) ?? 0;
  const keys = names.map((n) => n.trim().toLowerCase());
  const coats: Array<Coat | null> = keys.map(() => null);
  // first pass: Oyen, then each roster coat's first holder in the list
  keys.forEach((k, i) => {
    const r = rosterCat(k);
    const own = k === CEO_NAME.toLowerCase() ? CEO_COAT : r && r.coat !== CEO_COAT ? r.coat : null;
    if (own && (own === CEO_COAT || worn(own) === 0)) {
      coats[i] = own;
      used.set(own, worn(own) + 1);
    }
  });
  // second pass: everyone else takes a free coat, else the least worn
  keys.forEach((k, i) => {
    if (coats[i]) return;
    const start = nameHash(k) % pool.length;
    const own = rosterCat(k)?.coat;
    // past the palette the cat keeps its own coat when that is among the least worn
    let best = own && own !== CEO_COAT ? own : pool[start]!;
    let coat: Coat | null = null;
    for (let j = 0; j < pool.length; j++) {
      const c = pool[(start + j) % pool.length]!;
      if (worn(c) === 0) {
        coat = c;
        break;
      }
      if (worn(c) < worn(best)) best = c;
    }
    coat ??= best;
    coats[i] = coat;
    used.set(coat, worn(coat) + 1);
  });
  return keys.map((k, i) => ({ coat: coats[i]!, seed: rosterCat(k)?.seed ?? catLook(k).seed }));
}
