// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import { silentLogger } from "../../testing";
import type { AppConfig } from "../../core/module";
import { detectPlatform } from "../../lib/platform";
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
        platform: detectPlatform({ platform: "darwin", sandboxUnavailable: () => null }),
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
      platform: "darwin",
      features: { shell: true, liveTrading: true, mcpStdio: true, scriptPreview: true },
    });
  });

  test.each(["win32", "linux"] as const)("%s reports its platform with every sandbox feature off", async (platform) => {
    const mod = createHealthModule(
      { config, logger: silentLogger },
      { llmConfigured: () => true, jevConfigured: () => true, automationStatus: () => ({ available: false, reason: "x", permissions: { accessibility: false, screen: false }, active: false }), platform: detectPlatform({ platform }) },
    );
    const dto = await mod.service.check();
    expect(dto.platform).toBe(platform);
    expect(dto.features).toEqual({ shell: false, liveTrading: false, mcpStdio: false, scriptPreview: false });
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
        platform: detectPlatform({ platform: "darwin", sandboxUnavailable: () => null }),
      },
    );
    const dto = await mod.service.check();
    expect(dto.ok).toBe(true);
    expect(dto.configured).toBe(false);
    expect(dto.jev.configured).toBe(true);
    expect(dto.automation).toEqual({ available: false, accessibility: false, screen: false });
  });
});
