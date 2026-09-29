import { describe, expect, test } from "bun:test";
import type { DecisionDTO, LessonDTO, LessonListQuery, LlmCallDTO, RouteQuery } from "@mengai/shared";
import { Hono } from "hono";
import type { ModuleContext } from "../../core/module";
import type { BlobStore } from "../../core/ports/blob";
import type { Db } from "../../core/ports/db";
import type { Kv } from "../../core/ports/kv";
import type { ChatRequest, ChatResult, LlmProvider, LlmRouter } from "../../core/ports/llm";
import type { DecisionService, RecordCallInput, UsageService } from "../../core/services";
import { HttpError, errorBody } from "../../lib/http";
import { num } from "../../lib/sql";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createContextModule } from "../context";
import { bm25, similarity, tokenize } from "./bm25";
import { createMemoryModule, type MemoryModuleService } from "./index";
import { nextStatus, parseReflection } from "./service";

const noBlob: BlobStore = {
  async put(key) {
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

type PromoteInput = Parameters<DecisionService["promoteLesson"]>[0];

function fakeDecision(action: string): DecisionDTO {
  return {
    id: "d1",
    runId: null,
    decisionId: "mem.promote",
    answers: {},
    action,
    confidence: 0.9,
    verified: true,
    stamp: null,
    latencyMs: 0,
    createdAt: 0,
  };
}

function fakeDecisions(scope: "global" | "project" | "discard" | "throw", verdict: { verified: boolean; stamp: string | null } = { verified: true, stamp: null }) {
  const calls: PromoteInput[] = [];
  const unused = async (): Promise<never> => {
    throw new Error("not used by memory");
  };
  const service: DecisionService = {
    route: unused,
    modelTier: unused,
    loopExit: unused,
    escalate: unused,
    severity: unused,
    list: async () => [],
    async promoteLesson(input) {
      calls.push(input);
      if (scope === "throw") throw new Error("jev unreachable");
      return { scope, durable: 0.9, decision: { ...fakeDecision(scope), ...verdict } };
    },
  };
  return { service, calls };
}

function fakeUsage() {
  const calls: RecordCallInput[] = [];
  const service: UsageService = {
    async record(input) {
      calls.push(input);
      return {
        id: "call-1",
        runId: input.runId,
        agentId: input.agentId,
        taskId: input.taskId,
        providerId: input.providerId,
        model: input.model,
        purpose: input.purpose,
        ...input.usage,
        costUsd: 0,
        latencyMs: input.latencyMs,
        retries: input.retries,
        ok: input.ok,
        error: input.error,
        createdAt: 0,
      } satisfies LlmCallDTO;
    },
    cost: async () => 0,
    prices: async () => ({}),
    listCalls: async () => [],
  };
  return { service, calls };
}

function fakeLlm(opts: { configured: boolean; reply?: string; fail?: boolean }) {
  const requests: ChatRequest[] = [];
  const resolves: unknown[] = [];
  const provider: LlmProvider = {
    id: "prov-openai",
    protocol: "openai_chat",
    async chat(req): Promise<ChatResult> {
      requests.push(req);
      if (opts.fail) throw new Error("upstream 500");
      return {
        text: opts.reply ?? '{"lesson": null}',
        toolCalls: [],
        stopReason: "end",
        usage: { inputTokens: 120, outputTokens: 30, cachedTokens: 0, cacheWriteTokens: 0 },
        model: "gpt-4o-mini",
        latencyMs: 42,
        retries: 0,
      };
    },
    listModels: async () => [],
  };
  const router: LlmRouter = {
    async configured() {
      return opts.configured;
    },
    async resolve(o) {
      resolves.push(o);
      if (!opts.configured) throw new Error("no provider");
      return { provider, model: "gpt-4o-mini", contextWindow: 128_000 };
    },
  };
  return { router, requests, resolves };
}

/** Db that rejects any statement containing `pattern` while `fault.armed` (inside transactions too). */
function faultyDb(inner: Db, pattern: string, fault: { armed: boolean }): Db {
  return {
    dialect: inner.dialect,
    query(strings, ...values) {
      if (fault.armed && strings.join("?").includes(pattern)) return Promise.reject(new Error("injected db failure"));
      return inner.query(strings, ...values);
    },
    tx(fn) {
      return inner.tx((tx) => fn(faultyDb(tx, pattern, fault)));
    },
    exec: (sql) => inner.exec(sql),
    close: () => inner.close(),
  };
}

/** Db that rejects only the `fault.nth` statement (1-based) containing `pattern` while `fault.armed`. */
function nthFaultDb(inner: Db, pattern: string, fault: { armed: boolean; nth: number; seen: number }): Db {
  return {
    dialect: inner.dialect,
    query(strings, ...values) {
      if (fault.armed && strings.join("?").includes(pattern) && ++fault.seen === fault.nth) return Promise.reject(new Error("injected db failure"));
      return inner.query(strings, ...values);
    },
    tx(fn) {
      return inner.tx((tx) => fn(nthFaultDb(tx, pattern, fault)));
    },
    exec: (sql) => inner.exec(sql),
    close: () => inner.close(),
  };
}

/** Kv whose set() rejects for keys starting with `prefix` (the promotion memos, not the lock). */
function memoWritesFail(inner: Kv, prefix: string): Kv {
  return { ...inner, set: (key, value, ttl) => (key.startsWith(prefix) ? Promise.reject(new Error("kv down")) : inner.set(key, value, ttl)) };
}

async function setup(
  o: {
    scope?: "global" | "project" | "discard" | "throw";
    verdict?: { verified: boolean; stamp: string | null };
    llm?: ReturnType<typeof fakeLlm>;
    wrapDb?: (db: Db) => Db;
    wrapKv?: (kv: Kv) => Kv;
  } = {},
) {
  const clock = fakeClock();
  const events = captureEvents(clock);
  const raw = await createTestDb();
  const db = o.wrapDb ? o.wrapDb(raw) : raw;
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
    db,
    kv: o.wrapKv ? o.wrapKv(memoryKv()) : memoryKv(),
    blob: noBlob,
    vault: memoryVault(),
    clock,
    logger: silentLogger,
    events,
  };
  const decisions = fakeDecisions(o.scope ?? "global", o.verdict);
  const usage = fakeUsage();
  const llm = o.llm ?? fakeLlm({ configured: false });
  const mod = createMemoryModule(ctx, { llm: llm.router, decisions: decisions.service, usage: usage.service });
  const app = new Hono();
  app.onError((err, c) =>
    err instanceof HttpError ? c.json(errorBody(err.code, err.message), err.status) : c.json(errorBody("internal", "internal error"), 500),
  );
  app.route(`/api/${mod.mountPath}`, mod.routes!);
  return { ctx, db, clock, events, decisions, usage, llm, mod, memory: mod.service as MemoryModuleService, app };
}

const engineer = { role: "engineer" as const, projectId: "p1", runId: "r1" };

describe("bm25 and shingles", () => {
  test("tokenize splits camelCase and snake_case, drops stopwords, stems", () => {
    expect(tokenize("The deployApp tests are FAILING in run_tests")).toEqual(["deploy", "app", "test", "fail", "run", "test"]);
  });

  test("rarer matching terms rank higher and non-matching docs are dropped", () => {
    const docs = [
      { item: "a", text: "bun test runs the unit tests" },
      { item: "b", text: "postgres bigint comes back as a string" },
      { item: "c", text: "run bun test and bun build" },
      { item: "d", text: "css grid layout" },
    ];
    const ranked = bm25("postgres bigint", docs);
    expect(ranked.map((r) => r.item)).toEqual(["b"]);
    const bun = bm25("bun build", docs).map((r) => r.item);
    expect(bun[0]).toBe("c");
    expect(bun).not.toContain("d");
  });

  test("word 3-shingle similarity catches restatements, not rewording", () => {
    expect(similarity("Always run bun test before finish.", "always run BUN test before finish")).toBe(1);
    expect(similarity("Always run bun test before calling finish on a task", "Never run bun test before calling finish on a task")).toBeLessThan(0.8);
  });
});

describe("memory lessons", () => {
  test("record stores a candidate, redacts secrets and publishes lesson.recorded", async () => {
    const { memory, events } = await setup();
    const l = await memory.record({ ...engineer, text: "  Use the key sk-proj-abcdefghijklmnopqrstuvwxyz0123 only via the vault. ", tags: ["Vault", "vault", "Keys!"] });
    expect(l.status).toBe("candidate");
    expect(l.scope).toBe("project");
    expect(l.projectId).toBe("p1");
    expect(l.score).toBe(0.5);
    expect(l.text).not.toContain("sk-proj-");
    expect(l.text).toContain("[REDACTED]");
    expect(l.tags).toEqual(["vault", "keys"]);
    const ev = events.ofType("lesson.recorded");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data.lesson.id).toBe(l.id);
    expect(ev[0]!.runId).toBe("r1");
  });

  test("scope defaults: project, then role, then global", async () => {
    const { memory } = await setup();
    expect((await memory.record({ text: "Lesson one about project things", role: "qa", projectId: "p9", runId: null })).scope).toBe("project");
    expect((await memory.record({ text: "Lesson two about role things", role: "qa", projectId: null, runId: null })).scope).toBe("role");
    expect((await memory.record({ text: "Lesson three about everything", role: null, projectId: null, runId: null })).scope).toBe("global");
    const forced = await memory.record({ text: "Lesson four forced global", role: "qa", projectId: "p9", runId: null, scope: "global" });
    expect(forced.scope).toBe("global");
    expect(forced.projectId).toBeNull();
    const empty = await memory.record({ text: "   ", role: null, projectId: null, runId: null }).catch((e: unknown) => e);
    expect(empty).toBeInstanceOf(HttpError);
    expect(empty).toMatchObject({ status: 422, code: "invalid_body", message: "text: lesson text is empty" });
  });

  test("near duplicates merge into the existing lesson (Jaccard >= 0.8)", async () => {
    const { memory, events } = await setup();
    const a = await memory.record({ ...engineer, text: "Always run bun test before calling finish on a task.", tags: ["testing"] });
    const b = await memory.record({ ...engineer, text: "always run bun test before calling finish on a task", tags: ["finish"] });
    expect(b.id).toBe(a.id);
    expect(b.tags).toEqual(["testing", "finish"]);
    expect(events.ofType("lesson.recorded")).toHaveLength(2);
    const c = await memory.record({ ...engineer, text: "Read the file before editing it with fs_edit." });
    expect(c.id).not.toBe(a.id);
    // another project cannot see p1 lessons, so no merge there
    const d = await memory.record({ ...engineer, projectId: "p2", text: "Always run bun test before calling finish on a task." });
    expect(d.id).not.toBe(a.id);
    expect((await memory.listLessons({})).length).toBe(3);
  });

  test("an explicit wider scope is honored even when a narrower near duplicate exists", async () => {
    const { memory } = await setup();
    const text = "Always pin the bun version in CI before running tests.";
    const project = await memory.record({ ...engineer, text });
    // global asked: the project copy does not reach far enough, so a new global lesson is stored
    const global = await memory.record({ ...engineer, text, scope: "global" });
    expect(global.id).not.toBe(project.id);
    expect(global.scope).toBe("global");
    expect(global.projectId).toBeNull();
    // role asked: the project copy is narrower, the global copy is wider and absorbs it
    const role = await memory.record({ ...engineer, text, scope: "role" });
    expect(role.id).toBe(global.id);
    // project asked: merges into the widest match the recorder can see
    const again = await memory.record({ ...engineer, text });
    expect([project.id, global.id]).toContain(again.id);
    const all = await memory.listLessons({});
    expect(all.map((l) => l.scope).sort()).toEqual(["global", "project"]);

    // a role recorder with a project copy gets its own role lesson
    const { memory: m2 } = await setup();
    const p = await m2.record({ ...engineer, text });
    const r = await m2.record({ ...engineer, text, scope: "role" });
    expect(r.id).not.toBe(p.id);
    expect(r.scope).toBe("role");
  });

  test("BM25 retrieval over project, role and global scope within a token budget", async () => {
    const { memory } = await setup();
    const pg = await memory.record({ ...engineer, text: "Postgres returns bigint columns as strings; read them through num()." });
    const bun = await memory.record({ ...engineer, text: "Run bun test before calling finish." });
    await memory.record({ role: "engineer", projectId: null, runId: null, text: "Engineers prefer fs_edit patches over rewriting files." });
    const glob = await memory.record({ role: null, projectId: null, runId: null, text: "Postgres bigint handling differs from SQLite integers." });
    await memory.record({ ...engineer, projectId: "p2", text: "Postgres bigint columns in p2 are special." });
    await memory.record({ role: "qa", projectId: null, runId: null, text: "QA reads postgres bigint columns carefully." });
    const retired = await memory.record({ ...engineer, text: "Postgres bigint is broken, avoid postgres entirely." });
    await memory.patchLesson(retired.id, { status: "retired" });

    const hits = await memory.retrieve({ text: "read bigint columns from postgres", role: "engineer", projectId: "p1" });
    expect(hits.map((h) => h.id)).toEqual([pg.id, glob.id]);

    const tests = await memory.retrieve({ text: "bun test finish", role: "engineer", projectId: "p1" });
    expect(tests[0]!.id).toBe(bun.id);

    const one = await memory.retrieve({ text: "read bigint columns from postgres", role: "engineer", projectId: "p1", limit: 1 });
    expect(one.map((h) => h.id)).toEqual([pg.id]);

    // the budget fits only the shorter lesson
    const tight = await memory.retrieve({ text: "postgres bigint", role: "engineer", projectId: "p1", tokenBudget: 16 });
    expect(tight.map((h) => h.id)).toEqual([glob.id]);
    expect(await memory.retrieve({ text: "the and of", role: "engineer", projectId: "p1" })).toEqual([]);
  });

  test("markUsed writes one use per lesson and task, ignoring unknown ids", async () => {
    const { memory, db, clock } = await setup();
    const l = await memory.record({ ...engineer, text: "Check the migration folder before adding a column." });
    clock.advance(5_000);
    await memory.markUsed([l.id, l.id, "missing-id"], { runId: "r1", taskId: "t1" });
    await memory.markUsed([l.id], { runId: "r1", taskId: "t1" });
    const uses = await db.query`select * from lesson_uses`;
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({ lesson_id: l.id, task_id: "t1", run_id: "r1", outcome: null });
    const [row] = await memory.listLessons({});
    expect(row!.lastUsedAt).toBe(clock.now());
  });

  test("outcomes score (wins + 1) / (uses + 2) and move status candidate -> active -> retired", async () => {
    const { memory } = await setup();
    const good = await memory.record({ ...engineer, text: "Good lesson that keeps working." });
    const bad = await memory.record({ ...engineer, text: "Bad lesson that keeps failing." });
    const get = async (id: string) => (await memory.listLessons({})).find((l) => l.id === id)!;

    await memory.markUsed([good.id], { runId: "r1", taskId: "t1" });
    await memory.recordOutcome({ runId: "r1", taskId: "t1", success: true });
    let g = await get(good.id);
    expect([g.uses, g.wins, g.status]).toEqual([1, 1, "candidate"]);
    expect(g.score).toBeCloseTo(2 / 3, 6);

    // closing twice does not double count
    await memory.recordOutcome({ runId: "r1", taskId: "t1", success: true });
    expect((await get(good.id)).uses).toBe(1);

    await memory.markUsed([good.id], { runId: "r1", taskId: "t2" });
    await memory.recordOutcome({ runId: "r1", taskId: "t2", success: true });
    g = await get(good.id);
    expect([g.uses, g.wins, g.status]).toEqual([2, 2, "active"]);
    expect(g.score).toBeCloseTo(0.75, 6);

    // an active lesson that starts losing drops back to candidate
    for (const t of ["t3", "t4"]) {
      await memory.markUsed([good.id], { runId: "r1", taskId: t });
      await memory.recordOutcome({ runId: "r1", taskId: t, success: false });
    }
    g = await get(good.id);
    expect(g.score).toBeCloseTo(0.5, 6);
    expect(g.status).toBe("candidate");

    for (let i = 1; i <= 5; i++) {
      await memory.markUsed([bad.id], { runId: "r2", taskId: `b${i}` });
      await memory.recordOutcome({ runId: "r2", taskId: `b${i}`, success: false });
      const b = await get(bad.id);
      expect(b.status).toBe(i < 5 ? "candidate" : "retired");
    }
    const b = await get(bad.id);
    expect([b.uses, b.losses]).toEqual([5, 5]);
    expect(b.score).toBeCloseTo(1 / 7, 6);
    const after = await memory.retrieve({ text: "bad lesson failing", role: "engineer", projectId: "p1" });
    expect(after.map((l) => l.id)).toEqual([good.id]);
  });

  test("nextStatus thresholds", () => {
    expect(nextStatus("candidate", 1, 0.67)).toBe("candidate");
    expect(nextStatus("candidate", 2, 0.6)).toBe("active");
    expect(nextStatus("candidate", 4, 0.17)).toBe("candidate");
    expect(nextStatus("active", 5, 0.29)).toBe("retired");
    expect(nextStatus("retired", 10, 0.9)).toBe("retired");
  });
});

describe("memory reflection", () => {
  const input = {
    runId: "r1",
    taskId: "t1",
    projectId: "p1",
    role: "engineer" as const,
    taskTitle: "Fix the login bug",
    outcome: "failed review twice",
    notes: ["Reviewer: tests were never run", "token=supersecretvalue123 leaked in a log"],
  };

  test("is skipped when no provider is configured", async () => {
    const llm = fakeLlm({ configured: false });
    const { memory, usage } = await setup({ llm });
    expect(await memory.reflect(input)).toBeNull();
    expect(llm.resolves).toHaveLength(0);
    expect(llm.requests).toHaveLength(0);
    expect(usage.calls).toHaveLength(0);
  });

  test("asks the fast tier for one JSON lesson with a 150 token cap and records usage", async () => {
    const llm = fakeLlm({ configured: true, reply: '```json\n{"lesson": "Run the test suite before submitting work for review.", "tags": ["testing"]}\n```' });
    const { memory, usage } = await setup({ llm });
    const lesson = await memory.reflect(input);
    expect(lesson).not.toBeNull();
    expect(lesson!.text).toBe("Run the test suite before submitting work for review.");
    expect(lesson!.scope).toBe("project");
    expect(lesson!.projectId).toBe("p1");
    expect(lesson!.role).toBe("engineer");
    expect(lesson!.tags).toEqual(["testing"]);
    expect(llm.resolves).toEqual([{ tier: "fast" }]);
    const req = llm.requests[0]!;
    expect(req.maxOutputTokens).toBe(150);
    expect(req.temperature).toBe(0);
    expect(req.responseFormat).toBe("json");
    expect(req.model).toBe("gpt-4o-mini");
    expect(JSON.stringify(req)).not.toContain("supersecretvalue123");
    expect(usage.calls).toHaveLength(1);
    expect(usage.calls[0]).toMatchObject({ purpose: "reflect", runId: "r1", taskId: "t1", providerId: "prov-openai", ok: true });
  });

  test("returns null on a null lesson or a failing call", async () => {
    const quiet = await setup({ llm: fakeLlm({ configured: true, reply: '{"lesson": null}' }) });
    expect(await quiet.memory.reflect(input)).toBeNull();
    const broken = await setup({ llm: fakeLlm({ configured: true, fail: true }) });
    expect(await broken.memory.reflect(input)).toBeNull();
    expect(broken.usage.calls[0]).toMatchObject({ ok: false, error: "upstream 500" });
    expect(parseReflection("not json")).toBeNull();
    expect(parseReflection('{"lesson": "short"}')).toBeNull();
  });
});

describe("memory skills and digests", () => {
  test("skills upsert by name and are found by BM25 over name and description", async () => {
    const { memory } = await setup();
    const a = await memory.saveSkill({
      name: "deploy_preview",
      description: "Build the web app and deploy a preview.",
      role: "engineer",
      steps: [{ tool: "shell_run", args: { command: "bun run build", apiKey: "abc123456789" } }],
    });
    expect(a.steps[0]!.args.apiKey).toBe("[REDACTED]");
    const again = await memory.saveSkill({ name: "deploy_preview", description: "Build and deploy a preview site.", role: "engineer", steps: [{ tool: "shell_run", args: {} }] });
    expect(again.id).toBe(a.id);
    expect(again.description).toBe("Build and deploy a preview site.");
    await memory.saveSkill({ name: "screenshot_window", description: "Capture the front window.", role: "operator", steps: [{ tool: "screen_capture", args: {} }] });
    await memory.saveSkill({ name: "open_docs", description: "Open the project docs in the browser.", role: null, steps: [{ tool: "browser_open", args: {} }] });

    expect((await memory.findSkills({ text: "deploy preview" })).map((s) => s.name)).toEqual(["deploy_preview"]);
    expect((await memory.findSkills({ text: "capture window", role: "engineer" })).map((s) => s.name)).toEqual([]);
    expect((await memory.findSkills({ text: "open docs", role: "engineer" })).map((s) => s.name)).toEqual(["open_docs"]);
    await expect(memory.saveSkill({ name: "x", description: "y", role: null, steps: [] })).rejects.toThrow("at least one step");
  });

  test("run digests: null when none, newest first, capped near 300 tokens, one per run", async () => {
    const { memory, clock, db } = await setup();
    expect(await memory.runDigest("p1")).toBeNull();
    await memory.saveRunDigest({ projectId: "p1", runId: "r1", text: "Built the cart page. Tests pass." });
    clock.advance(1000);
    await memory.saveRunDigest({ projectId: "p1", runId: "r2", text: "Added login with password_hash storage." });
    clock.advance(1000);
    await memory.saveRunDigest({ projectId: "p2", runId: "r3", text: "Other project." });
    const d = (await memory.runDigest("p1"))!;
    expect(d.indexOf("Added login")).toBeLessThan(d.indexOf("Built the cart"));
    expect(d).not.toContain("Other project");

    await memory.saveRunDigest({ projectId: "p1", runId: "r2", text: "Replaced digest for run two." });
    const rows = await db.query`select * from summaries where kind = 'run_digest' and run_id = 'r2'`;
    expect(rows).toHaveLength(1);

    for (let i = 0; i < 5; i++) {
      clock.advance(1000);
      await memory.saveRunDigest({ projectId: "p1", runId: `big${i}`, text: `Run ${i}: ${"long report ".repeat(80)}` });
    }
    const capped = (await memory.runDigest("p1"))!;
    expect(Math.ceil(capped.length / 4)).toBeLessThanOrEqual(300);
    expect(capped).toContain("Run 4:");
  });
});

describe("memory promotion", () => {
  async function twoProjectWinners(scope: "global" | "project" | "discard") {
    const s = await setup({ scope });
    const a = await s.memory.record({ role: "engineer", projectId: "p1", runId: "r1", text: "Always pin the bun version in CI before running tests." });
    const b = await s.memory.record({ role: "engineer", projectId: "p2", runId: "r2", text: "always pin the bun version in CI before running tests" });
    expect(b.id).not.toBe(a.id);
    await s.memory.markUsed([a.id], { runId: "r1", taskId: "t1" });
    await s.memory.recordOutcome({ runId: "r1", taskId: "t1", success: true });
    await s.memory.markUsed([b.id], { runId: "r2", taskId: "t2" });
    await s.memory.recordOutcome({ runId: "r2", taskId: "t2", success: true });
    return { ...s, a, b };
  }

  test("lessons with wins in 2 projects are promoted to global and near duplicates merged", async () => {
    const s = await twoProjectWinners("global");
    // storing a digest never runs a promotion pass (the runs engine calls promoteEligible after outcomes)
    await s.memory.saveRunDigest({ projectId: "p2", runId: "r2", text: "Run two done." });
    expect(s.decisions.calls).toHaveLength(0);
    const res = await s.memory.promoteEligible();
    expect(res).toEqual([{ lessonId: s.a.id, scope: "global", projects: 2, merged: 1 }]);
    expect(s.decisions.calls).toHaveLength(1);
    expect(s.decisions.calls[0]!).toMatchObject({ lesson: s.a.text, projects: 2 });
    const all = await s.memory.listLessons({});
    expect(all).toHaveLength(1);
    const g = all[0]!;
    expect(g.id).toBe(s.a.id);
    expect(g.scope).toBe("global");
    expect(g.projectId).toBeNull();
    expect([g.uses, g.wins]).toEqual([2, 2]);
    expect(g.status).toBe("active");
    const uses = await s.db.query`select lesson_id from lesson_uses`;
    expect(uses.map((u) => u.lesson_id)).toEqual([s.a.id, s.a.id]);
    // global lessons now reach other projects
    const hits = await s.memory.retrieve({ text: "pin bun version", role: "engineer", projectId: "p3" });
    expect(hits.map((h) => h.id)).toEqual([s.a.id]);
    // nothing left to promote
    expect(await s.memory.promoteEligible()).toEqual([]);
    expect(s.decisions.calls).toHaveLength(1);
  });

  test("role lessons count wins per project through run digests", async () => {
    const s = await setup({ scope: "global" });
    const l = await s.memory.record({ role: "qa", projectId: null, runId: "r1", text: "Seed the fake clock in every test file." });
    for (const [run, task] of [["r1", "t1"], ["r2", "t2"]] as const) {
      await s.memory.markUsed([l.id], { runId: run, taskId: task });
      await s.memory.recordOutcome({ runId: run, taskId: task, success: true });
    }
    await s.memory.saveRunDigest({ projectId: "p1", runId: "r1", text: "Run one." });
    expect(await s.memory.promoteEligible()).toEqual([]);
    expect(s.decisions.calls).toHaveLength(0);
    await s.memory.saveRunDigest({ projectId: "p2", runId: "r2", text: "Run two." });
    expect(s.decisions.calls).toHaveLength(0);
    await s.memory.promoteEligible();
    expect(s.decisions.calls).toHaveLength(1);
    expect(s.decisions.calls[0]!.projects).toBe(2);
    expect((await s.memory.listLessons({}))[0]!.scope).toBe("global");
  });

  test("discard retires the cluster, project keeps it and is not asked again", async () => {
    const d = await twoProjectWinners("discard");
    const res = await d.memory.promoteEligible();
    expect(res).toEqual([{ lessonId: d.a.id, scope: "discard", projects: 2, merged: 0 }]);
    expect((await d.memory.listLessons({})).every((l: LessonDTO) => l.status === "retired")).toBe(true);

    const p = await twoProjectWinners("project");
    await p.memory.promoteEligible();
    await p.memory.promoteEligible();
    expect(p.decisions.calls).toHaveLength(1);
    const kept = await p.memory.listLessons({});
    expect(kept).toHaveLength(2);
    expect(kept.every((l) => l.scope === "project")).toBe(true);
  });

  test("merging a copy used on the same task as the rep counts that task once", async () => {
    const s = await setup({ scope: "global" });
    const proj = await s.memory.record({ role: "engineer", projectId: "p1", runId: "r1", text: "Always pin the bun version in CI before running tests." });
    const role = await s.memory.record({ role: "engineer", projectId: null, runId: "r1", text: "always pin the bun version in CI before running tests" });
    expect(role.id).not.toBe(proj.id);
    // both copies retrieved for the same task t1, only the role copy for t2 in another project
    await s.memory.markUsed([proj.id, role.id], { runId: "r1", taskId: "t1" });
    await s.memory.recordOutcome({ runId: "r1", taskId: "t1", success: true });
    await s.memory.markUsed([role.id], { runId: "r2", taskId: "t2" });
    await s.memory.recordOutcome({ runId: "r2", taskId: "t2", success: true });
    await s.memory.saveRunDigest({ projectId: "p1", runId: "r1", text: "Run one." });
    await s.memory.saveRunDigest({ projectId: "p2", runId: "r2", text: "Run two." });

    const res = await s.memory.promoteEligible();
    // rep is the role copy (score 3/4 beats 2/3); the project copy folds into it
    expect(res).toEqual([{ lessonId: role.id, scope: "global", projects: 2, merged: 1 }]);
    const all = await s.memory.listLessons({});
    expect(all).toHaveLength(1);
    const g = all[0]!;
    expect([g.id, g.scope, g.uses, g.wins, g.losses]).toEqual([role.id, "global", 2, 2, 0]);
    expect(g.score).toBeCloseTo(0.75, 6);
    const uses = await s.db.query`select lesson_id, task_id, outcome from lesson_uses order by task_id`;
    expect(uses).toEqual([
      { lesson_id: role.id, task_id: "t1", outcome: "win" },
      { lesson_id: role.id, task_id: "t2", outcome: "win" },
    ]);
  });

  test("the per-pass cap counts JEV attempts, so failing calls stay bounded", async () => {
    const s = await setup({ scope: "throw" });
    const texts = [
      "Seed the fake clock in every test file.",
      "Read a file before editing it with fs_edit.",
      "Postgres returns bigint columns as strings.",
      "Keep migrations additive and numbered per dialect.",
      "Redact tool output before it reaches a prompt.",
      "Prefer keyset cursors over offset pagination.",
      "Run the typecheck script scoped to owned paths.",
      "Close lesson uses once per task, never twice.",
    ];
    const ids: string[] = [];
    for (const text of texts) ids.push((await s.memory.record({ role: "engineer", projectId: null, runId: "r1", text })).id);
    expect(new Set(ids).size).toBe(8);
    for (const [run, task, project] of [["r1", "t1", "p1"], ["r2", "t2", "p2"]] as const) {
      await s.memory.markUsed(ids, { runId: run, taskId: task });
      await s.memory.recordOutcome({ runId: run, taskId: task, success: true });
      await s.memory.saveRunDigest({ projectId: project, runId: run, text: `Run in ${project}.` });
    }

    expect(await s.memory.promoteEligible()).toEqual([]);
    expect(s.decisions.calls).toHaveLength(5);
    // failed groups back off; the next pass asks the remaining three
    expect(await s.memory.promoteEligible()).toEqual([]);
    expect(s.decisions.calls).toHaveLength(8);
    expect(await s.memory.promoteEligible()).toEqual([]);
    expect(s.decisions.calls).toHaveLength(8);
    expect((await s.memory.listLessons({})).every((l) => l.scope === "role")).toBe(true);
  });

  test("one pass at a time: a concurrent pass finds the lock and asks nothing", async () => {
    const s = await twoProjectWinners("global");
    const [first, second] = await Promise.all([s.memory.promoteEligible(), s.memory.promoteEligible()]);
    expect([first, second].filter((r) => r.length === 1)).toHaveLength(1);
    expect([first, second].filter((r) => r.length === 0)).toHaveLength(1);
    expect(s.decisions.calls).toHaveLength(1);
    expect(await s.ctx.kv.get("mem:promote:lock")).toBeNull();
    expect((await s.memory.listLessons({})).map((l) => l.scope)).toEqual(["global"]);
  });

  test("a failure while applying a global answer rolls back the merges and is retried", async () => {
    const fault = { armed: true };
    const s = await setup({ scope: "global", wrapDb: (db) => faultyDb(db, "set scope = 'global'", fault) });
    const a = await s.memory.record({ role: "engineer", projectId: "p1", runId: "r1", text: "Always pin the bun version in CI before running tests." });
    const b = await s.memory.record({ role: "engineer", projectId: "p2", runId: "r2", text: "always pin the bun version in CI before running tests" });
    await s.memory.markUsed([a.id], { runId: "r1", taskId: "t1" });
    await s.memory.recordOutcome({ runId: "r1", taskId: "t1", success: true });
    await s.memory.markUsed([b.id], { runId: "r2", taskId: "t2" });
    await s.memory.recordOutcome({ runId: "r2", taskId: "t2", success: true });

    expect(await s.memory.promoteEligible()).toEqual([]);
    expect(s.decisions.calls).toHaveLength(1);
    const after = await s.memory.listLessons({});
    expect(after.map((l) => [l.id, l.scope, l.uses]).sort()).toEqual([
      [a.id, "project", 1],
      [b.id, "project", 1],
    ].sort());
    expect(await s.db.query`select lesson_id from lesson_uses order by task_id`).toEqual([{ lesson_id: a.id }, { lesson_id: b.id }]);
    expect(s.events.ofType("lesson.recorded")).toHaveLength(2);

    fault.armed = false;
    expect(await s.memory.promoteEligible()).toEqual([{ lessonId: a.id, scope: "global", projects: 2, merged: 1 }]);
    expect(s.decisions.calls).toHaveLength(2);
  });

  test("copies that never won are folded or retired with their winning cluster", async () => {
    const s = await twoProjectWinners("discard");
    const idle = await s.memory.record({ role: "engineer", projectId: "p3", runId: "r3", text: "Always pin the bun version in CI before running tests!" });
    expect(await s.memory.promoteEligible()).toEqual([{ lessonId: s.a.id, scope: "discard", projects: 2, merged: 0 }]);
    const all = await s.memory.listLessons({});
    expect(all.find((l) => l.id === idle.id)!.status).toBe("retired");

    const g = await twoProjectWinners("global");
    const idle2 = await g.memory.record({ role: "engineer", projectId: "p3", runId: "r3", text: "Always pin the bun version in CI before running tests!" });
    expect(await g.memory.promoteEligible()).toEqual([{ lessonId: g.a.id, scope: "global", projects: 2, merged: 2 }]);
    const left = await g.memory.listLessons({});
    expect(left.map((l) => l.id)).toEqual([g.a.id]);
    expect(left.some((l) => l.id === idle2.id)).toBe(false);
  });

  test("a single project never qualifies", async () => {
    const s = await setup();
    const l = await s.memory.record({ ...engineer, text: "Only p1 knows this trick." });
    await s.memory.markUsed([l.id], { runId: "r1", taskId: "t1" });
    await s.memory.recordOutcome({ runId: "r1", taskId: "t1", success: true });
    expect(await s.memory.promoteEligible()).toEqual([]);
    expect(s.decisions.calls).toHaveLength(0);
  });
});

describe("memory write paths", () => {
  const X = "Always pin the bun version in CI before running tests.";

  async function winners(s: Awaited<ReturnType<typeof setup>>) {
    const a = await s.memory.record({ role: "engineer", projectId: "p1", runId: "r1", text: X });
    const b = await s.memory.record({ role: "engineer", projectId: "p2", runId: "r2", text: X.toLowerCase() });
    for (const [l, run, task] of [[a, "r1", "t1"], [b, "r2", "t2"]] as const) {
      await s.memory.markUsed([l.id], { runId: run, taskId: task });
      await s.memory.recordOutcome({ runId: run, taskId: task, success: true });
    }
    return { a, b };
  }

  // ---------------------------------------------------------- outcome recording
  test("an outcome closes only that run's uses", async () => {
    const { memory, db } = await setup();
    const l = await memory.record({ ...engineer, text: "Check the migration folder before adding a column." });
    await memory.markUsed([l.id], { runId: "r1", taskId: "t1" });
    await memory.recordOutcome({ runId: "r2", taskId: "t1", success: true });
    expect(await db.query`select outcome from lesson_uses`).toEqual([{ outcome: null }]);
    expect((await memory.listLessons({}))[0]!.uses).toBe(0);
    await memory.recordOutcome({ runId: "r1", taskId: "t1", success: false });
    const [row] = await memory.listLessons({});
    expect([row!.uses, row!.wins, row!.losses]).toEqual([1, 0, 1]);
    expect(row!.score).toBeCloseTo(1 / 3, 6);
  });

  test("a failure mid-outcome rolls back every close, so a retry counts each lesson once", async () => {
    const fault = { armed: true, nth: 2, seen: 0 };
    const s = await setup({ wrapDb: (db) => nthFaultDb(db, "set uses = uses + 1", fault) });
    const a = await s.memory.record({ ...engineer, text: "Read the file before editing it with fs_edit." });
    const b = await s.memory.record({ ...engineer, text: "Seed the fake clock in every test file." });
    await s.memory.markUsed([a.id, b.id], { runId: "r1", taskId: "t1" });
    await expect(s.memory.recordOutcome({ runId: "r1", taskId: "t1", success: true })).rejects.toThrow("injected db failure");
    expect(await s.db.query`select outcome from lesson_uses order by lesson_id`).toEqual([{ outcome: null }, { outcome: null }]);
    expect((await s.memory.listLessons({})).map((l) => l.uses)).toEqual([0, 0]);
    fault.armed = false;
    await s.memory.recordOutcome({ runId: "r1", taskId: "t1", success: true });
    await s.memory.recordOutcome({ runId: "r1", taskId: "t1", success: true });
    expect((await s.memory.listLessons({})).map((l) => [l.uses, l.wins])).toEqual([[1, 1], [1, 1]]);
  });

  test("outcomes on a retired lesson are counted but never revive it", async () => {
    const { memory } = await setup();
    const l = await memory.record({ ...engineer, text: "Retry flaky network calls three times." });
    await memory.patchLesson(l.id, { status: "retired" });
    for (const t of ["t1", "t2", "t3"]) {
      await memory.markUsed([l.id], { runId: "r1", taskId: t });
      await memory.recordOutcome({ runId: "r1", taskId: t, success: true });
    }
    const [row] = await memory.listLessons({});
    expect([row!.uses, row!.wins, row!.status]).toEqual([3, 3, "retired"]);
  });

  test("an open use of a merged copy closes on the representative", async () => {
    const s = await setup({ scope: "global" });
    const { a, b } = await winners(s);
    await s.memory.markUsed([b.id], { runId: "r3", taskId: "t3" });
    await s.memory.saveRunDigest({ projectId: "p1", runId: "r1", text: "Run one." });
    expect(await s.memory.promoteEligible()).toEqual([{ lessonId: a.id, scope: "global", projects: 2, merged: 1 }]);
    await s.memory.recordOutcome({ runId: "r3", taskId: "t3", success: false });
    const all = await s.memory.listLessons({});
    expect(all.map((l) => [l.id, l.uses, l.wins, l.losses])).toEqual([[a.id, 3, 2, 1]]);
    expect(all[0]!.score).toBeCloseTo(3 / 5, 6);
  });

  // ---------------------------------------------------------------- dedupe merge
  test("text without words is never a near duplicate of other wordless text", async () => {
    const { memory } = await setup();
    const a = await memory.record({ ...engineer, text: "!!! ??? !!!" });
    const b = await memory.record({ ...engineer, text: "--- ... ---" });
    expect(b.id).not.toBe(a.id);
    expect(await memory.listLessons({})).toHaveLength(2);
  });

  test("a duplicate merges into a live copy before a retired one", async () => {
    const { memory } = await setup();
    const retired = await memory.record({ ...engineer, text: X, scope: "role" });
    await memory.patchLesson(retired.id, { status: "retired" });
    const live = await memory.record({ ...engineer, text: X, scope: "global" });
    expect(live.id).not.toBe(retired.id);
    const again = await memory.record({ ...engineer, text: X, tags: ["ci"] });
    expect(again.id).toBe(live.id);
    expect(again.tags).toEqual(["ci"]);
    expect((await memory.listLessons({})).find((l) => l.id === retired.id)!.tags).toEqual([]);
  });

  test("a merge keeps the existing lesson's scope, stats and text, and caps tags at 8", async () => {
    const { memory } = await setup();
    const first = await memory.record({ ...engineer, text: X, tags: ["a", "b", "c", "d", "e", "f", "g"] });
    await memory.markUsed([first.id], { runId: "r1", taskId: "t1" });
    await memory.recordOutcome({ runId: "r1", taskId: "t1", success: true });
    const merged = await memory.record({ ...engineer, projectId: "p1", text: X.toUpperCase(), tags: ["x", "y", "a"] });
    expect(merged.id).toBe(first.id);
    expect(merged).toMatchObject({ scope: "project", projectId: "p1", text: X, uses: 1, wins: 1 });
    expect(merged.tags).toEqual(["a", "b", "c", "d", "e", "f", "g", "x"]);
  });

  // ------------------------------------------------------ promotion failure handling
  test("an UNVERIFIED BY JEV answer changes nothing and is asked again after the retry window", async () => {
    const s = await setup({ scope: "global", verdict: { verified: false, stamp: "UNVERIFIED BY JEV" } });
    const { a, b } = await winners(s);
    expect(await s.memory.promoteEligible()).toEqual([]);
    expect(s.decisions.calls).toHaveLength(1);
    const all = await s.memory.listLessons({});
    expect(all.map((l) => [l.id, l.scope]).sort()).toEqual([[a.id, "project"], [b.id, "project"]].sort());
    expect(await s.ctx.kv.get(`mem:promote:${a.id}:2`)).toBe("error");
    // backs off like a failed call, then asks again
    expect(await s.memory.promoteEligible()).toEqual([]);
    expect(s.decisions.calls).toHaveLength(1);
    await s.ctx.kv.del(`mem:promote:${a.id}:2`);
    await s.memory.promoteEligible();
    expect(s.decisions.calls).toHaveLength(2);
  });

  test("a precheck answer (unverified but not stamped) is applied", async () => {
    const s = await setup({ scope: "discard", verdict: { verified: false, stamp: null } });
    const { a } = await winners(s);
    expect(await s.memory.promoteEligible()).toEqual([{ lessonId: a.id, scope: "discard", projects: 2, merged: 0 }]);
    expect((await s.memory.listLessons({})).every((l) => l.status === "retired")).toBe(true);
  });

  test("a discard that fails part way rolls back every retirement and is retried", async () => {
    const fault = { armed: false, nth: 2, seen: 0 };
    const s = await setup({ scope: "discard", wrapDb: (db) => nthFaultDb(db, "update lessons set status = ", fault) });
    const { a } = await winners(s);
    fault.armed = true;
    expect(await s.memory.promoteEligible()).toEqual([]);
    expect((await s.memory.listLessons({})).map((l) => l.status)).toEqual(["candidate", "candidate"]);
    expect(await s.ctx.kv.get(`mem:promote:${a.id}:2`)).toBeNull();
    fault.armed = false;
    expect(await s.memory.promoteEligible()).toEqual([{ lessonId: a.id, scope: "discard", projects: 2, merged: 0 }]);
    expect(s.decisions.calls).toHaveLength(2);
  });

  test("memo write failures never lose an applied promotion or abort the pass", async () => {
    const s = await setup({ scope: "global", wrapKv: (kv) => memoWritesFail(kv, "mem:promote:") });
    const { a } = await winners(s);
    const c = await s.memory.record({ role: "qa", projectId: "p1", runId: "r1", text: "Seed the fake clock in every test file." });
    const d = await s.memory.record({ role: "qa", projectId: "p2", runId: "r2", text: "seed the fake clock in every test file" });
    for (const [l, run, task] of [[c, "r1", "t5"], [d, "r2", "t6"]] as const) {
      await s.memory.markUsed([l.id], { runId: run, taskId: task });
      await s.memory.recordOutcome({ runId: run, taskId: task, success: true });
    }
    const res = await s.memory.promoteEligible();
    expect(res.map((r) => [r.lessonId, r.scope]).sort()).toEqual([[a.id, "global"], [c.id, "global"]].sort());
    expect((await s.memory.listLessons({})).map((l) => l.scope)).toEqual(["global", "global"]);
    expect(await s.ctx.kv.get("mem:promote:lock")).toBeNull();

    // a failed JEV call whose backoff memo cannot be written still ends the pass cleanly
    const t = await setup({ scope: "throw", wrapKv: (kv) => memoWritesFail(kv, "mem:promote:") });
    await winners(t);
    expect(await t.memory.promoteEligible()).toEqual([]);
    expect(t.decisions.calls).toHaveLength(1);
    expect(await t.ctx.kv.get("mem:promote:lock")).toBeNull();
  });

  test("a pass that fails before asking releases the lock", async () => {
    const fault = { armed: false };
    const s = await setup({ scope: "global", wrapDb: (db) => faultyDb(db, "scope <> 'global' and status", fault) });
    const { a } = await winners(s);
    fault.armed = true;
    await expect(s.memory.promoteEligible()).rejects.toThrow("injected db failure");
    expect(await s.ctx.kv.get("mem:promote:lock")).toBeNull();
    fault.armed = false;
    expect(await s.memory.promoteEligible()).toEqual([{ lessonId: a.id, scope: "global", projects: 2, merged: 1 }]);
  });
});

describe("memory routes", () => {
  test("every field of the shared LessonListQuery is accepted by GET /api/memory/lessons", async () => {
    const { app, memory } = await setup();
    const a = await memory.record({ ...engineer, text: "Lesson alpha for the query contract test." });
    const q: Required<RouteQuery<"GET /api/memory/lessons">> = {
      status: "candidate",
      scope: "project",
      projectId: "p1",
      role: "engineer",
      before: `${a.createdAt + 1},${a.id}`,
      limit: 5,
    };
    const typed: LessonListQuery = q;
    const qs = new URLSearchParams(Object.entries(typed).map(([k, v]) => [k, String(v)]));
    const res = await app.request(`/api/memory/lessons?${qs}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as LessonDTO[]).map((l) => l.id)).toEqual([a.id]);
  });

  test("list, filter, patch and delete lessons", async () => {
    const { app, memory, db } = await setup();
    const a = await memory.record({ ...engineer, text: "Lesson alpha for the routes test." });
    const b = await memory.record({ role: "qa", projectId: null, runId: null, text: "Lesson beta for the routes test." });
    await memory.markUsed([a.id], { runId: "r1", taskId: "t1" });

    const list = await app.request("/api/memory/lessons");
    expect(list.status).toBe(200);
    expect(((await list.json()) as LessonDTO[]).map((l) => l.id)).toEqual([b.id, a.id]);
    const filtered = (await (await app.request("/api/memory/lessons?scope=role&role=qa&limit=10")).json()) as LessonDTO[];
    expect(filtered.map((l) => l.id)).toEqual([b.id]);
    expect((await app.request("/api/memory/lessons?status=bogus")).status).toBe(422);
    expect((await app.request("/api/memory/lessons?limit=0")).status).toBe(422);
    for (const bad of ["abc", "12", "12,", ",id", "1,bad id!", "99999999999999999,x", "9999999999999999,x"]) {
      const r = await app.request(`/api/memory/lessons?before=${encodeURIComponent(bad)}`);
      expect(r.status).toBe(422);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("invalid_query");
    }

    const patch = (body: unknown, id = a.id) =>
      app.request(`/api/memory/lessons/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await patch({ status: "active", text: "Lesson alpha, edited." });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: a.id, status: "active", text: "Lesson alpha, edited." });
    expect((await patch({})).status).toBe(422);
    expect((await patch({ status: "gone" })).status).toBe(422);
    expect((await patch({ text: "x", extra: 1 })).status).toBe(422);
    const missing = await patch({ status: "retired" }, "does-not-exist");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: "not_found", message: "lesson not found" } });
    const badJson = await app.request(`/api/memory/lessons/${a.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{" });
    expect(badJson.status).toBe(400);
    expect((await app.request("/api/memory/lessons/bad%20id!", { method: "DELETE" })).status).toBe(422);

    const del = await app.request(`/api/memory/lessons/${a.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    expect((await app.request(`/api/memory/lessons/${a.id}`, { method: "DELETE" })).status).toBe(404);
    const uses = await db.query`select count(*) as c from lesson_uses`;
    expect(num(uses[0]!.c)).toBe(0);
  });

  test("lesson lists page with a (createdAt, id) keyset cursor, ties broken by id", async () => {
    const { app, memory, clock } = await setup();
    const made: LessonDTO[] = [];
    for (let i = 0; i < 5; i++) {
      made.push(await memory.record({ ...engineer, text: `Distinct lesson ${["alpha", "bravo", "charlie", "delta", "echo"][i]} about paging.` }));
      if (i === 2) clock.advance(1000); // two rows share one createdAt, three share another
    }
    const newest = [...made].sort((x, y) => y.createdAt - x.createdAt || (x.id < y.id ? 1 : -1)).map((l) => l.id);
    const seen: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 5; page++) {
      const url: string = `/api/memory/lessons?limit=2${before ? `&before=${encodeURIComponent(before)}` : ""}`;
      const rows = (await (await app.request(url)).json()) as LessonDTO[];
      seen.push(...rows.map((l) => l.id));
      if (rows.length < 2) break;
      const last = rows[rows.length - 1]!;
      before = `${last.createdAt},${last.id}`;
    }
    expect(seen).toEqual(newest);
    // the cursor combines with filters
    const q = await memory.record({ role: "qa", projectId: null, runId: null, text: "QA only lesson for the cursor filter." });
    const filtered = (await (await app.request(`/api/memory/lessons?role=qa&before=${clock.now() + 1},x`)).json()) as LessonDTO[];
    expect(filtered.map((l) => l.id)).toEqual([q.id]);
    expect(await memory.listLessons({ before: { createdAt: 0, id: "" } })).toEqual([]);
  });

  test("text that is empty after normalizing is a 422 invalid_body, like a zod failure", async () => {
    const { memory } = await setup();
    const l = await memory.record({ ...engineer, text: "Lesson that will be patched." });
    const err = await memory.patchLesson(l.id, { text: " \t\n " }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 422, code: "invalid_body", message: "text: lesson text is empty" });
    const none = await memory.patchLesson(l.id, {}).catch((e: unknown) => e);
    expect(none).toMatchObject({ status: 422, code: "invalid_body" });
    const skill = await memory.saveSkill({ name: "  ", description: "d", role: null, steps: [{ tool: "t", args: {} }] }).catch((e: unknown) => e);
    expect(skill).toMatchObject({ status: 422, code: "invalid_body", message: "name: skill name is empty" });
  });

  test("list and delete skills", async () => {
    const { app, memory } = await setup();
    const s = await memory.saveSkill({ name: "open_docs", description: "Open docs.", role: "operator", steps: [{ tool: "browser_open", args: {} }] });
    const list = await app.request("/api/memory/skills?role=operator");
    expect(list.status).toBe(200);
    expect(((await list.json()) as Array<{ id: string }>).map((x) => x.id)).toEqual([s.id]);
    expect((await app.request("/api/memory/skills?role=cat")).status).toBe(422);
    expect((await app.request("/api/memory/skills?before=nope")).status).toBe(422);
    const t = await memory.saveSkill({ name: "open_board", description: "Open the board.", role: "operator", steps: [{ tool: "browser_open", args: {} }] });
    const page1 = (await (await app.request("/api/memory/skills?role=operator&limit=1")).json()) as Array<{ id: string; createdAt: number }>;
    expect(page1.map((x) => x.id)).toEqual([t.id]);
    const page2 = (await (await app.request(`/api/memory/skills?role=operator&limit=1&before=${page1[0]!.createdAt},${page1[0]!.id}`)).json()) as Array<{
      id: string;
    }>;
    expect(page2.map((x) => x.id)).toEqual([s.id]);
    expect((await app.request(`/api/memory/skills/${s.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await app.request(`/api/memory/skills/${s.id}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("brain: role outcomes and versioned strategies", () => {
  const rules = (list: string[]) => JSON.stringify({ rules: list });
  async function brainSetup(reply = rules(["Run the tests after the last edit and name the exit code.", "Add alt text before asking for review."])) {
    const llm = fakeLlm({ configured: true, reply });
    const s = await setup({ llm });
    const context = createContextModule(s.ctx).service;
    return { ...s, context };
  }
  const outcome = (kind: "done" | "review_fail" | "blocked", cause = "") => ({
    role: "engineer",
    runId: "r1",
    taskId: "t1",
    agentId: "a1",
    outcome: kind === "done" ? ("win" as const) : ("loss" as const),
    kind,
    cause,
  });
  const role = { kind: "role" as const, key: "engineer", role: "engineer" as const };

  test("tuning is due after three outcomes under a 0.5 success rate, then waits for three fresh ones", async () => {
    const { memory, context } = await brainSetup();
    expect((await memory.recordRoleOutcome(outcome("review_fail", "no tests"))).tuneDue).toBe(false);
    expect((await memory.recordRoleOutcome(outcome("done"))).tuneDue).toBe(false);
    const third = await memory.recordRoleOutcome(outcome("blocked", "no lockfile"));
    expect(third).toMatchObject({ tuneDue: true, samples: 3 });
    expect(third.rate).toBeCloseTo(1 / 3, 5);
    const p = await memory.proposeStrategy({ subject: role, runId: "r1", context });
    await memory.applyStrategy({ proposal: p!, choice: "keep", decision: null });
    expect((await memory.recordRoleOutcome(outcome("review_fail"))).tuneDue).toBe(false);
    expect((await memory.recordRoleOutcome(outcome("review_fail"))).tuneDue).toBe(false);
    expect((await memory.recordRoleOutcome(outcome("review_fail"))).tuneDue).toBe(true);
    // wins keep the rate up: a dynamic role key has its own window
    for (let i = 0; i < 5; i++) await memory.recordRoleOutcome({ ...outcome("done"), role: "launch-tester" });
    expect((await memory.recordRoleOutcome({ ...outcome("blocked"), role: "launch-tester" })).tuneDue).toBe(false);
  });

  test("propose: one fast-tier call capped at 120 tokens, scored offline against legacy; the lock holds one pass per subject", async () => {
    const { memory, context, llm, usage } = await brainSetup();
    const secret = "sk-" + "d".repeat(40);
    await memory.recordRoleOutcome(outcome("review_fail", `The hero image has no alt text. key ${secret}`));
    await memory.recordRoleOutcome(outcome("blocked", "Never ran the tests after the last edit"));
    const p = await memory.proposeStrategy({ subject: role, runId: "r1", context });
    expect(p).not.toBeNull();
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]!.maxOutputTokens).toBe(120);
    expect(llm.resolves[0]).toEqual({ tier: "fast", role: "engineer" });
    const prompt = llm.requests[0]!.messages[0]!.content as string;
    expect(prompt).toContain("Role: engineer (Engineer)");
    expect(prompt).not.toContain(secret);
    expect(p!.candidate).toBe("- Run the tests after the last edit and name the exit code.\n- Add alt text before asking for review.");
    expect(p!).toMatchObject({ version: 1, current: null, merged: null });
    expect(p!.evidence.tokens.candidate).toBeLessThanOrEqual(120);
    expect(p!.evidence.billableInputTokens.candidate).toBeLessThan(p!.evidence.billableInputTokens.legacy);
    expect(p!.evidence.addressed.candidate).toBeGreaterThan(0);
    expect(p!.causes.some((c) => c.includes(secret))).toBe(false);
    expect(usage.calls.map((c) => c.purpose)).toEqual(["reflect"]);
    // the call as billed rides on the proposal, so the run's totals count it
    expect(p!.call).toEqual({ inputTokens: 120, outputTokens: 30, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 });
    // a second pass for the same subject waits for the first
    expect(await memory.proposeStrategy({ subject: role, runId: "r1", context })).toBeNull();
    await memory.applyStrategy({ proposal: p!, choice: "adopt", decision: { id: "d1", confidence: 0.8, verified: true, stamp: null } });
    expect(await memory.proposeStrategy({ subject: role, runId: "r1", context })).not.toBeNull();
  });

  test("apply: adopt makes v1 active, merge makes v2 from both texts, keep records the candidate as rejected", async () => {
    const { memory, context } = await brainSetup();
    await memory.recordRoleOutcome(outcome("review_fail", "no alt text"));
    const p1 = await memory.proposeStrategy({ subject: role, runId: "r1", context });
    const v1 = await memory.applyStrategy({ proposal: p1!, choice: "adopt", decision: { id: "d1", confidence: 0.84, verified: true, stamp: null }, reason: "adopt strategy v1" });
    expect(v1).toMatchObject({ subject: "role", subjectKey: "engineer", role: "engineer", version: 1, status: "active", choice: "adopt", reason: "adopt strategy v1" });
    expect(v1.decision).toEqual({ id: "d1", confidence: 0.84, verified: true, stamp: null });
    expect(v1.evidence!.scores.candidate).toBe(p1!.evidence.scores.candidate);
    expect((await memory.activeStrategy(role))!.id).toBe(v1.id);
    const p2 = await memory.proposeStrategy({ subject: role, runId: "r1", context });
    expect(p2!.current!.id).toBe(v1.id);
    expect(p2!.version).toBe(2);
    const v2 = await memory.applyStrategy({ proposal: p2!, choice: "merge", decision: null });
    expect(v2).toMatchObject({ version: 2, status: "active", choice: "merge" });
    const p3 = await memory.proposeStrategy({ subject: role, runId: "r1", context });
    const kept = await memory.applyStrategy({ proposal: p3!, choice: "keep", decision: { id: null, confidence: null, verified: false, stamp: "UNVERIFIED BY JEV" } });
    expect(kept).toMatchObject({ version: 3, status: "rejected", choice: "keep" });
    expect((await memory.activeStrategy(role))!.id).toBe(v2.id);
    const history = await memory.strategyHistory(role);
    expect(history.map((h) => [h.version, h.status])).toEqual([
      [3, "rejected"],
      [2, "active"],
      [1, "retired"],
    ]);
    expect((await memory.strategiesByIds([v1.id, "missing"])).map((x) => x.id)).toEqual([v1.id]);
  });

  test("an agent subject learns from its own failures; no usable candidate still counts as an attempt", async () => {
    const { memory, context, llm } = await brainSetup("not json at all");
    const cat = { kind: "agent" as const, key: "agent-7", role: "security" as const, title: "Security" };
    expect(await memory.proposeStrategy({ subject: cat, runId: "r1", context, cases: [{ outcome: "loss", kind: "agent", cause: "blocked: no lockfile to audit" }] })).toBeNull();
    expect((llm.requests[0]!.messages[0]!.content as string).startsWith("One crew member, role: Security (a Security specialist)")).toBe(true);
    const history = await memory.strategyHistory(cat);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "rejected", choice: null, reason: "no usable candidate", text: "" });
    expect(await memory.activeStrategy(cat)).toBeNull();
    // the attempt released its lock
    expect(await memory.proposeStrategy({ subject: cat, runId: "r1", context, cases: [] })).toBeNull();
    expect(llm.requests).toHaveLength(2);
  });
});
