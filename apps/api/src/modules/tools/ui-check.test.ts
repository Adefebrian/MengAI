// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// ui_check: the static design law scan (every rule, the quiet cases that
// must not fire, file:line accuracy) and the tool itself through the tools
// service on a real jailed workspace (role gate, paths, reviewCheck on the
// UI files a run changed).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRole, OwnerSettings } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { ToolContext } from "../../core/services";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createProjectsModule } from "../projects";
import { createWorkspaceModule } from "../workspace";
import { createToolsModule, type ToolsServiceImpl } from "./index";
import { formatUiReport, isUiFile, scanUi, shadowLayers, toPx, UI_CHECK, UI_CHECK_SPEC, type UiRule } from "./ui-check";

const EM = String.fromCharCode(0x2014);
const ROCKET = String.fromCodePoint(0x1f680);

const rules = (path: string, text: string) => scanUi([{ path, text }]).map((f) => `${f.line}:${f.rule}`);
const only = (path: string, text: string, rule: UiRule) => scanUi([{ path, text }]).filter((f) => f.rule === rule);

describe("ui_check scan", () => {
  test("a tidy page is clean", () => {
    const css = [
      ":root { --page: #fafaf9; --ink: #1b1b1b; }",
      "* { box-sizing: border-box; }",
      "body { font: 16px/1.5 system-ui; background: var(--page); color: var(--ink); }",
      ".card { border: 1px solid #e5e5e3; border-radius: 12px; padding: 16px; }",
      "button { min-height: 44px; padding: 0 16px; }",
      "button:focus-visible { box-shadow: 0 0 0 3px #1b1b1b; outline: none; }",
      ".wrap { width: 1200px; max-width: 100%; }",
      "@media (min-width: 1024px) { .side { width: 360px; } }",
      "small { font-size: 12px; }",
      "@keyframes fade { from { opacity: 0 } to { opacity: 1 } }",
      ".in { animation: fade 200ms ease-out; }",
      "@media (prefers-reduced-motion: reduce) { .in { animation: none; } }",
    ].join("\n");
    const html = `<!doctype html><html><body><img src="a.png" alt="A cat on a chair"><img src="b.svg" alt=""><button class="btn">Go</button><footer>Copyright 2026 \u00a9</footer></body></html>`;
    expect(scanUi([{ path: "styles.css", text: css }, { path: "index.html", text: html }])).toEqual([]);
  });

  test("gradients in stylesheets, inline styles, JSX strings and Tailwind classes, with the right line", () => {
    expect(rules("a.css", ".a { color: red; }\n.b { background: linear-gradient(90deg, #fff, #000); }")).toEqual(["2:gradient"]);
    expect(rules("a.html", `<div>\n<div style="background-image: radial-gradient(circle, red, blue)">x</div>\n</div>`)).toEqual(["2:gradient"]);
    expect(rules("a.tsx", `const s = {\n  background: "conic-gradient(red, blue)",\n};`)).toEqual(["2:gradient"]);
    expect(rules("a.tsx", `<div className="bg-gradient-to-r from-pink-500">x</div>`)).toEqual(["1:gradient"]);
    expect(rules("a.vue", `<template><div class="md:bg-linear-to-b">x</div></template>`)).toEqual(["1:gradient"]);
  });

  test("blurred shadows, glow and side stripes; a spread-only focus ring and a hairline pass", () => {
    expect(rules("a.css", ".card { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }")).toEqual(["1:shadow"]);
    expect(rules("a.css", ".card { box-shadow: 0 0 40px rgba(168, 85, 247, 0.6); }")).toEqual(["1:glow"]);
    expect(rules("a.css", "h1 { text-shadow: 0 0 12px #fff; }")).toEqual(["1:glow"]);
    expect(rules("a.css", ".x { filter: drop-shadow(0 2px 4px black); }")).toEqual(["1:shadow"]);
    expect(rules("a.css", ".neon-title { color: #0f0; }")).toEqual(["1:glow"]);
    expect(rules("a.css", ".alert { border-left: 4px solid var(--accent); }")).toEqual(["1:side-line"]);
    expect(rules("a.css", ".tab { box-shadow: inset 3px 0 0 #2563eb; }")).toEqual(["1:side-line"]);
    expect(rules("a.tsx", `<div className="shadow-lg hover:shadow-xl border-l-4">x</div>`)).toEqual(["1:shadow", "1:side-line"]);
    expect(rules("a.css", "a:focus-visible { box-shadow: 0 0 0 2px #111; }\n.row { border-left: 1px solid #e5e5e3; }\n.x { box-shadow: none; }\n.y { box-shadow: var(--ring); }")).toEqual([]);
    expect(shadowLayers("0 1px 2px rgba(0,0,0,.2), inset 0 0 0 1px #ddd").map((l) => [l.blur, l.inset])).toEqual([
      [2, false],
      [0, true],
    ]);
  });

  test("emoji and em-dashes in copy; comments and the copyright sign are not copy", () => {
    expect(rules("a.html", `<p>Launch day ${ROCKET}</p>\n<p>Fast ${EM} simple</p>\n<p>Fast &mdash; simple</p>`)).toEqual(["1:emoji", "2:em-dash", "3:em-dash"]);
    expect(rules("a.tsx", `// a note ${EM} fine\n/* ${ROCKET} */\nexport const A = () => <p>Hi \u00a9 2026</p>;`)).toEqual([]);
    expect(rules("a.html", `<!-- draft ${EM} later -->\n<p>ok</p>`)).toEqual([]);
  });

  test("animation needs prefers-reduced-motion in the file or a project-wide reset", () => {
    const anim = "@keyframes spin { to { transform: rotate(1turn) } }\n.s { animation: spin 1s linear infinite; }";
    expect(rules("a.css", anim)).toEqual(["1:reduced-motion"]);
    const reset = "@media (prefers-reduced-motion: reduce) { *, *::before { animation-duration: 0.01ms !important; } }";
    expect(scanUi([{ path: "a.css", text: anim }, { path: "base.css", text: reset }])).toEqual([]);
    expect(rules("a.tsx", `import { motion } from "motion/react";\nexport const A = () => <motion.div animate={{ x: 10 }} />;`)).toEqual(["2:reduced-motion"]);
    expect(rules("a.tsx", `const r = useReducedMotion();\nexport const A = () => <motion.div animate={{ x: r ? 0 : 10 }} />;`)).toEqual([]);
    expect(rules("a.css", ".s { animation: none; transition: opacity 200ms; }")).toEqual([]);
  });

  test("tap targets under 44 px on controls only; min-height lifts a small height", () => {
    expect(rules("a.css", ".btn-sm { height: 32px; }\nbutton.icon { height: 2rem; }")).toEqual(["1:tap-target", "2:tap-target"]);
    expect(rules("a.css", "button { height: 36px; min-height: 44px; }\n.card { height: 20px; }\nbutton .icon { height: 16px; }\ninput[type=checkbox] { height: 18px; }")).toEqual([]);
    expect(rules("a.tsx", `<button className="h-8 px-2">Go</button>\n<button className="h-8 min-h-11">Ok</button>\n<a className="h-12" href="/">Home</a>`)).toEqual(["1:tap-target"]);
    expect(rules("a.html", `<a href="#" style="height: 30px">x</a>`)).toEqual(["1:tap-target"]);
  });

  test("widths wider than a 320 px phone, 100vw and w-screen; min-width media and relative max-width pass", () => {
    expect(rules("a.css", ".wrap { width: 1200px; }\nbody { min-width: 1024px; }\n.full { width: 100vw; }")).toEqual(["1:too-wide", "2:too-wide", "3:too-wide"]);
    expect(rules("a.css", ".m { width: 480px; max-width: calc(100% - 32px); }\n@media (min-width: 768px) { .s { width: 400px; } }\n.n { width: 300px; }")).toEqual([]);
    expect(rules("a.tsx", `<div className="w-[1200px]">a</div>\n<div className="w-96 max-w-full">b</div>\n<div className="md:w-[900px]">c</div>\n<div className="w-screen">d</div>`)).toEqual([
      "1:too-wide",
      "4:too-wide",
    ]);
    expect(rules("a.tsx", `<div style={{ width: 1400 }}>x</div>`)).toEqual(["1:too-wide"]);
  });

  test("text under 12 px in every form; print styles pass", () => {
    expect(rules("a.css", ".a { font-size: 11px; }\n.b { font-size: 0.6rem; }\n.c { font: 600 10px/1.4 Inter, sans-serif; }")).toEqual(["1:small-text", "2:small-text", "3:small-text"]);
    expect(rules("a.css", "@media print { .a { font-size: 9pt; } }\n.b { font-size: 12px; }\n.c { font-size: 0; }")).toEqual([]);
    expect(rules("a.tsx", `<span style={{ fontSize: 10 }}>a</span>\n<span className="text-[11px]">b</span>\n<span className="text-xs">c</span>`)).toEqual(["1:small-text", "2:small-text"]);
  });

  test("img without alt, across lines; a spread may carry it", () => {
    expect(rules("a.html", `<p>x</p>\n<img\n  src="hero.png"\n  class="hero">`)).toEqual(["2:alt-text"]);
    expect(rules("a.tsx", `<img src={src} onClick={() => a > b} />\n<img {...props} />\n<img src="x" alt="" />`)).toEqual(["1:alt-text"]);
  });

  test("style blocks and CSS-in-JS are read as CSS, with lines in the host file", () => {
    const html = `<html>\n<head>\n<style>\n.card {\n  box-shadow: 0 8px 16px rgba(0,0,0,.2);\n}\n</style>\n</head>\n</html>`;
    expect(rules("page.html", html)).toEqual(["5:shadow"]);
    const tsx = "const Card = styled.div`\n  padding: 16px;\n  font-size: 10px;\n  width: ${w}px;\n`;";
    expect(rules("Card.tsx", tsx)).toEqual(["3:small-text"]);
    expect(rules("Btn.tsx", "const B = styled.button`\n  height: 30px;\n  &:hover { box-shadow: 0 2px 6px #000; }\n`;")).toEqual(["2:tap-target", "3:shadow"]);
  });

  test("files, units and the report", () => {
    expect(["a.html", "b.css", "c.scss", "d.tsx", "e.jsx", "f.vue", "g.svelte"].every(isUiFile)).toBe(true);
    expect(["a.ts", "b.min.css", "vendor/x.css", "README.md"].some(isUiFile)).toBe(false);
    expect([toPx("12px"), toPx("0.75rem"), toPx("9pt"), toPx("0"), toPx("50%")]).toEqual([12, 12, 12, 0, null]);
    expect(formatUiReport([], 0)).toMatchObject({ ok: true, summary: "ui_check: no UI files" });
    expect(formatUiReport([], 3)).toEqual({ ok: true, output: "ui_check: clean, 3 files checked", summary: "ui_check: clean, 3 files checked" });
    const bad = formatUiReport(only("a.css", ".a { font-size: 10px; }\n.b { width: 900px; }", "small-text"), 2);
    expect(bad.ok).toBe(false);
    expect(bad.output.split("\n")[0]).toBe("ui_check: 1 finding in 1 of 2 files (small-text 1)");
    expect(bad.output).toContain("a.css:1: [small-text]");
    expect(UI_CHECK_SPEC.description.split(/\s+/).length).toBeLessThan(60);
    expect(`${UI_CHECK_SPEC.description}${bad.output}`).not.toContain(EM);
  });
});

// ------------------------------------------------------------------ tool
const made: string[] = [];
afterAll(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
});

const settings: OwnerSettings = { defaultBudgetTokens: 400_000, defaultBudgetUsd: 5, maxConcurrentAgents: 4, allowNetworkTools: false, motion: "full", prices: {} };
let ctx: ModuleContext;

async function build(): Promise<{ tools: ToolsServiceImpl; tc: (role: AgentRole, runId?: string) => ToolContext; write: (path: string, text: string) => Promise<void> }> {
  const workspace = createWorkspaceModule(ctx, {}).service;
  const projects = createProjectsModule(ctx, { workspace }).service;
  const project = await projects.create({ name: "UI Check" });
  const root = project.workspacePath;
  const tools = createToolsModule(ctx, {
    workspace,
    runner: null,
    memory: null as never,
    assets: null as never,
    security: null as never,
    automation: null,
    settings: { get: async () => settings, patch: async () => settings },
    projects,
  }).service;
  const tc = (role: AgentRole, runId = "run-1"): ToolContext => ({ runId, agentId: "agent-1", taskId: "task-1", projectId: project.id, root, role });
  return { tools, tc, write: async (path, text) => void (await workspace.write(root, path, text)) };
}

let n = 0;
const call = (name: string, args: unknown) => ({ id: `call_${++n}`, name, arguments: JSON.stringify(args) });

beforeEach(async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "mengai-uicheck-")));
  made.push(base);
  const clock = fakeClock();
  ctx = {
    config: { mode: "local", version: "test", dataDir: join(base, "data"), workspacesDir: join(base, "ws"), webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db: await createTestDb(),
    kv: memoryKv(),
    blob: null as never,
    vault: memoryVault(),
    clock,
    logger: silentLogger,
    events: captureEvents(clock),
  };
});

describe("ui_check tool", () => {
  test("offered to designer, engineer, reviewer and QA, read only, refused to other roles", async () => {
    const { tools, tc } = await build();
    for (const role of ["designer", "engineer", "reviewer", "qa"] as const) expect(tools.specsFor(role).at(-1)?.name).toBe(UI_CHECK);
    for (const role of ["lead", "security", "researcher", "operator"] as const) expect(tools.specsFor(role).map((s) => s.name)).not.toContain(UI_CHECK);
    expect(tools.isReadOnly(UI_CHECK)).toBe(true);
    expect(tools.isControl(UI_CHECK)).toBe(false);
    const r = await tools.execute(call(UI_CHECK, {}), tc("security"));
    expect(r).toMatchObject({ ok: false, output: "error: ui_check is not available to the security role" });
  });

  test("scans the workspace (or the given paths) and answers file:line findings; clean passes", async () => {
    const { tools, tc, write } = await build();
    await write("index.html", `<!doctype html>\n<html><body>\n<img src="hero.png">\n</body></html>`);
    await write("src/app.css", `.card {\n  box-shadow: 0 10px 30px rgba(0,0,0,.3);\n}\n`);
    await write("src/deep/a/b/c/d/e/f/Tiny.tsx", `export const T = () => <span style={{ fontSize: 9 }}>x</span>;`);
    await write("notes.md", `Fast ${EM} simple`);
    const r = await tools.execute(call(UI_CHECK, {}), tc("reviewer"));
    expect(r.ok).toBe(false);
    const lines = r.output.split("\n");
    expect(lines[0]).toBe("ui_check: 3 findings in 3 of 3 files (alt-text 1, glow 1, small-text 1)");
    expect(lines).toContain(`index.html:3: [alt-text] img without alt: describe it, or alt="" when it is decoration`);
    expect(r.output).toContain("src/app.css:2: [glow]");
    expect(r.output).toContain("src/deep/a/b/c/d/e/f/Tiny.tsx:1: [small-text]");
    const one = await tools.execute(call(UI_CHECK, { paths: ["src/app.css", "missing.css"] }), tc("designer"));
    expect(one.output.split("\n")[0]).toBe("ui_check: 1 finding in 1 of 1 files (glow 1)");
    expect(one.output).toContain("skipped missing.css");
    await write("src/app.css", ".card { border: 1px solid #e5e5e3; }\n");
    const clean = await tools.execute(call(UI_CHECK, { paths: ["src/app.css"] }), tc("qa"));
    expect(clean).toMatchObject({ ok: true, output: "ui_check: clean, 1 file checked" });
    const bad = await tools.execute(call(UI_CHECK, { paths: "index.html" }), tc("qa"));
    expect(bad.ok).toBe(false);
    expect(bad.output).toStartWith("error: ");
  });

  test("reviewCheck runs ui_check on the UI files this run changed, as a logged call", async () => {
    const { tools, tc, write } = await build();
    // written outside the run: never part of the review
    await write("old.css", ".x { box-shadow: 0 4px 8px black; }\n");
    expect(await tools.reviewCheck(tc("reviewer"))).toBeNull();
    const w = await tools.execute(call("fs_write", { path: "site/page.html", content: `<p>Hello ${ROCKET}</p>\n` }), tc("engineer"));
    expect(w.ok).toBe(true);
    await tools.execute(call("fs_write", { path: "site/data.json", content: "{}" }), tc("engineer"));
    expect(await tools.reviewCheck(tc("lead"))).toBeNull();
    expect(await tools.reviewCheck(tc("reviewer", "run-2"))).toBeNull();
    const r = await tools.reviewCheck(tc("reviewer"));
    expect(r?.ok).toBe(false);
    expect(r?.output.split("\n")[0]).toBe("ui_check: 1 finding in 1 of 1 files (emoji 1)");
    expect(r?.output).not.toContain("old.css");
    const rows = await ctx.db.query<{ tool: string; args: string }>`select tool, args from tool_calls where tool = ${UI_CHECK}`;
    expect(rows.map((x) => JSON.parse(x.args))).toEqual([{ paths: ["site/page.html"] }]);
    await tools.execute(call("fs_edit", { path: "site/page.html", find: ` ${ROCKET}`, replace: "" }), tc("engineer"));
    expect(await tools.reviewCheck(tc("reviewer"))).toEqual({ ok: true, output: "ui_check: clean, 1 file checked" });
  });
});
