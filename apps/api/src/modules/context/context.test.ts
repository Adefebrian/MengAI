// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import { AGENT_ROLES, CONTEXT_LAYERS, type LessonDTO } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { BlobStore } from "../../core/ports/blob";
import type { ToolSpec } from "../../core/ports/llm";
import type { ContextInput, ContextService, StepRecord } from "../../core/services";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import {
  CREW_SKILLS_HEADER,
  CREW_SKILLS_MAX_TOKENS,
  CREW_SKILL_MAX_CHARS,
  createContextModule,
  crewSkillText,
  crewSkillTokens,
  crewSkillsTag,
  layerVersion,
  usableCrewSkills,
  type BrainContextInput,
  type CrewSkillLayer,
} from "./index";

const memoryBlob: BlobStore = {
  async put(key, _data, _type) {
    return { key, size: 0 };
  },
  async get() {
    return null;
  },
  async delete() {},
  async exists() {
    return false;
  },
};

async function setup(): Promise<{ ctx: ModuleContext; service: ContextService; clock: ReturnType<typeof fakeClock> }> {
  const clock = fakeClock();
  const ctx: ModuleContext = {
    config: {
      mode: "local",
      version: "test",
      dataDir: "/tmp/mengai-test",
      workspacesDir: "/tmp/mengai-test/ws",
      webDir: null,
      allowedOrigins: [],
      allowedHosts: [],
      controlToken: null,
    },
    db: await createTestDb(),
    kv: memoryKv(),
    blob: memoryBlob,
    vault: memoryVault(),
    clock,
    logger: silentLogger,
    events: captureEvents(clock),
  };
  const mod = createContextModule(ctx);
  expect(mod.name).toBe("context");
  expect(mod.routes).toBeUndefined();
  return { ctx, service: mod.service, clock };
}

const tools: ToolSpec[] = [
  { name: "fs_read", description: "Read a file by line range", parameters: { type: "object", properties: { path: { type: "string" } } } },
  { name: "finish", description: "Finish the task with evidence", parameters: { type: "object", properties: { summary: { type: "string" } } } },
];

function lesson(id: string, text: string): LessonDTO {
  return {
    id,
    scope: "project",
    role: "engineer",
    projectId: "p1",
    text,
    tags: [],
    status: "active",
    uses: 3,
    wins: 3,
    losses: 0,
    score: 0.8,
    createdAt: 1,
    lastUsedAt: null,
  };
}

function step(i: number, output: string, opts: { ok?: boolean; tool?: string; text?: string } = {}): StepRecord {
  const id = `call-${i}`;
  return {
    assistant: {
      text: opts.text ?? `Checking part ${i}.`,
      toolCalls: [{ id, name: opts.tool ?? "fs_read", arguments: JSON.stringify({ path: `src/file${i}.ts` }) }],
    },
    results: [{ callId: id, tool: opts.tool ?? "fs_read", output, ok: opts.ok ?? true }],
  };
}

function input(overrides: Partial<ContextInput> = {}): ContextInput {
  return {
    role: "engineer",
    runId: "run-1",
    agentId: "agent-1",
    taskId: "task-1",
    tools,
    brief: { goal: "Add a login page", projectName: "Shop", workspaceDigest: "src/\n  app.ts\n  auth.ts", history: "Run 1 built the cart." },
    lessons: [lesson("l1", "Run bun test before calling finish."), lesson("l2", "Auth routes live in src/auth.ts.")],
    task: {
      title: "Build the login form",
      spec: "Create a login form with email and password.",
      acceptance: ["Form validates email", "Tests pass"],
      depSummaries: ["Auth API exists at POST /api/login"],
      handoff: null,
      notes: ["Owner: keep it minimal"],
    },
    steps: [],
    summary: null,
    budgetTokens: 12_000,
    contextWindow: 128_000,
    model: "gpt-4o-mini",
    ...overrides,
  };
}

describe("context charters", () => {
  test("every role has a static charter of 250 to 400 tokens with tool-use rules", async () => {
    const { service } = await setup();
    for (const role of AGENT_ROLES) {
      const charter = service.charter(role);
      const tokens = service.estimateTokens(charter);
      expect(tokens).toBeGreaterThanOrEqual(250);
      expect(tokens).toBeLessThanOrEqual(400);
      expect(charter).toContain("Tools are cheap");
      expect(charter).toContain("before you change it");
      expect(charter).toContain("Finish with evidence");
      expect(service.charter(role)).toBe(charter);
      expect(/[^\x00-\x7f]/.test(charter)).toBe(false);
    }
  });
});

describe("context brain layers", () => {
  const sha = (t: string) => new Bun.CryptoHasher("sha256").update(t).digest("hex");
  const brain = (over: Partial<BrainContextInput>): BrainContextInput => ({ ...input(), ...over });

  test("strategy addenda follow the charter, role first, and version the cache key", async () => {
    const { service } = await setup();
    const plain = service.build(input());
    const role = { scope: "role" as const, version: 2, text: "- Run the checks after the last edit." };
    const own = { scope: "agent" as const, version: 1, text: "- Read the review notes twice." };
    const out = service.build(brain({ addenda: [own, role] }));
    const sys = out.request.system;
    expect(sys.startsWith(service.charter("engineer"))).toBe(true);
    expect(sys.indexOf("Role strategy v2")).toBeGreaterThan(0);
    expect(sys.indexOf("Your own strategy v1")).toBeGreaterThan(sys.indexOf("Role strategy v2"));
    expect(out.request.cacheKey).toBe(sha("engineer:run-1:c1.r2.a1"));
    expect(out.request.cacheKey).not.toBe(plain.request.cacheKey);
    // the charter layer grows by the addenda only; the messages are unchanged
    expect(JSON.stringify(out.request.messages)).toBe(JSON.stringify(plain.request.messages));
    expect(out.xray.layers[0]!.tokens).toBeGreaterThan(plain.xray.layers[0]!.tokens);
    // two cats of the role at the same version share the prefix up to their own addendum
    const other = service.build(brain({ agentId: "agent-2", addenda: [role] }));
    expect(other.request.system.startsWith(service.build(brain({ addenda: [role] })).request.system)).toBe(true);
    expect(other.request.cacheKey).toBe(sha("engineer:run-1:c1.r2"));
  });

  test("a dynamic role brings its own charter and cache key; empty or version 0 layers change nothing", async () => {
    const { service } = await setup();
    const charter = { version: 1, title: "Launch tester", text: "You are the Launch tester cat on a MengAI crew, a qa specialist.\n- Test the page like a first visitor." };
    const out = service.build(brain({ role: "qa", roleKey: "launch-tester", charter }));
    expect(out.request.system.startsWith("You are the Launch tester cat")).toBe(true);
    expect(out.request.system).toContain("Working rules:");
    expect(out.request.cacheKey).toBe(sha("launch-tester:run-1:c1"));
    const plain = service.build(input());
    expect(service.build(brain({ addenda: [{ scope: "role", version: 0, text: "x" }, { scope: "agent", version: 3, text: "  " }] })).request).toEqual(plain.request);
    expect(service.build(brain({ charter: { version: 1, title: "x", text: " " } })).request.system).toBe(plain.request.system);
    expect(layerVersion(null, [])).toBe("");
    expect(layerVersion(charter, [{ scope: "agent", version: 4, text: "a" }])).toBe("c1.a4");
  });

  test("addenda are capped at 120 tokens and redacted", async () => {
    const { service } = await setup();
    const secret = "sk-" + "a".repeat(40);
    const out = service.build(brain({ addenda: [{ scope: "role", version: 1, text: `- Never print ${secret}. ${"word ".repeat(400)}` }] }));
    expect(out.request.system).not.toContain(secret);
    const added = out.request.system.slice(service.charter("engineer").length);
    expect(added.length).toBeLessThanOrEqual(120 * 4 + 80);
  });
});

describe("context crew skills", () => {
  const sha = (t: string) => new Bun.CryptoHasher("sha256").update(t).digest("hex");
  const brain = (over: Partial<BrainContextInput>): BrainContextInput => ({ ...input(), ...over });
  const law: CrewSkillLayer = { id: "builtin-design-law", version: 1, name: "Design law and tidiness", text: "- Nothing overlaps.\n- No gradients." };
  const mine: CrewSkillLayer = { id: "o1", version: 3, name: "Brand voice", text: "- Warm and short." };

  test("skills sit after the charter and before the strategy addenda, in the given order, and key the cache", async () => {
    const { service } = await setup();
    const plain = service.build(input());
    const role = { scope: "role" as const, version: 2, text: "- Run the tests first." };
    const out = service.build(brain({ crewSkills: [law, mine], addenda: [role] }));
    const sys = out.request.system;
    expect(sys.startsWith(`${service.charter("engineer")}\n\n${CREW_SKILLS_HEADER}\n\n## Design law and tidiness\n- Nothing overlaps.`)).toBe(true);
    expect(sys.indexOf("## Brand voice")).toBeGreaterThan(sys.indexOf("## Design law"));
    expect(sys.indexOf("Role strategy v2")).toBeGreaterThan(sys.indexOf("## Brand voice"));
    const tag = crewSkillsTag([law, mine]);
    expect(tag).toMatch(/^k[0-9a-f]{8}$/);
    expect(out.request.cacheKey).toBe(sha(`engineer:run-1:c1.${tag}.r2`));
    expect(layerVersion(null, [], [law, mine])).toBe(`c1.${tag}`);
    // the prefix is byte-stable for the same skills; the messages never change
    expect(service.build(brain({ crewSkills: [law, mine], addenda: [role] })).request.system).toBe(sys);
    expect(JSON.stringify(out.request.messages)).toBe(JSON.stringify(plain.request.messages));
    expect(out.xray.layers[0]!.tokens).toBeGreaterThan(plain.xray.layers[0]!.tokens);
    // a new version or another order is another prefix
    expect(crewSkillsTag([law, { ...mine, version: 4 }])).not.toBe(tag);
    expect(crewSkillsTag([mine, law])).not.toBe(tag);
    expect(service.build(brain({ crewSkills: [] })).request).toEqual(plain.request);
  });

  test("usable skills: text required, each id once, under the hard token ceiling; text cut to the contract", () => {
    const big = (id: string): CrewSkillLayer => ({ id, version: 1, name: id, text: "x".repeat(CREW_SKILL_MAX_CHARS) });
    const use = usableCrewSkills([law, { ...law, version: 2 }, { ...mine, text: "  " }, big("a"), big("b"), mine]);
    expect(use.map((x) => x.id)).toEqual(["builtin-design-law", "a", "o1"]);
    expect(use.reduce((n, x) => n + crewSkillTokens(x), 0)).toBeLessThanOrEqual(CREW_SKILLS_MAX_TOKENS);
    expect(crewSkillText({ name: "A\nB", text: "y".repeat(CREW_SKILL_MAX_CHARS + 50) }).length).toBe("## A B\n".length + CREW_SKILL_MAX_CHARS);
    expect(crewSkillsTag(null)).toBe("");
  });

  test("skills are redacted like every charter layer", async () => {
    const { service } = await setup();
    const secret = "sk-" + "b".repeat(40);
    const out = service.build(brain({ crewSkills: [{ ...mine, text: `- Use key ${secret}` }] }));
    expect(out.request.system).toContain("## Brand voice");
    expect(out.request.system).not.toContain(secret);
  });
});

describe("context build", () => {
  test("lays the prompt out stable first with breakpoints after memory, task and summary", async () => {
    const { service } = await setup();
    const steps = [step(1, "export const a = 1;"), step(2, "export const b = 2;")];
    const out = service.build(input({ steps, summary: "Read src/app.ts; decided to reuse the auth client." }));
    const req = out.request;
    expect(req.system).toBe(service.charter("engineer"));
    expect(req.tools).toEqual(tools);
    expect(req.cacheSystem).toBe(true);
    expect(req.cacheKey).toBe(new Bun.CryptoHasher("sha256").update("engineer:run-1").digest("hex"));

    const m = req.messages;
    expect(m.map((x) => x.role)).toEqual(["user", "user", "user", "assistant", "tool", "assistant", "tool"]);
    const first = m[0]!.content as string;
    expect(first.indexOf("Goal: Add a login page")).toBe(0);
    expect(first).toContain("Project: Shop");
    expect(first).toContain("Workspace:\nsrc/");
    expect(first).toContain("Earlier runs:\nRun 1 built the cart.");
    expect(first.indexOf("Lessons from earlier work")).toBeGreaterThan(first.indexOf("Earlier runs"));
    expect(first).toContain("- Run bun test before calling finish.");
    expect(m[0]!.cacheBreakpoint).toBe(true);

    const packet = m[1]!.content as string;
    expect(packet.startsWith("Your task: Build the login form")).toBe(true);
    for (const part of ["Spec:\nCreate a login form", "Acceptance:\n- Form validates email\n- Tests pass", "Results from dependencies:\n- Auth API", "Notes for you:\n- Owner: keep it minimal"]) {
      expect(packet).toContain(part);
    }
    expect(m[1]!.cacheBreakpoint).toBe(true);

    expect((m[2]!.content as string).startsWith("Summary of your earlier steps:")).toBe(true);
    expect(m[2]!.cacheBreakpoint).toBe(true);

    expect(m[3]!.toolCalls?.[0]?.id).toBe("call-1");
    expect(m[4]!.toolCallId).toBe("call-1");
    expect(m[4]!.content).toBe("export const a = 1;");
    expect(m.slice(3).every((x) => !x.cacheBreakpoint)).toBe(true);
    expect(m.filter((x) => x.cacheBreakpoint)).toHaveLength(3);
  });

  test("the cached prefix is byte-identical across calls and agents of the same role", async () => {
    const { service } = await setup();
    const a = service.build(input({ steps: [step(1, "one")] }));
    const b = service.build(input({ agentId: "agent-2", steps: [step(1, "one"), step(2, "two")] }));
    expect(b.request.system).toBe(a.request.system);
    expect(b.request.cacheKey).toBe(a.request.cacheKey);
    expect(JSON.stringify(b.request.messages.slice(0, 4))).toBe(JSON.stringify(a.request.messages.slice(0, 4)));
    expect(service.build(input({ role: "qa" })).request.cacheKey).not.toBe(a.request.cacheKey);
    expect(service.build(input({ runId: "run-2" })).request.cacheKey).not.toBe(a.request.cacheKey);
  });

  test("without a task or summary the brief carries the only message breakpoint", async () => {
    const { service } = await setup();
    const out = service.build(input({ task: null, lessons: [] }));
    expect(out.request.messages).toHaveLength(1);
    expect(out.request.messages[0]!.cacheBreakpoint).toBe(true);
    expect(out.request.messages[0]!.content as string).not.toContain("Lessons");
    const byLayer = Object.fromEntries(out.xray.layers.map((l) => [l.layer, l]));
    expect(byLayer.memory!.tokens).toBe(0);
    expect(byLayer.task!.tokens).toBe(0);
    expect(byLayer.brief!.cached).toBe(true);
    expect(byLayer.charter!.cached).toBe(true);
  });

  test("xray lists every layer in order, sums to the total, and flags the cached prefix", async () => {
    const { service, clock } = await setup();
    const out = service.build(input({ steps: [step(1, "x".repeat(400)), step(2, "y".repeat(400))] }));
    expect(out.xray.layers.map((l) => l.layer)).toEqual([...CONTEXT_LAYERS]);
    const sum = out.xray.layers.reduce((s, l) => s + l.tokens, 0);
    expect(out.xray.totalTokens).toBe(sum);
    expect(out.estimatedTokens).toBe(sum);
    const cached = Object.fromEntries(out.xray.layers.map((l) => [l.layer, l.cached]));
    expect(cached).toEqual({ charter: true, tools: true, brief: true, memory: true, task: true, summary: false, recent: false });
    for (const l of out.xray.layers) if (l.layer !== "summary") expect(l.tokens).toBeGreaterThan(0);
    expect(out.xray.agentId).toBe("agent-1");
    expect(out.xray.taskId).toBe("task-1");
    expect(out.xray.model).toBe("gpt-4o-mini");
    expect(out.xray.createdAt).toBe(clock.now());

    const withSummary = service.build(input({ summary: "Earlier: fixed src/a.ts" }));
    const s = withSummary.xray.layers.find((l) => l.layer === "summary")!;
    expect(s.tokens).toBeGreaterThan(0);
    expect(s.cached).toBe(true);
    expect(withSummary.xray.layers.find((l) => l.layer === "recent")!.cached).toBe(false);
  });

  test("budget is min(budgetTokens, 40% of the window) and flags compaction when over", async () => {
    const { service } = await setup();
    expect(service.build(input({ budgetTokens: 12_000, contextWindow: 128_000 })).xray.budget).toBe(12_000);
    expect(service.build(input({ budgetTokens: 12_000, contextWindow: 16_000 })).xray.budget).toBe(6_400);
    // unset budget means min(12k, 40% of the window), not 40% alone
    expect(service.build(input({ budgetTokens: 0, contextWindow: 128_000 })).xray.budget).toBe(12_000);
    expect(service.build(input({ budgetTokens: -1, contextWindow: 16_000 })).xray.budget).toBe(6_400);
    expect(service.build(input({ budgetTokens: 0, contextWindow: 0 })).xray.budget).toBe(12_000);
    expect(service.build(input({ budgetTokens: Number.NaN, contextWindow: 200_000 })).xray.budget).toBe(12_000);
    expect(service.build(input({ budgetTokens: 50_000, contextWindow: 0 })).xray.budget).toBe(50_000);

    const small = service.build(input({ steps: [step(1, "a"), step(2, "b")] }));
    expect(small.needsCompaction).toBe(false);

    const big = [step(1, "z".repeat(6_000)), step(2, "w".repeat(6_000)), step(3, "v".repeat(6_000))];
    const over = service.build(input({ steps: big, budgetTokens: 3_000 }));
    expect(over.estimatedTokens).toBeGreaterThan(3_000);
    expect(over.needsCompaction).toBe(true);

    // a single step cannot be folded, so compaction is not requested
    const single = service.build(input({ steps: [step(1, "q".repeat(20_000))], budgetTokens: 1_000 }));
    expect(single.estimatedTokens).toBeGreaterThan(1_000);
    expect(single.needsCompaction).toBe(false);
  });

  test("recent steps: placeholder for missing results, orphans dropped, errors marked, nudge after plain text", async () => {
    const { service } = await setup();
    const s: StepRecord = {
      assistant: {
        text: "",
        toolCalls: [
          { id: "c1", name: "fs_read", arguments: "{}" },
          { id: "c2", name: "shell_run", arguments: "{}" },
        ],
      },
      results: [
        { callId: "c2", tool: "shell_run", output: "exit 1", ok: false },
        { callId: "ghost", tool: "fs_read", output: "orphan", ok: true },
      ],
    };
    const plain: StepRecord = { assistant: { text: "I think the form is done.", toolCalls: [] }, results: [] };
    const m = service.build(input({ steps: [s, plain] })).request.messages;
    const tail = m.slice(2);
    expect(tail.map((x) => x.role)).toEqual(["assistant", "tool", "tool", "assistant", "user"]);
    expect(tail[1]!).toMatchObject({ toolCallId: "c1", content: "(no result recorded)" });
    expect(tail[2]!).toMatchObject({ toolCallId: "c2", content: "[error] exit 1" });
    expect(JSON.stringify(m)).not.toContain("orphan");
    expect(tail[4]!.content).toBe("Continue: call a tool, or call finish with evidence.");
  });

  test("secrets never reach the prompt", async () => {
    const { service } = await setup();
    const key = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
    const out = service.build(
      input({
        brief: { goal: `use key ${key}`, projectName: "Shop", workspaceDigest: "", history: null },
        steps: [step(1, `OPENAI_API_KEY=${key}`), step(2, `token ${key}`)],
      }),
    );
    expect(JSON.stringify(out.request)).not.toContain(key);
    expect(JSON.stringify(out.request)).toContain("[REDACTED]");
  });

  test("identical consecutive tool outputs render as a pointer to the first call", async () => {
    const { service } = await setup();
    const same = "line of output that is long enough to be worth deduping in the prompt ".repeat(3);
    const m = service.build(input({ steps: [step(1, same), step(2, same), step(3, same), step(4, "short")] })).request.messages;
    const toolMsgs = m.filter((x) => x.role === "tool");
    expect(toolMsgs.map((x) => x.content)).toEqual([same, "(same output as call call-1)", "(same output as call call-1)", "short"]);
  });
});

describe("context estimates", () => {
  test("estimate starts at chars / 4 and calibration converges on the real ratio", async () => {
    const { service } = await setup();
    const text = "a".repeat(10_000);
    expect(service.estimateTokens(text)).toBe(2_500);
    expect(service.estimateTokens(text, "claude-sonnet-5")).toBe(2_500);
    expect(service.estimateTokens("")).toBe(0);

    const actual = Math.round(10_000 / 3.2);
    let est = 0;
    for (let i = 0; i < 25; i++) {
      est = service.estimateTokens(text, "claude-sonnet-5");
      service.calibrate("claude-sonnet-5", est, actual);
    }
    est = service.estimateTokens(text, "claude-sonnet-5");
    expect(Math.abs(est - actual) / actual).toBeLessThan(0.01);
    // other models keep their own ratio
    expect(service.estimateTokens(text, "gpt-4o-mini")).toBe(2_500);
    // bad observations are ignored
    service.calibrate("gpt-4o-mini", 0, 100);
    service.calibrate("gpt-4o-mini", 100, Number.NaN);
    expect(service.estimateTokens(text, "gpt-4o-mini")).toBe(2_500);
  });

  test("calibration moves gradually (EMA), not in one jump", async () => {
    const { service } = await setup();
    const text = "b".repeat(8_000);
    const est = service.estimateTokens(text, "m");
    service.calibrate("m", est, est * 2);
    const next = service.estimateTokens(text, "m");
    expect(next).toBeGreaterThan(est);
    expect(next).toBeLessThan(est * 2);
  });
});

describe("context truncation", () => {
  test("keeps the first 2000 and last 1000 chars with an omitted marker", async () => {
    const { service } = await setup();
    const text = "H".repeat(2_000) + "M".repeat(3_000) + "T".repeat(1_000);
    const out = service.truncateOutput(text);
    expect(out).toBe(`${"H".repeat(2_000)}\n[... 3000 chars omitted ...]\n${"T".repeat(1_000)}`);
    expect(service.truncateOutput("short output")).toBe("short output");
    expect(service.truncateOutput("x".repeat(3_000))).toBe("x".repeat(3_000));

    const custom = service.truncateOutput("abcdefghij".repeat(30), 90);
    expect(custom.startsWith("abcdefghij".repeat(6))).toBe(true);
    expect(custom).toContain("[... 210 chars omitted ...]");
    expect(custom.endsWith("abcdefghij".repeat(3))).toBe(true);
  });

  test("redacts secrets in tool output", async () => {
    const { service } = await setup();
    expect(service.truncateOutput("Authorization: Bearer abcdefghijklmnop1234")).not.toContain("abcdefghijklmnop1234");
  });
});

describe("context compaction", () => {
  const noisySteps = (): StepRecord[] => [
    step(1, "Listing complete\nnothing interesting here\nError: cannot find module ./db", { text: "Look at the db module." }),
    step(2, "All good\njust some chatter", { text: "Decided to use the existing pool instead of a new one." }),
    step(3, "plain words only\nmore plain words", { text: "hmm" }),
    step(4, "tail output 4"),
    step(5, "tail output 5"),
    step(6, "tail output 6"),
  ];

  test("folds the oldest half into an extractive summary when no summarizer is given", async () => {
    const { service } = await setup();
    const steps = noisySteps();
    const out = await service.compact({ steps, summary: null, keepRecent: 2 });
    expect(out.steps).toHaveLength(3);
    expect(out.steps[0]!.results[0]!.callId).toBe("call-4");
    expect(out.summary).toContain("Error: cannot find module ./db");
    expect(out.summary).toContain("Decided to use the existing pool");
    expect(out.summary).toContain("src/file1.ts");
    expect(out.summary).not.toContain("nothing interesting here");
    expect(out.summary).not.toContain("plain words only");
    expect(out.tokensAfter).toBeLessThan(out.tokensBefore);
  });

  test("uses the summarizer when it works and falls back when it throws or returns nothing", async () => {
    const { service } = await setup();
    let seen = "";
    const ok = await service.compact({
      steps: noisySteps(),
      summary: "Prior: created src/login.ts",
      keepRecent: 2,
      summarize: async (text) => {
        seen = text;
        return "LLM summary of steps 1 to 3";
      },
    });
    expect(ok.summary).toBe("LLM summary of steps 1 to 3");
    expect(seen).toContain("Previous summary:\nPrior: created src/login.ts");
    expect(seen).toContain("Call fs_read");

    const failing = await service.compact({
      steps: noisySteps(),
      summary: "Prior: created src/login.ts",
      keepRecent: 2,
      summarize: async () => {
        throw new Error("provider down");
      },
    });
    expect(failing.summary.startsWith("Prior: created src/login.ts")).toBe(true);
    expect(failing.summary).toContain("Error: cannot find module ./db");

    const empty = await service.compact({ steps: noisySteps(), summary: null, keepRecent: 2, summarize: async () => "  " });
    expect(empty.summary).toContain("Error: cannot find module ./db");
  });

  test("extractive summary is capped at 600 tokens and keeps the newest lines", async () => {
    const { service } = await setup();
    const steps: StepRecord[] = [];
    for (let i = 0; i < 40; i++) {
      steps.push(step(i, Array.from({ length: 12 }, (_, j) => `error ${i}-${j} in src/mod${i}/file${j}.ts at line ${j * 10}`).join("\n")));
    }
    const out = await service.compact({ steps, summary: null, keepRecent: 4 });
    expect(service.estimateTokens(out.summary)).toBeLessThanOrEqual(600);
    expect(out.summary).toContain("src/mod19/");
    expect(out.summary).not.toContain("src/mod0/file0.ts");
  });

  test("keepRecent limits folding and nothing folds for tiny histories", async () => {
    const { service } = await setup();
    const steps = noisySteps();
    const out = await service.compact({ steps, summary: null, keepRecent: 5 });
    expect(out.steps).toHaveLength(5);
    const none = await service.compact({ steps: steps.slice(0, 1), summary: "prior", keepRecent: 0 });
    expect(none.steps).toHaveLength(1);
    expect(none.summary).toBe("prior");
  });

  test("when keepRecent leaves nothing to fold, compact reports no progress and skips the summarizer", async () => {
    const { service } = await setup();
    const steps = [step(1, "z".repeat(8_000)), step(2, "w".repeat(8_000)), step(3, "v".repeat(8_000))];
    const base = { steps, summary: "Prior: read src/app.ts", budgetTokens: 3_000 };
    expect(service.build(input(base)).needsCompaction).toBe(true);

    let summarizerCalls = 0;
    const summarize = async () => {
      summarizerCalls++;
      return "LLM summary";
    };
    const stuck = await service.compact({ steps, summary: base.summary, keepRecent: 4, summarize });
    expect(summarizerCalls).toBe(0);
    expect(stuck.steps).toHaveLength(3);
    expect(stuck.summary).toBe(base.summary);
    expect(stuck.tokensAfter).toBeGreaterThanOrEqual(stuck.tokensBefore);
    // still over budget: needsCompaction stays true, so the caller's guard is what stops the loop
    expect(service.build(input({ ...base, steps: stuck.steps, summary: stuck.summary })).needsCompaction).toBe(true);

    // a caller loop guarded by tokensAfter >= tokensBefore ends after one round
    let cur = { steps, summary: base.summary as string };
    let rounds = 0;
    while (rounds < 10 && service.build(input({ ...base, ...cur })).needsCompaction) {
      rounds++;
      const c = await service.compact({ ...cur, keepRecent: 4, summarize });
      cur = { steps: c.steps, summary: c.summary };
      if (c.tokensAfter >= c.tokensBefore) break;
    }
    expect(rounds).toBe(1);
    expect(summarizerCalls).toBe(0);

    // with room to fold, the same history makes progress and uses the summarizer
    const folded = await service.compact({ steps, summary: base.summary, keepRecent: 1, summarize });
    expect(summarizerCalls).toBe(1);
    expect(folded.steps).toHaveLength(2);
    expect(folded.tokensAfter).toBeLessThan(folded.tokensBefore);
  });

  test("kept steps dedupe identical consecutive outputs and never keep a dangling pointer", async () => {
    const { service } = await setup();
    const same = "identical directory listing with plenty of characters to be worth a pointer here\n".repeat(2);
    const steps = [step(1, "first"), step(2, same), step(3, same), step(4, same)];
    // pre-deduped history: call-3 and call-4 already point at call-2
    steps[2]!.results[0]!.output = "(same output as call call-2)";
    steps[3]!.results[0]!.output = "(same output as call call-2)";
    const out = await service.compact({ steps, summary: null, keepRecent: 2 });
    expect(out.steps).toHaveLength(2);
    // call-2 was folded: call-3 gets the real output back, call-4 points at call-3
    expect(out.steps[0]!.results[0]!.output).toBe(same);
    expect(out.steps[1]!.results[0]!.output).toBe("(same output as call call-3)");

    const fresh = [step(1, same), step(2, same), step(3, "other")];
    const none = await service.compact({ steps: fresh, summary: null, keepRecent: 3 });
    expect(none.steps[1]!.results[0]!.output).toBe("(same output as call call-1)");
  });
});
