// Replicate adapter (replicate): predictions API. owner/name models go to
// /models/<owner>/<name>/predictions, owner/name:version to /predictions.
// Images wait synchronously (Prefer: wait) and then poll; video returns the
// prediction id as the job. Output files are downloaded without the key.
import { LlmError } from "../ports/llm";
import type { GeneratedMedia, ImageRequest, MediaProvider, VideoPoll, VideoRequest } from "../ports/media";
import { joinUrl } from "./llm-openai";
import {
  aspectOf,
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

const SAFE_MODEL = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?::([a-f0-9]{8,128}))?$/;
const SAFE_ID = /^[A-Za-z0-9]{1,100}$/;

export interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: string[];
  error: string | null;
}

function outputs(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(outputs);
  if (v && typeof v === "object" && typeof (v as Json).url === "string") return [String((v as Json).url)];
  return [];
}

function toPrediction(j: Json): Prediction {
  const id = typeof j.id === "string" ? j.id : "";
  const s = String(j.status ?? "starting");
  const status = (["starting", "processing", "succeeded", "failed", "canceled"].includes(s) ? s : "processing") as Prediction["status"];
  return { id, status, output: outputs(j.output).filter((u) => /^(https?:|data:)/.test(u)), error: j.error ? String(j.error) : null };
}

export function createReplicateMedia(cfg: MediaAdapterConfig): MediaProvider & { account(signal?: AbortSignal): Promise<{ username: string | null }> } {
  const vendor = cfg.label ?? "replicate";
  const now = cfg.now ?? Date.now;
  const sleep = cfg.sleep ?? mediaSleep;
  const request = createJsonClient({ ...cfg, label: vendor }, (): Record<string, string> => (cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}));

  async function create(model: string, input: Json, wait: boolean, signal?: AbortSignal): Promise<Prediction> {
    const m = model.match(SAFE_MODEL);
    if (!m) throw new LlmError("bad_request", `${vendor}: invalid model id, expected owner/name or owner/name:version`);
    const [, owner, name, version] = m;
    const url = version ? joinUrl(cfg.baseUrl, "/predictions") : joinUrl(cfg.baseUrl, `/models/${owner}/${name}/predictions`);
    const body = version ? { version, input } : { input };
    const res = await request("POST", url, { body, signal, headers: wait ? { prefer: "wait=60" } : {}, timeoutMs: wait ? 90_000 : undefined });
    const p = toPrediction(await readJson(res, vendor));
    if (!SAFE_ID.test(p.id)) throw new LlmError("server", `${vendor}: no prediction id in the response`);
    return p;
  }

  async function get(id: string, signal?: AbortSignal): Promise<Prediction> {
    if (!SAFE_ID.test(id)) throw new LlmError("bad_request", `${vendor}: invalid prediction id`);
    const res = await request("GET", joinUrl(cfg.baseUrl, `/predictions/${id}`), { signal });
    return toPrediction(await readJson(res, vendor));
  }

  const download = (url: string, maxBytes: number, signal?: AbortSignal) =>
    downloadMedia(url, { mode: cfg.mode, lookup: cfg.lookup, fetch: cfg.fetch, signal, maxBytes, vendor, baseUrl: cfg.baseUrl });

  return {
    id: cfg.id,
    protocol: "replicate",
    async generateImage(req: ImageRequest): Promise<{ images: GeneratedMedia[] }> {
      const { width, height } = sizeOf(req.size);
      const count = clampInt(req.n ?? 1, 1, 4);
      let p = await create(req.model, { prompt: req.prompt, aspect_ratio: aspectOf(req.size), num_outputs: count }, true, req.signal);
      if (p.status !== "succeeded" && p.status !== "failed" && p.status !== "canceled") {
        const id = p.id;
        p = await pollUntil(
          async () => {
            const cur = await get(id, req.signal);
            return cur.status === "succeeded" || cur.status === "failed" || cur.status === "canceled" ? cur : null;
          },
          { intervalMs: cfg.pollIntervalMs ?? 1_000, maxWaitMs: cfg.maxWaitMs ?? 180_000, now, sleep, signal: req.signal, vendor },
        );
      }
      if (p.status !== "succeeded") throw new LlmError("server", `${vendor}: ${p.error ?? `prediction ${p.status}`}`);
      const images: GeneratedMedia[] = [];
      for (const url of p.output.slice(0, count)) {
        const d = await download(url, MAX_IMAGE_BYTES, req.signal);
        images.push({ data: d.data, mime: d.mime, width, height });
      }
      if (images.length === 0) throw new LlmError("server", `${vendor}: no image in the output`);
      return { images };
    },
    async startVideo(req: VideoRequest): Promise<{ jobId: string }> {
      const input: Json = { prompt: req.prompt };
      if (req.aspect) input.aspect_ratio = req.aspect;
      if (req.durationSec !== undefined) input.duration = clampInt(req.durationSec, 1, 60);
      const p = await create(req.model, input, false, req.signal);
      return { jobId: p.id };
    },
    async pollVideo(jobId: string, signal?: AbortSignal): Promise<VideoPoll> {
      const p = await get(jobId, signal);
      if (p.status === "starting") return { status: "queued" };
      if (p.status === "processing") return { status: "running" };
      if (p.status !== "succeeded") return { status: "failed", error: p.error ?? `prediction ${p.status}` };
      const url = p.output[0];
      if (!url) return { status: "failed", error: "no video in the output" };
      const d = await download(url, MAX_VIDEO_BYTES, signal);
      return { status: "done", progress: 1, video: { data: d.data, mime: d.mime.startsWith("video/") ? d.mime : "video/mp4" } };
    },
    async account(signal?: AbortSignal): Promise<{ username: string | null }> {
      const res = await request("GET", joinUrl(cfg.baseUrl, "/account"), { signal, timeoutMs: 15_000 });
      const j = await readJson(res, vendor);
      return { username: typeof j.username === "string" ? j.username : null };
    },
  };
}
