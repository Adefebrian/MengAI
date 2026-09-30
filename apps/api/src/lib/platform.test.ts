// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import { HttpError } from "./http";
import { assertFeature, comingSoonText, detectPlatform, FEATURE_KEYS, featureOff, platformLabel, taskkillArgv } from "./platform";

const EM_DASH = String.fromCharCode(0x2014);

describe("detectPlatform", () => {
  test("darwin with a working sandbox turns every feature on", () => {
    let probed = 0;
    const info = detectPlatform({ platform: "darwin", sandboxUnavailable: () => (probed++, null) });
    expect(info).toEqual({ platform: "darwin", features: { shell: true, liveTrading: true, mcpStdio: true, scriptPreview: true }, reason: null });
    expect(probed).toBe(1);
    expect(Object.isFrozen(info) && Object.isFrozen(info.features)).toBe(true);
  });

  test("darwin whose sandbox cannot start, or whose check throws, turns every feature off", () => {
    const failed = detectPlatform({ platform: "darwin", sandboxUnavailable: () => "sandbox-exec self test failed (exit 71)" });
    expect(Object.values(failed.features).every((v) => v === false)).toBe(true);
    expect(failed.reason).toContain("self test failed");
    const threw = detectPlatform({
      platform: "darwin",
      sandboxUnavailable: () => {
        throw new Error("boom");
      },
    });
    expect(Object.values(threw.features).every((v) => v === false)).toBe(true);
    expect(threw.reason).toContain("boom");
  });

  test.each(["win32", "linux", "freebsd"] as const)("%s turns every feature off without probing", (platform) => {
    let probed = 0;
    const info = detectPlatform({ platform, sandboxUnavailable: () => (probed++, null) });
    expect(info.platform).toBe(platform);
    expect(info.features).toEqual({ shell: false, liveTrading: false, mcpStdio: false, scriptPreview: false });
    expect(info.reason).toContain("has no crew sandbox yet");
    expect(probed).toBe(0);
  });

  test("the default reads the real platform", () => {
    expect(detectPlatform({ sandboxUnavailable: () => null }).platform).toBe(process.platform);
  });
});

describe("coming soon reasons", () => {
  test("plain text per platform and feature, no em-dash", () => {
    expect(platformLabel("win32")).toBe("Windows");
    expect(platformLabel("linux")).toBe("Linux");
    expect(platformLabel("darwin")).toBe("macOS");
    expect(comingSoonText("win32", "liveTrading")).toBe("Coming soon on Windows: live trading. Paper trading works here.");
    expect(comingSoonText("linux", "shell")).toBe("Coming soon on Linux: crew shell commands. File tools still work here.");
    expect(comingSoonText("win32", "mcpStdio")).toBe("Coming soon on Windows: local MCP servers. Remote MCP servers and HTTP connectors work here.");
    expect(comingSoonText("win32", "scriptPreview")).toBe("Coming soon on Windows: live preview of dev scripts. Static sites still preview here.");
    expect(comingSoonText("darwin", "shell")).toStartWith("Not available on this Mac right now (crew shell commands)");
    for (const p of ["win32", "linux", "darwin"]) for (const f of FEATURE_KEYS) expect(comingSoonText(p, f)).not.toContain(EM_DASH);
  });

  test("featureOff and assertFeature: no info or a feature that is on pass; an off feature is 422 coming_soon", () => {
    const win = detectPlatform({ platform: "win32" });
    const mac = detectPlatform({ platform: "darwin", sandboxUnavailable: () => null });
    for (const f of FEATURE_KEYS) {
      expect(featureOff(undefined, f)).toBeNull();
      expect(featureOff(mac, f)).toBeNull();
      expect(featureOff(win, f)).toBe(comingSoonText("win32", f));
      expect(() => assertFeature(mac, f)).not.toThrow();
      let thrown: unknown = null;
      try {
        assertFeature(win, f);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HttpError);
      expect((thrown as HttpError).status).toBe(422);
      expect((thrown as HttpError).code).toBe("coming_soon");
    }
  });
});

describe("taskkillArgv", () => {
  test("ends the whole tree by force through the absolute taskkill under SystemRoot", () => {
    expect(taskkillArgv(4321, "C:\\Windows")).toEqual(["C:\\Windows\\System32\\taskkill.exe", "/PID", "4321", "/T", "/F"]);
    expect(taskkillArgv(7, undefined)).toEqual(["taskkill.exe", "/PID", "7", "/T", "/F"]);
    expect(taskkillArgv(7, "relative\\dir")[0]).toBe("taskkill.exe");
  });
});
