// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// tools module: the tool registry (specs per role) and execution of every
// non-control tool, plus the ui_check design law scan (pure, exported for
// reuse). Service only; the runs module drives it.
import type { MountedModule, ModuleContext } from "../../core/module";
import { createToolsService, type ToolsDeps, type ToolsOptions, type ToolsServiceImpl } from "./service";

export type { ToolsDeps, ToolsOptions, ToolsServiceImpl } from "./service";
export { UI_CHECK_ROLES } from "./service";
export { UI_CHECK, UI_CHECK_SPEC, scanUi, formatUiReport, type UiFinding, type UiRule } from "./ui-check";

export function createToolsModule(ctx: ModuleContext, deps: ToolsDeps, opts: ToolsOptions = {}): MountedModule & { service: ToolsServiceImpl } {
  return { name: "tools", service: createToolsService(ctx, deps, opts) };
}
