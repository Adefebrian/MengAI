// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Written skills on the page: the limits the form checks before it sends,
// the token estimate it shows while the owner types, the words for who
// reads a skill, and the checks a draft must pass. Pure, so the Skills
// screen, the demo engine and the tests read the same rules.
import { AGENT_ROLES, COMPANY_KINDS, ROLE_LABEL, type AgentRole, type CompanyKind, type CrewSkillDTO } from "@mengai/shared";
import { fmtInt } from "./format";
import { COMPANY_WORD } from "./run/stages";

/** the engine's limits (POST and PATCH /api/crew-skills) */
export const SKILL_NAME_MAX = 80;
export const SKILL_SUMMARY_MAX = 200;
/** the most a cat reads of one skill (CrewSkillDTO.body) */
export const SKILL_BODY_MAX = 6000;

/** Roles the form offers: every role on the crew, the operator included. */
export const SKILL_ROLES: readonly AgentRole[] = AGENT_ROLES;
export const SKILL_KINDS: readonly CompanyKind[] = COMPANY_KINDS;

/** About four characters a token. */
export function estimateTokens(text: string): number {
  return text.trim() ? Math.ceil(text.length / 4) : 0;
}

/**
 * The tokens a skill adds to each matching prompt, counted the way the
 * engine counts CrewSkillDTO.tokens: its heading line, its text and the
 * separator at four characters a token. 0 while there is no text.
 */
export function promptTokens(name: string, body: string): number {
  const text = body.trim();
  if (!text) return 0;
  const heading = name.replace(/\s+/g, " ").trim().slice(0, 120);
  return Math.ceil((`## ${heading}\n${text.slice(0, SKILL_BODY_MAX)}`.length + 2) / 4);
}

/** The first meaningful line of a body without markdown markers: the summary the engine keeps when none is given. */
export function summaryFrom(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw
      .replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, "")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line) return line.length > 160 ? `${line.slice(0, 157).trimEnd()}...` : line;
  }
  return "";
}

export function roleWord(r: AgentRole): string {
  return r === "lead" ? "CEO" : ROLE_LABEL[r];
}

export function rolesWord(roles: readonly AgentRole[] | null): string {
  if (!roles) return "Every role";
  if (roles.length === 0) return "No role";
  return roles.map(roleWord).join(", ");
}

export function kindsWord(kinds: readonly CompanyKind[] | null): string {
  if (!kinds) return "Every company";
  if (kinds.length === 0) return "No company";
  return kinds.map((k) => COMPANY_WORD[k]).join(", ");
}

/** Built-in pack first, then the owner's, each in the order the engine sent. */
export function bySource<T extends { source: CrewSkillDTO["source"] }>(list: readonly T[]): T[] {
  return [...list.filter((s) => s.source === "builtin"), ...list.filter((s) => s.source !== "builtin")];
}

export interface SkillDraft {
  name: string;
  summary: string;
  body: string;
  everyRole: boolean;
  roles: AgentRole[];
  everyKind: boolean;
  kinds: CompanyKind[];
}

export type SkillField = "name" | "summary" | "body" | "roles" | "kinds";
export type SkillErrors = Partial<Record<SkillField, string>>;

/** The characters over the limit, 0 when it fits. */
export function bodyOverBy(body: string): number {
  return Math.max(0, body.length - SKILL_BODY_MAX);
}

export function overLimitText(over: number): string {
  return `Too long by ${fmtInt(over)} ${over === 1 ? "character" : "characters"}. A cat reads at most ${fmtInt(SKILL_BODY_MAX)}.`;
}

/**
 * What stops a draft from saving, one line per field that says what to do.
 * `others` is every skill already there; `selfId` the one being edited.
 */
export function validateSkill(d: SkillDraft, others: readonly Pick<CrewSkillDTO, "id" | "name">[], selfId: string | null): SkillErrors {
  const e: SkillErrors = {};
  const name = d.name.trim();
  if (!name) e.name = "Name it, so you and the crew can tell skills apart.";
  else if (name.length > SKILL_NAME_MAX) e.name = `Keep the name to ${SKILL_NAME_MAX} characters.`;
  else if (others.some((s) => s.id !== selfId && s.name.trim().toLowerCase() === name.toLowerCase())) e.name = `A skill called ${name} is there already. Pick another name.`;
  if (d.summary.trim().length > SKILL_SUMMARY_MAX) e.summary = `Keep the summary to ${SKILL_SUMMARY_MAX} characters.`;
  if (!d.body.trim()) e.body = "Write what the cats should do. This is the text they read.";
  else if (bodyOverBy(d.body) > 0) e.body = overLimitText(bodyOverBy(d.body));
  if (!d.everyRole && d.roles.length === 0) e.roles = "Tick at least one role, or let every role read it.";
  if (!d.everyKind && d.kinds.length === 0) e.kinds = "Tick at least one kind of company, or let every company use it.";
  return e;
}

export function hasErrors(e: SkillErrors): boolean {
  return Object.values(e).some(Boolean);
}
