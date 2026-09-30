// The shared crew roster: one name, coat, seed and default role per cat, so
// every scene that shows a named cat (the landing's stories, the Office
// preview, the run page) gives the same cat the same coat. Cemong is always
// the tuxedo engineer, Tempe always the gray reviewer, wherever they appear.
// A name that is not on the roster keeps the look its agent id hashes to
// (catLook in @mengai/shared), so live runs still get a stable coat.
import { catLook, type AgentRole, type CatLook, type Coat } from "@mengai/shared";

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
