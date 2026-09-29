// ToolsService: role-filtered specs and execution of every non-control
// tool. Each call: parse and validate args against the spec, check the role
// may use the tool, run it jailed to the project workspace, redact the
// output, persist a tool_calls row and publish tool.call / tool.result.
import {
  activityForTool,
  ROLE_TOOLS,
  TOOL_NAMES,
  type AgentRole,
  type AxNode,
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
import { clip, redact, redactDeep } from "../../lib/redact";
import { toJson } from "../../lib/sql";
import { runWithFileOrigin } from "../workspace";
import { createToolCallsRepo } from "./repo";
import { CONTROL_TOOLS, OPERATOR_TOOLS, READ_ONLY_TOOLS, TOOL_SPECS, UNAVAILABLE_TOOLS } from "./specs";
import { validateArgs, type JsonSchema } from "./validate";
import { fetchReadable, type Lookup } from "./web";

export interface ToolsDeps {
  workspace: WorkspaceService;
  /** null keeps shell_run out of every spec (for example server mode with the shell off) */
  runner: Runner | null;
  memory: MemoryService;
  assets: AssetsService;
  security: SecurityService;
  /** null outside local mode: operator tools are omitted and refused */
  automation: AutomationService | null;
  settings: SettingsService;
  projects: ProjectsService;
}

export interface ToolsOptions {
  /** injectable for tests; defaults to global fetch */
  fetch?: typeof fetch;
  /** injectable DNS lookup for the SSRF guard */
  lookup?: Lookup;
}

/** ToolsService plus the persisted call detail the runs module serves */
export interface ToolsServiceImpl extends ToolsService {
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult & { callId: string }>;
  detail(runId: string, callId: string): Promise<ToolCallDetail | null>;
}

export const SHELL_TIMEOUT_MS = 120_000;
export const SHELL_OUTPUT_CAP = 200 * 1024;
export const WEB_TIMEOUT_MS = 20_000;
export const WEB_MAX_BYTES = 2 * 1024 * 1024;
/** hard cap on what one tool result may carry (the context module truncates further) */
export const MAX_OUTPUT_CHARS = 256_000;
const MAX_LIST_LINES = 400;

type Args = Record<string, unknown>;
interface Outcome {
  ok: boolean;
  output: string;
  summary: string;
}
interface Call extends ToolContext {
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

export function createToolsService(ctx: ModuleContext, deps: ToolsDeps, opts: ToolsOptions = {}): ToolsServiceImpl {
  const repo = createToolCallsRepo(ctx.db);
  const log = ctx.logger.child({ module: "tools" });

  const offered = (name: ToolName): boolean => {
    if (UNAVAILABLE_TOOLS.has(name)) return false;
    if (OPERATOR_TOOLS.has(name) && !deps.automation) return false;
    if (name === "shell_run" && !deps.runner) return false;
    return true;
  };

  // stable arrays per role keep the tools block byte-identical for prompt caching
  const byRole = new Map<AgentRole, ToolSpec[]>();
  const specsFor = (role: AgentRole): ToolSpec[] => {
    let specs = byRole.get(role);
    if (!specs) {
      specs = (ROLE_TOOLS[role] ?? []).filter(offered).map((name) => TOOL_SPECS[name]);
      byRole.set(role, specs);
    }
    return specs;
  };

  const networkAllowed = async () => (await deps.settings.get()).allowNetworkTools === true;

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
    if (!(TOOL_NAMES as readonly string[]).includes(tool)) return fail(`unknown tool ${tool}`);
    const name = tool as ToolName;
    const unavailable = UNAVAILABLE_TOOLS.get(name);
    if (unavailable) return fail(unavailable);
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
    isReadOnly: (tool) => READ_ONLY_TOOLS.has(tool),

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
          data: { callId, tool, activity: activityForTool(tool), argsPreview: clip(typeof safeArgs === "string" ? safeArgs : toJson(safeArgs), 160) },
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
  };
  return service;
}
