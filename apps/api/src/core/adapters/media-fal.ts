// fal.ai queue adapter (fal_queue): submit to <base>/<model>, poll
// <base>/<owner>/<app>/requests/<id>/status, fetch the result and download
// the output URLs. Images are awaited in-call; video is a job the caller
// polls. The key ("Authorization: Key ...") goes to the queue host only;
// result files on the CDN are fetched without it.
import { LlmError } from "../ports/llm";
import type { GeneratedMedia, ImageRequest, MediaProvider, VideoPoll, VideoRequest } from "../ports/media";
import { joinUrl } from "./llm-openai";
import {
  clampInt,
  createJsonClient,
  downloadMedia,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  mediaSleep,
  pollUntil,
  readJson,
  sizeOf,
  type MediaAdapterConfig,
} from "./media-openai";

type Json = Record<string, unknown>;

const SAFE_MODEL = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/;
const SAFE_REQUEST = /^[A-Za-z0-9-]{1,100}$/;

/** fal model ids look like owner/app[/sub/path]; the queue status path uses owner/app only. */
export function falAppId(model: string): string {
  if (!SAFE_MODEL.test(model) || model.split("/").some((s) => s === "." || s === "..")) {
    throw new LlmError("bad_request", "fal: invalid model id, expected owner/app[/path]");
  }
  return model.split("/").slice(0, 2).join("/");
}

type FalStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

export function createFalMedia(cfg: MediaAdapterConfig): MediaProvider {
  const vendor = cfg.label ?? "fal";
  const now = cfg.now ?? Date.now;
  const sleep = cfg.sleep ?? mediaSleep;
  const request = createJsonClient({ ...cfg, label: vendor }, (): Record<string, string> => (cfg.apiKey ? { authorization: `Key ${cfg.apiKey}` } : {}));

  async function submit(model: string, input: Json, signal?: AbortSignal): Promise<{ appId: string; requestId: string }> {
    const appId = falAppId(model);
    const res = await request("POST", joinUrl(cfg.baseUrl, `/${model}`), { body: input, signal });
    const j = await readJson(res, vendor);
    const requestId = typeof j.request_id === "string" ? j.request_id : "";
    if (!SAFE_REQUEST.test(requestId)) throw new LlmError("server", `${vendor}: no request id in the response`);
    return { appId, requestId };
  }

  async function status(appId: string, requestId: string, signal?: AbortSignal): Promise<{ status: FalStatus; error: string | null }> {
    const res = await request("GET", joinUrl(cfg.baseUrl, `/${appId}/requests/${requestId}/status`), { signal });
    const j = await readJson(res, vendor);
    const s = String(j.status ?? "IN_QUEUE") as FalStatus;
    return { status: s === "COMPLETED" || s === "IN_PROGRESS" ? s : "IN_QUEUE", error: typeof j.error === "string" ? j.error : null };
  }

  async function result(appId: string, requestId: string, signal?: AbortSignal): Promise<Json> {
    const res = await request("GET", joinUrl(cfg.baseUrl, `/${appId}/requests/${requestId}`), { signal });
    return readJson(res, vendor);
  }

  const download = (url: string, maxBytes: number, signal?: AbortSignal) =>
    downloadMedia(url, { mode: cfg.mode, lookup: cfg.lookup, fetch: cfg.fetch, signal, maxBytes, vendor, baseUrl: cfg.baseUrl });

  return {
    id: cfg.id,
    protocol: "fal_queue",
    async generateImage(req: ImageRequest): Promise<{ images: GeneratedMedia[] }> {
      const { width, height } = sizeOf(req.size);
      const job = await submit(req.model, { prompt: req.prompt, image_size: { width, height }, num_images: clampInt(req.n ?? 1, 1, 4) }, req.signal);
      await pollUntil(
        async () => {
          const s = await status(job.appId, job.requestId, req.signal);
          if (s.error) throw new LlmError("server", `${vendor}: ${s.error}`);
          return s.status === "COMPLETED" ? true : null;
        },
        { intervalMs: cfg.pollIntervalMs ?? 1_000, maxWaitMs: cfg.maxWaitMs ?? 180_000, now, sleep, signal: req.signal, vendor },
      );
      const out = await result(job.appId, job.requestId, req.signal);
      const images: GeneratedMedia[] = [];
      for (const img of (Array.isArray(out.images) ? out.images : out.image ? [out.image] : []) as Json[]) {
        if (typeof img.url !== "string") continue;
        const d = await download(img.url, MAX_IMAGE_BYTES, req.signal);
        images.push({ data: d.data, mime: d.mime, width: Number(img.width) || width, height: Number(img.height) || height });
      }
      if (images.length === 0) throw new LlmError("server", `${vendor}: no image in the result`);
      return { images };
    },
    async startVideo(req: VideoRequest): Promise<{ jobId: string }> {
      const input: Json = { prompt: req.prompt };
      if (req.aspect) input.aspect_ratio = req.aspect;
      if (req.durationSec !== undefined) input.duration = String(clampInt(req.durationSec, 1, 60));
      const job = await submit(req.model, input, req.signal);
      return { jobId: `${job.appId}|${job.requestId}` };
    },
    async pollVideo(jobId: string, signal?: AbortSignal): Promise<VideoPoll> {
      const [appId, requestId] = jobId.split("|");
      if (!appId || !requestId || !SAFE_REQUEST.test(requestId)) throw new LlmError("bad_request", `${vendor}: invalid job id`);
      falAppId(appId);
      const s = await status(appId, requestId, signal);
      if (s.error) return { status: "failed", error: s.error };
      if (s.status === "IN_QUEUE") return { status: "queued" };
      if (s.status === "IN_PROGRESS") return { status: "running" };
      let out: Json;
      try {
        out = await result(appId, requestId, signal);
      } catch (e) {
        return { status: "failed", error: e instanceof Error ? e.message : "result fetch failed" };
      }
      const video = (out.video ?? (Array.isArray(out.videos) ? out.videos[0] : undefined)) as Json | undefined;
      if (!video || typeof video.url !== "string") return { status: "failed", error: "no video in the result" };
      const d = await download(video.url, MAX_VIDEO_BYTES, signal);
      return { status: "done", progress: 1, video: { data: d.data, mime: d.mime.startsWith("video/") ? d.mime : "video/mp4" } };
    },
  };
}
