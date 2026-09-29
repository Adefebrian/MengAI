import { describe, expect, test } from "bun:test";
import {
  ACTIVITIES,
  AGENT_ROLES,
  COATS,
  PROVIDER_PRESETS,
  ROLE_TOOLS,
  TOOL_ACTIVITY,
  TOOL_NAMES,
  activityForTool,
  catLook,
  costUsd,
  findPreset,
  pickCatName,
  priceFor,
} from "./index";

describe("activity map", () => {
  test("every tool maps to a known activity", () => {
    for (const tool of TOOL_NAMES) expect(ACTIVITIES).toContain(TOOL_ACTIVITY[tool]);
  });
  test("unknown tools fall back to code", () => {
    expect(activityForTool("mystery_tool")).toBe("code");
  });
  test("every role has finish and only known tools", () => {
    for (const role of AGENT_ROLES) {
      expect(ROLE_TOOLS[role]).toContain("finish");
      for (const t of ROLE_TOOLS[role]) expect(TOOL_NAMES).toContain(t);
      expect(new Set(ROLE_TOOLS[role]).size).toBe(ROLE_TOOLS[role].length);
    }
  });
  test("role tool sets stay small (token budget)", () => {
    for (const role of AGENT_ROLES) expect(ROLE_TOOLS[role].length).toBeLessThanOrEqual(14);
  });
});

describe("cat identity", () => {
  test("look is deterministic and valid", () => {
    const a = catLook("0192f0aa-1111-7000-8000-000000000001");
    const b = catLook("0192f0aa-1111-7000-8000-000000000001");
    expect(a).toEqual(b);
    expect(COATS).toContain(a.coat);
  });
  test("lead gets Kopi, names stay unique", () => {
    const taken = new Set<string>();
    const lead = pickCatName("a", "lead", taken);
    expect(lead).toBe("Kopi");
    taken.add(lead);
    for (let i = 0; i < 60; i++) {
      const n = pickCatName(`agent-${i}`, "engineer", taken);
      expect(taken.has(n)).toBe(false);
      taken.add(n);
    }
  });
});

describe("providers", () => {
  test("preset ids are unique and default preset exists", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findPreset("openai")?.suggestedModels).toContain("gpt-4o-mini");
    for (const id of ["anthropic", "deepseek", "mimo", "agentrouter", "custom-openai", "custom-anthropic", "jev"]) {
      expect(findPreset(id)).toBeDefined();
    }
  });
});

describe("pricing", () => {
  test("prefix match and unknown models", () => {
    expect(priceFor("claude-sonnet-5-5").known).toBe(true);
    expect(priceFor("openai/gpt-4o-mini").price.input).toBe(0.15);
    expect(priceFor("totally-unknown").known).toBe(false);
  });
  test("cached tokens are cheaper", () => {
    const full = costUsd("gpt-4o-mini", { inputTokens: 10_000, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 });
    const cached = costUsd("gpt-4o-mini", { inputTokens: 10_000, outputTokens: 0, cachedTokens: 8_000, cacheWriteTokens: 0 });
    expect(cached).toBeLessThan(full);
    expect(full).toBeCloseTo(0.0015, 6);
  });
});
