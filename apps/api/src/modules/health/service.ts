// Health: mode, version and what is configured, from injected callbacks.
// A failing callback reports "not configured" instead of failing the check.
import type { AutomationStatus, HealthDTO } from "@mengai/shared";
import type { AppConfig } from "../../core/module";
import type { Logger } from "../../core/ports/logger";

export interface HealthDeps {
  llmConfigured(): Promise<boolean> | boolean;
  jevConfigured(): Promise<boolean> | boolean;
  automationStatus(): Promise<AutomationStatus> | AutomationStatus;
}

export interface HealthService {
  check(): Promise<HealthDTO>;
}

const OFF: AutomationStatus = { available: false, reason: "unavailable", permissions: { accessibility: false, screen: false }, active: false };

export function createHealthService(config: AppConfig, deps: HealthDeps, logger: Logger): HealthService {
  async function safe<T>(name: string, fn: () => Promise<T> | T, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      logger.log("warn", "health probe failed", { probe: name, error: err instanceof Error ? err.message : String(err) });
      return fallback;
    }
  }
  return {
    async check() {
      const [configured, jev, automation] = await Promise.all([
        safe("llm", () => deps.llmConfigured(), false),
        safe("jev", () => deps.jevConfigured(), false),
        safe("automation", () => deps.automationStatus(), OFF),
      ]);
      return {
        ok: true,
        mode: config.mode,
        version: config.version,
        configured: configured === true,
        automation: {
          available: automation.available === true,
          accessibility: automation.permissions?.accessibility === true,
          screen: automation.permissions?.screen === true,
        },
        jev: { configured: jev === true },
      };
    },
  };
}
