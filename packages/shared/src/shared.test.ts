import { describe, expect, test } from "bun:test";
import {
  ACTIVITIES,
  AGENT_ROLES,
  CAT_NAMES,
  COATS,
  EVENT_TYPES,
  LEAD_NAME,
  NAME_TAILS,
  RUN_STAGES,
  PROVIDER_PRESETS,
  ROLE_TOOLS,
  TOOL_ACTIVITY,
  TOOL_NAMES,
  activityForTool,
  catLook,
  costUsd,
  findPreset,
  leadCatName,
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
  test("the CEO is Oyen by default, or the owner's ceoName; nobody else takes it", () => {
    expect(LEAD_NAME).toBe("Oyen");
    expect(pickCatName("a", "lead", new Set())).toBe("Oyen");
    expect(pickCatName("a", "lead", new Set(), "Kopi")).toBe("Kopi");
    expect(leadCatName("  Mas   Oyen  ")).toBe("Mas Oyen");
    expect(leadCatName("")).toBe("Oyen");
    expect(leadCatName(null)).toBe("Oyen");
    expect(leadCatName("x".repeat(40))).toHaveLength(24);
    for (let i = 0; i < 200; i++) {
      expect(pickCatName(`agent-${i}`, "engineer", new Set())).not.toBe("Oyen");
      expect(pickCatName(`agent-${i}`, "engineer", new Set(), "Kopi")).not.toBe("Kopi");
    }
  });

  test("a large, cute pool of one-word Indonesian names, unique per run and deterministic", () => {
    expect(CAT_NAMES.length).toBeGreaterThanOrEqual(80);
    expect(new Set(CAT_NAMES).size).toBe(CAT_NAMES.length);
    for (const n of ["Belang", "Cemong", "Tompel", "Garong", "Gembul", "Cimol", "Moci", "Bolu", "Kunyit", "Cireng", "Martabak", "Oreo"]) expect(CAT_NAMES as readonly string[]).toContain(n);
    for (const n of CAT_NAMES) expect(n).toMatch(/^[A-Z][a-z]+$/);
    expect(CAT_NAMES as readonly string[]).not.toContain(LEAD_NAME);
    const taken = new Set<string>([pickCatName("lead", "lead", new Set())]);
    for (let i = 0; i < CAT_NAMES.length; i++) {
      const n = pickCatName(`agent-${i}`, AGENT_ROLES[1 + (i % 7)]!, taken);
      expect(taken.has(n)).toBe(false);
      expect(CAT_NAMES as readonly string[]).toContain(n);
      taken.add(n);
    }
    expect(pickCatName("same", "qa", new Set(["Bolu"]))).toBe(pickCatName("same", "qa", new Set(["Bolu"])));
  });

  test("when the pool runs out the names get a playful second word, then a number", () => {
    const taken = new Set<string>(["Oyen", ...CAT_NAMES]);
    const combo = pickCatName("agent-x", "engineer", taken);
    const [base, tail] = combo.split(" ");
    expect(CAT_NAMES as readonly string[]).toContain(base);
    expect(NAME_TAILS as readonly string[]).toContain(tail);
    for (let i = 0; i < 500; i++) {
      const n = pickCatName(`agent-${i}`, "designer", taken);
      expect(taken.has(n)).toBe(false);
      taken.add(n);
    }
    const full = new Set<string>(["Oyen", ...CAT_NAMES]);
    for (const b of CAT_NAMES) for (const t of NAME_TAILS) full.add(`${b} ${t}`);
    expect(pickCatName("agent-y", "qa", full)).toMatch(/^[A-Z][a-z]+ \d+$/);
  });
});

describe("brain contracts", () => {
  test("tracker stages are ordered and the brain events are registered", () => {
    expect(RUN_STAGES).toEqual(["goal", "planned", "hired", "working", "review", "testing", "shipped"]);
    for (const t of ["agent.spawned", "agent.left", "agent.reflexion", "strategy.updated", "role.created", "run.stage"] as const) expect(EVENT_TYPES).toContain(t);
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
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
