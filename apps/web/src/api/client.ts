// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Typed API client over the Routes table in @mengai/shared. One call()
// per route key ("GET /api/runs/:id"): path params, query and the JSON
// body are typed from the table, the response is RouteResponse<K>.
// The base is the local engine (api/runtime.ts): "" when the page shares
// its origin, else the engine's loopback origin. There is no auth of any
// kind: no token, no bearer header, no cookies across origins. Every
// mutating call is Content-Type application/json (so a browser always
// preflights it and a plain form post can never reach the engine) and
// carries the x-mengai-csrf header.
// Errors come back as ApiError with the server's { error: { code,
// message } }, or a network code when the engine cannot be reached.
import { CSRF_HEADER, type RouteBody, type RouteKey, type RouteResponse } from "@mengai/shared";
import type { EventSourceLike } from "../store/runStore";
import { fetchEventSource } from "./sse";

type PathOf<K extends string> = K extends `${string} ${infer P}` ? P : never;
type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;
export type PathParams<K extends RouteKey> = Record<ParamNames<PathOf<K>>, string>;

export type Query = Record<string, string | number | boolean | null | undefined>;

type ParamPart<K extends RouteKey> = [ParamNames<PathOf<K>>] extends [never] ? { params?: undefined } : { params: PathParams<K> };
type BodyPart<K extends RouteKey> = [RouteBody<K>] extends [never] ? { body?: undefined } : { body: RouteBody<K> };
export type CallOptions<K extends RouteKey> = ParamPart<K> & BodyPart<K> & { query?: Query; signal?: AbortSignal };
type NeedsOptions<K extends RouteKey> = [ParamNames<PathOf<K>>] extends [never] ? ([RouteBody<K>] extends [never] ? false : true) : true;
export type CallArgs<K extends RouteKey> = NeedsOptions<K> extends true ? [opts: CallOptions<K>] : [opts?: CallOptions<K>];

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
  get isAuth(): boolean {
    return this.status === 401;
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientConfig {
  /** origin prefix, "" for same origin (the default) */
  base?: string;
  fetch?: FetchLike;
}

export interface ApiClient {
  readonly base: string;
  call<K extends RouteKey>(key: K, ...args: CallArgs<K>): Promise<RouteResponse<K>>;
  /** the absolute or same-origin URL for a GET route, for EventSource and <img> */
  url<K extends RouteKey>(key: K, ...args: CallArgs<K>): string;
  /** open a server-sent events stream on a url() from this client */
  stream(url: string): EventSourceLike;
  /** a src an <img> or <video> can load for an engine file path ("/api/assets/:id/file") */
  resolve(path: string): string;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function buildPath(pattern: string, params: Record<string, string> | undefined, query: Query | undefined): string {
  const path = pattern.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    const v = params?.[name];
    if (v === undefined || v === "") throw new ApiError(0, "missing_param", `Missing path parameter ${name}`);
    return encodeURIComponent(v);
  });
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

function splitKey(key: string): [method: string, pattern: string] {
  const i = key.indexOf(" ");
  return [key.slice(0, i), key.slice(i + 1)];
}

/** Map a non-2xx response to an ApiError, reading the JSON error body when present. */
export async function errorFrom(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = res.statusText || `Request failed with status ${res.status}`;
  try {
    const text = await res.text();
    if (text) {
      const body = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
      if (body && typeof body === "object" && body.error) {
        if (typeof body.error.code === "string" && body.error.code) code = body.error.code;
        if (typeof body.error.message === "string" && body.error.message) message = body.error.message;
      }
    }
  } catch {
    // not JSON: keep the status based code and message
  }
  return new ApiError(res.status, code, message);
}

export function createApiClient(config: ApiClientConfig = {}): ApiClient {
  const base = (config.base ?? "").replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetch ?? ((input, init) => fetch(input, init));
  // Nothing rides along: no cookies across origins, no Authorization header.
  const credentials: RequestCredentials = base ? "omit" : "same-origin";

  const url = (key: RouteKey, opts?: { params?: Record<string, string>; query?: Query }) => {
    const [, pattern] = splitKey(key);
    return base + buildPath(pattern, opts?.params, opts?.query);
  };

  return {
    base,
    url<K extends RouteKey>(key: K, ...args: CallArgs<K>): string {
      const opts = args[0] as { params?: Record<string, string>; query?: Query } | undefined;
      return url(key, opts);
    },
    resolve(path: string): string {
      const absolute = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path);
      return absolute ? path : base + path;
    },
    stream(u: string): EventSourceLike {
      // an injected fetch (the demo server, tests) streams through it; a browser uses EventSource
      if (config.fetch || typeof EventSource === "undefined") return fetchEventSource(u, { headers: {}, credentials, fetch: config.fetch });
      return new EventSource(u, { withCredentials: false }) as unknown as EventSourceLike;
    },
    async call<K extends RouteKey>(key: K, ...args: CallArgs<K>): Promise<RouteResponse<K>> {
      const opts = (args[0] ?? {}) as { params?: Record<string, string>; query?: Query; body?: unknown; signal?: AbortSignal };
      const [method] = splitKey(key);
      const headers: Record<string, string> = { accept: "application/json" };
      if (MUTATING.has(method)) {
        headers[CSRF_HEADER] = "1";
        headers["content-type"] = "application/json";
      }
      const init: RequestInit = { method, headers, credentials, signal: opts.signal };
      if (opts.body !== undefined) {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(opts.body);
      }
      let res: Response;
      try {
        res = await doFetch(url(key, opts), init);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        if (err instanceof Error && err.name === "AbortError") throw err;
        throw new ApiError(0, "network", "Cannot reach MengAI on this Mac. Check that the app is open, then try again.");
      }
      if (!res.ok) throw await errorFrom(res);
      if (res.status === 204) return undefined as unknown as RouteResponse<K>;
      const text = await res.text();
      if (!text) return undefined as unknown as RouteResponse<K>;
      try {
        return JSON.parse(text) as RouteResponse<K>;
      } catch {
        throw new ApiError(res.status, "bad_json", "The server sent a response the app could not read.");
      }
    },
  };
}

/** Human text for any thrown value, for inline error states. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}
