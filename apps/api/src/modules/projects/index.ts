// projects module: project CRUD and the workspace root binding.
// Mounted at /api/projects (see Routes in @mengai/shared).
import type { MountedModule, ModuleContext } from "../../core/module";
import type { ProjectsService } from "../../core/services";
import { createProjectsRoutes } from "./routes";
import { createProjectsService, type ProjectsDeps } from "./service";

export type { ProjectsDeps } from "./service";

export function createProjectsModule(ctx: ModuleContext, deps: ProjectsDeps): MountedModule & { service: ProjectsService } {
  const service = createProjectsService(ctx, deps);
  return { name: "projects", mountPath: "projects", routes: createProjectsRoutes(service), service };
}
