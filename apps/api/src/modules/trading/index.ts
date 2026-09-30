// trading module: the owner's trading settings (paper by default), the paper
// broker (fills, positions, P&L), the risk review and the live-order gate.
// Mounted at /api/trading; the kill switch cancels open orders and stops
// trading. The only public export.
import type { ModuleContext, MountedModule } from "../../core/module";
import type { KillSwitch } from "../../core/services";
import type { TradingService } from "./ports";
import { createTradingRoutes } from "./routes";
import { createTradingService, type TradingDeps } from "./service";

export type { ProposeInput, ReviewInput, TradingService, TradingVenue, VenueTool } from "./ports";
export { TradingError } from "./ports";
export type { TradingDeps } from "./service";
export { applyFill, unrealized } from "./broker";
export { liveGate } from "./gates";

export function createTradingModule(ctx: ModuleContext, deps: TradingDeps & { killswitch?: KillSwitch } = {}): MountedModule & { service: TradingService } {
  const service = createTradingService(ctx, deps);
  // the kill switch count is processes; cancelled orders are logged and streamed instead
  deps.killswitch?.register("trading", async () => {
    await service.halt("kill switch");
    return 0;
  });
  return { name: "trading", mountPath: "trading", routes: createTradingRoutes(service, { kv: ctx.kv }), service };
}
