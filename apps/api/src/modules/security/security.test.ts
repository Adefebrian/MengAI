// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Service and route tests for the security module, on the shared test kit.
// The workspace is an in-memory fake with the real read semantics (1-based
// line ranges, byte-capped reads) so paging is exercised too.
import { describe, expect, test } from "bun:test";
import type { DecisionDTO, FileNodeDTO, OwnerSettings, ScanDTO, Severity } from "@mengai/shared";
import { Hono } from "hono";
import type { ModuleContext } from "../../core/module";
import type { BlobStore } from "../../core/ports/blob";
import type { DecisionService, ReadResult, SettingsService, WorkspaceService } from "../../core/services";
import { HttpError, errorBody, notFound } from "../../lib/http";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createSecurityModule } from "./index";
import { OSV_BATCH_URL, OSV_VULN_URL } from "./osv";
import { readWorkspaceText } from "./files";
import { FINGERPRINT_KEY_REF, SCAN_LIMITS } from "./service";

// ------------------------------------------------------------------ fakes
function memoryWorkspace(files: Record<string, string>, capBytes = 64 * 1024): WorkspaceService & { reads: string[] } {
  const reads: string[] = [];
  const dirs = new Set<string>();
  for (const p of Object.keys(files)) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const parent = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const unused = () => Promise.reject(new Error("not used in these tests"));
  return {
    reads,
    async list(_root, rel = ".") {
      const base = rel === "." ? "" : rel;
      const out: FileNodeDTO[] = [];
      for (const d of dirs) if (parent(d) === base) out.push({ path: d, name: name(d), dir: true, size: 0, mtime: 0 });
      for (const [p, c] of Object.entries(files)) if (parent(p) === base) out.push({ path: p, name: name(p), dir: false, size: c.length, mtime: 0 });
      return out;
    },
    async read(_root, rel, range): Promise<ReadResult> {
      const text = files[rel];
      if (text === undefined) throw notFound(`file ${rel}`);
      reads.push(rel);
      const binary = text.includes("\0");
      const lines = text.split("\n");
      if (text.endsWith("\n")) lines.pop();
      const total = text === "" ? 0 : lines.length;
      const from = Math.max(1, range?.from ?? 1);
      const to = Math.min(total, range?.to ?? total);
      const out: string[] = [];
      let bytes = 0;
      let truncated = false;
      for (const l of lines.slice(from - 1, to)) {
        if (bytes + l.length + 1 > capBytes) {
          truncated = true;
          if (!out.length) out.push(l.slice(0, capBytes));
          break;
        }
        out.push(l);
        bytes += l.length + 1;
      }
      return { content: binary ? "" : out.join("\n"), totalLines: total, truncated, hash: "h", binary, size: text.length };
    },
    async resolveInside(root, rel) {
      if (rel.split("/").includes("..")) throw new HttpError(403, "path_outside_workspace", "escape");
      return `${root}/${rel}`;
    },
    write: unused,
    edit: unused,
    remove: unused,
    search: unused,
    digest: unused,
  };
}

/**
 * The real workspace on a file over its read-all limit: only the head is
 * served, reads past the head answer 413 too_large, and totalLines and size
 * describe the whole file.
 */
function headOnly(base: WorkspaceService & { reads: string[] }, path: string, headLines: number, size: number): WorkspaceService & { reads: string[] } {
  return {
    ...base,
    async list(root, rel, depth) {
      const nodes = await base.list(root, rel, depth);
      return nodes.map((n) => (n.path === path ? { ...n, size } : n));
    },
    async read(root, rel, range) {
      const r = await base.read(root, rel, range ? { from: range.from, to: Math.min(range.to ?? Infinity, headLines) } : { to: headLines });
      if (rel !== path) return r;
      const from = Math.max(1, range?.from ?? 1);
      if (from > headLines) throw new HttpError(413, "too_large", `${rel} is ${size} bytes; only its first ${headLines} lines can be read`);
      return { ...r, truncated: true, size };
    },
  };
}

function fakeSettings(allowNetworkTools: boolean): SettingsService {
  const s: OwnerSettings = { defaultBudgetTokens: 400_000, defaultBudgetUsd: 5, maxConcurrentAgents: 4, allowNetworkTools, motion: "full", prices: {} };
  return { get: async () => s, patch: async () => s };
}

function fakeDecisions(override?: Severity): DecisionService & { calls: Array<{ rule: string; ruleSeverity: Severity }> } {
  const calls: Array<{ rule: string; ruleSeverity: Severity }> = [];
  const decision = (): DecisionDTO => ({ id: "d", runId: null, decisionId: "sec.severity", answers: {}, action: "grade", confidence: 0.9, verified: true, stamp: null, latencyMs: 1, createdAt: 0 });
  const no = () => Promise.reject(new Error("not used"));
  return {
    calls,
    async severity(input) {
      calls.push({ rule: input.finding.rule, ruleSeverity: input.ruleSeverity });
      return { severity: override ?? input.ruleSeverity, decision: decision() };
    },
    route: no,
    modelTier: no,
    loopExit: no,
    escalate: no,
    promoteLesson: no,
    list: async () => [],
  };
}

const nullBlob: BlobStore = { put: async (k, d) => ({ key: k, size: 0 }), get: async () => null, delete: async () => {}, exists: async () => false };

async function setup(opts: {
  files: Record<string, string>;
  network?: boolean;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  override?: Severity;
  projects?: boolean;
  wrap?: (ws: WorkspaceService & { reads: string[] }) => WorkspaceService & { reads: string[] };
}) {
  const clock = fakeClock();
  const events = captureEvents(clock);
  const ctx: ModuleContext = {
    config: { mode: "local", version: "test", dataDir: "/tmp", workspacesDir: "/tmp", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db: await createTestDb(),
    kv: memoryKv(),
    blob: nullBlob,
    vault: memoryVault(),
    clock,
    logger: silentLogger,
    events,
  };
  const base = memoryWorkspace(opts.files);
  const workspace = opts.wrap ? opts.wrap(base) : base;
  const decisions = fakeDecisions(opts.override);
  const fetchCalls: string[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    fetchCalls.push(url);
    if (!opts.fetch) throw new Error("fetch must not be called");
    return opts.fetch(url, init);
  };
  const mod = createSecurityModule(ctx, {
    workspace,
    decisions,
    settings: fakeSettings(opts.network ?? false),
    projects: opts.projects === false ? undefined : { root: async (id) => (id === "p1" ? "/ws" : Promise.reject(notFound("project"))) },
    fetch: fetchFn,
  });
  const app = new Hono()
    .onError((err, c) => (err instanceof HttpError ? c.json(errorBody(err.code, err.message), err.status) : c.json(errorBody("internal", "internal error"), 500)))
    .route("/api/security", mod.routes!);
  return { ctx, clock, events, workspace, decisions, fetchCalls, mod, app };
}

const LOCK = JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "demo" }, "node_modules/lodash": { version: "4.17.20" }, "node_modules/ms": { version: "2.1.3" } } });

// ------------------------------------------------------------------ tests
describe("security scan service", () => {
  test("deps is skipped without network consent and fetch is never called", async () => {
    const globalFetch = globalThis.fetch;
    let globalCalls = 0;
    globalThis.fetch = (async () => {
      globalCalls++;
      throw new Error("network");
    }) as unknown as typeof fetch;
    try {
      const s = await setup({ files: { "package-lock.json": LOCK }, network: false });
      const { scan, findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["deps"], network: true });
      expect(scan.status).toBe("done");
      expect(findings.map((f) => f.rule)).toEqual(["deps.skipped_no_consent"]);
      expect(findings[0]!.severity).toBe("info");
      expect(findings[0]!.detail).toContain("2 packages");
      expect(s.fetchCalls).toEqual([]);
      // consent in settings but the caller did not ask for network: still skipped
      const s2 = await setup({ files: { "package-lock.json": LOCK }, network: true });
      const r2 = await s2.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["deps"], network: false });
      expect(r2.findings.map((f) => f.rule)).toEqual(["deps.skipped_no_consent"]);
      expect(s2.fetchCalls).toEqual([]);
      expect(globalCalls).toBe(0);
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  test("deps with consent queries OSV with names and versions only", async () => {
    const bodies: unknown[] = [];
    const s = await setup({
      files: { "package-lock.json": LOCK },
      network: true,
      fetch: async (url, init) => {
        if (url === OSV_BATCH_URL) {
          const body = JSON.parse(String(init!.body)) as { queries: Array<{ package: { name: string } }> };
          bodies.push(body);
          return Response.json({ results: body.queries.map((q) => (q.package.name === "lodash" ? { vulns: [{ id: "GHSA-test-0001", modified: "2021-01-01T00:00:00Z" }] } : {})) });
        }
        if (url === `${OSV_VULN_URL}GHSA-test-0001`) {
          return Response.json({
            id: "GHSA-test-0001",
            summary: "Prototype pollution in lodash",
            aliases: ["CVE-2021-23337"],
            database_specific: { severity: "HIGH" },
            affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }],
          });
        }
        return new Response("no", { status: 404 });
      },
    });
    const { scan, findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["deps"], network: true });
    expect(scan.status).toBe("done");
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.title).toBe("GHSA-test-0001 in lodash@4.17.20");
    expect(f.severity).toBe("high");
    expect(f.file).toBe("package-lock.json");
    expect(f.fix).toContain("4.17.21");
    expect(scan.counts.high).toBe(1);
    expect(JSON.stringify(bodies[0])).toBe(JSON.stringify({ queries: [{ package: { name: "lodash", ecosystem: "npm" }, version: "4.17.20" }, { package: { name: "ms", ecosystem: "npm" }, version: "2.1.3" }] }));
    expect(s.decisions.calls).toEqual([{ rule: "deps.vulnerable_package", ruleSeverity: "high" }]);
    expect(s.events.ofType("finding")).toHaveLength(1);
  });

  test("OSV outage fails a deps-only scan with a redacted error", async () => {
    const s = await setup({ files: { "package-lock.json": LOCK }, network: true, fetch: async () => new Response("down", { status: 503 }) });
    const { scan } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["deps"], network: true });
    expect(scan.status).toBe("failed");
    expect(scan.error).toContain("deps: OSV responded 503");
    const stored = await s.mod.service.getScan(scan.id);
    expect(stored.status).toBe("failed");
  });

  test("secrets and config findings are masked, graded and streamed", async () => {
    const gh = "ghp" + "_" + "Q1w2E3r4T5y6U7i8".repeat(3);
    const pw = "Zq8" + "vLm2Rt5Wx9Kp3Nb";
    const s = await setup({
      files: {
        ".git/HEAD": "ref: refs/heads/main\n",
        ".gitignore": "node_modules\n",
        ".env": `GITHUB_TOKEN=${gh}\n`,
        "src/db.ts": `export const password = "${pw}";\n`,
        Dockerfile: "FROM node\nRUN npm ci\n",
        "node_modules/x/index.js": `const t = "${gh}";`,
      },
      override: "low",
    });
    const { scan, findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets", "config"], network: false });
    expect(scan.status).toBe("done");
    const rules = findings.map((f) => `${f.rule}:${f.file}`).sort();
    expect(rules).toEqual([
      "docker.root_user:Dockerfile",
      "docker.unpinned_base:Dockerfile",
      "env.not_ignored:.env",
      "secret.generic_assignment:src/db.ts",
      "secret.github_token:.env",
    ]);
    for (const f of findings) {
      expect(f.detail).not.toContain(gh);
      expect(f.detail).not.toContain(pw);
    }
    // leaked live credentials stay critical without asking; the rest go through DecisionService
    expect(findings.find((f) => f.rule === "secret.github_token")!.severity).toBe("critical");
    expect(findings.find((f) => f.rule === "secret.generic_assignment")!.severity).toBe("low");
    expect(s.decisions.calls.map((c) => c.rule).sort()).toEqual(["docker.root_user", "docker.unpinned_base", "env.not_ignored", "secret.generic_assignment"]);
    expect(s.events.ofType("finding")).toHaveLength(5);
    expect(s.workspace.reads).not.toContain("node_modules/x/index.js");
    // stored rows never hold the raw secret either
    const rows = await s.ctx.db.query<{ detail: string; fingerprint: string }>`select detail, fingerprint from findings`;
    for (const r of rows) {
      expect(r.detail).not.toContain(gh);
      expect(r.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  test("dedupe within a scan and status carry-over across scans", async () => {
    const pw = "Zq8" + "vLm2Rt5Wx9Kp3Nb";
    const line = `password = "${pw}"`;
    const s = await setup({ files: { "app.py": `${line}\n${line}\n` } });
    const first = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets"], network: false });
    expect(first.findings).toHaveLength(1);
    expect(s.decisions.calls).toHaveLength(1);
    await s.mod.service.setFindingStatus(first.findings[0]!.id, "false_positive");
    const second = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets"], network: false });
    expect(second.findings).toHaveLength(1);
    expect(second.findings[0]!.id).not.toBe(first.findings[0]!.id);
    expect(second.findings[0]!.status).toBe("false_positive");
    // already graded fingerprint: no second severity call
    expect(s.decisions.calls).toHaveLength(1);
  });

  test("large files are read page by page through the workspace", async () => {
    const lines = Array.from({ length: 900 }, (_, i) => `const v${i} = ${i};`);
    const files = { "big.ts": lines.join("\n") + "\n" };
    const ws = memoryWorkspace(files, 1024);
    const r = await readWorkspaceText(ws, "/ws", "big.ts", 1_000_000);
    expect(r!.partial).toBe(false);
    expect(r!.text).toBe(lines.join("\n"));
    expect(ws.reads.length).toBeGreaterThan(5);
  });

  test("a head-only lockfile (413 past the head) is parsed in part and reported", async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `pkg${i}==1.0.${i}`);
    const files = { "requirements.txt": lines.join("\n") + "\n" };
    const ws = headOnly(memoryWorkspace(files, 1024), "requirements.txt", 1200, 10_126_751);
    const r = await readWorkspaceText(ws, "/ws", "requirements.txt", SCAN_LIMITS.lockfileBytes);
    expect(r!.partial).toBe(true);
    expect(r!.text.split("\n")).toEqual(lines.slice(0, 1200));

    const s = await setup({ files, wrap: (w) => headOnly(w, "requirements.txt", 1200, 10_126_751) });
    const { scan, findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["deps"], network: false });
    expect(scan.status).toBe("done");
    expect(findings.map((f) => f.rule).sort()).toEqual(["deps.lockfile_partial", "deps.skipped_no_consent"]);
    expect(findings.find((f) => f.rule === "deps.lockfile_partial")!.file).toBe("requirements.txt");
    expect(findings.find((f) => f.rule === "deps.skipped_no_consent")!.detail).toContain("1200 packages");
  });

  test("a lockfile over the audit limit is reported, not dropped", async () => {
    const files = { "package-lock.json": LOCK };
    const s = await setup({ files, wrap: (w) => headOnly(w, "package-lock.json", 1, SCAN_LIMITS.lockfileBytes + 1) });
    const { findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["deps"], network: false });
    expect(findings.map((f) => f.rule)).toEqual(["deps.lockfile_partial"]);
    expect(findings[0]!.detail).toContain("over the 25000000 byte audit limit");
    // oversize known from the listing: the file is not read at all
    expect(s.workspace.reads).not.toContain("package-lock.json");
    const direct = await readWorkspaceText(s.workspace, "/ws", "package-lock.json", 10, undefined, { oversize: "partial" });
    expect(direct).toEqual({ text: "", partial: true, tooLarge: true });
  });

  test("files skipped for size or encoding are reported, never dropped silently", async () => {
    const saved = { text: SCAN_LIMITS.textFileBytes, config: SCAN_LIMITS.configFileBytes };
    SCAN_LIMITS.textFileBytes = 200;
    SCAN_LIMITS.configFileBytes = 100;
    try {
      const big = `export const pad = "${"x".repeat(300)}";\n`;
      const mid = `const note = "${"y".repeat(120)}";\n`;
      const files = { "src/big.ts": big, "src/mid.ts": mid, "src/ok.ts": "export {}\n", "poetry.lock": "\0\0binary lock" };
      const s = await setup({ files });
      const { findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["deps", "secrets", "config"], network: false });
      const gaps = findings.filter((f) => f.rule === "scan.file_too_large");
      expect(gaps.map((f) => [f.kind, f.severity]).sort()).toEqual([
        ["config", "info"],
        ["secrets", "info"],
      ]);
      const secretsGap = gaps.find((f) => f.kind === "secrets")!;
      expect(secretsGap.detail).toContain("1 file(s) over the 200 byte limit");
      expect(secretsGap.detail).toContain("src/big.ts");
      const configGap = gaps.find((f) => f.kind === "config")!;
      expect(configGap.detail).toContain("src/big.ts");
      expect(configGap.detail).toContain("src/mid.ts");
      expect(configGap.detail).not.toContain("src/ok.ts");
      // a lockfile the workspace serves as binary is a reported gap too
      const lock = findings.find((f) => f.rule === "deps.lockfile_partial")!;
      expect(lock.file).toBe("poetry.lock");
      expect(lock.detail).toContain("could not be read as text");
    } finally {
      SCAN_LIMITS.textFileBytes = saved.text;
      SCAN_LIMITS.configFileBytes = saved.config;
    }
  });

  test("ignore rules apply to secrets in every kind combination; uncovered .env files are still reported", async () => {
    const key = "sk-" + "proj-" + "Q1w2E3r4T5y6U7i8O9p0".repeat(2);
    const other = "sk-" + "proj-" + "Z9x8C7v6B5n4M3l2K1j0".repeat(2);
    const files = {
      ".git/HEAD": "ref: refs/heads/main\n",
      // anchored at the root, so the nested apps/api/.env is not covered
      ".gitignore": "/.env\n/.env.*\n!/.env.shared\n",
      ".env": `OPENAI_API_KEY=${key}\n`,
      ".env.local": `OPENAI_API_KEY=${key}\n`,
      ".env.shared": `OPENAI_API_KEY=${other}\n`,
      "apps/api/.gitignore": "dist\n",
      "apps/api/.env": `OPENAI_API_KEY=${other}\n`,
      "package-lock.json": LOCK,
    };
    for (const kinds of [["secrets"], ["deps", "secrets"], ["secrets", "review"]] as const) {
      const s = await setup({ files });
      const { findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: [...kinds], network: false });
      const secretFiles = findings.filter((f) => f.kind === "secrets").map((f) => f.file).sort();
      // .env and .env.local are ignored; the negated .env.shared and the uncovered nested .env are not
      expect(secretFiles).toEqual(["apps/api/.env", ".env.shared"].sort());
    }
    // with config requested, the uncovered .env files also get env.not_ignored
    const s = await setup({ files });
    const { findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets", "config"], network: false });
    expect(findings.filter((f) => f.rule === "env.not_ignored").map((f) => f.file).sort()).toEqual(["apps/api/.env", ".env.shared"].sort());
  });

  test("an accepted dummy key never hides a different real key on the same line", async () => {
    // a fixture key the owner accepted, then a live key pasted over it on the same line
    const dummy = "sk-" + "proj-" + "Dm7yK2eQ9vL4wX1zR8tN";
    const real = "sk-" + "proj-" + "Hq3uP6sJ0cB5fG2mW9aE";
    const files: Record<string, string> = { "src/ai.ts": `const client = new OpenAI({ apiKey: "${dummy}" });\n` };
    const s = await setup({ files });
    const first = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets"], network: false });
    expect(first.findings.map((f) => f.rule)).toEqual(["secret.openai_key"]);
    await s.mod.service.setFindingStatus(first.findings[0]!.id, "accepted");
    const again = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets"], network: false });
    expect(again.findings[0]!.status).toBe("accepted");
    files["src/ai.ts"] = `const client = new OpenAI({ apiKey: "${real}" });\n`;
    const swapped = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets"], network: false });
    expect(swapped.findings).toHaveLength(1);
    expect(swapped.findings[0]!.status).toBe("open");
    expect(swapped.findings[0]!.severity).toBe("critical");
    const rows = await s.ctx.db.query<{ fingerprint: string; status: string }>`select fingerprint, status from findings`;
    expect(new Set(rows.map((r) => r.fingerprint)).size).toBe(2);
  });

  test("secrets in files ignored by git are not reported; env.not_ignored needs a git repo", async () => {
    const key = "sk-" + "proj-" + "Q1w2E3r4T5y6U7i8O9p0".repeat(2);
    const noRepo = await setup({ files: { ".env": `OPENAI_API_KEY=${key}\n`, "src/a.ts": "export {}\n" } });
    const r1 = await noRepo.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets", "config"], network: false });
    // not a git repo: nothing can be committed, the .env rule does not apply
    expect(r1.findings.map((f) => f.rule)).toEqual(["secret.openai_key"]);

    const ignored = await setup({ files: { ".git/HEAD": "ref: refs/heads/main\n", ".gitignore": ".env*\n!.env.example\n", ".env": `OPENAI_API_KEY=${key}\n` } });
    const r2 = await ignored.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets"], network: false });
    expect(r2.findings).toEqual([]);

    const excluded = await setup({ files: { ".git/HEAD": "ref: refs/heads/main\n", ".git/info/exclude": "# local\n.env\n", ".env": `OPENAI_API_KEY=${key}\n` } });
    const r3 = await excluded.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets", "config"], network: false });
    expect(r3.findings).toEqual([]);

    const committed = await setup({ files: { ".git/HEAD": "ref: refs/heads/main\n", ".env": `OPENAI_API_KEY=${key}\n` } });
    const r4 = await committed.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets", "config"], network: false });
    expect(r4.findings.map((f) => [f.rule, f.severity])).toEqual([
      ["secret.openai_key", "critical"],
      ["env.not_ignored", "high"],
    ]);
  });

  test("a suppression applies to one secret value only", async () => {
    const pw1 = "Zq8" + "vLm2Rt5Wx9Kp3Nb";
    const pw2 = "Hy4" + "cTn7Qe1Ud6Rf0Zs";
    const files: Record<string, string> = { "app.py": `password = "${pw1}"\n` };
    const s = await setup({ files });
    const first = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets"], network: false });
    await s.mod.service.setFindingStatus(first.findings[0]!.id, "accepted");
    expect(await s.ctx.vault.get(FINGERPRINT_KEY_REF)).toMatch(/^[0-9a-f]{64}$/);
    const same = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets"], network: false });
    expect(same.findings[0]!.status).toBe("accepted");
    // a different value committed on the same line is a new finding
    files["app.py"] = `password = "${pw2}"\n`;
    const changed = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets"], network: false });
    expect(changed.findings).toHaveLength(1);
    expect(changed.findings[0]!.status).toBe("open");
    const rows = await s.ctx.db.query<{ fingerprint: string }>`select fingerprint from findings`;
    expect(new Set(rows.map((r) => r.fingerprint)).size).toBe(2);
    for (const r of rows) expect(r.fingerprint).not.toContain(pw2);
  });

  test("the finding cap keeps the most severe and says it capped", async () => {
    const gh = "ghp" + "_" + "Q1w2E3r4T5y6U7i8".repeat(3);
    const saved = SCAN_LIMITS.maxFindings;
    SCAN_LIMITS.maxFindings = 1;
    try {
      // arrival order puts the Dockerfile findings first (sorted walk)
      const s = await setup({ files: { Dockerfile: "FROM node\n", "src/z.ts": `const t = "${gh}";\n` } });
      const { findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets", "config", "review"], network: false });
      expect(findings.map((f) => f.rule)).toEqual(["secret.github_token", "review.agent_task", "scan.findings_capped"]);
      expect(findings.find((f) => f.rule === "scan.findings_capped")!.detail).toContain("2 lower-priority");
    } finally {
      SCAN_LIMITS.maxFindings = saved;
    }
  });

  test("a fallback grade is graded again, a real grade and triage are reused", async () => {
    const s = await setup({ files: { Dockerfile: "FROM alpine:3.19\nUSER root\n" } });
    const down = s.decisions.severity;
    s.decisions.severity = async () => {
      throw new Error("jev down");
    };
    const outage = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["config"], network: false });
    expect(outage.findings.map((f) => f.severity)).toEqual(["medium"]);
    s.decisions.severity = async (input) => ({ ...(await down(input)), severity: "low" });
    const regraded = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["config"], network: false });
    expect(regraded.findings.map((f) => f.severity)).toEqual(["low"]);
    expect(s.decisions.calls).toHaveLength(1);
    // the stored grade differs from the rule default, so it is reused without asking
    const again = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["config"], network: false });
    expect(again.findings.map((f) => f.severity)).toEqual(["low"]);
    expect(s.decisions.calls).toHaveLength(1);
  });

  test("severity falls back to the rule default when DecisionService throws", async () => {
    const s = await setup({ files: { Dockerfile: "FROM alpine:3.19\n" } });
    s.decisions.severity = async () => {
      throw new Error("jev down");
    };
    const { findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["config"], network: false });
    expect(findings.map((f) => [f.rule, f.severity])).toEqual([["docker.root_user", "medium"]]);
  });

  test("code rules skip test paths, secrets there stay low and are not sent to grading", async () => {
    const gh = "ghp" + "_" + "Q1w2E3r4T5y6U7i8".repeat(3);
    const s = await setup({ files: { "src/app.test.ts": `app.use(cors({ origin: "*" }));\nconst t = "${gh}";\n` } });
    const { findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["secrets", "config"], network: false });
    expect(findings.map((f) => [f.rule, f.severity])).toEqual([["secret.github_token", "low"]]);
    // sec.false_positive precheck: a fixture is not asked (the grader would apply the leaked-secret law)
    expect(s.decisions.calls).toEqual([]);
  });

  test("review kind reports an info notice", async () => {
    const s = await setup({ files: { "a.ts": "export {}\n" } });
    const { scan, findings } = await s.mod.service.scan({ projectId: "p1", root: "/ws", kinds: ["review"], network: false });
    expect(scan.status).toBe("done");
    expect(findings.map((f) => [f.rule, f.severity])).toEqual([["review.agent_task", "info"]]);
  });
});

describe("security routes", () => {
  async function waitDone(app: Hono, projectId: string): Promise<ScanDTO> {
    for (let i = 0; i < 200; i++) {
      const list = (await (await app.request(`/api/security/scans?projectId=${projectId}`)).json()) as ScanDTO[];
      if (list[0] && list[0].status !== "running") return list[0];
      await Bun.sleep(2);
    }
    throw new Error("scan did not finish");
  }

  test("POST starts a background scan, findings and PATCH work", async () => {
    const s = await setup({ files: { Dockerfile: "FROM node\n" } });
    const res = await s.app.request("/api/security/scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "p1", kinds: ["config", "config"] }) });
    expect(res.status).toBe(201);
    const started = (await res.json()) as ScanDTO;
    expect(started.status).toBe("running");
    expect(started.kinds).toEqual(["config"]);
    const done = await waitDone(s.app, "p1");
    expect(done.status).toBe("done");
    expect(done.counts.medium + done.counts.low).toBe(2);
    const findings = (await (await s.app.request(`/api/security/scans/${started.id}/findings`)).json()) as Array<{ id: string; severity: string; rule: string }>;
    expect(findings.map((f) => f.rule)).toEqual(["docker.root_user", "docker.unpinned_base"]);
    const low = (await (await s.app.request(`/api/security/scans/${started.id}/findings?severity=low`)).json()) as unknown[];
    expect(low).toHaveLength(1);
    const patch = await s.app.request(`/api/security/findings/${findings[0]!.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "accepted" }) });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { status: string }).status).toBe("accepted");
    await s.mod.close!();
  });

  test("validation, not found, missing wiring and lock conflict", async () => {
    const s = await setup({ files: { "a.ts": "x\n" } });
    const post = (body: unknown) => s.app.request("/api/security/scans", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ projectId: "p1", kinds: [] })).status).toBe(422);
    expect((await post({ projectId: "p1", kinds: ["malware"] })).status).toBe(422);
    expect((await post({ projectId: "p1", kinds: ["deps"], extra: 1 })).status).toBe(422);
    expect((await post({ projectId: "nope", kinds: ["deps"] })).status).toBe(404);
    expect((await s.app.request("/api/security/scans/does-not-exist/findings")).status).toBe(404);
    expect((await s.app.request("/api/security/scans/bad%20id/findings")).status).toBe(422);
    const patch = await s.app.request("/api/security/findings/x1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "gone" }) });
    expect(patch.status).toBe(422);
    await s.ctx.kv.set("security:scan:p1", "other", 60);
    const locked = await post({ projectId: "p1", kinds: ["config"] });
    expect(locked.status).toBe(409);
    const bare = await setup({ files: {}, projects: false });
    const res = await bare.app.request("/api/security/scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "p1", kinds: ["config"] }) });
    expect(res.status).toBe(503);
  });

  test("scan starts are rate limited with Retry-After", async () => {
    const s = await setup({ files: {} });
    let last: Response | null = null;
    for (let i = 0; i < 7; i++) {
      last = await s.app.request("/api/security/scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: `nope${i}`, kinds: ["config"] }) });
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await last!.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
  });
});
