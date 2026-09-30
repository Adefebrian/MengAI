// HTTP API connectors: a base URL, an auth header filled from the vault, and
// tools. With an OpenAPI 3 document (JSON) each operation becomes a tool
// with a JSON schema of its path, query and header parameters and its JSON
// body; without one the connector offers two tools, get (read) and send
// (sensitive, always approved). Requests stay on the base URL's origin and
// path, redirects are never followed, bodies are size capped, and the SSRF
// guard runs before every request.
import type { Risk } from "@mengai/shared";
import type { HttpOperation } from "./ports";
import { classify, localName, uniqueNames } from "./risk";
import { argsSchema, normalizeSchema, resolveRef, type Schema } from "./schema";

export const OPENAPI_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_OPERATIONS = 60;
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const FORBIDDEN_HEADERS = new Set(["host", "authorization", "cookie", "content-length", "transfer-encoding", "connection", "proxy-authorization"]);

export class HttpApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpApiError";
  }
}

export interface ImportedTool {
  local: string;
  description: string;
  risk: Risk;
  money: boolean;
  schema: Schema;
  http: HttpOperation;
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};

/** get and send: the tools of an http_api without an OpenAPI document. */
export function genericTools(): ImportedTool[] {
  const path = { type: "string", description: "Path under the base URL, starting with /", maxLength: 1024 };
  const query = { type: "object", description: "Query parameters" };
  return [
    {
      local: "get",
      description: "GET a path of this API and return the response.",
      risk: "read",
      money: false,
      schema: { type: "object", properties: { path, query }, required: ["path"] },
      http: { method: "GET", path: "", params: [], body: false, generic: "get" },
    },
    {
      local: "send",
      description: "POST, PUT, PATCH or DELETE a path of this API with an optional JSON body. Needs approval.",
      risk: "sensitive",
      money: false,
      schema: {
        type: "object",
        properties: { method: { type: "string", enum: ["POST", "PUT", "PATCH", "DELETE"] }, path, query, body: { type: "object", description: "JSON body" } },
        required: ["method", "path"],
      },
      http: { method: "POST", path: "", params: [], body: true, generic: "send" },
    },
  ];
}

/** OpenAPI 3 operations as tools (at most 60). Throws HttpApiError on a document it cannot use. */
export function toolsFromOpenApi(doc: unknown): ImportedTool[] {
  if (!doc || typeof doc !== "object") throw new HttpApiError("the OpenAPI document is not a JSON object");
  const d = doc as Record<string, unknown>;
  if (typeof d.openapi !== "string" || !d.openapi.startsWith("3")) throw new HttpApiError("only OpenAPI 3 documents are supported");
  const paths = d.paths && typeof d.paths === "object" ? (d.paths as Record<string, unknown>) : {};
  const raw: Array<Omit<ImportedTool, "local"> & { name: string }> = [];
  for (const [path, itemRaw] of Object.entries(paths)) {
    if (!path.startsWith("/") || !itemRaw || typeof itemRaw !== "object") continue;
    const item = itemRaw as Record<string, unknown>;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const m of METHODS) {
      const op = item[m];
      if (!op || typeof op !== "object") continue;
      if (raw.length >= MAX_OPERATIONS) break;
      const o = op as Record<string, unknown>;
      const properties: Record<string, Schema> = {};
      const required: string[] = [];
      const params: HttpOperation["params"] = [];
      for (const pRaw of [...shared, ...(Array.isArray(o.parameters) ? o.parameters : [])]) {
        const p = (pRaw && typeof pRaw === "object" && typeof (pRaw as Schema).$ref === "string" ? resolveRef(doc, (pRaw as Schema).$ref) : pRaw) as Record<string, unknown> | null;
        if (!p || typeof p.name !== "string" || !["path", "query", "header"].includes(String(p.in))) continue;
        if (p.in === "header" && (!HEADER_NAME.test(p.name) || FORBIDDEN_HEADERS.has(p.name.toLowerCase()))) continue;
        if (params.some((x) => x.name === p.name)) continue;
        const s = normalizeSchema(p.schema ?? { type: "string" }, doc);
        const desc = typeof p.description === "string" ? clip(p.description, 120) : undefined;
        properties[p.name] = desc && !s.description ? { ...s, description: desc } : s;
        if (p.required === true || p.in === "path") required.push(p.name);
        params.push({ name: p.name, in: p.in as "path" | "query" | "header" });
      }
      let body = false;
      const rb = (o.requestBody && typeof o.requestBody === "object" && typeof (o.requestBody as Schema).$ref === "string" ? resolveRef(doc, (o.requestBody as Schema).$ref) : o.requestBody) as Record<string, unknown> | null;
      const json = rb && rb.content && typeof rb.content === "object" ? ((rb.content as Record<string, unknown>)["application/json"] as Record<string, unknown> | undefined) : undefined;
      if (json) {
        properties.body = normalizeSchema(json.schema ?? { type: "object" }, doc);
        if (rb!.required === true) required.push("body");
        body = true;
      }
      const method = m.toUpperCase() as HttpOperation["method"];
      const name = typeof o.operationId === "string" && o.operationId ? o.operationId : `${m}_${path.replace(/\{[^}]*\}/g, "by").replace(/[^A-Za-z0-9]+/g, "_")}`;
      const summary = typeof o.summary === "string" && o.summary ? o.summary : typeof o.description === "string" ? o.description : "";
      const c = classify(name, {}, method);
      raw.push({
        name,
        description: clip(summary || `${method} ${path}`, 200),
        risk: c.risk,
        money: c.money,
        schema: { type: "object", properties, ...(required.length ? { required: [...new Set(required)] } : {}) },
        http: { method, path, params, body },
      });
    }
  }
  if (raw.length === 0) throw new HttpApiError("the OpenAPI document has no operations");
  const names = uniqueNames(raw.map((r) => localName(r.name)));
  return raw.map((r, i) => ({ local: names[i]!, description: r.description, risk: r.risk, money: r.money, schema: argsSchema(r.schema), http: r.http }));
}

/** Parses an inline OpenAPI JSON document. */
export function parseOpenApi(text: string): unknown {
  if (text.length > OPENAPI_MAX_BYTES) throw new HttpApiError("the OpenAPI document is over 2 MB");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpApiError("the OpenAPI document must be JSON (YAML is not supported)");
  }
}

async function readCapped(res: Response, max: number): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      text += decoder.decode(value.slice(0, Math.max(0, max - (size - value.byteLength))), { stream: false });
      await reader.cancel().catch(() => undefined);
      return { text, truncated: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  return { text: text + decoder.decode(), truncated: false };
}

export interface FetchDocOptions {
  guard: (url: string) => Promise<void>;
  fetch?: typeof fetch;
  timeoutMs: number;
  headers?: Record<string, string>;
}

/** Downloads an OpenAPI document (JSON, at most 2 MB, no redirects). */
export async function fetchOpenApi(url: string, o: FetchDocOptions): Promise<unknown> {
  await o.guard(url);
  const res = await (o.fetch ?? fetch)(url, { headers: { accept: "application/json", ...(o.headers ?? {}) }, redirect: "manual", signal: AbortSignal.timeout(o.timeoutMs) });
  if (res.status >= 300) {
    await res.body?.cancel();
    throw new HttpApiError(`the OpenAPI document answered HTTP ${res.status}`);
  }
  const { text, truncated } = await readCapped(res, OPENAPI_MAX_BYTES);
  if (truncated) throw new HttpApiError("the OpenAPI document is over 2 MB");
  return parseOpenApi(text);
}

/** The request URL for an operation: always on the base URL's origin and under its path. */
export function buildUrl(base: string, path: string, query: Record<string, unknown>): URL {
  const b = new URL(base);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new HttpApiError("path must start with a single /");
  const prefix = b.pathname.replace(/\/+$/, "");
  const url = new URL(`${prefix}${path}`, b.origin);
  if (url.origin !== b.origin || !url.pathname.startsWith(prefix || "/")) throw new HttpApiError("the path leaves the API's base URL");
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, typeof item === "object" ? JSON.stringify(item) : String(item));
  }
  return url;
}

export interface CallOperationInput {
  base: string;
  op: HttpOperation;
  args: Record<string, unknown>;
  auth: { header: string; value: string } | null;
  guard: (url: string) => Promise<void>;
  fetch?: typeof fetch;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
}

/** Runs one operation. Returns the status line and the body text; ok when the status is below 400. */
export async function callOperation(i: CallOperationInput): Promise<{ ok: boolean; output: string; status: number }> {
  const a = i.args;
  let method = i.op.method;
  let path = i.op.path;
  const query: Record<string, unknown> = {};
  const headers: Record<string, string> = { accept: "application/json, text/plain;q=0.9, */*;q=0.1" };
  let body: unknown = undefined;
  if (i.op.generic) {
    path = String(a.path ?? "");
    if (a.query && typeof a.query === "object") Object.assign(query, a.query);
    if (i.op.generic === "send") {
      method = String(a.method ?? "POST").toUpperCase() as HttpOperation["method"];
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new HttpApiError("method must be POST, PUT, PATCH or DELETE");
      body = a.body;
    }
  } else {
    for (const p of i.op.params) {
      const v = a[p.name];
      if (v === undefined || v === null) {
        if (p.in === "path") throw new HttpApiError(`${p.name} is required`);
        continue;
      }
      if (p.in === "path") path = path.split(`{${p.name}}`).join(encodeURIComponent(String(v)));
      else if (p.in === "query") query[p.name] = v;
      else headers[p.name.toLowerCase()] = String(v).replace(/[\r\n]/g, " ");
    }
    if (/\{[^}]*\}/.test(path)) throw new HttpApiError("a path parameter is missing");
    if (i.op.body) body = a.body;
  }
  const url = buildUrl(i.base, path, query);
  if (i.auth) headers[i.auth.header.toLowerCase()] = i.auth.value;
  if (body !== undefined) headers["content-type"] = "application/json";
  await i.guard(url.toString());
  const signal = i.signal ? AbortSignal.any([i.signal, AbortSignal.timeout(i.timeoutMs)]) : AbortSignal.timeout(i.timeoutMs);
  const res = await (i.fetch ?? fetch)(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal });
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    return { ok: false, status: res.status, output: `HTTP ${res.status}: a redirect to ${res.headers.get("location") ?? "somewhere"} was not followed` };
  }
  const { text, truncated } = await readCapped(res, i.maxBytes);
  const type = res.headers.get("content-type") ?? "";
  let shown = text;
  if (type.includes("json")) {
    try {
      shown = JSON.stringify(JSON.parse(text), null, 1);
    } catch {
      // keep the raw text
    }
  }
  return { ok: res.status < 400, status: res.status, output: `HTTP ${res.status} ${type || "unknown type"}${truncated ? " (truncated)" : ""}\n${shown}` };
}
