// tools module: the tool registry (specs per role) and execution of every
// non-control tool. Service only; the runs module drives it.
import type { MountedModule, ModuleContext } from "../../core/module";
import { createToolsService, type ToolsDeps, type ToolsOptions, type ToolsServiceImpl } from "./service";

export type { ToolsDeps, ToolsOptions, ToolsServiceImpl } from "./service";

export function createToolsModule(ctx: ModuleContext, deps: ToolsDeps, opts: ToolsOptions = {}): MountedModule & { service: ToolsServiceImpl } {
  return { name: "tools", service: createToolsService(ctx, deps, opts) };
}
