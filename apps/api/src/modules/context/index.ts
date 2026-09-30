// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// context module public API. Service only (no routes): the runs module and
// the evals harness receive `service` through core/container.ts.
import type { MountedModule, ModuleContext } from "../../core/module";
import type { ContextService } from "../../core/services";
import { createContextService } from "./service";

export type { BrainContextInput } from "./service";
export type { CharterOverride, CrewSkillLayer, StrategyLayer } from "./charters";
export {
  CREW_SKILLS_HEADER,
  CREW_SKILLS_MAX_TOKENS,
  CREW_SKILL_MAX_CHARS,
  ROLE_CHARTER_MAX_CHARS,
  STRATEGY_MAX_TOKENS,
  charterLayer,
  crewSkillText,
  crewSkillTokens,
  crewSkillsTag,
  layerVersion,
  roleCharter,
  usableAddenda,
  usableCrewSkills,
} from "./charters";

export type ContextModuleDeps = Record<string, never>;

export function createContextModule(
  ctx: ModuleContext,
  _deps: ContextModuleDeps = {},
): MountedModule & { service: ContextService } {
  const service = createContextService({ clock: ctx.clock });
  return { name: "context", service };
}
