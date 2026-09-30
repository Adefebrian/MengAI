// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// companies module: company templates (software studio, hedge fund). Service
// only, no routes and no tables; the runs module receives it from the container.
import type { MountedModule } from "../../core/module";
import { createCompaniesService, type CompaniesService } from "./service";

export type { CompaniesService } from "./service";
export type { CompanyRoleTemplate, CompanyTemplate, TradingTool } from "./templates";
export type { StageBoardTask, StageTask } from "./stages";
export { companyKind } from "./service";
export { FUND, FUND_ROLES, NO_ADVICE, STUDIO, TEMPLATES, TRADING_TOOLS } from "./templates";

export function createCompaniesModule(): MountedModule & { service: CompaniesService } {
  return { name: "companies", service: createCompaniesService() };
}
