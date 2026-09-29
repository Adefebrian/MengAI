// The ONLY file another module or the app entrypoint may import from this
// module. Exposes the router and the public types; everything else
// (service.ts, repo.ts internals) stays private to this folder.
import { createExampleRoutes } from "./routes";
import { createExampleService, type ExampleServiceDeps } from "./service";

export type { Item } from "./repo";
export type { ExampleService } from "./service";

export function createExampleModule(deps: ExampleServiceDeps) {
  const service = createExampleService(deps);
  return createExampleRoutes(service);
}
