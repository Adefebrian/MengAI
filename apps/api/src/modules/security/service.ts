// Security scanning of the owner's own workspace (defensive only). One pass
// over the jailed file tree feeds three scanners (lockfile deps + OSV,
// committed secrets, config review); findings are fingerprinted, deduped,
// graded through DecisionService.severity (rule default as fallback),
// persisted and streamed as `finding` events.
import { SEVERITIES, type FindingDTO, type FindingStatus, type ScanDTO, type ScanKind, type Severity } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { DecisionService, ProjectsService, SecurityService, SettingsService, WorkspaceService } from "../../core/services";
import { badRequest, conflict, notFound, unavailable } from "../../lib/http";
import { clip, redact } from "../../lib/redact";
import {
  envNotIgnoredFinding,
  isComposeFile,
  isDockerfile,
  isEnvFile,
  isIgnored,
  isReviewableSource,
  parseGitignore,
  reviewCompose,
  reviewDockerfile,
  reviewSource,
} from "./config";
import { readGitMeta, readWorkspaceText, walkWorkspace, type ScanFile } from "./files";
import { isLockfile, parseLockfile, type PackageRef } from "./lockfiles";
import { queryOsv, type FetchLike, type OsvMatch } from "./osv";
import { createSecurityRepo, emptyCounts, type FindingRow } from "./repo";
import { scanSecrets, shouldScanForSecrets } from "./secrets";
import { SEVERITY_RANK, baseName, fingerprint, hmacTag, isTestPath, randomKeyHex, type RawFinding, type ValueTag } from "./util";

export interface SecurityDeps {
  workspace: WorkspaceService;
  decisions: DecisionService;
  settings: SettingsService;
  /** projectId -> jailed root for POST /api/security/scans (container wires projects.service) */
  projects?: Pick<ProjectsService, "root">;
  /** injectable for tests; defaults to the global fetch at call time */
  fetch?: FetchLike;
}

export type ScanInput = Parameters<SecurityService["scan"]>[0];

export interface SecurityModuleService extends SecurityService {
  /** REST entry: resolves the project root, starts the scan in the background, returns it running */
  start(input: { projectId: string; kinds: ScanKind[]; runId?: string | null }): Promise<ScanDTO>;
  listScans(q: { projectId?: string; limit?: number }): Promise<ScanDTO[]>;
  getScan(id: string): Promise<ScanDTO>;
  findings(scanId: string, q?: { severity?: Severity; status?: FindingStatus }): Promise<FindingDTO[]>;
  setFindingStatus(id: string, status: FindingStatus): Promise<FindingDTO>;
  close(): Promise<void>;
}

const KIND_ORDER: ScanKind[] = ["deps", "secrets", "config", "review"];

export const SCAN_LIMITS = {
  lockfileBytes: 25_000_000,
  textFileBytes: 1_000_000,
  configFileBytes: 512_000,
  maxPackages: 10_000,
  maxFindings: 1_000,
  maxPerRule: 200,
  severityCalls: 40,
  severityConcurrency: 4,
  lockTtlSec: 900,
};

const CARRIED: FindingStatus[] = ["accepted", "false_positive"];

/** vault ref of the per-install HMAC key that tags secret values in fingerprints */
export const FINGERPRINT_KEY_REF = "security:fingerprint-key";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function notice(rule: string, kind: ScanKind, title: string, detail: string, fix: string | null): RawFinding {
  return { kind, rule, title, file: null, line: null, detail, fix, severity: "info", key: rule };
}

function lockfileGap(file: string, detail: string): RawFinding {
  return { ...notice("deps.lockfile_partial", "deps", "Lockfile too large to audit completely", detail, "Split the workspace or audit this lockfile in CI with a dedicated tool."), file, key: `partial ${file}` };
}

function depFinding(m: OsvMatch): RawFinding {
  const { pkg, vuln } = m;
  const aliases = vuln.aliases.length ? ` Aliases: ${vuln.aliases.join(", ")}.` : "";
  return {
    kind: "deps",
    rule: "deps.vulnerable_package",
    title: `${vuln.id} in ${pkg.name}@${pkg.version}`,
    file: pkg.file,
    line: null,
    detail: `${vuln.summary} (${pkg.ecosystem} ${pkg.name} ${pkg.version}).${aliases}`,
    fix: vuln.fixed
      ? `Upgrade ${pkg.name} to ${vuln.fixed} or later and refresh the lockfile.`
      : "No fixed release is published yet: replace the package or guard the affected code path.",
    severity: vuln.severity,
    key: `${pkg.ecosystem}|${pkg.name}|${pkg.version}|${vuln.id}`,
  };
}

export function createSecurityService(ctx: ModuleContext, deps: SecurityDeps): SecurityModuleService {
  const repo = createSecurityRepo(ctx.db);
  const log = ctx.logger.child({ module: "security" });
  const live = new Map<string, { ac: AbortController; done: Promise<unknown> }>();
  let tagKey: string | null = null;
  // used only while the vault is unavailable: suppressions then do not carry, which fails safe
  const ephemeral = hmacTag(randomKeyHex());

  async function valueTag(): Promise<ValueTag> {
    if (tagKey) return hmacTag(tagKey);
    try {
      let key = await ctx.vault.get(FINGERPRINT_KEY_REF);
      if (!key || key.length < 32) {
        key = randomKeyHex();
        await ctx.vault.set(FINGERPRINT_KEY_REF, key);
      }
      tagKey = key;
      return hmacTag(key);
    } catch (err) {
      log.log("warn", "fingerprint key unavailable, finding statuses will not carry over this time", { error: clip(message(err), 200) });
      return ephemeral;
    }
  }

  async function consent(requested: boolean): Promise<boolean> {
    if (requested !== true) return false;
    try {
      return (await deps.settings.get()).allowNetworkTools === true;
    } catch {
      return false;
    }
  }

  /** .git/info/exclude first (lowest precedence), then every .gitignore from the root down. */
  async function loadIgnores(root: string, files: ScanFile[], exclude: string | null, signal: AbortSignal) {
    const out: Array<{ base: string; rules: ReturnType<typeof parseGitignore> }> = [];
    if (exclude) out.push({ base: "", rules: parseGitignore(exclude) });
    const found = files.filter((f) => baseName(f.path) === ".gitignore").sort((a, b) => a.path.split("/").length - b.path.split("/").length);
    for (const f of found) {
      const read = await readWorkspaceText(deps.workspace, root, f.path, 256_000, signal).catch(() => null);
      if (read === null) continue;
      const base = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      out.push({ base, rules: parseGitignore(read.text) });
    }
    return out;
  }

  async function collect(scan: ScanDTO, input: ScanInput, signal: AbortSignal): Promise<{ raw: RawFinding[]; errors: string[] }> {
    const want = new Set(scan.kinds);
    const raw: RawFinding[] = [];
    const errors: string[] = [];
    const walked = await walkWorkspace(deps.workspace, input.root, { signal });
    if (walked.truncated) {
      raw.push(notice("scan.truncated", scan.kinds[0]!, "Workspace is larger than the scan limit", `Only the first ${walked.files.length} files were scanned.`, "Scan a smaller folder or exclude generated output."));
    }
    // secrets report committed credentials only, so git ignore rules matter to both kinds
    const needGit = want.has("config") || want.has("secrets");
    const git = needGit ? await readGitMeta(deps.workspace, input.root) : { isRepo: false, exclude: null };
    const ignores = needGit ? await loadIgnores(input.root, walked.files, git.exclude, signal) : [];
    const tag = await valueTag();
    const pkgs: PackageRef[] = [];
    const pkgSeen = new Set<string>();
    const lockfiles: string[] = [];
    let pkgCapped = false;

    for (const f of walked.files) {
      if (signal.aborted) throw new Error("aborted");
      const name = baseName(f.path);
      const ignored = needGit && isIgnored(f.path, ignores);
      const lock = want.has("deps") && isLockfile(name);
      // a gitignored file (a local .env) is never committed: not a leak (JEV sec.false_positive, real 0.21)
      const sec = want.has("secrets") && !ignored && shouldScanForSecrets(f.path) && f.size <= SCAN_LIMITS.textFileBytes;
      const docker = want.has("config") && isDockerfile(f.path);
      const compose = want.has("config") && isComposeFile(f.path);
      // code rules skip test paths: unreachable test code is closed by the sec.false_positive precheck
      const source = want.has("config") && isReviewableSource(f.path) && !isTestPath(f.path);
      // outside a git repository nothing here can be committed (JEV sec.false_positive, real 0.29)
      if (want.has("config") && git.isRepo && isEnvFile(f.path) && !ignored) raw.push(envNotIgnoredFinding(f.path));
      if (lock && name === "bun.lockb") {
        raw.push({ ...notice("deps.binary_lockfile", "deps", "Binary bun.lockb cannot be audited", `${f.path} is the legacy binary lockfile format.`, "Run `bun install --save-text-lockfile` to produce bun.lock, then scan again."), file: f.path, key: `binary ${f.path}` });
        continue;
      }
      if (!lock && !sec && !docker && !compose && !source) continue;
      const cap = lock ? SCAN_LIMITS.lockfileBytes : SCAN_LIMITS.textFileBytes;
      const tooBig = `${f.path} is ${f.size} bytes, over the ${SCAN_LIMITS.lockfileBytes} byte audit limit, so its packages were not checked.`;
      if (lock && f.size > cap) {
        // known from the listing: skip the read (a huge file is hashed by streaming) but report the gap
        raw.push(lockfileGap(f.path, tooBig));
        continue;
      }
      let read: Awaited<ReturnType<typeof readWorkspaceText>>;
      try {
        read = await readWorkspaceText(deps.workspace, input.root, f.path, cap, signal, { oversize: lock ? "partial" : "skip" });
      } catch (err) {
        if (signal.aborted) throw err;
        if (lock) raw.push(lockfileGap(f.path, `${f.path} could not be read (${redact(clip(message(err), 160))}), so its packages were not checked.`));
        continue;
      }
      if (read === null) continue;
      const text = read.text;
      if (lock) {
        if (read.partial) raw.push(lockfileGap(f.path, text ? `${f.path} could only be read in part, so some packages were not checked.` : tooBig));
        if (pkgs.length >= SCAN_LIMITS.maxPackages) pkgCapped = true;
        else {
          lockfiles.push(f.path);
          for (const p of parseLockfile(f.path, text)) {
            const k = `${p.ecosystem}|${p.name}|${p.version}`;
            if (pkgSeen.has(k)) continue;
            pkgSeen.add(k);
            pkgs.push(p);
          }
        }
      }
      if (sec) raw.push(...scanSecrets(f.path, text, { tag }));
      if (text.length <= SCAN_LIMITS.configFileBytes) {
        if (docker) raw.push(...reviewDockerfile(f.path, text, { tag }));
        if (compose) raw.push(...reviewCompose(f.path, text, { tag }));
        if (source) raw.push(...reviewSource(f.path, text));
      }
    }

    if (pkgCapped || pkgs.length > SCAN_LIMITS.maxPackages) {
      raw.push(notice("deps.packages_capped", "deps", "Too many packages to audit in one scan", `Only the first ${SCAN_LIMITS.maxPackages} distinct packages were checked.`, "Scan each workspace package on its own."));
    }
    if (want.has("deps") && pkgs.length) {
      if (!(await consent(input.network))) {
        raw.push(
          notice(
            "deps.skipped_no_consent",
            "deps",
            "Dependency audit skipped: network consent is off",
            `Parsed ${pkgs.length} packages from ${lockfiles.length} lockfile(s). The OSV lookup sends only package names, versions and ecosystems to api.osv.dev and runs only with network consent.`,
            "Turn on network tools in Settings, then scan again.",
          ),
        );
      } else {
        try {
          const fetchFn: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
          for (const m of await queryOsv(pkgs.slice(0, SCAN_LIMITS.maxPackages), { fetch: fetchFn, signal })) raw.push(depFinding(m));
        } catch (err) {
          if (signal.aborted) throw err;
          errors.push(`deps: ${clip(message(err), 160)}`);
        }
      }
    }
    if (want.has("review")) {
      raw.push(notice("review.agent_task", "review", "Code review runs as a security agent task", "The review kind is performed by the security cat inside a run, not by the static scanner.", "Start a run with a security review goal for this project."));
    }
    return { raw, errors };
  }

  /**
   * A prior grade is reused when the owner triaged the finding (accepted,
   * false_positive) or when it differs from the rule default, which proves a
   * grade took effect. A prior equal to the default may be a fallback from a
   * DecisionService outage, so it is graded again.
   */
  function reusable(f: RawFinding, known: { status: FindingStatus; severity: Severity } | undefined): boolean {
    if (!known) return false;
    return CARRIED.includes(known.status) || known.severity !== f.severity;
  }

  async function grade(items: Array<RawFinding & { fp: string }>, prior: Map<string, { status: FindingStatus; severity: Severity }>, runId: string | null, signal: AbortSignal): Promise<Severity[]> {
    const out = items.map((f) => f.severity);
    const ask: number[] = [];
    items.forEach((f, i) => {
      const known = prior.get(f.fp);
      if (reusable(f, known)) out[i] = known!.severity;
      // precheck: notices are not graded; leaked live credentials are critical by law; a
      // low-default secret (test fixture, loopback dev password) is closed as likely fake by
      // the sec.false_positive precheck, and asking would only hit the leaked-secret law
      else if (f.severity !== "info" && !(f.kind === "secrets" && (f.severity === "critical" || f.severity === "low"))) ask.push(i);
    });
    ask.sort((a, b) => SEVERITY_RANK[items[a]!.severity] - SEVERITY_RANK[items[b]!.severity]);
    const queue = ask.slice(0, SCAN_LIMITS.severityCalls);
    let next = 0;
    let warned = false;
    const worker = async () => {
      while (next < queue.length && !signal.aborted) {
        const i = queue[next++]!;
        const f = items[i]!;
        try {
          const r = await deps.decisions.severity({ runId, finding: { kind: f.kind, rule: f.rule, title: f.title, detail: f.detail }, ruleSeverity: f.severity });
          if ((SEVERITIES as readonly string[]).includes(r.severity)) out[i] = r.severity;
        } catch (err) {
          if (!warned) log.log("warn", "severity grading fell back to rule defaults", { error: clip(message(err), 200) });
          warned = true;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SCAN_LIMITS.severityConcurrency, queue.length) }, worker));
    return out;
  }

  /** Dedupe and cap, most severe first; info notices always survive and a capped scan says so. */
  function select(scan: ScanDTO, raw: RawFinding[]): Array<RawFinding & { fp: string }> {
    const ordered = raw.map((f, i) => ({ f, i })).sort((a, b) => SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity] || a.i - b.i);
    const unique = new Map<string, RawFinding & { fp: string }>();
    const perRule = new Map<string, number>();
    const dropped = new Set<string>();
    let kept = 0;
    for (const { f } of ordered) {
      const fp = fingerprint(f);
      if (unique.has(fp) || dropped.has(fp)) continue;
      if (f.severity !== "info") {
        const n = perRule.get(f.rule) ?? 0;
        if (n >= SCAN_LIMITS.maxPerRule || kept >= SCAN_LIMITS.maxFindings) {
          dropped.add(fp);
          continue;
        }
        perRule.set(f.rule, n + 1);
        kept++;
      }
      unique.set(fp, { ...f, fp });
    }
    if (dropped.size > 0) {
      const capped = notice(
        "scan.findings_capped",
        scan.kinds[0]!,
        "Some findings were not recorded",
        `${dropped.size} lower-priority finding(s) were dropped by the per-scan limits (${SCAN_LIMITS.maxFindings} in total, ${SCAN_LIMITS.maxPerRule} per rule). The most severe ones were kept.`,
        "Fix or triage the recorded findings, then scan again.",
      );
      unique.set(fingerprint(capped), { ...capped, fp: fingerprint(capped) });
    }
    return [...unique.values()];
  }

  async function finalize(scan: ScanDTO, raw: RawFinding[], runId: string | null, signal: AbortSignal): Promise<FindingDTO[]> {
    const items = select(scan, raw);
    const prior = await repo.priorByFingerprint(scan.projectId, scan.id);
    const severities = await grade(items, prior, runId, signal);
    const now = ctx.clock.now();
    const rows: FindingRow[] = items.map((f, i) => {
      const was = prior.get(f.fp)?.status;
      return {
        id: ctx.clock.id(),
        scanId: scan.id,
        kind: f.kind,
        severity: severities[i]!,
        rule: f.rule,
        title: clip(f.title, 200),
        file: f.file,
        line: f.line,
        detail: clip(f.detail, 600),
        fix: f.fix ? clip(f.fix, 400) : null,
        // a scanner-closed finding keeps any status the owner gave it since
        status: was && (CARRIED.includes(was) || f.status) ? was : (f.status ?? "open"),
        fingerprint: f.fp,
        createdAt: now,
      };
    });
    rows.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0));
    await repo.insertFindings(rows);
    const dtos = rows.map(({ fingerprint: _fp, createdAt: _at, ...dto }) => dto as FindingDTO);
    for (const finding of dtos) {
      await ctx.events.publish({ type: "finding", runId, data: { finding, severity: finding.severity } }).catch(() => undefined);
    }
    return dtos;
  }

  async function run(scan: ScanDTO, input: ScanInput, signal: AbortSignal): Promise<{ scan: ScanDTO; findings: FindingDTO[] }> {
    try {
      const { raw, errors } = await collect(scan, input, signal);
      if (signal.aborted) throw new Error("aborted");
      const findings = await finalize(scan, raw, input.runId ?? null, signal);
      const counts = emptyCounts();
      for (const f of findings) counts[f.severity]++;
      const failedKinds = errors.length;
      const graded = scan.kinds.filter((k) => k !== "review").length;
      const status = graded > 0 && failedKinds >= graded ? "failed" : "done";
      const done: ScanDTO = { ...scan, status, counts, error: errors.length ? errors.join("; ") : null, finishedAt: ctx.clock.now() };
      await repo.finishScan(scan.id, { status: done.status, counts, error: done.error, finishedAt: done.finishedAt! });
      return { scan: done, findings };
    } catch (err) {
      const error = signal.aborted ? "aborted" : clip(message(err), 300);
      const failed: ScanDTO = { ...scan, status: "failed", error, finishedAt: ctx.clock.now() };
      await repo.finishScan(scan.id, { status: "failed", counts: scan.counts, error, finishedAt: failed.finishedAt! }).catch((e) => {
        log.log("error", "could not record scan failure", { scanId: scan.id, error: clip(message(e), 200) });
      });
      log.log("warn", "scan failed", { scanId: scan.id, error });
      return { scan: failed, findings: [] };
    }
  }

  async function begin(input: ScanInput): Promise<{ scan: ScanDTO; done: Promise<{ scan: ScanDTO; findings: FindingDTO[] }> }> {
    const kinds = KIND_ORDER.filter((k) => input.kinds.includes(k));
    if (!kinds.length) throw badRequest("at least one scan kind is required");
    const id = ctx.clock.id();
    const lockKey = `security:scan:${input.projectId}`;
    if (!(await ctx.kv.setNx(lockKey, id, SCAN_LIMITS.lockTtlSec))) throw conflict("a scan is already running for this project");
    const scan: ScanDTO = { id, projectId: input.projectId, kinds, status: "running", counts: emptyCounts(), error: null, createdAt: ctx.clock.now(), finishedAt: null };
    try {
      await repo.insertScan(scan);
    } catch (err) {
      await ctx.kv.del(lockKey).catch(() => undefined);
      throw err;
    }
    const ac = new AbortController();
    const signal = input.signal ? AbortSignal.any([input.signal, ac.signal]) : ac.signal;
    const done = run(scan, input, signal).finally(async () => {
      live.delete(id);
      await ctx.kv.del(lockKey).catch(() => undefined);
    });
    live.set(id, { ac, done });
    return { scan, done };
  }

  return {
    async scan(input) {
      const { done } = await begin(input);
      return done;
    },

    async start(input) {
      if (!deps.projects) throw unavailable("project lookup is not wired for security scans");
      const root = await deps.projects.root(input.projectId);
      const { scan } = await begin({ projectId: input.projectId, root, kinds: input.kinds, runId: input.runId ?? null, network: true });
      return scan;
    },

    listScans(q) {
      return repo.listScans({ projectId: q.projectId, limit: Math.min(Math.max(q.limit ?? 50, 1), 200) });
    },

    async getScan(id) {
      const s = await repo.getScan(id);
      if (!s) throw notFound("scan");
      return s;
    },

    async findings(scanId, q = {}) {
      if (!(await repo.getScan(scanId))) throw notFound("scan");
      return repo.listFindings(scanId, q);
    },

    async setFindingStatus(id, status) {
      const f = await repo.getFinding(id);
      if (!f) throw notFound("finding");
      if (f.status !== status) {
        await repo.setFindingStatus(id, status);
        f.status = status;
        await ctx.events.publish({ type: "finding", runId: null, data: { finding: f, severity: f.severity } }).catch(() => undefined);
      }
      return f;
    },

    async close() {
      const pending = [...live.values()];
      for (const p of pending) p.ac.abort(new Error("shutting down"));
      await Promise.allSettled(pending.map((p) => p.done));
    },
  };
}
