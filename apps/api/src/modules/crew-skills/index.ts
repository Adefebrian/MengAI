// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// crew-skills module public API: mounted at /api/crew-skills; the service's
// forPrompt() is handed to the runs module through core/container.ts.
import type { ModuleContext, MountedModule } from "../../core/module";
import { crewSkillRoutes } from "./routes";
import { createCrewSkillsService, type CrewSkillsServiceImpl } from "./service";

export type { CrewSkillsService, PromptSkills, PromptSkillsInput, SkillRef } from "./ports";
export type { CrewSkillsServiceImpl } from "./service";
export type { BuiltinSkill } from "./builtin";
export { BUILTINS, BUILTIN_ID_PREFIX } from "./builtin";
export { BUILTIN_BUDGET_TOKENS, CREW_SKILLS_TOTAL_TOKENS, focusOf, isBuilderCharter } from "./pick";
export { MAX_OWNER_SKILLS } from "./service";

export function createCrewSkillsModule(ctx: ModuleContext): MountedModule & { service: CrewSkillsServiceImpl } {
  const service = createCrewSkillsService(ctx);
  return { name: "crew-skills", mountPath: "crew-skills", routes: crewSkillRoutes(service, ctx.kv), service };
}
