// ConnectorsService: the owner's MCP servers and HTTP APIs, their tools, and
// the calls into them. Secrets go to the vault ("connector:<id>") and the
// redactor, never back out. MCP stdio servers are local mode only and run as
// long-lived children (spawned on first use, restarted at most restartLimit
// times per window, killed by the kill switch); streamable HTTP MCP servers
// and HTTP APIs pass the providers' SSRF guard (server mode: https and public
// addresses only). A bad remote never fails a request with a 5xx: the
// connector is saved with status error and the reason.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRole, ConnectorDTO, CreateConnectorBody, UpdateConnectorBody } from "@mengai/shared";
import { assertSafeUrl, UnsafeUrlError } from "../../core/adapters/llm-openai";
import type { ModuleContext } from "../../core/module";
import { conflict, forbidden, HttpError, notFound } from "../../lib/http";
import { clip, keyHint, redact, registerSecret } from "../../lib/redact";
import { callOperation, fetchOpenApi, genericTools, parseOpenApi, toolsFromOpenApi, type ImportedTool } from "./http";
import { HttpChannel, mcpCallTool, mcpInitialize, mcpListTools, StdioChannel, type RpcChannel } from "./mcp";
import type { ConnectorCallResult, ConnectorsService, ConnectorToolDef, LookupFn, Spawner } from "./ports";
import { createConnectorsRepo, type ConnectorRow, type StoredTool } from "./repo";
import { classify, LABEL_RE, localName, namespaced, toolAlias, toolName, uniqueNames } from "./risk";
import { argsSchema } from "./schema";
import { bunSpawner, CommandError, parseCommand, scrubbedEnv, secretEnv, secretValues } from "./stdio";

export interface ConnectorsOptions {
  spawn?: Spawner;
  fetch?: typeof fetch;
  lookup?: LookupFn;
  /** initialize and tools/list, ms (default 20 s) */
  connectTimeoutMs?: number;
  /** one tool call, ms (default 60 s) */
  callTimeoutMs?: number;
  /** stdio restarts allowed per window (default 3 in 10 minutes) */
  restartLimit?: number;
  restartWindowMs?: number;
}

export const CONNECTOR_LIMITS = {
  connectTimeoutMs: 20_000,
  callTimeoutMs: 60_000,
  restartLimit: 3,
  restartWindowMs: 10 * 60_000,
  outputChars: 64_000,
  httpMaxBytes: 1024 * 1024,
  errorChars: 300,
  guardTtlMs: 60_000,
} as const;

interface Session {
  channel: RpcChannel;
  kill(): void;
  pid: number | null;
}

const errText = (e: unknown) => clip(redact(e instanceof Error ? e.message : String(e)), CONNECTOR_LIMITS.errorChars);

export function createConnectorsService(ctx: ModuleContext, opts: ConnectorsOptions = {}): ConnectorsService {
  const repo = createConnectorsRepo(ctx.db);
  const log = ctx.logger.child({ module: "connectors" });
  const spawn = opts.spawn ?? bunSpawner;
  const limits = {
    connect: opts.connectTimeoutMs ?? CONNECTOR_LIMITS.connectTimeoutMs,
    call: opts.callTimeoutMs ?? CONNECTOR_LIMITS.callTimeoutMs,
    restarts: opts.restartLimit ?? CONNECTOR_LIMITS.restartLimit,
    window: opts.restartWindowMs ?? CONNECTOR_LIMITS.restartWindowMs,
  };
  const sessions = new Map<string, Session>();
  const starting = new Map<string, Promise<Session>>();
  /** spawn times per connector, for the restart limit */
  const spawns = new Map<string, number[]>();
  /** stopped by the kill switch: stays down until the owner tests the connector */
  const halted = new Set<string>();
  let rows: ConnectorRow[] | null = null;
  let closed = false;

  // ------------------------------------------------------------- guard
  const passed = new Map<string, number>();
  async function guard(url: string): Promise<void> {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new UnsafeUrlError("the URL is not valid");
    }
    const until = passed.get(origin);
    if (until && until > Date.now()) return;
    await assertSafeUrl(url, { mode: ctx.config.mode, lookup: opts.lookup });
    passed.set(origin, Date.now() + CONNECTOR_LIMITS.guardTtlMs);
  }

  async function all(): Promise<ConnectorRow[]> {
    if (!rows) rows = await repo.list();
    return rows;
  }
  const invalidate = () => {
    rows = null;
  };

  function toDto(r: ConnectorRow): ConnectorDTO {
    return {
      id: r.id,
      kind: r.kind,
      label: r.label,
      target: r.kind === "mcp_stdio" ? redact(r.target) : r.target,
      hasSecret: !!r.secretRef,
      keyHint: r.keyHint,
      status: r.status,
      error: r.error,
      tools: r.tools.map((t) => ({ name: t.name, description: t.description, risk: t.risk })),
      roles: r.roles,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async function publish(r: ConnectorRow): Promise<void> {
    try {
      await ctx.events.publish({ type: "connector.status", runId: null, data: { connectorId: r.id, status: r.status, error: r.error } });
    } catch (e) {
      log.log("warn", "connector.status publish failed", { error: errText(e) });
    }
  }

  async function secretOf(r: ConnectorRow): Promise<string | null> {
    return r.secretRef ? ctx.vault.get(r.secretRef) : null;
  }

  function learn(secret: string | null | undefined, kind: ConnectorRow["kind"]): void {
    if (!secret) return;
    registerSecret(secret);
    if (kind === "mcp_stdio") for (const v of secretValues(secret)) registerSecret(v);
  }

  // ---------------------------------------------------------- sessions
  function drop(id: string): void {
    const s = sessions.get(id);
    sessions.delete(id);
    if (s) {
      void s.channel.close().catch(() => undefined);
      s.kill();
    }
  }

  async function open(r: ConnectorRow): Promise<Session> {
    if (r.kind === "mcp_stdio") {
      if (ctx.config.mode !== "local") throw new Error("MCP stdio servers run in the Mac app only");
      if (halted.has(r.id)) throw new Error("stopped by the kill switch; test the connector to start it again");
      const now = Date.now();
      const recent = (spawns.get(r.id) ?? []).filter((t) => now - t < limits.window);
      if (recent.length > limits.restarts) throw new Error(`the MCP server restarted ${limits.restarts} times in ${Math.round(limits.window / 60_000)} minutes; test the connector to try again`);
      recent.push(now);
      spawns.set(r.id, recent);
      const argv = parseCommand(r.target);
      const cwd = join(ctx.config.dataDir, "connectors", r.id);
      await mkdir(cwd, { recursive: true, mode: 0o700 });
      const env = scrubbedEnv({ tmpdir: cwd, extra: secretEnv(await secretOf(r)) });
      const proc = spawn(argv, { env, cwd });
      const channel = new StdioChannel(proc);
      const session: Session = { channel, kill: () => proc.kill(), pid: proc.pid };
      void proc.exited.then(() => {
        if (sessions.get(r.id) === session) sessions.delete(r.id);
      });
      try {
        await mcpInitialize(channel, limits.connect, ctx.config.version);
      } catch (e) {
        proc.kill();
        throw e;
      }
      return session;
    }
    await guard(r.target);
    const secret = await secretOf(r);
    const headers: Record<string, string> = secret ? { [(r.authHeader ?? "authorization").toLowerCase()]: secret } : {};
    const channel = new HttpChannel({ url: r.target, headers, guard, fetch: opts.fetch });
    await mcpInitialize(channel, limits.connect, ctx.config.version);
    return { channel, kill: () => undefined, pid: null };
  }

  async function sessionFor(r: ConnectorRow): Promise<Session> {
    const live = sessions.get(r.id);
    if (live && !live.channel.closed) return live;
    if (live) sessions.delete(r.id);
    const pending = starting.get(r.id);
    if (pending) return pending;
    const p = open(r)
      .then((s) => {
        if (closed) {
          s.kill();
          throw new Error("shutting down");
        }
        sessions.set(r.id, s);
        return s;
      })
      .finally(() => starting.delete(r.id));
    starting.set(r.id, p);
    return p;
  }

  // --------------------------------------------------------- discovery
  function stored(label: string, imported: ImportedTool[]): StoredTool[] {
    return imported.map((t) => ({ name: toolName(label, t.local), local: t.local, remote: t.local, description: t.description, risk: t.risk, money: t.money, schema: t.schema, http: t.http }));
  }

  async function discover(r: ConnectorRow): Promise<StoredTool[]> {
    if (r.kind === "http_api") {
      if (!r.openapi) {
        // reachability: any HTTP answer counts, a network error does not
        await guard(r.target);
        const res = await (opts.fetch ?? fetch)(r.target, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(limits.connect) });
        await res.body?.cancel();
        return stored(r.label, genericTools());
      }
      const doc = r.openapi.trim().startsWith("{")
        ? parseOpenApi(r.openapi)
        : await fetchOpenApi(r.openapi, { guard, fetch: opts.fetch, timeoutMs: limits.connect });
      return stored(r.label, toolsFromOpenApi(doc));
    }
    drop(r.id);
    const s = await sessionFor(r);
    const tools = await mcpListTools(s.channel, limits.connect);
    const locals = uniqueNames(tools.map((t) => localName(t.name)));
    return tools.map((t, i) => {
      const c = classify(t.name, t.annotations);
      const description = t.description.replace(/\s+/g, " ").trim();
      return {
        name: toolName(r.label, locals[i]!),
        local: locals[i]!,
        remote: t.name,
        description: description.length > 200 ? `${description.slice(0, 197)}...` : description || t.name,
        risk: c.risk,
        money: c.money,
        schema: argsSchema(t.inputSchema),
      };
    });
  }

  /** Connects, refreshes the tools and saves the status. Never throws for a remote failure. */
  async function connect(r: ConnectorRow): Promise<ConnectorRow> {
    const next: ConnectorRow = { ...r, updatedAt: ctx.clock.now() };
    if (!r.enabled) {
      drop(r.id);
      next.status = "disabled";
      next.error = null;
    } else {
      try {
        next.tools = await discover(r);
        next.status = "connected";
        next.error = null;
      } catch (e) {
        next.status = "error";
        next.error = errText(e);
        if (r.kind !== "http_api") drop(r.id);
      }
    }
    await repo.save(next);
    invalidate();
    await publish(next);
    return next;
  }

  async function requireRow(id: string): Promise<ConnectorRow> {
    const r = await repo.get(id);
    if (!r) throw notFound("connector");
    return r;
  }

  async function checkTarget(kind: ConnectorRow["kind"], target: string): Promise<string> {
    const t = target.trim();
    if (kind === "mcp_stdio") {
      try {
        parseCommand(t);
      } catch (e) {
        throw new HttpError(422, "invalid_command", e instanceof Error ? e.message : String(e));
      }
      return t;
    }
    try {
      const url = await assertSafeUrl(t, { mode: ctx.config.mode, lookup: opts.lookup });
      return url.toString();
    } catch (e) {
      if (e instanceof UnsafeUrlError) throw new HttpError(422, "unsafe_url", e.message);
      throw e;
    }
  }

  function checkSecret(kind: ConnectorRow["kind"], secret: string): void {
    if (kind !== "mcp_stdio") {
      if (/[\r\n]/.test(secret)) throw new HttpError(422, "invalid_secret", "the auth header value must be one line");
      return;
    }
    try {
      secretEnv(secret);
    } catch (e) {
      throw new HttpError(422, "invalid_secret", e instanceof CommandError ? e.message : "the secret is not usable");
    }
  }

  async function findTool(name: string): Promise<{ row: ConnectorRow; tool: StoredTool } | null> {
    const full = namespaced(name);
    if (!full) return null;
    const label = full.slice(0, full.indexOf("."));
    const row = (await all()).find((r) => r.label === label);
    const tool = row?.tools.find((t) => t.name === full);
    return row && tool ? { row, tool } : null;
  }

  const service: ConnectorsService = {
    async list() {
      return (await all()).map(toDto);
    },

    async create(body: CreateConnectorBody) {
      if (body.kind === "mcp_stdio" && ctx.config.mode !== "local") throw forbidden("MCP stdio servers run in the Mac app only; use an MCP HTTP URL on the server");
      const label = body.label.trim().toLowerCase();
      if (!LABEL_RE.test(label)) throw new HttpError(422, "invalid_body", "label: lowercase letters, digits, - and single _ (at most 24)");
      if (await repo.byLabel(label)) throw conflict(`a connector named ${label} already exists`);
      const target = await checkTarget(body.kind, body.target);
      if (body.secret) checkSecret(body.kind, body.secret);
      if (body.openapi !== undefined && body.kind !== "http_api") throw new HttpError(422, "invalid_body", "openapi: only http_api connectors take an OpenAPI document");
      if (body.openapi && !body.openapi.trim().startsWith("{")) {
        try {
          await assertSafeUrl(body.openapi.trim(), { mode: ctx.config.mode, lookup: opts.lookup });
        } catch (e) {
          if (e instanceof UnsafeUrlError) throw new HttpError(422, "unsafe_url", `openapi: ${e.message}`);
          throw e;
        }
      }
      const id = ctx.clock.id();
      const now = ctx.clock.now();
      const secretRef = body.secret ? `connector:${id}` : null;
      if (body.secret && secretRef) {
        learn(body.secret, body.kind);
        await ctx.vault.set(secretRef, body.secret);
      }
      const row: ConnectorRow = {
        id,
        kind: body.kind,
        label,
        target,
        authHeader: body.kind === "mcp_stdio" ? null : (body.authHeader ?? null),
        secretRef,
        keyHint: body.secret ? keyHint(body.secret) || null : null,
        openapi: body.openapi?.trim() || null,
        enabled: true,
        status: "error",
        error: "not connected yet",
        tools: [],
        roles: body.roles ?? null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await repo.insert(row);
      } catch (e) {
        if (secretRef) await ctx.vault.delete(secretRef).catch(() => undefined);
        if (await repo.byLabel(label)) throw conflict(`a connector named ${label} already exists`);
        throw e;
      }
      invalidate();
      return toDto(await connect(row));
    },

    async update(id: string, body: UpdateConnectorBody) {
      const r = await requireRow(id);
      const next: ConnectorRow = { ...r };
      let reconnect = false;
      if (body.label !== undefined) {
        const label = body.label.trim().toLowerCase();
        if (!LABEL_RE.test(label)) throw new HttpError(422, "invalid_body", "label: lowercase letters, digits, - and single _ (at most 24)");
        if (label !== r.label) {
          const other = await repo.byLabel(label);
          if (other && other.id !== id) throw conflict(`a connector named ${label} already exists`);
          next.label = label;
          next.tools = r.tools.map((t) => ({ ...t, name: toolName(label, t.local) }));
        }
      }
      if (body.target !== undefined && body.target.trim() !== r.target) {
        next.target = await checkTarget(r.kind, body.target);
        reconnect = true;
      }
      if (body.authHeader !== undefined && r.kind !== "mcp_stdio") {
        next.authHeader = body.authHeader || null;
        reconnect = true;
      }
      if (body.openapi !== undefined) {
        if (r.kind !== "http_api") throw new HttpError(422, "invalid_body", "openapi: only http_api connectors take an OpenAPI document");
        next.openapi = body.openapi.trim() || null;
        reconnect = true;
      }
      if (body.roles !== undefined) next.roles = body.roles ?? null;
      if (body.secret !== undefined) {
        const ref = `connector:${id}`;
        if (body.secret) {
          checkSecret(r.kind, body.secret);
          learn(body.secret, r.kind);
          await ctx.vault.set(ref, body.secret);
          next.secretRef = ref;
          next.keyHint = keyHint(body.secret) || null;
        } else {
          if (r.secretRef) await ctx.vault.delete(r.secretRef).catch(() => undefined);
          next.secretRef = null;
          next.keyHint = null;
        }
        reconnect = true;
      }
      if (body.enabled !== undefined && body.enabled !== r.enabled) {
        next.enabled = body.enabled;
        reconnect = true;
      }
      next.updatedAt = ctx.clock.now();
      if (reconnect) {
        drop(id);
        halted.delete(id);
        spawns.delete(id);
        return toDto(await connect(next));
      }
      await repo.save(next);
      invalidate();
      return toDto(next);
    },

    async remove(id: string) {
      const r = await requireRow(id);
      drop(id);
      halted.delete(id);
      spawns.delete(id);
      if (r.secretRef) await ctx.vault.delete(r.secretRef).catch(() => undefined);
      await repo.remove(id);
      invalidate();
      await publish({ ...r, status: "disabled", error: null });
    },

    async test(id: string) {
      const r = await requireRow(id);
      halted.delete(id);
      spawns.delete(id);
      drop(id);
      return toDto(await connect(r));
    },

    async tools(scope: { role?: AgentRole }): Promise<ConnectorToolDef[]> {
      const out: ConnectorToolDef[] = [];
      for (const r of await all()) {
        if (!r.enabled || r.status !== "connected") continue;
        if (scope.role && r.roles && !r.roles.includes(scope.role)) continue;
        for (const t of r.tools) {
          out.push({
            name: t.name,
            description: t.description,
            risk: t.risk,
            connectorId: r.id,
            connectorLabel: r.label,
            remote: t.remote,
            alias: toolAlias(r.label, t.local),
            money: t.money,
            schema: t.schema,
            ...(t.http ? { http: t.http } : {}),
          });
        }
      }
      return out;
    },

    async call(name, args, callOpts = {}): Promise<ConnectorCallResult> {
      const started = performance.now();
      const done = (ok: boolean, output: string): ConnectorCallResult => {
        const text = redact(output);
        const max = CONNECTOR_LIMITS.outputChars;
        return { ok, output: text.length > max ? `${text.slice(0, max)}\n[output cut at ${max} characters]` : text, durationMs: Math.round(performance.now() - started) };
      };
      const hit = await findTool(name);
      if (!hit) return done(false, `unknown connector tool ${name}`);
      const { row, tool } = hit;
      if (!row.enabled) return done(false, `the ${row.label} connector is disabled`);
      const timeoutMs = Math.min(callOpts.timeoutMs ?? limits.call, limits.call);
      try {
        if (row.kind === "http_api") {
          if (!tool.http) return done(false, `${tool.name} has no HTTP binding`);
          const secret = await secretOf(row);
          const r = await callOperation({
            base: row.target,
            op: tool.http,
            args,
            auth: secret ? { header: row.authHeader ?? "authorization", value: secret } : null,
            guard,
            fetch: opts.fetch,
            timeoutMs,
            maxBytes: CONNECTOR_LIMITS.httpMaxBytes,
            signal: callOpts.signal,
          });
          return done(r.ok, r.output);
        }
        const s = await sessionFor(row);
        const r = await mcpCallTool(s.channel, tool.remote, args, { timeoutMs, signal: callOpts.signal });
        return done(r.ok, r.text);
      } catch (e) {
        if (row.kind !== "http_api" && sessions.get(row.id)?.channel.closed) sessions.delete(row.id);
        return done(false, `${tool.name} failed: ${errText(e)}`);
      }
    },

    async warm() {
      for (const r of await all()) {
        if (!r.secretRef) continue;
        try {
          learn(await ctx.vault.get(r.secretRef), r.kind);
        } catch (e) {
          log.log("warn", "connector secret warm-up failed", { connector: r.label, error: errText(e) });
        }
      }
    },

    async killAll() {
      let n = 0;
      for (const [id, s] of [...sessions]) {
        if (s.pid !== null) {
          n++;
          halted.add(id);
        }
        drop(id);
      }
      for (const r of await all()) {
        if (r.kind !== "mcp_stdio" || !r.enabled) continue;
        halted.add(r.id);
        if (r.status === "connected") {
          const next: ConnectorRow = { ...r, status: "error", error: "stopped by the kill switch; test it to start again", updatedAt: ctx.clock.now() };
          await repo.save(next).catch(() => undefined);
          await publish(next);
        }
      }
      invalidate();
      return n;
    },

    async close() {
      closed = true;
      for (const id of [...sessions.keys()]) drop(id);
    },
  };
  return service;
}
