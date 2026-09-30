// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Which crew skills one prompt carries. Pure and deterministic: the same
// role, company kind, run goal and skill set always give the same list in
// the same order, so the charter layer (and the vendor prefix cache behind
// it) stays byte-stable for the whole run and changes only when a skill
// version or the enabled set changes.
//
//   1 filter   enabled, the company kind, the role (a dynamic role whose
//              charter builds things also reads the builder pack)
//   2 rank     built-ins by relevance: the role's own skills (weight 3)
//              first, then the score: weight for the role, +2 when the run
//              goal's focus (ui or build) matches the skill, +1 when the
//              goal names one of its topics; kept at a score of 3 or more;
//              ties keep the pack order
//   3 cap      built-ins fill the role's built-in budget, then the owner's
//              skills (newest first) fill the rest of the hard total cap;
//              whatever does not fit is skipped and listed as skipped
import type { AgentRole, CompanyKind } from "@mengai/shared";
import { CREW_SKILLS_MAX_TOKENS, crewSkillsTag, type CrewSkillLayer } from "../context";
import type { BuiltinSkill } from "./builtin";

/**
 * Built-in tokens per prompt, by role. The designer reads the whole UI
 * pack; the other roles two skills at most. The eval test in
 * crew-skills.test.ts replays the benchmark suite with these budgets and
 * keeps billable input at least 60 percent below legacy: tighten the pack,
 * never this test.
 */
export const BUILTIN_BUDGET_TOKENS: Readonly<Record<AgentRole, number>> = {
  designer: 1_600,
  engineer: 700,
  reviewer: 700,
  qa: 700,
  security: 400,
  lead: 400,
  researcher: 400,
  operator: 400,
};

/** Hard cap on every crew skill in one prompt, built-in and owner together (fixed 4 chars per token): the context module's ceiling. */
export const CREW_SKILLS_TOTAL_TOKENS = CREW_SKILLS_MAX_TOKENS;
/** A built-in is read when its relevance score reaches this. */
export const MIN_SCORE = 3;

/**
 * Words that make a goal a UI goal (English and Indonesian); anything else is
 * a build goal. Words with a common backend meaning ("interface", "view",
 * "web", "model") are left out on purpose: "a provider interface" is no UI.
 */
const UI_WORDS = new Set(
  (
    "ui ux page pages landing site website webapp app apps frontend front-end screen screens dashboard design redesign hero css style styles styling " +
    "layout component components form forms button mobile responsive theme react vue svelte html visual animation " +
    "3d webgl portfolio homepage storefront halaman tampilan aplikasi situs desain antarmuka beranda dasbor formulir tombol"
  ).split(" "),
);

/** A dynamic role's charter that builds things: it reads the builder pack as an engineer would. */
const BUILDER_RE =
  /\b(build|builds|building|implement|implements|implementing|code|codes|coding|develop|develops|developer|engineer|frontend|backend|full[- ]?stack|ui|ux|page|pages|component|components|css|html|api|endpoint|website|app|prototype)\b/i;

export interface OwnerSkillView {
  id: string;
  name: string;
  body: string;
  version: number;
  roles: AgentRole[] | null;
  kinds: CompanyKind[] | null;
  enabled: boolean;
  createdAt: number;
}

export interface PickInput {
  /** the cat's archetype */
  role: AgentRole;
  /** the run's company kind; null reads as studio */
  kind: CompanyKind | null;
  /** the run goal: relevance only (stable for the whole run) */
  goal?: string | null;
  /** a dynamic role's charter: relevance and builder detection */
  charter?: string | null;
}

export interface SkillRef {
  id: string;
  name: string;
  source: "builtin" | "owner";
  tokens: number;
}

export interface PickResult {
  /** cache tag of the layers ("" when none), the k part of layerVersion */
  tag: string;
  /** what the charter layer renders, in order */
  layers: CrewSkillLayer[];
  read: SkillRef[];
  /** matching skills trimmed by the cap */
  skipped: SkillRef[];
  /** estimated tokens of the layers */
  tokens: number;
}

/** Lowercase words of a text, with a naive singular form added (pages -> page). */
export function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (!w) continue;
    out.add(w);
    if (w.length > 3 && w.endsWith("s")) out.add(w.slice(0, -1));
    for (const part of w.split("-")) if (part && part !== w) out.add(part);
  }
  return out;
}

/** ui when the text names interface work, else build. */
export function focusOf(text: string): "ui" | "build" {
  for (const w of words(text)) if (UI_WORDS.has(w)) return "ui";
  return "build";
}

export function isBuilderCharter(charter: string | null | undefined): boolean {
  return !!charter && BUILDER_RE.test(charter);
}

/** A built-in's weight for this cat: its archetype's, or the engineer's when the dynamic role builds. */
function weightFor(s: BuiltinSkill, role: AgentRole, builder: boolean): number {
  const own = s.weights[role] ?? 0;
  return builder ? Math.max(own, s.weights.engineer ?? 0) : own;
}

const kindOk = (kinds: readonly CompanyKind[] | null, kind: CompanyKind) => kinds === null || kinds.includes(kind);

/** Relevance of a built-in for this cat and goal; 0 when the role never reads it. */
export function relevance(s: BuiltinSkill, role: AgentRole, builder: boolean, goal: Set<string>, focus: "ui" | "build"): number {
  const weight = weightFor(s, role, builder);
  if (weight <= 0) return 0;
  let hit = false;
  for (const t of s.topics) if (goal.has(t)) hit = true;
  return weight + (s.focus === focus ? 2 : 0) + (hit ? 1 : 0);
}

export function pickSkills(input: PickInput, builtins: readonly BuiltinSkill[], enabled: (id: string) => boolean, owner: readonly OwnerSkillView[], tokensOf: (s: { name: string; text: string }) => number): PickResult {
  const kind: CompanyKind = input.kind ?? "studio";
  const builder = isBuilderCharter(input.charter);
  const text = [input.goal ?? "", input.charter ?? ""].join("\n");
  const goal = words(text);
  const focus = focusOf(text);

  const layers: CrewSkillLayer[] = [];
  const read: SkillRef[] = [];
  const skipped: SkillRef[] = [];
  let used = 0;

  const ranked = builtins
    .filter((s) => enabled(s.id) && kindOk(s.kinds, kind))
    .map((s) => ({ s, score: relevance(s, input.role, builder, goal, focus) }))
    .filter((x) => x.score >= MIN_SCORE)
    .map((x) => ({ ...x, own: weightFor(x.s, input.role, builder) >= 3 ? 1 : 0 }))
    .sort((a, b) => b.own - a.own || b.score - a.score || a.s.order - b.s.order);
  const budget = builder ? Math.max(BUILTIN_BUDGET_TOKENS[input.role], BUILTIN_BUDGET_TOKENS.engineer) : BUILTIN_BUDGET_TOKENS[input.role];
  let builtinUsed = 0;
  for (const { s } of ranked) {
    const ref: SkillRef = { id: s.id, name: s.name, source: "builtin", tokens: s.tokens };
    if (builtinUsed + s.tokens > budget || used + s.tokens > CREW_SKILLS_TOTAL_TOKENS) {
      skipped.push(ref);
      continue;
    }
    builtinUsed += s.tokens;
    used += s.tokens;
    layers.push({ id: s.id, version: s.version, name: s.name, text: s.body });
    read.push(ref);
  }

  const mine = owner
    .filter((o) => o.enabled && kindOk(o.kinds, kind) && (o.roles === null || o.roles.includes(input.role) || (builder && o.roles.includes("engineer"))))
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  for (const o of mine) {
    const tokens = tokensOf({ name: o.name, text: o.body });
    const ref: SkillRef = { id: o.id, name: o.name, source: "owner", tokens };
    if (used + tokens > CREW_SKILLS_TOTAL_TOKENS) {
      skipped.push(ref);
      continue;
    }
    used += tokens;
    layers.push({ id: o.id, version: o.version, name: o.name, text: o.body });
    read.push(ref);
  }

  return { tag: crewSkillsTag(layers), layers, read, skipped, tokens: used };
}
