// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Crew skills: the built-in JAL-AIDev pack (files, limits, coverage), the
// deterministic pick per cat (relevance, budgets, the hard cap, skipped),
// the service and its four routes (strict validation, conflicts, the write
// limit), and the eval bar: with the pack and ui_check in every matching
// prompt, billable input stays at least 60 percent below legacy.
import { beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRole, CrewSkillDTO } from "@mengai/shared";
import { Hono } from "hono";
import { TooManyRequestsError } from "../../core/hardening";
import type { ModuleContext } from "../../core/module";
import type { ContextInput } from "../../core/services";
import { errorBody, HttpError } from "../../lib/http";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { CREW_SKILL_MAX_CHARS, CREW_SKILLS_MAX_TOKENS, createContextModule, crewSkillTokens } from "../context";
import { createEvalsModule } from "../evals";
import { UI_CHECK_ROLES, UI_CHECK_SPEC } from "../tools";
import { BUILTIN_FILES, loadBuiltins, parseBuiltin } from "./builtin";
import { BUILTINS, BUILTIN_BUDGET_TOKENS, CREW_SKILLS_TOTAL_TOKENS, createCrewSkillsModule, focusOf, isBuilderCharter, MAX_OWNER_SKILLS } from "./index";
import { pickSkills, type OwnerSkillView, type PickInput } from "./pick";
import { WRITE_LIMIT_PER_WINDOW } from "./routes";
import { CACHE_TTL_MS, summaryFrom } from "./service";

const EM = String.fromCharCode(0x2014);
const on = () => true;
const pick = (input: PickInput, owner: OwnerSkillView[] = [], enabled: (id: string) => boolean = on) => pickSkills(input, BUILTINS, enabled, owner, crewSkillTokens);
const ids = (r: { read: Array<{ id: string }> }) => r.read.map((x) => x.id);
const b = (slug: string) => `builtin-${slug}`;

function owner(id: string, over: Partial<OwnerSkillView> = {}): OwnerSkillView {
  return { id, name: `Skill ${id}`, body: `Do the ${id} thing.`, version: 1, roles: null, kinds: null, enabled: true, createdAt: 1, ...over };
}

async function makeCtx(): Promise<ModuleContext & { clock: ReturnType<typeof fakeClock> }> {
  const clock = fakeClock();
  return {
    config: { mode: "local", version: "test", dataDir: "/tmp/x", workspacesDir: "/tmp/x", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db: await createTestDb(),
    kv: memoryKv(),
    blob: null as never,
    vault: memoryVault(),
    clock,
    logger: silentLogger,
    events: captureEvents(clock),
  };
}

// ------------------------------------------------------------------ pack
describe("built-in pack", () => {
  const FRONT = ["id: x", "name: X", "version: 1", "updated: 2026-09-30", "focus: ui", "summary: One line.", "roles: designer=3", "kinds: studio", "topics: ui"];
  const file = (front: string[] = FRONT, body = "- Do it.") => `---\n${front.join("\n")}\n---\n${body}\n`;

  test("6 to 9 focused skills: plain ASCII bodies of at most 6,000 characters, a sharp summary, roles and kinds", () => {
    expect(BUILTINS.length).toBeGreaterThanOrEqual(6);
    expect(BUILTINS.length).toBeLessThanOrEqual(9);
    expect(new Set(BUILTINS.map((s) => s.id)).size).toBe(BUILTINS.length);
    expect(new Set(BUILTINS.map((s) => s.name.toLowerCase())).size).toBe(BUILTINS.length);
    for (const s of BUILTINS) {
      expect(s.body.length).toBeLessThanOrEqual(CREW_SKILL_MAX_CHARS);
      expect(`${s.name}${s.summary}${s.body}`).toMatch(/^[\x20-\x7e\n]*$/);
      expect(s.body).not.toContain(EM);
      expect(s.summary.length).toBeGreaterThan(40);
      expect(s.summary.length).toBeLessThanOrEqual(200);
      expect(s.roles.length).toBeGreaterThan(0);
      expect(s.kinds === null || s.kinds.length > 0).toBe(true);
      expect(s.version).toBeGreaterThanOrEqual(1);
      expect(s.tokens).toBe(crewSkillTokens({ name: s.name, text: s.body }));
      // provider agnostic: no skill names a model
      expect(s.body).not.toMatch(/\b(gpt-|claude|gemini|llama|sonnet|opus)\b/i);
    }
  });

  test("every file under builtin/ is embedded, in the pack order", async () => {
    const onDisk = (await readdir(join(import.meta.dir, "builtin"))).filter((f) => f.endsWith(".md")).sort();
    expect(BUILTIN_FILES.map((f) => f.file).sort()).toEqual(onDisk);
    expect(BUILTINS.map((s) => s.order)).toEqual(BUILTINS.map((_, i) => i));
  });

  test("covers the JAL-AIDev base: design law and tidiness, taste, the design system, frontend, motion, architecture, security and QA", () => {
    const body = (slug: string) => BUILTINS.find((s) => s.id === b(slug))!.body;
    expect(BUILTINS.map((s) => s.id)).toEqual([b("design-law"), b("ui-taste"), b("design-system"), b("frontend-rules"), b("motion-immersive"), b("system-design"), b("security-qa")]);
    for (const phrase of ["nothing overlaps", "No clipped text", "No empty gaps", "No gradients", "No decorative lines", "44 px", "prefers-reduced-motion", "no em-dash", "ui_check", "never purple"]) {
      expect(body("design-law")).toContain(phrase);
    }
    expect(body("ui-taste")).toContain("One type scale");
    expect(body("ui-taste")).toContain("Records (orders, users, files) are rows");
    expect(body("design-system")).toContain("Tokens first");
    expect(body("design-system")).toContain("Eight states per component");
    expect(body("frontend-rules")).toContain("Semantic HTML");
    expect(body("motion-immersive")).toContain("Transform and opacity only");
    expect(body("motion-immersive")).toContain("Reduced motion");
    expect(body("system-design")).toContain("Ports and adapters");
    expect(body("security-qa")).toContain("rate limits per route and client");
    expect(body("security-qa")).toContain("A test you did not run did not pass");
  });

  test("flexible on the stack: the project's stack first, Bun, Hono, React and TypeScript only when nothing is set", () => {
    const sys = BUILTINS.find((s) => s.id === b("system-design"))!.body;
    expect(sys).toContain("keep the project's stack");
    expect(sys).toContain("With nothing specified, recommend Bun, Hono, React and TypeScript");
    expect(BUILTINS.find((s) => s.id === b("frontend-rules"))!.body).toContain("Use the project's framework");
    for (const s of BUILTINS) expect(s.body).not.toMatch(/\b(always|must) use (Bun|Hono|React)\b/i);
  });

  test("a broken file fails loudly with its name", () => {
    expect(parseBuiltin("ok.md", file()).id).toBe("builtin-x");
    const bad: Array<[string, string, RegExp]> = [
      ["no front matter", "- body only", /front matter missing/],
      ["unknown key", file([...FRONT, "color: red"]), /unknown key color/],
      ["missing key", file(FRONT.filter((l) => !l.startsWith("summary"))), /summary is required/],
      ["bad role", file(FRONT.map((l) => (l.startsWith("roles") ? "roles: boss=3" : l))), /unknown role/],
      ["bad weight", file(FRONT.map((l) => (l.startsWith("roles") ? "roles: designer=4" : l))), /weight must be 1 to 3/],
      ["bad kind", file(FRONT.map((l) => (l.startsWith("kinds") ? "kinds: bank" : l))), /unknown company kind/],
      ["bad focus", file(FRONT.map((l) => (l.startsWith("focus") ? "focus: art" : l))), /focus must be ui or build/],
      ["bad version", file(FRONT.map((l) => (l.startsWith("version") ? "version: 0" : l))), /version must be a positive integer/],
      ["em-dash", file(FRONT, `- Fast ${EM} simple`), /plain ASCII/],
      ["too long", file(FRONT, "x".repeat(CREW_SKILL_MAX_CHARS + 1)), /at most 6000/],
      ["empty", file(FRONT, "   "), /body is empty/],
    ];
    for (const [why, text, re] of bad) expect(() => parseBuiltin("bad.md", text), why).toThrow(re);
    expect(() => parseBuiltin("bad.md", "- x")).toThrow(/bad\.md/);
    expect(() => loadBuiltins([{ file: "a.md", text: file() }, { file: "b.md", text: file() }])).toThrow(/used twice/);
  });
});

// ------------------------------------------------------------------ pick
describe("pick", () => {
  test("focus: interface work is ui, a provider interface is not", () => {
    expect(focusOf("Refresh the landing page hero")).toBe("ui");
    expect(focusOf("Buat halaman beranda untuk kafe")).toBe("ui");
    expect(focusOf("Move payment calls behind a provider interface.")).toBe("build");
    expect(focusOf("Move user settings from JSON files to SQLite.")).toBe("build");
    expect(isBuilderCharter("You are the Launch tester cat.\n- Build the checkout page and its tests")).toBe(true);
    expect(isBuilderCharter("You are the Quant researcher cat.\n- Read the market notes")).toBe(false);
    expect(isBuilderCharter(null)).toBe(false);
  });

  test("the designer reads the UI pack, design law first, within its budget", () => {
    const r = pick({ role: "designer", kind: "studio", goal: "Refresh the landing page hero." });
    expect(ids(r).slice(0, 3)).toEqual([b("design-law"), b("ui-taste"), b("design-system")]);
    expect(ids(r)).toContain(b("motion-immersive"));
    expect(r.tokens).toBeLessThanOrEqual(BUILTIN_BUDGET_TOKENS.designer);
    expect(r.tokens).toBe(r.read.reduce((n, x) => n + x.tokens, 0));
    expect(r.layers.map((l) => l.id)).toEqual(ids(r));
    expect(r.layers[0]!.text).toBe(BUILTINS[0]!.body);
    expect(pick({ role: "designer", kind: "studio", goal: "Refresh the landing page hero." })).toEqual(r);
  });

  test("engineers read architecture and security on build goals, the design law and frontend rules on UI goals", () => {
    expect(ids(pick({ role: "engineer", kind: "studio", goal: "Move user settings from JSON files to SQLite." }))).toEqual([b("system-design"), b("security-qa")]);
    const ui = pick({ role: "engineer", kind: "studio", goal: "Build a landing page for a cafe" });
    expect(ids(ui)).toEqual([b("design-law"), b("frontend-rules")]);
    // skipped in rank order: taste and motion (the goal names a landing page) before the design system
    expect(ui.skipped.map((x) => x.id)).toEqual([b("ui-taste"), b("motion-immersive"), b("design-system")]);
    expect(ui.skipped.every((x) => x.source === "builtin" && x.tokens > 0)).toBe(true);
  });

  test("a role's own skill always comes first: QA keeps its QA habits on a UI goal", () => {
    expect(ids(pick({ role: "qa", kind: "studio", goal: "Build a landing page for a cafe" }))).toEqual([b("security-qa"), b("design-law")]);
    expect(ids(pick({ role: "lead", kind: "studio", goal: "Build a landing page for a cafe" }))).toEqual([b("system-design")]);
    expect(ids(pick({ role: "reviewer", kind: "studio", goal: "Move payment calls behind a provider interface." }))).toEqual([b("system-design"), b("security-qa")]);
  });

  test("researchers, operators and fund companies read no built-in by default", () => {
    expect(pick({ role: "researcher", kind: "studio", goal: "Add full text search to the docs site." }).read).toEqual([]);
    expect(pick({ role: "operator", kind: null, goal: "Build a landing page" }).read).toEqual([]);
    const fund = pick({ role: "engineer", kind: "fund", goal: "Build a trading dashboard page" });
    expect(fund).toEqual({ tag: "", layers: [], read: [], skipped: [], tokens: 0 });
  });

  test("a dynamic role whose charter builds things reads the builder pack on the engineer's budget", () => {
    const charter = "You are the Launch tester cat on a MengAI crew, a researcher specialist.\n- Build the landing page components and check them";
    const r = pick({ role: "researcher", kind: "studio", goal: "Launch the cafe site", charter });
    expect(ids(r)).toEqual([b("design-law"), b("frontend-rules")]);
    expect(r.tokens).toBeLessThanOrEqual(BUILTIN_BUDGET_TOKENS.engineer);
    const engineerOwn = owner("o1", { roles: ["engineer"] });
    expect(ids(pick({ role: "researcher", kind: "studio", goal: "x", charter }, [engineerOwn]))).toContain("o1");
    expect(ids(pick({ role: "researcher", kind: "studio", goal: "x" }, [engineerOwn]))).toEqual([]);
  });

  test("owner skills follow the built-ins, newest first, filtered by role, kind and the switch", () => {
    const skills = [
      owner("old", { createdAt: 1 }),
      owner("new", { createdAt: 3 }),
      owner("designers", { createdAt: 2, roles: ["designer"] }),
      owner("fund", { createdAt: 4, kinds: ["fund"] }),
      owner("off", { createdAt: 5, enabled: false }),
    ];
    const r = pick({ role: "engineer", kind: "studio", goal: "Move settings to SQLite" }, skills);
    expect(ids(r)).toEqual([b("system-design"), b("security-qa"), "new", "old"]);
    expect(r.read.slice(2).every((x) => x.source === "owner")).toBe(true);
    expect(ids(pick({ role: "designer", kind: "fund" }, skills))).toEqual(["fund", "new", "designers", "old"]);
    const off = pick({ role: "engineer", kind: "studio", goal: "Move settings to SQLite" }, [], (id) => id !== b("system-design"));
    expect(ids(off)).toEqual([b("security-qa")]);
    expect(off.skipped).toEqual([]);
  });

  test("the hard cap: built-ins by relevance first, then the owner's newest; what does not fit is listed as skipped", () => {
    const big = (id: string, createdAt: number) => owner(id, { createdAt, body: "y".repeat(5000) });
    const r = pick({ role: "designer", kind: "studio", goal: "Refresh the landing page hero." }, [big("a", 1), big("b", 2), owner("small", { createdAt: 0 })]);
    expect(r.tokens).toBeLessThanOrEqual(CREW_SKILLS_TOTAL_TOKENS);
    expect(CREW_SKILLS_TOTAL_TOKENS).toBe(CREW_SKILLS_MAX_TOKENS);
    expect(ids(r).slice(-1)).toEqual(["small"]);
    expect(r.skipped.map((x) => [x.id, x.source])).toEqual([
      ["b", "owner"],
      ["a", "owner"],
    ]);
    const lead = pick({ role: "lead", kind: "studio", goal: "plan" }, [big("a", 1), big("b", 2)]);
    expect(ids(lead)).toEqual([b("system-design"), "b"]);
    expect(lead.skipped.map((x) => x.id)).toEqual(["a"]);
  });

  test("the cache tag keys the set: stable for the same skills, new when a version or the set changes", () => {
    const input: PickInput = { role: "engineer", kind: "studio", goal: "Move settings to SQLite" };
    const a = pick(input, [owner("o", { version: 1 })]);
    expect(a.tag).toMatch(/^k[0-9a-f]{8}$/);
    expect(pick(input, [owner("o", { version: 1 })]).tag).toBe(a.tag);
    expect(pick(input, [owner("o", { version: 2 })]).tag).not.toBe(a.tag);
    expect(pick(input).tag).not.toBe(a.tag);
    expect(pick({ role: "researcher", kind: "studio", goal: "x" }).tag).toBe("");
  });
});

// --------------------------------------------------------------- service
describe("service", () => {
  let ctx: Awaited<ReturnType<typeof makeCtx>>;
  beforeEach(async () => {
    ctx = await makeCtx();
  });

  test("list: the built-in pack in order (on by default, never editable), then the owner's newest first", async () => {
    const svc = createCrewSkillsModule(ctx).service;
    const first = await svc.list();
    expect(first.map((s) => s.id)).toEqual(BUILTINS.map((s) => s.id));
    expect(first.every((s) => s.source === "builtin" && s.enabled)).toBe(true);
    const dl = first[0]!;
    expect(dl).toMatchObject({ name: "Design law and tidiness", roles: ["designer", "engineer", "reviewer", "qa"], kinds: ["studio"], version: 1, tokens: BUILTINS[0]!.tokens });
    await svc.create({ name: "Brand voice", body: "# Voice\n- Warm and short." });
    ctx.clock.advance(1000);
    await svc.create({ name: "Tabs", body: "Indent with tabs.", roles: ["engineer"] });
    const all = await svc.list();
    expect(all.slice(BUILTINS.length).map((s) => s.name)).toEqual(["Tabs", "Brand voice"]);
  });

  test("create: trimmed, summary from the body when none is given, token estimate, version 1", async () => {
    const svc = createCrewSkillsModule(ctx).service;
    const s = await svc.create({ name: "  Brand   voice ", body: "\n# Voice rules\n- Warm and short.\n", roles: ["designer", "designer"], kinds: null });
    expect(s).toMatchObject({ source: "owner", name: "Brand voice", summary: "Voice rules", body: "# Voice rules\n- Warm and short.", roles: ["designer"], kinds: null, enabled: true, version: 1 });
    expect(s.tokens).toBe(crewSkillTokens({ name: "Brand voice", text: s.body }));
    expect(summaryFrom("**Bold** first line\nsecond")).toBe("Bold first line");
    expect(summaryFrom("x".repeat(300)).length).toBe(160);
  });

  test("names are unique, case and spacing aside, and never a built-in's", async () => {
    const svc = createCrewSkillsModule(ctx).service;
    await svc.create({ name: "Brand voice", body: "x" });
    await expect(svc.create({ name: "brand  VOICE", body: "y" })).rejects.toMatchObject({ status: 409 });
    await expect(svc.create({ name: "Design law and tidiness", body: "y" })).rejects.toMatchObject({ status: 409 });
    const other = await svc.create({ name: "Other", body: "z" });
    await expect(svc.update(other.id, { name: "BRAND voice" })).rejects.toMatchObject({ status: 409 });
    expect((await svc.update(other.id, { name: "other" })).name).toBe("other");
  });

  test("update: an edit bumps the version, a switch does not; built-ins accept only enabled", async () => {
    const svc = createCrewSkillsModule(ctx).service;
    const s = await svc.create({ name: "Tabs", body: "Indent with tabs." });
    const edited = await svc.update(s.id, { body: "Indent with two spaces." });
    expect(edited.version).toBe(2);
    const off = await svc.update(s.id, { enabled: false });
    expect(off).toMatchObject({ version: 2, enabled: false });
    expect((await svc.update(s.id, { enabled: false })).updatedAt).toBe(off.updatedAt);
    await expect(svc.update(b("design-law"), { body: "mine now" })).rejects.toMatchObject({ status: 422 });
    const bi = await svc.update(b("design-law"), { enabled: false });
    expect(bi).toMatchObject({ source: "builtin", enabled: false, version: 1 });
    expect((await svc.list()).find((x) => x.id === b("design-law"))!.enabled).toBe(false);
    await expect(svc.update(b("nope"), { enabled: false })).rejects.toMatchObject({ status: 404 });
    await expect(svc.update("missing", { enabled: false })).rejects.toMatchObject({ status: 404 });
    await expect(svc.update(s.id, {})).rejects.toMatchObject({ status: 422 });
  });

  test("delete: owner skills only; a built-in is switched off instead", async () => {
    const svc = createCrewSkillsModule(ctx).service;
    const s = await svc.create({ name: "Tabs", body: "x" });
    await svc.remove(s.id);
    expect((await svc.list()).length).toBe(BUILTINS.length);
    await expect(svc.remove(s.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.remove(b("design-law"))).rejects.toMatchObject({ status: 409 });
  });

  test(`the owner keeps at most ${MAX_OWNER_SKILLS} skills`, async () => {
    const svc = createCrewSkillsModule(ctx).service;
    for (let i = 0; i < MAX_OWNER_SKILLS; i++) await svc.create({ name: `Skill ${i}`, body: "x" });
    await expect(svc.create({ name: "One more", body: "x" })).rejects.toMatchObject({ status: 409 });
  });

  test("forPrompt follows every write at once; another process sees them within the cache lifetime", async () => {
    const svc = createCrewSkillsModule(ctx).service;
    const other = createCrewSkillsModule(ctx).service;
    const input: PickInput = { role: "engineer", kind: "studio", goal: "Move settings to SQLite" };
    expect(ids(await other.forPrompt(input))).toEqual([b("system-design"), b("security-qa")]);
    const s = await svc.create({ name: "Tabs", body: "Indent with tabs.", roles: ["engineer"] });
    await svc.update(b("security-qa"), { enabled: false });
    expect(ids(await svc.forPrompt(input))).toEqual([b("system-design"), s.id]);
    expect(ids(await other.forPrompt(input))).toEqual([b("system-design"), b("security-qa")]);
    ctx.clock.advance(CACHE_TTL_MS + 1);
    expect(ids(await other.forPrompt(input))).toEqual([b("system-design"), s.id]);
  });
});

// ---------------------------------------------------------------- routes
describe("routes", () => {
  function app(ctx: ModuleContext) {
    const mod = createCrewSkillsModule(ctx);
    const a = new Hono();
    // stands in for core/hardening requestContext: the socket peer, never X-Forwarded-For
    a.use(async (c, next) => {
      c.set("clientIp", c.req.header("x-test-peer") ?? "1.1.1.1");
      await next();
    });
    a.onError((err, c) => {
      if (err instanceof TooManyRequestsError) c.header("Retry-After", String(err.retryAfterSec));
      return err instanceof HttpError ? c.json(errorBody(err.code, err.message), err.status) : c.json(errorBody("internal", "error"), 500);
    });
    a.route(`/api/${mod.mountPath}`, mod.routes!);
    return a;
  }
  const send = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
    method,
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  test("GET, POST 201, PATCH, DELETE", async () => {
    const a = app(await makeCtx());
    const list = (await (await a.request("/api/crew-skills")).json()) as CrewSkillDTO[];
    expect(list.map((s) => s.id)).toEqual(BUILTINS.map((s) => s.id));
    const created = await a.request("/api/crew-skills", send("POST", { name: "Tabs", body: "Indent with tabs.", roles: ["engineer"], kinds: ["studio"] }));
    expect(created.status).toBe(201);
    const s = (await created.json()) as CrewSkillDTO;
    expect(s).toMatchObject({ source: "owner", name: "Tabs", roles: ["engineer"], kinds: ["studio"] });
    const patched = await a.request(`/api/crew-skills/${s.id}`, send("PATCH", { roles: null, summary: "House indent" }));
    expect(await patched.json()).toMatchObject({ roles: null, summary: "House indent", version: 2 });
    expect(await (await a.request(`/api/crew-skills/${b("motion-immersive")}`, send("PATCH", { enabled: false }))).json()).toMatchObject({ enabled: false });
    expect(await (await a.request(`/api/crew-skills/${s.id}`, { method: "DELETE" })).json()).toEqual({ ok: true });
    expect((await a.request(`/api/crew-skills/${b("motion-immersive")}`, { method: "DELETE" })).status).toBe(409);
    expect((await a.request("/api/crew-skills/nope", { method: "DELETE" })).status).toBe(404);
  });

  test("strict validation: 400 for bad JSON, 422 for unknown keys, bad roles, long bodies, multi-line names and bad ids", async () => {
    const a = app(await makeCtx());
    const post = (body: unknown) => a.request("/api/crew-skills", send("POST", body));
    expect((await post("{not json")).status).toBe(400);
    const cases: Array<[string, unknown]> = [
      ["unknown key", { name: "A", body: "x", color: "red" }],
      ["no name", { body: "x" }],
      ["blank name", { name: "   ", body: "x" }],
      ["two-line name", { name: "A\nB", body: "x" }],
      ["long name", { name: "n".repeat(81), body: "x" }],
      ["blank body", { name: "A", body: "  \n " }],
      ["long body", { name: "A", body: "x".repeat(CREW_SKILL_MAX_CHARS + 1) }],
      ["bad role", { name: "A", body: "x", roles: ["boss"] }],
      ["empty roles", { name: "A", body: "x", roles: [] }],
      ["bad kind", { name: "A", body: "x", kinds: ["bank"] }],
      ["array body", []],
    ];
    for (const [why, body] of cases) {
      const res = await post(body);
      expect(res.status, why).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code, why).toBe("invalid_body");
    }
    expect((await post({ name: "Max", body: "x".repeat(CREW_SKILL_MAX_CHARS) })).status).toBe(201);
    expect((await a.request("/api/crew-skills/bad%20id!", send("PATCH", { enabled: true }))).status).toBe(422);
    expect((await a.request(`/api/crew-skills/${b("design-law")}`, send("PATCH", {}))).status).toBe(422);
    expect((await a.request(`/api/crew-skills/${b("design-law")}`, send("PATCH", { enabled: "no" }))).status).toBe(422);
  });

  test("writes are limited per client with 429 and Retry-After; the limit holds when the kv fails", async () => {
    const ctx = await makeCtx();
    const a = app(ctx);
    const statuses: number[] = [];
    for (let i = 0; i <= WRITE_LIMIT_PER_WINDOW; i++) statuses.push((await a.request("/api/crew-skills", send("POST", "nope", { "x-forwarded-for": `10.0.0.${i}` }))).status);
    expect(statuses.slice(0, WRITE_LIMIT_PER_WINDOW).every((s) => s === 400)).toBe(true);
    const last = await a.request("/api/crew-skills", send("POST", "nope"));
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).toBe("60");
    expect(((await last.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    expect((await a.request("/api/crew-skills")).status).toBe(200);
    expect((await a.request("/api/crew-skills", send("POST", "nope", { "x-test-peer": "2.2.2.2" }))).status).toBe(400);
    const broken = app({ ...ctx, kv: { ...ctx.kv, incr: async () => Promise.reject(new Error("redis down")) } });
    let code = 0;
    for (let i = 0; i <= WRITE_LIMIT_PER_WINDOW; i++) code = (await broken.request("/api/crew-skills", send("POST", "nope"))).status;
    expect(code).toBe(429);
  });
});

// ------------------------------------------------------------------ eval
describe("prompt budget", () => {
  test("with the built-in pack and ui_check in every matching prompt, billable input stays at least 60 percent below legacy", async () => {
    const ctx = await makeCtx();
    const real = createContextModule(ctx).service;
    const read: Record<string, string[]> = {};
    const withSkills = {
      ...real,
      build(input: ContextInput) {
        const p = pick({ role: input.role, kind: "studio", goal: input.brief.goal });
        read[input.role] = ids(p);
        const tools = UI_CHECK_ROLES.has(input.role as AgentRole) ? [...input.tools, UI_CHECK_SPEC] : input.tools;
        return real.build({ ...input, tools, crewSkills: p.layers } as ContextInput);
      },
    };
    const base = await createEvalsModule(ctx, { context: real }).service.replay("core");
    const r = await createEvalsModule(ctx, { context: withSkills }).service.replay("core");
    // every scripted role but the researcher really carries skills
    expect(Object.entries(read).filter(([, v]) => v.length > 0).map(([k]) => k).sort()).toEqual(["designer", "engineer", "lead", "qa", "reviewer", "security"]);
    expect(r.v2.metrics.inputTokens).toBeGreaterThan(base.v2.metrics.inputTokens);
    expect(r.v2.metrics.billableInputTokens).toBeLessThanOrEqual(r.legacy.metrics.billableInputTokens * 0.4);
    expect(r.savingsPct).toBeGreaterThanOrEqual(60);
    expect(r.v2.metrics.maxPromptTokens).toBeLessThanOrEqual(12_000 * 1.05);
    expect(r.v2.metrics.passed).toBe(r.v2.metrics.scenarios);
  }, 30_000);
});
