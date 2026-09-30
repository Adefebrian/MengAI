// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// OpenAI media adapter (openai_images): gpt-image models through
// POST /images/generations (base64 output), Sora through /videos jobs.
// Also hosts the media kit the other media adapters share: guarded binary
// downloads (every redirect hop re-checked, the key only ever sent to the
// vendor's own hosts), size and aspect helpers, mime sniffing, polling.
import type { Mode } from "@mengai/shared";
import { LlmError } from "../ports/llm";
import type { GeneratedMedia, ImageRequest, MediaProvider, VideoPoll, VideoRequest } from "../ports/media";
import { abortableSleep } from "./llm-retry";
import {
  assertSafeUrl,
  createUrlGuard,
  httpError,
  joinUrl,
  transportError,
  UnsafeUrlError,
  withTimeout,
  type FetchFn,
  type LookupFn,
} from "./llm-openai";

export interface MediaAdapterConfig {
  /** providers table row id */
  id: string;
  baseUrl: string;
  apiKey: string | null;
  mode: Mode;
  lookup?: LookupFn;
  label?: string;
  fetch?: FetchFn;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** request timeout per HTTP call */
  timeoutMs?: number;
  /** image jobs that are async on the vendor side are polled this often */
  pollIntervalMs?: number;
  /** and at most this long before giving up */
  maxWaitMs?: number;
}

export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 400 * 1024 * 1024;

type Json = Record<string, unknown>;

// ------------------------------------------------------------ media kit

export function sizeOf(size: ImageRequest["size"]): { width: number; height: number } {
  const [w, h] = (size ?? "1024x1024").split("x").map(Number);
  return { width: w ?? 1024, height: h ?? 1024 };
}

/** 1024x1024 -> 1:1, 1536x1024 -> 3:2, 1024x1536 -> 2:3 */
export function aspectOf(size: ImageRequest["size"]): "1:1" | "3:2" | "2:3" {
  return size === "1536x1024" ? "3:2" : size === "1024x1536" ? "2:3" : "1:1";
}

export function sniffMime(b: Uint8Array, fallback: string): string {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return b[8] === 0x71 && b[9] === 0x74 ? "video/quicktime" : "video/mp4";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  return fallback;
}

export function fromBase64(b64: string): Uint8Array {
  const buf = Buffer.from(b64, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

export interface DownloadOptions {
  mode: Mode;
  lookup?: LookupFn;
  fetch?: FetchFn;
  signal?: AbortSignal;
  maxBytes: number;
  timeoutMs?: number;
  /** extra headers for a given hop (return undefined to send none); used to scope keys to vendor hosts */
  headersFor?: (url: URL) => Record<string, string> | undefined;
  vendor?: string;
  /**
   * the provider's own base URL. In local mode a hop on this exact origin
   * may be loopback (a local image server); every other hop must resolve to
   * a public address, so a vendor-returned URL cannot reach the Mac's own
   * services or the LAN.
   */
  baseUrl?: string;
}

function originOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Downloads generated media. http(s) and data: URLs only; https only in
 * server mode; every redirect hop goes through the SSRF guard (public
 * addresses only in both modes, except the provider's own origin in local
 * mode); the body is capped at maxBytes while streaming.
 */
export async function downloadMedia(raw: string, opts: DownloadOptions): Promise<{ data: Uint8Array; mime: string }> {
  const vendor = opts.vendor ?? "media";
  if (raw.startsWith("data:")) {
    const m = raw.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) throw new LlmError("bad_request", `${vendor}: malformed data URL`);
    const data = m[2] ? fromBase64(m[3] ?? "") : new TextEncoder().encode(decodeURIComponent(m[3] ?? ""));
    if (data.byteLength > opts.maxBytes) throw new LlmError("bad_request", `${vendor}: media exceeds ${opts.maxBytes} bytes`);
    return { data, mime: sniffMime(data, m[1] ?? "application/octet-stream") };
  }
  const own = originOf(opts.baseUrl);
  let url = raw;
  for (let hop = 0; hop < 5; hop++) {
    let parsed: URL;
    try {
      const publicOnly = opts.mode === "local" && originOf(url) !== own;
      parsed = await assertSafeUrl(url, { mode: opts.mode, lookup: opts.lookup, publicOnly });
    } catch (e) {
      const reason = e instanceof UnsafeUrlError ? e.message : "invalid URL";
      throw new LlmError(e instanceof UnsafeUrlError && e.reason === "unresolved" ? "network" : "bad_request", `${vendor}: media URL rejected: ${reason}`);
    }
    if (opts.mode === "server" && parsed.protocol !== "https:") throw new LlmError("bad_request", `${vendor}: media URL must use https`);
    let res: Response;
    try {
      res = await (opts.fetch ?? globalThis.fetch)(parsed.toString(), {
        headers: opts.headersFor?.(parsed) ?? {},
        redirect: "manual",
        signal: withTimeout(opts.signal, opts.timeoutMs ?? 300_000),
      });
    } catch (e) {
      throw transportError(e, opts.signal, vendor);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new LlmError("server", `${vendor}: redirect without location`);
      url = new URL(loc, parsed).toString();
      continue;
    }
    if (!res.ok) throw httpError(res.status, await res.text().catch(() => ""), res.headers, vendor);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > opts.maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new LlmError("bad_request", `${vendor}: media exceeds ${opts.maxBytes} bytes`);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > opts.maxBytes) {
            await reader.cancel().catch(() => {});
            throw new LlmError("bad_request", `${vendor}: media exceeds ${opts.maxBytes} bytes`);
          }
          chunks.push(value);
        }
      } catch (e) {
        throw transportError(e, opts.signal, vendor);
      }
    }
    const data = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      data.set(c, off);
      off += c.byteLength;
    }
    const ct = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    return { data, mime: sniffMime(data, ct || "application/octet-stream") };
  }
  throw new LlmError("bad_request", `${vendor}: too many redirects`);
}

/** JSON request helper shared by the media adapters (guarded, timed, errors mapped). */
export function createJsonClient(cfg: MediaAdapterConfig, auth: () => Record<string, string>) {
  const now = cfg.now ?? Date.now;
  const vendor = cfg.label ?? "media";
  const guard = createUrlGuard({ mode: cfg.mode, lookup: cfg.lookup }, now);
  return async function request(
    method: "GET" | "POST",
    url: string,
    opts: { body?: unknown; form?: FormData; headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number; raw?: boolean } = {},
  ): Promise<Response> {
    await guard(url);
    let res: Response;
    try {
      res = await (cfg.fetch ?? globalThis.fetch)(url, {
        method,
        headers: {
          accept: "application/json",
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...auth(),
          ...opts.headers,
        },
        body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        redirect: "manual",
        signal: withTimeout(opts.signal, opts.timeoutMs ?? cfg.timeoutMs ?? 120_000),
      });
    } catch (e) {
      throw transportError(e, opts.signal, vendor);
    }
    if (!res.ok) throw httpError(res.status, await res.text().catch(() => ""), res.headers, vendor);
    return res;
  };
}

export async function readJson(res: Response, vendor: string): Promise<Json> {
  try {
    const j = (await res.json()) as unknown;
    return j && typeof j === "object" ? (j as Json) : {};
  } catch {
    throw new LlmError("server", `${vendor}: response was not JSON`);
  }
}

/** Polls until done() returns a value or maxWaitMs passes. */
export async function pollUntil<T>(
  step: () => Promise<T | null>,
  opts: { intervalMs: number; maxWaitMs: number; now: () => number; sleep: (ms: number, signal?: AbortSignal) => Promise<void>; signal?: AbortSignal; vendor: string },
): Promise<T> {
  const deadline = opts.now() + opts.maxWaitMs;
  for (;;) {
    const v = await step();
    if (v !== null) return v;
    if (opts.now() >= deadline) throw new LlmError("timeout", `${opts.vendor}: generation did not finish within ${Math.round(opts.maxWaitMs / 1000)}s`);
    await opts.sleep(opts.intervalMs, opts.signal);
  }
}

export const SAFE_JOB_ID = /^[A-Za-z0-9_-]{1,200}$/;

// ------------------------------------------------------------ OpenAI

/** Sora sizes per aspect; 1:1 has no native size and falls back to landscape. */
function soraSize(aspect: VideoRequest["aspect"]): string {
  return aspect === "9:16" ? "720x1280" : "1280x720";
}

function soraSeconds(sec: number | undefined): string {
  const want = sec ?? 8;
  return String([4, 8, 12].reduce((best, s) => (Math.abs(s - want) < Math.abs(best - want) ? s : best), 8));
}

export function createOpenAiMedia(cfg: MediaAdapterConfig): MediaProvider {
  const vendor = cfg.label ?? "openai";
  const request = createJsonClient({ ...cfg, label: vendor }, (): Record<string, string> => (cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}));
  const baseHost = (() => {
    try {
      return new URL(cfg.baseUrl).host;
    } catch {
      return "";
    }
  })();

  return {
    id: cfg.id,
    protocol: "openai_images",
    async generateImage(req: ImageRequest): Promise<{ images: GeneratedMedia[] }> {
      const gptImage = /^gpt-image|^chatgpt-image/.test(req.model);
      const body: Json = {
        model: req.model,
        prompt: req.prompt,
        n: clampInt(req.n ?? 1, 1, 4),
        size: req.size ?? "1024x1024",
        ...(gptImage ? {} : { response_format: "b64_json" }),
      };
      const res = await request("POST", joinUrl(cfg.baseUrl, "/images/generations"), { body, signal: req.signal, timeoutMs: cfg.timeoutMs ?? 240_000 });
      const j = await readJson(res, vendor);
      const { width, height } = sizeOf(req.size);
      const fmt = typeof j.output_format === "string" ? `image/${j.output_format === "jpg" ? "jpeg" : j.output_format}` : "image/png";
      const images: GeneratedMedia[] = [];
      for (const item of (Array.isArray(j.data) ? j.data : []) as Json[]) {
        if (typeof item.b64_json === "string") {
          const data = fromBase64(item.b64_json);
          images.push({ data, mime: sniffMime(data, fmt), width, height });
        } else if (typeof item.url === "string") {
          const d = await downloadMedia(item.url, { mode: cfg.mode, lookup: cfg.lookup, fetch: cfg.fetch, signal: req.signal, maxBytes: MAX_IMAGE_BYTES, vendor, baseUrl: cfg.baseUrl });
          images.push({ data: d.data, mime: d.mime, width, height });
        }
      }
      if (images.length === 0) throw new LlmError("server", `${vendor}: no image in the response`);
      return { images };
    },
    async startVideo(req: VideoRequest): Promise<{ jobId: string }> {
      const form = new FormData();
      form.set("model", req.model);
      form.set("prompt", req.prompt);
      form.set("seconds", soraSeconds(req.durationSec));
      form.set("size", soraSize(req.aspect));
      const res = await request("POST", joinUrl(cfg.baseUrl, "/videos"), { form, signal: req.signal });
      const j = await readJson(res, vendor);
      const id = typeof j.id === "string" ? j.id : "";
      if (!SAFE_JOB_ID.test(id)) throw new LlmError("server", `${vendor}: no job id in the response`);
      return { jobId: id };
    },
    async pollVideo(jobId: string, signal?: AbortSignal): Promise<VideoPoll> {
      if (!SAFE_JOB_ID.test(jobId)) throw new LlmError("bad_request", `${vendor}: invalid job id`);
      const res = await request("GET", joinUrl(cfg.baseUrl, `/videos/${jobId}`), { signal });
      const j = await readJson(res, vendor);
      const progress = typeof j.progress === "number" ? j.progress / 100 : undefined;
      const status = String(j.status ?? "");
      if (status === "failed") {
        const e = (j.error ?? {}) as Json;
        return { status: "failed", error: String(e.message ?? "video generation failed") };
      }
      if (status !== "completed") return { status: status === "queued" ? "queued" : "running", ...(progress !== undefined ? { progress } : {}) };
      const d = await downloadMedia(joinUrl(cfg.baseUrl, `/videos/${jobId}/content`), {
        mode: cfg.mode,
        lookup: cfg.lookup,
        fetch: cfg.fetch,
        signal,
        maxBytes: MAX_VIDEO_BYTES,
        vendor,
        baseUrl: cfg.baseUrl,
        headersFor: (u) => (u.host === baseHost && cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : undefined),
      });
      const seconds = Number(j.seconds);
      return {
        status: "done",
        progress: 1,
        video: { data: d.data, mime: d.mime.startsWith("video/") ? d.mime : "video/mp4", ...(Number.isFinite(seconds) ? { durationMs: seconds * 1000 } : {}) },
      };
    },
  };
}

/** default sleep for the media adapters */
export const mediaSleep = abortableSleep;
