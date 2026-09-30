// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// CompaniesService: the template catalog the runs module reads through DI.
// Templates are code, not rows: a run stores only its kind.
import { COMPANY_KINDS, type AgentRole, type CompanyKind, type RunStage, type RunStatus } from "@mengai/shared";
import { fundBoardStage, mapStage, stageMoves, type StageBoardTask, type StageTask } from "./stages";
import { TEMPLATES, type CompanyTemplate } from "./templates";

export interface CompaniesService {
  kinds(): readonly CompanyKind[];
  /** the template of a kind; unknown or missing reads as studio */
  template(kind: CompanyKind | null | undefined): CompanyTemplate;
  mapStage(kind: CompanyKind, beat: RunStage, task: StageTask | null): string | null;
  stageMoves(kind: CompanyKind, current: string | null, next: string, loopBack?: boolean): boolean;
  /** the furthest stage a fund board reached; studio boards keep the runs module's own rule */
  boardStage(kind: CompanyKind, tasks: readonly StageBoardTask[], status: RunStatus): string | null;
  /** capability tools (trading) a cat may use: its role's grants, the CEO's, or the crew's */
  grantsFor(kind: CompanyKind, roleKey: string, archetype: AgentRole): string[];
}

export function companyKind(v: unknown): CompanyKind {
  return typeof v === "string" && (COMPANY_KINDS as readonly string[]).includes(v) ? (v as CompanyKind) : "studio";
}

export function createCompaniesService(): CompaniesService {
  return {
    kinds: () => COMPANY_KINDS,
    template: (kind) => TEMPLATES[companyKind(kind)],
    mapStage,
    stageMoves: (kind, current, next, loopBack = false) => stageMoves(kind, current, next, loopBack),
    boardStage: (kind, tasks, status) => (kind === "studio" ? null : fundBoardStage(tasks, status)),
    grantsFor(kind, roleKey, archetype) {
      const t = TEMPLATES[companyKind(kind)];
      if (archetype === "lead") return [...t.leadGrants];
      const role = t.roles.find((r) => r.key === roleKey);
      return [...new Set([...t.crewGrants, ...(role?.grants ?? [])])];
    },
  };
}
