// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// workspace module: jailed file operations (service only, no routes, no tables).
// Public surface: the factory, plus runWithFileOrigin so the tools module can
// attribute file.changed events to the tool call that caused them, and the
// SearchHits type (its `stopped` marker says a search ended early).
import type { MountedModule, ModuleContext } from "../../core/module";
import type { Runner } from "../../core/ports";
import type { WorkspaceService } from "../../core/services";
import { createWorkspaceService } from "./service";

export { runWithFileOrigin, type FileOrigin } from "./origin";
export type { SearchHit, SearchHits } from "./service";

export interface WorkspaceDeps {
  /** reserved for command-backed operations; file ops never shell out */
  runner?: Runner | null;
}

export function createWorkspaceModule(ctx: ModuleContext, _deps: WorkspaceDeps = {}): MountedModule & { service: WorkspaceService } {
  return { name: "workspace", service: createWorkspaceService(ctx) };
}
