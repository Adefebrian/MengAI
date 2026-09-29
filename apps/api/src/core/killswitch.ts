// Global kill switch. Modules register stop hooks at wiring time; trigger()
// runs every hook at once (a stuck hook cannot delay the others past its
// timeout), sums what they report, and publishes the `killswitch` event.
//
// Hook naming decides where its count lands in KillSwitchResult:
//   "runs" or "runs.<x>"   -> stoppedRuns     (RunsService.stopAll)
//   anything else           -> killedProcesses (runner.killAll, hands.stop, ...)
import type { KillSwitchResult } from "@mengai/shared";
import type { EventSink } from "./ports/events";
import type { Logger } from "./ports/logger";
import type { KillSwitch } from "./services";

export type KillTrigger = "user" | "shortcut" | "tray" | "system";

export const KILL_HOOK_RUNS = "runs";

export interface KillSwitchOptions {
  events: EventSink;
  logger: Logger;
  /** per-hook timeout, ms */
  hookTimeoutMs?: number;
}

export interface KillSwitchImpl extends KillSwitch {
  hooks(): string[];
}

const isRunsHook = (name: string) => name === KILL_HOOK_RUNS || name.startsWith(`${KILL_HOOK_RUNS}.`);

export function createKillSwitch(opts: KillSwitchOptions): KillSwitchImpl {
  const hooks = new Map<string, () => Promise<number>>();
  const timeoutMs = opts.hookTimeoutMs ?? 5000;

  async function runHook(name: string, hook: () => Promise<number>): Promise<number> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const n = await Promise.race([
        hook(),
        new Promise<number>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`kill hook "${name}" timed out`)), timeoutMs);
        }),
      ]);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch (err) {
      opts.logger.log("error", "kill hook failed", { hook: name, error: err instanceof Error ? err.message : String(err) });
      return 0;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    register(name, hook) {
      if (!name) throw new Error("kill hook needs a name");
      if (hooks.has(name)) throw new Error(`kill hook "${name}" already registered`);
      hooks.set(name, hook);
    },
    hooks() {
      return [...hooks.keys()];
    },
    async trigger(by: KillTrigger): Promise<KillSwitchResult> {
      const entries = [...hooks.entries()];
      const counts = await Promise.all(entries.map(([name, hook]) => runHook(name, hook)));
      const result: KillSwitchResult = { stoppedRuns: 0, killedProcesses: 0 };
      entries.forEach(([name], i) => {
        if (isRunsHook(name)) result.stoppedRuns += counts[i]!;
        else result.killedProcesses += counts[i]!;
      });
      opts.logger.log("warn", "kill switch triggered", { by, ...result });
      try {
        await opts.events.publish({ type: "killswitch", runId: null, data: { by, ...result } });
      } catch (err) {
        opts.logger.log("error", "kill switch event failed", { error: err instanceof Error ? err.message : String(err) });
      }
      return result;
    },
  };
}
