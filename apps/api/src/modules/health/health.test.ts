import { describe, expect, test } from "bun:test";
import { silentLogger } from "../../testing";
import type { AppConfig } from "../../core/module";
import { createHealthModule } from "./index";

const config: AppConfig = {
  mode: "local",
  version: "9.9.9",
  dataDir: "/tmp/x",
  workspacesDir: "/tmp/x/ws",
  webDir: null,
  allowedOrigins: [],
  allowedHosts: [],
  controlToken: "t",
};

describe("health", () => {
  test("reports mode, version and the injected probes", async () => {
    const mod = createHealthModule(
      { config, logger: silentLogger },
      {
        llmConfigured: async () => true,
        jevConfigured: () => false,
        automationStatus: async () => ({ available: true, reason: null, permissions: { accessibility: true, screen: false }, active: false }),
      },
    );
    const res = await mod.routes!.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      mode: "local",
      version: "9.9.9",
      configured: true,
      automation: { available: true, accessibility: true, screen: false },
      jev: { configured: false },
    });
  });

  test("a failing probe reads as not configured, never a 500", async () => {
    const mod = createHealthModule(
      { config, logger: silentLogger },
      {
        llmConfigured: async () => {
          throw new Error("db down");
        },
        jevConfigured: async () => true,
        automationStatus: () => {
          throw new Error("helper missing");
        },
      },
    );
    const dto = await mod.service.check();
    expect(dto.ok).toBe(true);
    expect(dto.configured).toBe(false);
    expect(dto.jev.configured).toBe(true);
    expect(dto.automation).toEqual({ available: false, accessibility: false, screen: false });
  });
});
