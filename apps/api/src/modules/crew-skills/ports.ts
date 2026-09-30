// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The crew-skills module's contract. It needs only the core ports in the
// module context (db, clock, logger, kv for the write limit); the runs
// module reads forPrompt() through core/container.ts (structurally, as its
// own CrewSkillsView), the routes serve the rest.
import type { CreateCrewSkillBody, CrewSkillDTO, UpdateCrewSkillBody } from "@mengai/shared";
import type { PickInput, PickResult } from "./pick";

export type { PickInput as PromptSkillsInput, PickResult as PromptSkills, SkillRef } from "./pick";

export interface CrewSkillsService {
  /** the built-in pack in its order, then the owner's skills newest first */
  list(): Promise<CrewSkillDTO[]>;
  create(body: CreateCrewSkillBody): Promise<CrewSkillDTO>;
  /** built-in skills accept only { enabled } */
  update(id: string, body: UpdateCrewSkillBody): Promise<CrewSkillDTO>;
  /** owner skills only; a built-in is switched off instead */
  remove(id: string): Promise<void>;
  /** the crew skills one prompt carries for this cat, capped, with what was trimmed */
  forPrompt(input: PickInput): Promise<PickResult>;
}
