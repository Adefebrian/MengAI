// projects module: project CRUD, the workspace root binding, and the live
// preview and open folder routes (delegated to the preview module).
// Mounted at /api/projects (see Routes in @mengai/shared).
import type { MountedModule, ModuleContext } from "../../core/module";
import type { ProjectsService } from "../../core/services";
import { createProjectsRoutes } from "./routes";
import { createProjectsService, type ProjectsDeps } from "./service";

export type { ProjectsDeps } from "./service";

export function createProjectsModule(ctx: ModuleContext, deps: ProjectsDeps): MountedModule & { service: ProjectsService } {
  const service = createProjectsService(ctx, deps);
  return { name: "projects", mountPath: "projects", routes: createProjectsRoutes(service, { kv: ctx.kv }), service };
}
