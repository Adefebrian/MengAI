// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The built-in crew skill pack: the JAL-AIDev design guardrails, UI craft,
// system design, security and QA habits, distilled into short versioned
// markdown files under builtin/ (the source of truth is Brian's JAL-AIDev
// plugin). The files are embedded at build time (Bun text imports), so a
// compiled binary carries them. They are parsed and validated once at load:
// a bad file fails the boot and the tests, never a run.
//
// Front matter, one "key: value" per line:
//   id       slug (the public id is builtin-<slug>)
//   name     display name, also the heading the cats read
//   version  bump it whenever the body changes (the prompt cache keys on it)
//   updated  YYYY-MM-DD, shown as the skill's date
//   focus    ui | build: which kind of goal it serves first
//   summary  one line for lists
//   roles    role=weight pairs, weight 1 to 3 (3: always read by that role;
//            2: read when the goal fits its focus; 1: only when the goal
//            also names one of its topics)
//   kinds    company kinds (studio, fund) or all
//   topics   words that make the skill relevant to a goal
// The body is ASCII only (no em-dash, no emoji) and at most 6,000 characters.
import { AGENT_ROLES, COMPANY_KINDS, type AgentRole, type CompanyKind } from "@mengai/shared";
import { CREW_SKILL_MAX_CHARS, crewSkillTokens } from "../context";
// @ts-ignore Bun text import: there are no type declarations for .md files
import designLaw from "./builtin/design-law.md" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .md files
import uiTaste from "./builtin/ui-taste.md" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .md files
import designSystem from "./builtin/design-system.md" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .md files
import frontendRules from "./builtin/frontend-rules.md" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .md files
import motionImmersive from "./builtin/motion-immersive.md" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .md files
import systemDesign from "./builtin/system-design.md" with { type: "text" };
// @ts-ignore Bun text import: there are no type declarations for .md files
import securityQa from "./builtin/security-qa.md" with { type: "text" };

/** The pack in display order (also the tie break when two skills are equally relevant). */
export const BUILTIN_FILES: ReadonlyArray<{ file: string; text: string }> = [
  { file: "design-law.md", text: designLaw as string },
  { file: "ui-taste.md", text: uiTaste as string },
  { file: "design-system.md", text: designSystem as string },
  { file: "frontend-rules.md", text: frontendRules as string },
  { file: "motion-immersive.md", text: motionImmersive as string },
  { file: "system-design.md", text: systemDesign as string },
  { file: "security-qa.md", text: securityQa as string },
];

export const BUILTIN_ID_PREFIX = "builtin-";
export type SkillFocus = "ui" | "build";

export interface BuiltinSkill {
  /** public id: builtin-<slug> */
  id: string;
  slug: string;
  name: string;
  version: number;
  summary: string;
  body: string;
  focus: SkillFocus;
  /** relevance weight per role (1 to 3); a role that is absent never reads it */
  weights: Partial<Record<AgentRole, number>>;
  /** roles that read it, heaviest weight first */
  roles: AgentRole[];
  /** null means every company kind */
  kinds: CompanyKind[] | null;
  topics: ReadonlySet<string>;
  /** the updated date, epoch ms (UTC midnight) */
  updatedAt: number;
  /** estimated prompt tokens (context crewSkillTokens) */
  tokens: number;
  /** the pack position */
  order: number;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PRINTABLE = /^[\x20-\x7e\n]*$/;

function fail(file: string, why: string): never {
  throw new Error(`built-in crew skill ${file}: ${why}`);
}

/** Parses and validates one built-in file; throws with the file name on any problem. */
export function parseBuiltin(file: string, raw: string, order = 0): BuiltinSkill {
  const text = raw.replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) fail(file, "front matter missing (--- block first)");
  const meta = new Map<string, string>();
  for (const line of m[1]!.split("\n")) {
    if (!line.trim()) continue;
    const i = line.indexOf(":");
    if (i <= 0) fail(file, `bad front matter line "${line}"`);
    const key = line.slice(0, i).trim();
    if (meta.has(key)) fail(file, `duplicate key ${key}`);
    meta.set(key, line.slice(i + 1).trim());
  }
  const need = (key: string): string => {
    const v = meta.get(key);
    if (!v) fail(file, `${key} is required`);
    return v;
  };
  const known = new Set(["id", "name", "version", "updated", "focus", "summary", "roles", "kinds", "topics"]);
  for (const key of meta.keys()) if (!known.has(key)) fail(file, `unknown key ${key}`);

  const slug = need("id");
  if (!SLUG.test(slug) || slug.length > 48) fail(file, "id must be a lowercase slug");
  const name = need("name");
  if (name.length > 80) fail(file, "name is longer than 80 characters");
  const version = Number(need("version"));
  if (!Number.isInteger(version) || version < 1) fail(file, "version must be a positive integer");
  const updated = need("updated");
  const updatedAt = /^\d{4}-\d{2}-\d{2}$/.test(updated) ? Date.parse(`${updated}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(updatedAt)) fail(file, "updated must be YYYY-MM-DD");
  const focus = need("focus");
  if (focus !== "ui" && focus !== "build") fail(file, "focus must be ui or build");
  const summary = need("summary");
  if (summary.length > 200) fail(file, "summary is longer than 200 characters");

  const weights: Partial<Record<AgentRole, number>> = {};
  for (const pair of need("roles").split(/\s+/)) {
    const [role, w] = pair.split("=");
    if (!role || !(AGENT_ROLES as readonly string[]).includes(role)) fail(file, `unknown role in "${pair}"`);
    const weight = Number(w);
    if (!Number.isInteger(weight) || weight < 1 || weight > 3) fail(file, `weight must be 1 to 3 in "${pair}"`);
    if (weights[role as AgentRole] !== undefined) fail(file, `role ${role} listed twice`);
    weights[role as AgentRole] = weight;
  }
  const roles = (Object.keys(weights) as AgentRole[]).sort((a, b) => weights[b]! - weights[a]! || AGENT_ROLES.indexOf(a) - AGENT_ROLES.indexOf(b));

  const kindsRaw = need("kinds");
  let kinds: CompanyKind[] | null = null;
  if (kindsRaw !== "all") {
    kinds = [];
    for (const k of kindsRaw.split(/\s+/)) {
      if (!(COMPANY_KINDS as readonly string[]).includes(k)) fail(file, `unknown company kind ${k}`);
      if (!kinds.includes(k as CompanyKind)) kinds.push(k as CompanyKind);
    }
  }
  const topics = new Set(need("topics").toLowerCase().split(/\s+/).filter(Boolean));

  const body = m[2]!.trim();
  if (!body) fail(file, "body is empty");
  if (body.length > CREW_SKILL_MAX_CHARS) fail(file, `body is ${body.length} characters (at most ${CREW_SKILL_MAX_CHARS})`);
  for (const [label, value] of [["name", name], ["summary", summary], ["body", body]] as const) {
    if (!PRINTABLE.test(value)) fail(file, `${label} must be plain ASCII (no em-dash, no emoji)`);
  }

  return {
    id: `${BUILTIN_ID_PREFIX}${slug}`,
    slug,
    name,
    version,
    summary,
    body,
    focus,
    weights,
    roles,
    kinds,
    topics,
    updatedAt,
    tokens: crewSkillTokens({ name, text: body }),
    order,
  };
}

/** Parses the whole pack; ids must be unique. */
export function loadBuiltins(files: ReadonlyArray<{ file: string; text: string }> = BUILTIN_FILES): BuiltinSkill[] {
  const out = files.map((f, i) => parseBuiltin(f.file, f.text, i));
  const ids = new Set<string>();
  for (const s of out) {
    if (ids.has(s.id)) throw new Error(`built-in crew skill id ${s.slug} is used twice`);
    ids.add(s.id);
  }
  return out;
}

/** The pack, parsed at module load (a broken file fails the boot, loudly). */
export const BUILTINS: readonly BuiltinSkill[] = loadBuiltins();
