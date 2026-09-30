// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Google Gemini media adapter (gemini_media): images through
// models/<m>:generateContent (inlineData parts) or models/imagen-*:predict,
// video through models/veo-*:predictLongRunning plus operation polling.
// The key travels in x-goog-api-key and only to Google API hosts.
import type { ProviderModel } from "@mengai/shared";
import { LlmError } from "../ports/llm";
import type { GeneratedMedia, ImageRequest, MediaProvider, VideoPoll, VideoRequest } from "../ports/media";
import { joinUrl } from "./llm-openai";
import {
  aspectOf,
  clampInt,
  createJsonClient,
  downloadMedia,
  fromBase64,
  MAX_VIDEO_BYTES,
  readJson,
  sizeOf,
  sniffMime,
  type MediaAdapterConfig,
} from "./media-openai";

type Json = Record<string, unknown>;

const SAFE_MODEL = /^[A-Za-z0-9._-]{1,120}$/;
const SAFE_OPERATION = /^(models\/[A-Za-z0-9._-]+\/)?operations\/[A-Za-z0-9._-]{1,200}$/;

function modelPath(model: string, vendor: string): string {
  const m = model.replace(/^models\//, "");
  if (!SAFE_MODEL.test(m)) throw new LlmError("bad_request", `${vendor}: invalid model id`);
  return `/models/${m}`;
}

function inlineImages(j: Json): Array<{ data: Uint8Array; mime: string }> {
  const out: Array<{ data: Uint8Array; mime: string }> = [];
  for (const c of (Array.isArray(j.candidates) ? j.candidates : []) as Json[]) {
    const parts = ((c.content as Json | undefined)?.parts ?? []) as Json[];
    for (const p of Array.isArray(parts) ? parts : []) {
      const inline = (p.inlineData ?? p.inline_data) as Json | undefined;
      if (inline && typeof inline.data === "string") {
        const data = fromBase64(inline.data);
        out.push({ data, mime: sniffMime(data, String(inline.mimeType ?? inline.mime_type ?? "image/png")) });
      }
    }
  }
  return out;
}

function blockReason(j: Json): string {
  const fb = (j.promptFeedback ?? {}) as Json;
  if (fb.blockReason) return `blocked (${String(fb.blockReason)})`;
  const c = (Array.isArray(j.candidates) ? j.candidates[0] : undefined) as Json | undefined;
  return c?.finishReason ? `finished with ${String(c.finishReason)}` : "no image in the response";
}

function veoAspect(a: VideoRequest["aspect"]): "16:9" | "9:16" {
  return a === "9:16" ? "9:16" : "16:9";
}

export function createGeminiMedia(cfg: MediaAdapterConfig): MediaProvider & { listModels(signal?: AbortSignal): Promise<ProviderModel[]> } {
  const vendor = cfg.label ?? "gemini";
  const keyHeader = (): Record<string, string> => (cfg.apiKey ? { "x-goog-api-key": cfg.apiKey } : {});
  const request = createJsonClient({ ...cfg, label: vendor }, keyHeader);
  const baseHost = (() => {
    try {
      return new URL(cfg.baseUrl).host;
    } catch {
      return "";
    }
  })();
  const googleHost = (u: URL) => u.host === baseHost || u.hostname === "googleapis.com" || u.hostname.endsWith(".googleapis.com");

  return {
    id: cfg.id,
    protocol: "gemini_media",
    async generateImage(req: ImageRequest): Promise<{ images: GeneratedMedia[] }> {
      const { width, height } = sizeOf(req.size);
      const count = clampInt(req.n ?? 1, 1, 4);
      const path = modelPath(req.model, vendor);
      const images: GeneratedMedia[] = [];
      if (/^(models\/)?imagen/.test(req.model)) {
        const res = await request("POST", joinUrl(cfg.baseUrl, `${path}:predict`), {
          body: { instances: [{ prompt: req.prompt }], parameters: { sampleCount: count, aspectRatio: aspectOf(req.size) === "3:2" ? "4:3" : aspectOf(req.size) === "2:3" ? "3:4" : "1:1" } },
          signal: req.signal,
          timeoutMs: cfg.timeoutMs ?? 180_000,
        });
        const j = await readJson(res, vendor);
        for (const p of (Array.isArray(j.predictions) ? j.predictions : []) as Json[]) {
          if (typeof p.bytesBase64Encoded === "string") {
            const data = fromBase64(p.bytesBase64Encoded);
            images.push({ data, mime: sniffMime(data, String(p.mimeType ?? "image/png")), width, height });
          }
        }
        if (images.length === 0) throw new LlmError("bad_request", `${vendor}: no image in the response (filtered or empty)`);
        return { images };
      }
      // generateContent returns one image per call
      for (let i = 0; i < count; i++) {
        const res = await request("POST", joinUrl(cfg.baseUrl, `${path}:generateContent`), {
          body: {
            contents: [{ role: "user", parts: [{ text: req.prompt }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspectOf(req.size) } },
          },
          signal: req.signal,
          timeoutMs: cfg.timeoutMs ?? 180_000,
        });
        const j = await readJson(res, vendor);
        const found = inlineImages(j);
        if (found.length === 0) throw new LlmError("bad_request", `${vendor}: ${blockReason(j)}`);
        for (const f of found) images.push({ ...f, width, height });
      }
      return { images };
    },
    async startVideo(req: VideoRequest): Promise<{ jobId: string }> {
      const path = modelPath(req.model, vendor);
      const parameters: Json = { aspectRatio: veoAspect(req.aspect) };
      if (req.durationSec !== undefined) parameters.durationSeconds = clampInt(req.durationSec, 4, 8);
      const res = await request("POST", joinUrl(cfg.baseUrl, `${path}:predictLongRunning`), {
        body: { instances: [{ prompt: req.prompt }], parameters },
        signal: req.signal,
      });
      const j = await readJson(res, vendor);
      const name = typeof j.name === "string" ? j.name : "";
      if (!SAFE_OPERATION.test(name)) throw new LlmError("server", `${vendor}: no operation name in the response`);
      return { jobId: name };
    },
    async pollVideo(jobId: string, signal?: AbortSignal): Promise<VideoPoll> {
      if (!SAFE_OPERATION.test(jobId)) throw new LlmError("bad_request", `${vendor}: invalid operation name`);
      const res = await request("GET", joinUrl(cfg.baseUrl, `/${jobId}`), { signal });
      const j = await readJson(res, vendor);
      if (!j.done) {
        const meta = (j.metadata ?? {}) as Json;
        const pct = Number(meta.progressPercent ?? meta.progress);
        return { status: "running", ...(Number.isFinite(pct) ? { progress: pct / 100 } : {}) };
      }
      if (j.error) return { status: "failed", error: String((j.error as Json).message ?? "video generation failed") };
      const r = (j.response ?? {}) as Json;
      const gen = (r.generateVideoResponse ?? r) as Json;
      const samples = (gen.generatedSamples ?? gen.generatedVideos ?? []) as Json[];
      const video = (Array.isArray(samples) ? samples[0]?.video : undefined) as Json | undefined;
      const uri = typeof video?.uri === "string" ? video.uri : null;
      if (!uri) {
        const reasons = gen.raiMediaFilteredReasons;
        return { status: "failed", error: Array.isArray(reasons) && reasons.length ? `filtered: ${String(reasons[0])}` : "no video in the response" };
      }
      const d = await downloadMedia(uri, {
        mode: cfg.mode,
        baseUrl: cfg.baseUrl,
        lookup: cfg.lookup,
        fetch: cfg.fetch,
        signal,
        maxBytes: MAX_VIDEO_BYTES,
        vendor,
        headersFor: (u) => (googleHost(u) ? keyHeader() : undefined),
      });
      return { status: "done", progress: 1, video: { data: d.data, mime: d.mime.startsWith("video/") ? d.mime : "video/mp4" } };
    },
    async listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
      const res = await request("GET", `${joinUrl(cfg.baseUrl, "/models")}?pageSize=200`, { signal, timeoutMs: 15_000 });
      const j = await readJson(res, vendor);
      return ((Array.isArray(j.models) ? j.models : []) as Json[])
        .filter((m) => typeof m.name === "string")
        .map((m) => {
          const id = String(m.name).replace(/^models\//, "");
          return { id, ...(typeof m.displayName === "string" ? { label: m.displayName } : {}) };
        });
    },
  };
}
