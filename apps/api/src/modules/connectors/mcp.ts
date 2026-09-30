// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A small MCP client: JSON-RPC 2.0 over stdio (newline-delimited JSON on the
// server's stdin and stdout) or streamable HTTP (POST per message, answered
// with JSON or an SSE stream, Mcp-Session-Id kept across calls). Only what
// the crew needs: initialize, tools/list and tools/call. Every request has a
// timeout, every body and line is size capped, and a server request the
// client does not serve gets a JSON-RPC "method not found" (ping gets {}).
import type { SpawnedProcess } from "./ports";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_LINE = 4 * 1024 * 1024;
const MAX_HTTP_BODY = 4 * 1024 * 1024;
const STDERR_TAIL = 2000;
const MAX_TOOLS = 200;

export class McpError extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "closed" | "protocol" | "remote" | "http" = "protocol",
  ) {
    super(message);
    this.name = "McpError";
  }
}

export interface RpcChannel {
  request(method: string, params: unknown, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
  readonly closed: boolean;
}

type Msg = { jsonrpc?: string; id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } };

interface Pending {
  resolve(v: unknown): void;
  reject(e: Error): void;
}

function remoteError(e: Msg["error"]): McpError {
  const msg = typeof e?.message === "string" ? e.message : "unknown error";
  return new McpError(`the MCP server answered an error${typeof e?.code === "number" ? ` ${e.code}` : ""}: ${msg.slice(0, 300)}`, "remote");
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, signal: AbortSignal | undefined, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(new McpError("aborted", "closed"));
    const timer = setTimeout(() => {
      onTimeout();
      reject(new McpError(`the MCP server did not answer within ${Math.round(timeoutMs / 1000)} s`, "timeout"));
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      onTimeout();
      reject(new McpError("aborted", "closed"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

// ------------------------------------------------------------------ stdio
export class StdioChannel implements RpcChannel {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stderrTail = "";
  private isClosed = false;
  private exitCode: number | null | undefined = undefined;

  constructor(private readonly proc: SpawnedProcess) {
    void this.readStdout();
    void this.readStderr();
    void proc.exited.then((code) => {
      this.exitCode = code;
      this.fail(new McpError(`the MCP server exited${code === null ? "" : ` with code ${code}`}${this.stderrTail ? `: ${this.stderrTail.trim().slice(-300)}` : ""}`, "closed"));
    });
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** the tail of the server's stderr, for error messages */
  get stderr(): string {
    return this.stderrTail;
  }

  private fail(e: Error): void {
    this.isClosed = true;
    for (const [id, p] of this.pending) {
      p.reject(e);
      this.pending.delete(id);
    }
  }

  private async readStdout(): Promise<void> {
    const decoder = new TextDecoder();
    const reader = this.proc.stdout.getReader();
    let buf = "";
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) this.onLine(line);
        }
        if (buf.length > MAX_LINE) {
          this.fail(new McpError("the MCP server sent a message over 4 MB", "protocol"));
          this.proc.kill();
          await reader.cancel().catch(() => undefined);
          return;
        }
      }
    } catch {
      // the pipe closed; exited reports why
    }
  }

  private async readStderr(): Promise<void> {
    const decoder = new TextDecoder();
    const reader = this.proc.stderr.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.stderrTail = (this.stderrTail + decoder.decode(value, { stream: true })).slice(-STDERR_TAIL);
      }
    } catch {
      // ignore
    }
  }

  private onLine(line: string): void {
    let msg: Msg;
    try {
      msg = JSON.parse(line) as Msg;
    } catch {
      return; // servers may log non-JSON lines by mistake; skip them
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.method !== undefined) {
      // a server request (has an id) or a notification (no id)
      if (msg.id !== undefined && msg.id !== null) {
        const reply = msg.method === "ping" ? { jsonrpc: "2.0", id: msg.id, result: {} } : { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not supported by this client" } };
        this.write(reply);
      }
      return;
    }
    if (typeof msg.id !== "number") return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(remoteError(msg.error));
    else p.resolve(msg.result);
  }

  private write(msg: unknown): void {
    if (this.isClosed) throw new McpError("the MCP server is not running", "closed");
    this.proc.write(`${JSON.stringify(msg)}\n`);
  }

  request(method: string, params: unknown, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<unknown> {
    if (this.isClosed) return Promise.reject(new McpError(`the MCP server is not running${this.exitCode !== undefined ? " (it exited)" : ""}`, "closed"));
    const id = this.nextId++;
    const p = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    try {
      this.write({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    } catch (e) {
      this.pending.delete(id);
      return Promise.reject(e);
    }
    return withTimeout(p, opts.timeoutMs, opts.signal, () => {
      this.pending.delete(id);
      try {
        this.write({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "timeout" } });
      } catch {
        // closed
      }
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  async close(): Promise<void> {
    if (!this.isClosed) this.fail(new McpError("the MCP connection closed", "closed"));
    this.proc.kill();
  }
}

// ------------------------------------------------------------------- http
export interface HttpChannelOptions {
  url: string;
  headers: Record<string, string>;
  /** SSRF guard, run before every request */
  guard: (url: string) => Promise<void>;
  fetch?: typeof fetch;
}

async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new McpError("the MCP server sent a response over 4 MB", "protocol");
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

/** Reads SSE events until one carries the response to `id`. */
async function readSse(res: Response, id: number): Promise<Msg | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let buf = "";
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTTP_BODY) throw new McpError("the MCP server sent a stream over 4 MB", "protocol");
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, end);
        buf = buf.slice(end + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        let msg: Msg;
        try {
          msg = JSON.parse(data) as Msg;
        } catch {
          continue;
        }
        if (msg && msg.method === undefined && msg.id === id) return msg;
      }
    }
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export class HttpChannel implements RpcChannel {
  private nextId = 1;
  private session: string | null = null;
  private protocol: string | null = null;
  private isClosed = false;
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: HttpChannelOptions) {
    this.doFetch = opts.fetch ?? fetch;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** the protocol version the server agreed to; sent as MCP-Protocol-Version from then on */
  setProtocol(version: string | null): void {
    this.protocol = version;
  }

  private headers(): Record<string, string> {
    return {
      ...this.opts.headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(this.session ? { "mcp-session-id": this.session } : {}),
      ...(this.protocol ? { "mcp-protocol-version": this.protocol } : {}),
    };
  }

  private async post(body: unknown, signal: AbortSignal): Promise<Response> {
    await this.opts.guard(this.opts.url);
    const res = await this.doFetch(this.opts.url, { method: "POST", headers: this.headers(), body: JSON.stringify(body), redirect: "manual", signal });
    const sid = res.headers.get("mcp-session-id");
    if (sid && /^[\x21-\x7e]{1,256}$/.test(sid)) this.session = sid;
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      throw new McpError(`the MCP server redirected (${res.status}); redirects are not followed`, "http");
    }
    return res;
  }

  async request(method: string, params: unknown, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<unknown> {
    if (this.isClosed) throw new McpError("the MCP connection is closed", "closed");
    const id = this.nextId++;
    const ctl = new AbortController();
    const work = (async () => {
      const res = await this.post({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }, ctl.signal);
      if (!res.ok) {
        const text = await readCapped(res, 4000).catch(() => "");
        if (res.status === 404 && this.session) this.session = null;
        throw new McpError(`the MCP server answered HTTP ${res.status}${text ? `: ${text.replace(/\s+/g, " ").slice(0, 200)}` : ""}`, "http");
      }
      const type = res.headers.get("content-type") ?? "";
      let msg: Msg | null = null;
      if (type.includes("text/event-stream")) msg = await readSse(res, id);
      else {
        const text = await readCapped(res, MAX_HTTP_BODY);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new McpError("the MCP server answered something that is not JSON", "protocol");
        }
        const list = Array.isArray(parsed) ? parsed : [parsed];
        msg = (list.find((m) => m && typeof m === "object" && (m as Msg).id === id) as Msg | undefined) ?? null;
      }
      if (!msg) throw new McpError("the MCP server closed the stream without an answer", "protocol");
      if (msg.error) throw remoteError(msg.error);
      return msg.result;
    })();
    return withTimeout(work, opts.timeoutMs, opts.signal, () => ctl.abort());
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    try {
      const res = await this.post({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }, ctl.signal);
      await res.body?.cancel();
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    if (!this.session) return;
    try {
      await this.opts.guard(this.opts.url);
      const res = await this.doFetch(this.opts.url, { method: "DELETE", headers: this.headers(), redirect: "manual", signal: AbortSignal.timeout(5000) });
      await res.body?.cancel();
    } catch {
      // best effort
    }
  }
}

// ----------------------------------------------------------------- client
export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/** initialize, then notifications/initialized. Returns the server name and the agreed protocol version. */
export async function mcpInitialize(ch: RpcChannel, timeoutMs: number, version: string): Promise<{ server: string; protocolVersion: string }> {
  const r = (await ch.request(
    "initialize",
    { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "mengai", version } },
    { timeoutMs },
  )) as { protocolVersion?: unknown; serverInfo?: { name?: unknown } } | null;
  if (!r || typeof r !== "object") throw new McpError("the MCP server gave no initialize result");
  const protocolVersion = typeof r.protocolVersion === "string" ? r.protocolVersion : MCP_PROTOCOL_VERSION;
  if (ch instanceof HttpChannel) ch.setProtocol(protocolVersion);
  await ch.notify("notifications/initialized");
  return { server: typeof r.serverInfo?.name === "string" ? r.serverInfo.name.slice(0, 80) : "mcp server", protocolVersion };
}

/** tools/list with cursor paging, at most 200 tools. */
export async function mcpListTools(ch: RpcChannel, timeoutMs: number): Promise<McpToolInfo[]> {
  const out: McpToolInfo[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20 && out.length < MAX_TOOLS; page++) {
    const r = (await ch.request("tools/list", cursor ? { cursor } : {}, { timeoutMs })) as { tools?: unknown; nextCursor?: unknown } | null;
    const tools = Array.isArray(r?.tools) ? r!.tools : [];
    for (const t of tools) {
      if (!t || typeof t !== "object") continue;
      const o = t as Record<string, unknown>;
      if (typeof o.name !== "string" || !o.name) continue;
      const ann = (o.annotations && typeof o.annotations === "object" ? o.annotations : {}) as Record<string, unknown>;
      out.push({
        name: o.name,
        description: typeof o.description === "string" ? o.description : "",
        inputSchema: o.inputSchema ?? { type: "object" },
        annotations: { readOnlyHint: ann.readOnlyHint === true ? true : undefined, destructiveHint: ann.destructiveHint === true ? true : undefined },
      });
      if (out.length >= MAX_TOOLS) break;
    }
    cursor = typeof r?.nextCursor === "string" && r.nextCursor ? r.nextCursor : undefined;
    if (!cursor) break;
  }
  return out;
}

/** tools/call as text: text parts joined, other parts summarized; isError maps to ok false. */
export async function mcpCallTool(ch: RpcChannel, name: string, args: Record<string, unknown>, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<{ ok: boolean; text: string }> {
  const r = (await ch.request("tools/call", { name, arguments: args }, opts)) as { content?: unknown; isError?: unknown; structuredContent?: unknown } | null;
  const parts: string[] = [];
  for (const c of Array.isArray(r?.content) ? r!.content : []) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (o.type === "text" && typeof o.text === "string") parts.push(o.text);
    else if (o.type === "image" || o.type === "audio") parts.push(`[${o.type} ${typeof o.mimeType === "string" ? o.mimeType : ""} not shown]`);
    else if (o.type === "resource" && o.resource && typeof o.resource === "object") {
      const res = o.resource as Record<string, unknown>;
      parts.push(typeof res.text === "string" ? res.text : `[resource ${String(res.uri ?? "")}]`);
    } else if (o.type === "resource_link") parts.push(`[resource ${String(o.uri ?? "")}]`);
  }
  if (!parts.length && r?.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  return { ok: r?.isError !== true, text: parts.join("\n") || "(no output)" };
}
