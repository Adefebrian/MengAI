// preview module: Live preview (a project's dev script or static
// index.html on 127.0.0.1:4300-4399) and Open folder, local engine only.
// Service only: the projects module owns /api/projects/:id/preview and
// /api/projects/:id/reveal and passes the workspace root in. The kill
// switch and shutdown stop every preview. The only public export.
import type { MountedModule, ModuleContext } from "../../core/module";
import type { KillSwitch } from "../../core/services";
import type { PreviewOptions, PreviewService } from "./ports";
import { createPreviewService } from "./service";

export type { FolderOpener, PortFree, PreviewFetch, PreviewLimits, PreviewOptions, PreviewProcess, PreviewService, PreviewSpawner, StaticServe, StaticServer } from "./ports";
export { detectPreview, NOTHING_TO_PREVIEW, type Detection } from "./detect";
export { LOCAL_ONLY, PREVIEW_LIMITS } from "./service";

export interface PreviewDeps {
  killswitch?: KillSwitch;
}

export function createPreviewModule(ctx: ModuleContext, deps: PreviewDeps = {}, opts: PreviewOptions = {}): MountedModule & { service: PreviewService } {
  const service = createPreviewService(ctx, opts);
  deps.killswitch?.register("preview", () => service.stopAll());
  return { name: "preview", service, close: () => service.close() };
}
