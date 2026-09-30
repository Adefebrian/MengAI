// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// ToolsService: role-filtered specs and execution of every non-control
// tool. Each call: parse and validate args against the spec, check the role
// may use the tool, run it jailed to the project workspace, redact the
// output, persist a tool_calls row and publish tool.call / tool.result.
// Capability tools ride on the same path (capabilities.ts): find_tools and
// the connector tools a task loaded, and the trading tools a company grants.
// Destructive and sensitive connector tools go through the approval path the
// engine passes in; order placement and fund movement only through the
// trading gate. A connector tool that fails during a run becomes a crew-wide
// lesson (once per tool and error shape), so every cat learns from it.
// Where the platform has no crew sandbox (lib/platform.ts), shell_run is
// dropped from every role and a call to it answers the "Coming soon" reason.
// ui_check (ui-check.ts) is a crew tool of the tools module itself: a static
// design law scan with no shell, so it works on every platform. Designers,
// engineers, reviewers and QA get it after their registry tools, and the
// engine asks reviewCheck() before it accepts a reviewer's pass on UI work.
import {
  activityForTool,
  ROLE_TOOLS,
  type Activity,
  TOOL_NAMES,
  type AgentRole,
  type AxNode,
  type FileNodeDTO,
  type HandsMethod,
  type HandsParams,
  type HandsResults,
  type ToolCallDetail,
  type ToolName,
} from "@mengai/shared";
import { realpath } from "node:fs/promises";
import type { ModuleContext } from "../../core/module";
import type { Runner, ToolCall, ToolSpec } from "../../core/ports";
import {
  ApprovalDeniedError,
  type AssetsService,
  type AutomationService,
  type MemoryService,
  type ProjectsService,
  type SecurityService,
  type SettingsService,
  type ToolContext,
  type ToolResult,
  type ToolsService,
  type WorkspaceService,
} from "../../core/services";
import { enginePorts } from "../../lib/engine-guard";
import { featureOff, type PlatformInfo } from "../../lib/platform";
import { clip, redact, redactDeep } from "../../lib/redact";
import { toJson } from "../../lib/sql";
import { errorMeaning } from "../trading";
import { runWithFileOrigin } from "../workspace";
import { createToolCallsRepo } from "./repo";
import { CONTROL_TOOLS, OPERATOR_TOOLS, READ_ONLY_TOOLS, TOOL_SPECS, UNAVAILABLE_TOOLS } from "./specs";
import { formatUiReport, isUiFile, scanUi, UI_CHECK, UI_CHECK_LIMITS, UI_CHECK_SPEC, type UiFile } from "./ui-check";
import { validateArgs, type JsonSchema } from "./validate";
import { fetchReadable, type Lookup } from "./web";
import { argsLine, connectorSpec, dotted, FIND_TOOLS, FIND_TOOLS_SPEC, isTradingTool, searchTools, TRADING_ORDER, TRADING_SPECS, type TradingToolName } from "./capabilities";
import type { BridgeTool, CapabilityContext, ConnectorsBridge, SharedSkillMemory, SimulatedVenue, TaskSpecsInput, TradingBridge, VenueNoteView } from "./ports";

export interface ToolsDeps {
  workspace: WorkspaceService;
  /** null keeps shell_run out of every spec (for example server mode with the shell off) */
  runner: Runner | null;
  /** the memory module's service; its crew-wide skill side is handed to the trading desk */
  memory: MemoryService & Partial<SharedSkillMemory>;
  assets: AssetsService;
  security: SecurityService;
  /** null outside local mode: operator tools are omitted and refused */
  automation: AutomationService | null;
  settings: SettingsService;
  projects: ProjectsService;
  /** the owner's connectors (MCP servers, HTTP APIs); null or absent: no find_tools */
  connectors?: ConnectorsBridge | null;
  /** the trading service; null or absent: no trading tools */
  trading?: TradingBridge | null;
  /** boot-time platform features: shell off drops shell_run everywhere; absent keeps every feature on */
  platform?: PlatformInfo;
}

export interface ToolsOptions {
  /** injectable for tests; defaults to global fetch */
  fetch?: typeof fetch;
  /** injectable DNS lookup for the SSRF guard */
  lookup?: Lookup;
}

/** ToolsService plus the persisted call detail the runs module serves */
export interface ToolsServiceImpl extends ToolsService {
  execute(call: ToolCall, ctx: ToolContext & CapabilityContext): Promise<ToolResult & { callId: string }>;
  detail(runId: string, callId: string): Promise<ToolCallDetail | null>;
  /**
   * The capability tools of one step, after the role's registry tools: the
   * trading tools granted to the cat, find_tools when connector tools exist
   * for its role, then the connector tools this task loaded (in load order).
   */
  taskSpecs(input: TaskSpecsInput): Promise<ToolSpec[]>;
  /** memory layer notes of the ready trading venues this role may use (empty without trading) */
  venueNotes(role: AgentRole): Promise<VenueNoteView[]>;
  /** attaches an in-process simulated venue to the trading desk (the fund demo); null without trading */
  connectSimulator(sim: SimulatedVenue): Promise<unknown>;
  /** registry tools this platform turns off (shell_run without a crew sandbox), so role tool sets leave them out */
  platformOff(): ReadonlySet<string>;
  /**
   * Before a reviewer's pass: runs ui_check on the UI files this run wrote
   * or edited (a normal, logged tool call). null when the role has no
   * ui_check or the run changed no UI file; throws when the run's changes
   * cannot be read.
   */
  reviewCheck(tc: ToolContext & CapabilityContext): Promise<{ ok: boolean; output: string } | null>;
}

/** Roles that get ui_check after their registry tools (fixed order: the tools block stays cacheable). */
export const UI_CHECK_ROLES: ReadonlySet<AgentRole> = new Set<AgentRole>(["designer", "engineer", "reviewer", "qa"]);
/** list calls one ui_check may make to walk deep folders */
const UI_CHECK_LISTS = 20;
/** reads per file (64 KB each through the workspace port) */
const UI_CHECK_READS = 10;

export const SHELL_TIMEOUT_MS = 120_000;
export const SHELL_OUTPUT_CAP = 200 * 1024;
export const WEB_TIMEOUT_MS = 20_000;
export const WEB_MAX_BYTES = 2 * 1024 * 1024;
/** hard cap on what one tool result may carry (the context module truncates further) */
export const MAX_OUTPUT_CHARS = 256_000;
const MAX_LIST_LINES = 400;
/** tasks whose loaded connector tools are remembered (oldest dropped first) */
const LOADED_TASKS = 1000;
/** tool and error shapes already turned into a lesson in this process */
const LESSON_KEYS = 500;

type Args = Record<string, unknown>;
interface Outcome {
  ok: boolean;
  output: string;
  summary: string;
}
interface Call extends ToolContext, CapabilityContext {
  /** verified realpath of the project workspace */
  workspace(): Promise<string>;
}
type Handler = (args: Args, call: Call) => Promise<Outcome>;

const done = (output: string, summary = output): Outcome => ({ ok: true, output, summary });
const fail = (message: string): Outcome => ({ ok: false, output: `error: ${message}`, summary: message });

const s = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const n = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}k`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

function capOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n[output cut at ${MAX_OUTPUT_CHARS} characters]`;
}

function renderAx(root: AxNode, maxLines: number): string[] {
  const lines: string[] = [];
  const walk = (node: AxNode, depth: number) => {
    if (lines.length >= maxLines) return;
    const label = [node.title, node.description, node.secure ? null : node.value].filter((x) => x && x.trim()).map((x) => `"${clip(x!, 60)}"`).join(" ");
    const f = node.frame ? ` [${Math.round(node.frame.x)},${Math.round(node.frame.y)},${Math.round(node.frame.w)},${Math.round(node.frame.h)}]` : "";
    const flags = `${node.secure ? " secure" : ""}${node.focused ? " focused" : ""}${node.enabled === false ? " disabled" : ""}`;
    lines.push(`${"  ".repeat(depth)}${node.role}${label ? ` ${label}` : ""}${f}${flags}`);
    for (const c of node.children ?? []) walk(c, depth + 1);
  };
  walk(root, 0);
  return lines;
}

function hasSharedSkills(m: (MemoryService & Partial<SharedSkillMemory>) | null | undefined): m is MemoryService & SharedSkillMemory {
  return !!m && typeof m.sharedSkills === "function" && typeof m.skillOutcome === "function" && typeof m.deleteSharedSkills === "function";
}

export function createToolsService(ctx: ModuleContext, deps: ToolsDeps, opts: ToolsOptions = {}): ToolsServiceImpl {
  const repo = createToolCallsRepo(ctx.db);
  const log = ctx.logger.child({ module: "tools" });
  // the capability bridge: the trading desk writes venue skills and lessons into the crew memory
  if (deps.trading?.useMemory && hasSharedSkills(deps.memory)) deps.trading.useMemory(deps.memory);

  // no crew sandbox on this platform: shell commands could reach the no-auth engine API
  const shellOff = featureOff(deps.platform, "shell");
  const shellRefusal = shellOff ? `${shellOff} Say in your finish summary which check the owner should run.` : null;
  const platformOff: ReadonlySet<string> = new Set<string>(shellOff ? ["shell_run"] : []);

  const offered = (name: ToolName): boolean => {
    if (UNAVAILABLE_TOOLS.has(name)) return false;
    if (OPERATOR_TOOLS.has(name) && !deps.automation) return false;
    if (name === "shell_run" && !deps.runner) return false;
    if (platformOff.has(name)) return false;
    return true;
  };

  // stable arrays per role keep the tools block byte-identical for prompt caching
  const byRole = new Map<AgentRole, ToolSpec[]>();
  const specsFor = (role: AgentRole): ToolSpec[] => {
    let specs = byRole.get(role);
    if (!specs) {
      specs = (ROLE_TOOLS[role] ?? []).filter(offered).map((name) => TOOL_SPECS[name]);
      if (UI_CHECK_ROLES.has(role)) specs.push(UI_CHECK_SPEC);
      byRole.set(role, specs);
    }
    return specs;
  };
  const activityOf = (tool: string): Activity => (tool === UI_CHECK ? "review" : activityForTool(tool));

  const networkAllowed = async () => (await deps.settings.get()).allowNetworkTools === true;

  // ----------------------------------------------------- capabilities
  /** connector tools a task loaded (find_tools or a call), by "runId:taskId", in load order */
  const loaded = new Map<string, string[]>();
  /** alias and namespaced name -> the last seen connector tool (isReadOnly is sync) */
  const known = new Map<string, BridgeTool>();
  const taskKey = (runId: string, taskId: string | null) => `${runId}:${taskId ?? "-"}`;
  function markLoaded(runId: string, taskId: string | null, name: string): void {
    const key = taskKey(runId, taskId);
    const list = loaded.get(key) ?? [];
    if (!list.includes(name)) list.push(name);
    loaded.delete(key);
    loaded.set(key, list);
    while (loaded.size > LOADED_TASKS) loaded.delete(loaded.keys().next().value!);
  }
  function remember(tools: readonly BridgeTool[]): void {
    for (const t of tools) {
      known.set(t.alias, t);
      known.set(t.name, t);
    }
  }
  async function connectorTools(role: AgentRole): Promise<BridgeTool[]> {
    if (!deps.connectors) return [];
    try {
      const tools = await deps.connectors.tools({ role });
      remember(tools);
      return tools;
    } catch (e) {
      log.log("warn", "connector tool list failed", { error: redact(String(e)) });
      return [];
    }
  }

  const lessonKeys = new Set<string>();
  /** a failed connector call during a run: one crew-wide lesson per tool and error shape */
  async function toolLesson(t: BridgeTool, output: string, call: Call): Promise<void> {
    const first = redact(output).replace(/^error:\s*/i, "").split("\n")[0]!.trim();
    if (!first || !deps.memory) return;
    const key = `${t.name}|${first.replace(/[0-9a-f]{8,}|\d+(\.\d+)?/gi, "#").slice(0, 120)}`;
    if (lessonKeys.has(key)) return;
    lessonKeys.add(key);
    if (lessonKeys.size > LESSON_KEYS) lessonKeys.delete(lessonKeys.values().next().value!);
    try {
      await deps.memory.record({
        text: `${t.alias} failed with "${clip(first, 140)}": ${errorMeaning(first)}.`,
        tags: [t.connectorLabel, "tool-error"],
        role: null,
        projectId: null,
        runId: call.runId,
        scope: "global",
      });
    } catch (e) {
      log.log("warn", "tool error lesson failed", { error: redact(String(e)) });
    }
  }

  async function findTools(a: Args, call: Call): Promise<Outcome> {
    const tools = await connectorTools(call.role);
    if (!tools.length) return done("no connector tools are available to your role", "find_tools: none available");
    const query = s(a.query)!;
    const hits = searchTools(tools, query, n(a.limit) ?? 5);
    if (!hits.length) return done(`no connector tool matches "${clip(query, 80)}"; ${tools.length} tools exist, try other words`, `find_tools ${clip(query, 60)}: no match`);
    const lines = hits.map((t) => {
      if (t.money) return `- ${t.alias} (${t.risk}, places orders): ${t.description} Pass its name as venue to propose_order; it is never called directly.`;
      markLoaded(call.runId, call.taskId, t.name);
      return `- ${t.alias} (${t.risk}): ${t.description} Args: ${argsLine(t.schema)}`;
    });
    return done([...lines, "The tools above are in your tool list from your next step. Destructive and sensitive ones need an approval."].join("\n"), `find_tools ${clip(query, 60)}: ${hits.length} found`);
  }

  async function connectorTool(name: string, rawArgs: unknown, call: Call): Promise<Outcome> {
    const full = dotted(name)!;
    const tools = await connectorTools(call.role);
    const t = tools.find((x) => x.name === full);
    if (!t) return fail(known.has(full) ? `${full} is not available to the ${call.role} role` : `unknown tool ${name}`);
    if (t.money) return fail(`${t.name} places orders or moves funds: use propose_order (the risk review and the owner's trading gate), never a direct call`);
    const props = (t.schema.properties ?? {}) as Record<string, unknown>;
    const schema = (Object.keys(props).length ? t.schema : { type: "object" }) as JsonSchema;
    const v = validateArgs(schema, rawArgs);
    if (!v.ok) return fail(v.error);
    const args = v.value as Args;
    if (t.risk === "destructive" || t.risk === "sensitive") {
      if (!call.approve) return fail(`${t.name} is ${t.risk} and needs an approval, and no approval path is available here`);
      const verdict = await call.approve({ tool: t.name, risk: t.risk, summary: clip(`${t.description} Arguments: ${toJson(redactDeep(args))}`, 400) });
      if (!verdict.approved) return fail(`not approved: ${clip(verdict.answer || "declined", 200)}`);
    }
    markLoaded(call.runId, call.taskId, t.name);
    const r = await deps.connectors!.call(t.name, args, { signal: call.signal });
    if (!r.ok && !call.signal?.aborted) await toolLesson(t, r.output, call);
    return { ok: r.ok, output: r.output, summary: `${t.name} ${r.ok ? "answered" : "failed"}` };
  }

  const money = (v: number) => (Math.abs(v) >= 1 ? v.toFixed(2) : String(Math.round(v * 1e6) / 1e6));
  const signed = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;

  async function tradingTool(name: TradingToolName, rawArgs: unknown, call: Call): Promise<Outcome> {
    const trading = deps.trading;
    if (!trading) return fail("trading is not available in this build");
    if (!call.grants?.includes(name)) return fail(`${name} is not granted to your role in this company`);
    const v = validateArgs(TRADING_SPECS[name].parameters as JsonSchema, rawArgs);
    if (!v.ok) return fail(v.error);
    const a = v.value as Args;
    switch (name) {
      case "get_quote": {
        const q = await trading.quote(s(a.symbol)!, { signal: call.signal, runId: call.runId });
        return done(`${q.symbol} last price ${money(q.price)} (source: ${q.source})`);
      }
      case "propose_order": {
        const o = await trading.propose({
          runId: call.runId,
          agentId: call.agentId,
          symbol: s(a.symbol)!,
          side: s(a.side) as "buy" | "sell",
          qty: n(a.qty)!,
          type: (s(a.type) as "market" | "limit" | undefined) ?? (n(a.limit_price) !== undefined ? "limit" : "market"),
          limitPrice: n(a.limit_price) ?? null,
          // absent: the desk decides (live only in the owner's live mode with a live venue ready)
          live: typeof a.live === "boolean" ? a.live : undefined,
          venue: s(a.venue) ?? null,
          quote: n(a.quote) ?? null,
          reason: s(a.reason)!,
          signal: call.signal,
        });
        const what = `${o.mode} ${o.side} ${o.qty} ${o.symbol} ${o.type}${o.limitPrice !== null ? ` at ${money(o.limitPrice)}` : ""}`;
        return done(`order ${o.id} proposed: ${what}. It waits for the risk manager's review_order${o.mode === "live" ? ", then the owner's trading gate" : ""}.`, `proposed ${what}`);
      }
      case "review_order": {
        const o = await trading.review({ runId: call.runId, agentId: call.agentId, orderId: s(a.order_id) ?? null, verdict: s(a.verdict) as "approve" | "reject", note: s(a.note)!, signal: call.signal });
        const what = `${o.mode} ${o.side} ${o.qty} ${o.symbol}`;
        const result =
          o.status === "filled"
            ? `filled at ${money(o.fillPrice ?? 0)}`
            : o.status === "rejected"
              ? "rejected"
              : o.status === "approved"
                ? o.mode === "paper"
                  ? `open at the limit ${money(o.limitPrice ?? 0)} until the price crosses it`
                  : "sent to the venue, not filled yet"
                : o.status === "proposed"
                  ? "risk approved; it waits for the owner's decision and trading limits"
                  : o.status;
        return { ok: o.status !== "failed", output: `order ${o.id} (${what}): ${result}`, summary: `review ${what}: ${result}` };
      }
      case "positions": {
        const [positions, pending] = await Promise.all([trading.positions(), trading.pendingReview(call.runId)]);
        const lines = positions.map(
          (p) => `${p.mode} ${p.symbol}: qty ${p.qty} avg ${money(p.avgPrice)} last ${p.lastPrice === null ? "n/a" : money(p.lastPrice)} unrealized ${signed(p.unrealizedUsd)} realized ${signed(p.realizedUsd)}`,
        );
        const totals = positions.reduce((t, p) => ({ u: t.u + p.unrealizedUsd, r: t.r + p.realizedUsd }), { u: 0, r: 0 });
        const out = [
          positions.length ? "positions:" : "no positions yet",
          ...lines,
          ...(positions.length ? [`total unrealized ${signed(totals.u)}, realized ${signed(totals.r)}`] : []),
          ...(pending.length ? ["waiting for a risk review:", ...pending.map((o) => `- ${o.id}: ${o.mode} ${o.side} ${o.qty} ${o.symbol} ${o.type} (${clip(o.reason, 80)})`)] : []),
        ];
        return done(out.join("\n"), `positions: ${positions.length}, ${pending.length} waiting for review`);
      }
    }
  }

  const automationDenied = (e: unknown): Outcome | null =>
    e instanceof ApprovalDeniedError ? fail(`denied by the owner: ${e.message}`) : null;

  async function perform<M extends HandsMethod>(call: Call, method: M, params: HandsParams[M]): Promise<HandsResults[M]> {
    if (!deps.automation) throw new Error("local automation is not available in this mode");
    return deps.automation.perform({ runId: call.runId, agentId: call.agentId, method, params, signal: call.signal });
  }

  async function scan(kind: "deps" | "secrets" | "config", call: Call): Promise<Outcome> {
    const root = await call.workspace();
    const network = kind === "deps" ? await networkAllowed() : false;
    const { scan: result, findings } = await deps.security.scan({ projectId: call.projectId, root, kinds: [kind], runId: call.runId, network, signal: call.signal });
    const counts = Object.entries(result.counts)
      .filter(([, c]) => c > 0)
      .map(([sev, c]) => `${c} ${sev}`)
      .join(", ");
    const lines = findings.slice(0, 20).map((f) => `[${f.severity}] ${f.rule} ${f.file ?? "-"}${f.line ? `:${f.line}` : ""} ${clip(f.title, 120)}`);
    const more = findings.length > 20 ? `\n+${findings.length - 20} more findings in the Security panel` : "";
    const head = `scan ${result.id} (${kind}) ${result.status}: ${findings.length} findings${counts ? ` (${counts})` : ""}${result.error ? `; error: ${result.error}` : ""}${kind === "deps" && !network ? "; OSV lookups skipped (network tools are off)" : ""}`;
    return { ok: result.status !== "failed", output: [head, ...lines].join("\n") + more, summary: head };
  }

  // ----------------------------------------------------------- ui_check
  /** Every UI file under the given paths, through the jailed workspace port (sorted, capped, sizes known). */
  async function uiFiles(root: string, paths: readonly string[]): Promise<{ files: Array<{ path: string; size: number }>; notes: string[] }> {
    const found = new Map<string, number>();
    const notes: string[] = [];
    let large = 0;
    let lists = 0;
    const queue = [...paths];
    const seen = new Set<string>();
    while (queue.length && lists < UI_CHECK_LISTS) {
      const p = queue.shift()!;
      if (seen.has(p)) continue;
      seen.add(p);
      lists++;
      let nodes: FileNodeDTO[];
      try {
        nodes = await deps.workspace.list(root, p, 6);
      } catch (e) {
        notes.push(`skipped ${clip(p, 80)}: ${clip(e instanceof Error ? e.message : String(e), 120)}`);
        continue;
      }
      const walk = (list: readonly FileNodeDTO[]) => {
        for (const node of list) {
          if (node.dir) {
            if (node.children) walk(node.children);
            else if (node.path !== p) queue.push(node.path);
          } else if (isUiFile(node.path)) {
            if (node.size > UI_CHECK_LIMITS.maxFileBytes) large++;
            else found.set(node.path, node.size);
          }
        }
      };
      walk(nodes);
    }
    if (queue.length) notes.push(`${queue.length} deeper folders not checked: pass them in paths`);
    if (large) notes.push(`${large} files over ${UI_CHECK_LIMITS.maxFileBytes / 1024} KB not checked (generated or vendored)`);
    const all = [...found].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([path, size]) => ({ path, size }));
    if (all.length > UI_CHECK_LIMITS.maxFiles) notes.push(`${all.length - UI_CHECK_LIMITS.maxFiles} more UI files not checked: pass narrower paths`);
    return { files: all.slice(0, UI_CHECK_LIMITS.maxFiles), notes };
  }

  /** A whole text file, read in 64 KB line ranges; null for binary files. */
  async function readText(root: string, path: string): Promise<string | null> {
    let text = "";
    let from = 1;
    for (let i = 0; i < UI_CHECK_READS; i++) {
      const r = await deps.workspace.read(root, path, { from });
      if (r.binary) return null;
      text += text && r.content ? `\n${r.content}` : r.content;
      if (!r.truncated) break;
      const got = r.content ? r.content.split("\n").length : 0;
      if (!got) break;
      from += got;
    }
    return text;
  }

  async function uiCheck(a: Args, call: Call): Promise<Outcome> {
    const root = await call.workspace();
    const wanted = Array.isArray(a.paths) ? (a.paths as string[]).map((p) => p.trim()).filter(Boolean) : [];
    const { files, notes } = await uiFiles(root, wanted.length ? wanted : ["."]);
    const texts: UiFile[] = [];
    for (const f of files) {
      if (call.signal?.aborted) break;
      try {
        const text = await readText(root, f.path);
        if (text !== null) texts.push({ path: f.path, text });
      } catch (e) {
        notes.push(`skipped ${clip(f.path, 80)}: ${clip(e instanceof Error ? e.message : String(e), 120)}`);
      }
    }
    return formatUiReport(scanUi(texts), texts.length, notes);
  }

  const handlers: Partial<Record<ToolName, Handler>> = {
    async fs_list(a, call) {
      const root = await call.workspace();
      const nodes = await deps.workspace.list(root, s(a.path) ?? ".", n(a.depth) ?? 2);
      const lines: string[] = [];
      let hidden = 0;
      const walk = (list: typeof nodes, depth: number) => {
        for (const node of list) {
          if (lines.length >= MAX_LIST_LINES) {
            hidden++;
            continue;
          }
          lines.push(`${"  ".repeat(depth)}${node.name}${node.dir ? "/" : ` ${fmtSize(node.size)}`}`);
          if (node.children) walk(node.children, depth + 1);
        }
      };
      walk(nodes, 0);
      if (hidden) lines.push(`+${hidden} more entries; list a subfolder`);
      const where = s(a.path) ?? ".";
      return done(lines.length ? lines.join("\n") : `${where} is empty`, `listed ${where} (${lines.length} entries)`);
    },

    async fs_read(a, call) {
      const root = await call.workspace();
      const path = s(a.path)!;
      const from = n(a.from);
      const to = n(a.to);
      const r = await deps.workspace.read(root, path, { from, to });
      if (r.binary) return done(`${path} is a binary file (${r.size} bytes); not shown`, `${path} is binary`);
      const start = from ?? 1;
      if (r.content === "" && r.totalLines > 0 && start > r.totalLines) return done(`${path} has ${r.totalLines} lines; nothing at line ${start}`);
      const shown = r.content === "" ? 0 : r.content.split("\n").length;
      const end = start + Math.max(shown, 1) - 1;
      const head = r.totalLines === 0 ? `${path} (empty file)` : `${path} lines ${start}-${end} of ${r.totalLines}`;
      const tail = r.truncated ? `\n[truncated at 64 KB: continue with from=${end + 1}]` : "";
      return done(`${head}\n${r.content}${tail}`, `read ${path} ${start}-${end}`);
    },

    async fs_search(a, call) {
      const root = await call.workspace();
      const limit = n(a.limit) ?? 50;
      const hits = await deps.workspace.search(root, s(a.pattern)!, s(a.glob), limit);
      if (!hits.length) return done("no matches", `searched ${clip(s(a.pattern)!, 60)}: no matches`);
      const lines = hits.map((h) => `${h.path}:${h.line}: ${h.text}`);
      if (hits.length >= limit) lines.push(`[limit ${limit} reached; narrow the pattern or glob]`);
      return done(lines.join("\n"), `searched ${clip(s(a.pattern)!, 60)}: ${hits.length} matches`);
    },

    async fs_write(a, call) {
      const root = await call.workspace();
      const path = s(a.path)!;
      const r = await deps.workspace.write(root, path, s(a.content) ?? "");
      return done(`${r.created ? "created" : "updated"} ${path} (${r.bytes} bytes)`);
    },

    async fs_edit(a, call) {
      const root = await call.workspace();
      const path = s(a.path)!;
      const r = await deps.workspace.edit(root, path, s(a.find)!, s(a.replace) ?? "", a.all === true);
      return done(`replaced ${r.replacements} occurrence${r.replacements === 1 ? "" : "s"} in ${path}`);
    },

    async fs_delete(a, call) {
      const root = await call.workspace();
      const path = s(a.path)!;
      const r = await deps.workspace.remove(root, path);
      return done(r.removed ? `deleted ${path}` : `${path} did not exist`);
    },

    async shell_run(a, call) {
      if (shellRefusal) return fail(shellRefusal);
      if (!deps.runner) return fail("shell commands are not available in this mode");
      const root = await call.workspace();
      const cwd = await deps.workspace.resolveInside(root, s(a.cwd) ?? ".");
      const command = s(a.command)!;
      const timeoutMs = Math.min(SHELL_TIMEOUT_MS, (n(a.timeout_s) ?? SHELL_TIMEOUT_MS / 1000) * 1000);
      const res = await deps.runner.exec({
        command,
        cwd,
        timeoutMs,
        maxOutputBytes: SHELL_OUTPUT_CAP,
        network: await networkAllowed(),
        writablePaths: [root],
        // the no-auth engine API is never reachable from a crew command (read live: known once listening)
        denyTcpPorts: enginePorts(ctx.config.allowedHosts),
        signal: call.signal,
      });
      const status = res.timedOut
        ? `timed out after ${Math.round(timeoutMs / 1000)} s (process group killed)`
        : res.killed
          ? "stopped"
          : res.signal
            ? `killed by ${res.signal}`
            : `exit ${res.exitCode}`;
      const parts = [`${status} in ${(res.durationMs / 1000).toFixed(1)}s${res.truncated ? " (output truncated)" : ""}`];
      if (res.stdout) parts.push(`stdout:\n${res.stdout.replace(/\n$/, "")}`);
      if (res.stderr) parts.push(`stderr:\n${res.stderr.replace(/\n$/, "")}`);
      if (!res.stdout && !res.stderr) parts.push("(no output)");
      const ok = res.exitCode === 0 && !res.timedOut && !res.killed;
      return { ok, output: parts.join("\n"), summary: `${status}: ${clip(command, 80)}` };
    },

    async web_fetch(a, call) {
      if (!(await networkAllowed())) return fail("network tools are off; the owner can allow them in Settings");
      const r = await fetchReadable(s(a.url)!, {
        maxBytes: WEB_MAX_BYTES,
        timeoutMs: WEB_TIMEOUT_MS,
        maxChars: n(a.max_chars) ?? 20_000,
        signal: call.signal,
        fetchImpl: opts.fetch,
        lookup: opts.lookup,
      });
      const head = `${r.url} ${r.status} ${r.contentType || "unknown type"}${r.truncated ? " (truncated)" : ""}`;
      return { ok: r.status < 400, output: `${head}\n\n${r.text}`, summary: `fetched ${clip(r.url, 100)} (${r.status})` };
    },

    async recall(a, call) {
      const query = s(a.query)!;
      const limit = n(a.limit) ?? 5;
      const [lessons, skills] = await Promise.all([
        deps.memory.retrieve({ text: query, role: call.role, projectId: call.projectId, limit }),
        deps.memory.findSkills({ text: query, role: call.role, limit: 3 }),
      ]);
      if (call.taskId && lessons.length) await deps.memory.markUsed(lessons.map((l) => l.id), { runId: call.runId, taskId: call.taskId });
      if (!lessons.length && !skills.length) return done("nothing recalled for this query", `recall ${clip(query, 60)}: none`);
      const out: string[] = [];
      if (lessons.length) out.push("lessons:", ...lessons.map((l) => `- ${l.text}`));
      if (skills.length) out.push("skills:", ...skills.map((k) => `- ${k.name}: ${k.description} (${k.steps.length} steps: ${k.steps.map((st) => st.tool).join(", ")})`));
      return done(out.join("\n"), `recalled ${lessons.length} lessons, ${skills.length} skills`);
    },

    async record_lesson(a, call) {
      const tags = Array.isArray(a.tags) ? (a.tags as string[]) : undefined;
      const lesson = await deps.memory.record({ text: redact(s(a.text)!), tags, role: call.role, projectId: call.projectId, runId: call.runId });
      return done(`saved lesson ${lesson.id} (${lesson.status})`);
    },

    async save_skill(a, call) {
      const steps = redactDeep(a.steps as Array<{ tool: string; args: Record<string, unknown>; note?: string }>);
      const skill = await deps.memory.saveSkill({ name: s(a.name)!, description: redact(s(a.description)!), role: call.role, steps });
      return done(`saved skill ${skill.name} (${skill.steps.length} steps)`);
    },

    async generate_image(a, call) {
      const root = await call.workspace();
      const size = s(a.size) as "1024x1024" | "1536x1024" | "1024x1536" | undefined;
      const asset = await deps.assets.generate({ kind: "image", prompt: s(a.prompt)!, size, runId: call.runId, workspaceRoot: root, signal: call.signal });
      const ok = asset.status !== "failed";
      const out = `image ${asset.id} ${asset.status}${asset.url ? ` ${asset.url}` : ""}${asset.error ? `; error: ${asset.error}` : ""}`;
      return { ok, output: out, summary: out };
    },

    async generate_video(a, call) {
      const root = await call.workspace();
      const asset = await deps.assets.generate({ kind: "video", prompt: s(a.prompt)!, durationSec: n(a.duration_s), runId: call.runId, workspaceRoot: root, signal: call.signal });
      const ok = asset.status !== "failed";
      const out = `video ${asset.id} ${asset.status}${asset.error ? `; error: ${asset.error}` : "; it appears in the gallery when done"}`;
      return { ok, output: out, summary: out };
    },

    scan_deps: (_a, call) => scan("deps", call),
    scan_secrets: (_a, call) => scan("secrets", call),
    scan_config: (_a, call) => scan("config", call),

    async screen_capture(a, call) {
      const r = await perform(call, "screen.capture", { maxWidth: n(a.max_width) ?? 1440 });
      return done(`screenshot ${r.width}x${r.height} (scale ${r.scale}); the owner sees it in the live view. Use ui_tree for element frames.`, `screenshot ${r.width}x${r.height}`);
    },

    async ui_tree(a, call) {
      const r = await perform(call, "ax.tree", { bundleId: s(a.bundle_id), depth: n(a.depth) ?? 6, maxNodes: n(a.max_nodes) ?? 200 });
      const lines = renderAx(r.root, MAX_LIST_LINES);
      if (r.truncated) lines.push("[tree truncated: raise max_nodes or target a bundle_id]");
      return done(lines.join("\n"), `read ui tree (${lines.length} nodes)`);
    },

    async pointer(a, call) {
      const action = s(a.action)!;
      const x = n(a.x);
      const y = n(a.y);
      if (action === "scroll") {
        await perform(call, "input.scroll", { dx: n(a.dx) ?? 0, dy: n(a.dy) ?? 0 });
        return done(`scrolled ${n(a.dx) ?? 0},${n(a.dy) ?? 0}`);
      }
      if (x === undefined || y === undefined) return fail(`${action} needs x and y`);
      if (action === "move") await perform(call, "input.move", { x, y });
      else await perform(call, "input.click", { x, y, button: action === "right_click" ? "right" : "left", count: action === "double_click" ? 2 : 1 });
      return done(`${action.replace("_", " ")} at ${Math.round(x)},${Math.round(y)}`);
    },

    async keyboard(a, call) {
      const text = s(a.text);
      const combo = s(a.combo);
      if ((text === undefined) === (combo === undefined)) return fail("give exactly one of text or combo");
      if (combo !== undefined) {
        await perform(call, "input.key", { combo });
        return done(`pressed ${combo}`);
      }
      const r = await perform(call, "input.type", { text: text! });
      return done(`typed ${r.chars} characters`);
    },

    async app_open(a, call) {
      const name = s(a.name);
      const bundleId = s(a.bundle_id);
      if (!name && !bundleId) return fail("give name or bundle_id");
      const r = await perform(call, "app.open", { name, bundleId });
      return done(`opened ${r.bundleId ?? name ?? bundleId}`);
    },
  };

  async function run(tool: string, rawArgs: unknown, call: Call): Promise<Outcome> {
    try {
      if (tool === FIND_TOOLS) {
        const v = validateArgs(FIND_TOOLS_SPEC.parameters as JsonSchema, rawArgs);
        return v.ok ? await findTools(v.value as Args, call) : fail(v.error);
      }
      if (isTradingTool(tool)) return await tradingTool(tool, rawArgs, call);
      if (tool === UI_CHECK) {
        if (!specsFor(call.role).some((sp) => sp.name === UI_CHECK)) return fail(`${UI_CHECK} is not available to the ${call.role} role`);
        const v = validateArgs(UI_CHECK_SPEC.parameters as JsonSchema, rawArgs);
        return v.ok ? await uiCheck(v.value as Args, call) : fail(v.error);
      }
      if (deps.connectors && dotted(tool)) return await connectorTool(tool, rawArgs, call);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    if (!(TOOL_NAMES as readonly string[]).includes(tool)) return fail(`unknown tool ${tool}`);
    const name = tool as ToolName;
    const unavailable = UNAVAILABLE_TOOLS.get(name);
    if (unavailable) return fail(unavailable);
    if (name === "shell_run" && shellRefusal) return fail(shellRefusal);
    if (OPERATOR_TOOLS.has(name) && !deps.automation) return fail("local automation is not available: operator tools need the desktop app");
    if (!specsFor(call.role).some((sp) => sp.name === name)) return fail(`${name} is not available to the ${call.role} role`);
    const v = validateArgs(TOOL_SPECS[name].parameters as JsonSchema, rawArgs);
    if (!v.ok) return fail(v.error);
    const handler = handlers[name];
    if (!handler) return fail(`${name} has no executor`);
    try {
      return await handler(v.value as Args, call);
    } catch (e) {
      return automationDenied(e) ?? fail(e instanceof Error ? e.message : String(e));
    }
  }

  async function verifiedRoot(tc: ToolContext): Promise<string> {
    const real = await deps.projects.root(tc.projectId);
    const given = await realpath(tc.root).catch(() => null);
    if (given !== real) throw new Error("workspace root does not match the project");
    return real;
  }

  const service: ToolsServiceImpl = {
    specsFor,
    isControl: (tool) => CONTROL_TOOLS.has(tool),
    isReadOnly: (tool) => READ_ONLY_TOOLS.has(tool) || tool === FIND_TOOLS || tool === UI_CHECK || tool === "positions" || known.get(tool)?.risk === "read",

    async taskSpecs(input) {
      const out: ToolSpec[] = [];
      if (deps.trading && input.grants?.length) for (const name of TRADING_ORDER) if (input.grants.includes(name)) out.push(TRADING_SPECS[name]);
      const tools = await connectorTools(input.role);
      if (!tools.length) return out;
      out.push(FIND_TOOLS_SPEC);
      for (const name of loaded.get(taskKey(input.runId, input.taskId)) ?? []) {
        const t = tools.find((x) => x.name === name && !x.money);
        if (t) out.push(connectorSpec(t));
      }
      return out;
    },

    async execute(toolCall, tc) {
      const tool = toolCall.name;
      const started = performance.now();
      if (CONTROL_TOOLS.has(tool)) {
        return { output: `error: ${tool} is a control tool handled by the run engine`, ok: false, durationMs: 0, callId: toolCall.id };
      }
      const callId = ctx.clock.id();
      const createdAt = ctx.clock.now();
      let parsed: unknown;
      let parseError: string | null = null;
      const raw = typeof toolCall.arguments === "string" ? toolCall.arguments : "";
      try {
        parsed = raw.trim() === "" ? {} : JSON.parse(raw);
      } catch {
        parseError = "arguments are not valid JSON";
      }
      const safeArgs = parseError ? redact(raw.slice(0, 8000)) : redactDeep(parsed);
      const who = { runId: tc.runId, agentId: tc.agentId, taskId: tc.taskId };
      try {
        await ctx.events.publish({
          type: "tool.call",
          ...who,
          data: { callId, tool, activity: activityOf(tool), argsPreview: clip(typeof safeArgs === "string" ? safeArgs : toJson(safeArgs), 160) },
        });
      } catch (e) {
        log.log("warn", "tool.call publish failed", { error: redact(String(e)) });
      }

      let rootPromise: Promise<string> | null = null;
      const call: Call = { ...tc, workspace: () => (rootPromise ??= verifiedRoot(tc)) };
      const outcome = parseError ? fail(parseError) : await runWithFileOrigin(who, () => run(tool, parsed, call));
      const output = capOutput(redact(outcome.output));
      const durationMs = Math.round(performance.now() - started);

      try {
        await repo.insert({
          id: callId,
          runId: tc.runId,
          agentId: tc.agentId,
          taskId: tc.taskId,
          tool,
          args: toJson(safeArgs),
          output,
          ok: outcome.ok,
          durationMs,
          createdAt,
        });
      } catch (e) {
        log.log("error", "tool_calls insert failed", { tool, error: redact(String(e)) });
      }
      try {
        await ctx.events.publish({ type: "tool.result", ...who, data: { callId, tool, ok: outcome.ok, summary: clip(outcome.summary, 160), durationMs } });
      } catch (e) {
        log.log("warn", "tool.result publish failed", { error: redact(String(e)) });
      }
      return { output, ok: outcome.ok, durationMs, callId };
    },

    detail: (runId, callId) => repo.get(runId, callId),

    async venueNotes(role) {
      if (!deps.trading?.venueNotes) return [];
      try {
        return await deps.trading.venueNotes(role);
      } catch (e) {
        log.log("warn", "venue notes failed", { error: redact(String(e)) });
        return [];
      }
    },

    async connectSimulator(sim) {
      return deps.trading?.connectSimulator ? deps.trading.connectSimulator(sim) : null;
    },

    platformOff: () => platformOff,

    async reviewCheck(tc) {
      if (!specsFor(tc.role).some((sp) => sp.name === UI_CHECK)) return null;
      // a failing read throws: the engine holds the pass until the reviewer runs ui_check itself
      const paths = (await repo.changedPaths(tc.runId)).filter(isUiFile);
      if (!paths.length) return null;
      const r = await service.execute({ id: ctx.clock.id(), name: UI_CHECK, arguments: JSON.stringify({ paths: paths.slice(0, 40) }) }, tc);
      return { ok: r.ok, output: r.output };
    },
  };
  return service;
}
