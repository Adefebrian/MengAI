// Dynamic roles: a cat (the CEO or any crew cat) asks for a role the base
// eight do not name, "Launch tester" or "Accessibility auditor". Runtime JEV
// orch.role decides whether an existing role fits or a new one is needed and
// which archetype (the base role behind the pose and default tools). A new
// role gets one fast-tier call for its charter (capped) and a tool subset of
// its archetype's tools in the registry. Pure, no I/O.
import { ROLE_LABEL, ROLE_TOOLS, type AgentRole, type RoleDTO } from "@mengai/shared";
import { clip, redact } from "../../lib/redact";

export const ROLE_GEN = {
  /** output cap of the charter call (JEV orch.playbooks charter_output_cap: 220) */
  outputTokens: 220,
  /** the generated charter body, before the header line */
  charterChars: 900,
  titleChars: 48,
  reasonChars: 160,
  specChars: 600,
  /** new dynamic roles one run may define (JEV orch.playbooks roles_per_run: three) */
  maxPerRun: 3,
} as const;

/** Archetypes a dynamic role may take: every base role except the CEO's. */
export const ARCHETYPES: readonly AgentRole[] = ["engineer", "designer", "reviewer", "qa", "security", "researcher", "operator"];

/** One line per archetype, the JEV criteria for orch.role. */
export const ARCHETYPE_NOTE: Record<AgentRole, string> = {
  lead: "Plans and coordinates the crew.",
  engineer: "Writes and fixes code in the workspace, runs checks.",
  designer: "Shapes interfaces, copy and visual assets.",
  reviewer: "Reads changes and runs checks to pass or fail work.",
  qa: "Tests the software against acceptance criteria and edge cases, reports defects.",
  security: "Scans for secrets, risky config and vulnerable dependencies, reports findings.",
  researcher: "Finds and cites facts from documentation and sources, writes findings down.",
  operator: "Operates the owner's Mac through the automation tools, with permission.",
};

/** System prompt of the charter call (the demo crew answers it by exact match). */
export const ROLE_SYSTEM = [
  "You write the charter of a new specialist role in an AI crew of cats. The role sits on top of a base role (its archetype) and gets a subset of that archetype's tools.",
  "Write 3 to 5 short imperative lines about how this specialist works: what it checks first, what it produces, how it proves its result. No names, no secrets, no project-specific paths.",
  "Pick only the tools this role needs from the list given; finish is always included.",
  'Reply with JSON only: {"charter":["..."],"tools":["..."]}',
].join("\n");

const oneLine = (t: string) => t.replace(/\s+/g, " ").trim();

/** Title as shown: one line, letters and digits, at most 48 chars; null when unusable. */
export function roleTitle(raw: string | null | undefined): string | null {
  const t = oneLine(redact(String(raw ?? "")))
    .replace(/[^\p{L}\p{N} &/'.-]/gu, "")
    .trim()
    .slice(0, ROLE_GEN.titleChars)
    .trim();
  if (t.length < 3) return null;
  return t[0]!.toUpperCase() + t.slice(1);
}

/** Stable key of a title, unique per project ("launch-tester"); null when it names a base role or nothing. */
export function roleSlug(title: string | null | undefined): string | null {
  const slug = String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (slug.length < 3) return null;
  return baseRoleOf(slug) ? null : slug;
}

/** The base role a title names ("QA", "engineer", "Engineers"), or null. */
export function baseRoleOf(title: string): AgentRole | null {
  const t = title.toLowerCase().replace(/[^a-z]/g, "");
  for (const [role, label] of Object.entries(ROLE_LABEL) as Array<[AgentRole, string]>) {
    const l = label.toLowerCase();
    if (t === role || t === l || t === `${role}s` || t === `${l}s`) return role;
  }
  return null;
}

/** The charter call's input: the goal, the title, the archetype, the task and the archetype's tools. */
export function rolePacket(i: { goal: string; title: string; archetype: AgentRole; task: { title: string; spec: string }; tools: readonly string[] }): string {
  return [
    `Goal: ${clip(oneLine(redact(i.goal)), 300)}`,
    `New role: ${i.title}`,
    `Archetype: ${i.archetype} (${ARCHETYPE_NOTE[i.archetype]})`,
    `First task: ${clip(oneLine(redact(i.task.title)), 160)}`,
    `Task spec: ${clip(oneLine(redact(i.task.spec)), ROLE_GEN.specChars)}`,
    `Tools of the archetype: ${i.tools.join(", ")}`,
  ].join("\n");
}

/** The archetype's tools that a dynamic role may get (the registry for that base role). */
export function archetypeTools(archetype: AgentRole): string[] {
  return [...ROLE_TOOLS[archetype]];
}

/** A subset of the archetype's tools; finish and note always stay. Unknown names are dropped. */
export function toolSubset(archetype: AgentRole, wanted: readonly string[] | null): string[] {
  const allowed = archetypeTools(archetype);
  if (!wanted || wanted.length === 0) return allowed;
  const want = new Set(wanted.map((w) => String(w).trim()));
  for (const must of ["finish", "note"]) want.add(must);
  const out = allowed.filter((t) => want.has(t));
  // a subset with nothing but finish and note is no working role
  return out.length > 2 ? out : allowed;
}

/** The header line every dynamic charter starts with (the demo crew reads the title from it). */
export function roleHeader(title: string, archetype: AgentRole): string {
  return `You are the ${title} cat on a MengAI crew, a ${ROLE_LABEL[archetype]} specialist.`;
}

export const ROLE_HEADER_RE = /^You are the (.+?) cat on a MengAI crew, a (.+?) specialist\./;

/** The charter text stored on the role: the header, then the generated lines. */
export function roleCharterText(title: string, archetype: AgentRole, lines: readonly string[]): string {
  const body: string[] = [];
  let size = 0;
  for (const raw of lines.slice(0, 6)) {
    const line = clip(oneLine(redact(String(raw))).replace(/^[-*\d.)\s]+/, ""), 200);
    if (line.length < 6) continue;
    if (size + line.length + 3 > ROLE_GEN.charterChars) break;
    body.push(`- ${line}`);
    size += line.length + 3;
  }
  return [roleHeader(title, archetype), ...body].join("\n");
}

/** Deterministic charter when the call fails or answers nothing usable. */
export function fallbackCharter(title: string, archetype: AgentRole, task: { title: string }): string {
  return roleCharterText(title, archetype, [
    `Work as a ${title.toLowerCase()}: ${ARCHETYPE_NOTE[archetype].toLowerCase()}`,
    `Start from the task and its acceptance criteria (first task: ${clip(task.title, 80)}).`,
    "Read the files that matter before you judge or change anything.",
    "Prove every result with a file you changed or a check you ran, and name it in your finish summary.",
  ]);
}

/** The charter call's reply: lines and tools, or null when it is not usable. */
export function parseRoleReply(text: string): { lines: string[]; tools: string[] | null } | null {
  const raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as { charter?: unknown; tools?: unknown };
  const lines = Array.isArray(o.charter) ? o.charter.filter((x): x is string => typeof x === "string") : typeof o.charter === "string" ? o.charter.split("\n") : [];
  const usable = lines.map((l) => l.trim()).filter((l) => l.length >= 6);
  if (usable.length === 0) return null;
  const tools = Array.isArray(o.tools) ? o.tools.filter((x): x is string => typeof x === "string") : null;
  return { lines: usable, tools };
}

/** Pool key of an agent or a task: its dynamic role's key, else its base role. */
export function roleKeyOf(x: { role: AgentRole; roleId?: string | null }, roles: ReadonlyMap<string, RoleDTO>): string {
  if (x.roleId) {
    const r = roles.get(x.roleId);
    if (r) return r.key;
  }
  return x.role;
}

/** Display title of an agent or a task's role. */
export function titleOfRole(x: { role: AgentRole; roleId?: string | null }, roles: ReadonlyMap<string, RoleDTO>): string {
  const r = x.roleId ? roles.get(x.roleId) : undefined;
  return r ? r.title : ROLE_LABEL[x.role];
}

/** The most similar existing dynamic role for a title (shared words), or null. */
export function closestRole(title: string, archetype: AgentRole, roles: readonly RoleDTO[]): RoleDTO | null {
  const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)));
  const want = words(title);
  let best: RoleDTO | null = null;
  let bestScore = 0;
  for (const r of roles) {
    if (r.archetype !== archetype) continue;
    const have = words(r.title);
    let inter = 0;
    for (const w of want) if (have.has(w)) inter++;
    const score = inter / Math.max(1, want.size + have.size - inter);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : null;
}
