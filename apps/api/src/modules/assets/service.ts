// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Image and video generation (BYOK). The provider comes from MediaRouter,
// bytes land in the blob store under assets/<id>.<ext>, an optional copy
// goes into the workspace assets/ folder through the workspace jail, cost is
// recorded on the asset row, and every status change is an asset.updated
// event. Videos are async jobs: generate() returns the queued asset and a
// background poller with exponential backoff finishes it.
import type { AssetDTO, AssetKind, CreateAssetBody } from "@mengai/shared";
import type { ModuleContext } from "../../core/module";
import type { GeneratedMedia, MediaProvider, MediaRouter, VideoPoll } from "../../core/ports/media";
import type { AssetsService, SettingsService, UsageService, WorkspaceService } from "../../core/services";
import { HttpError, badRequest, notFound, unavailable } from "../../lib/http";
import { clip, redact } from "../../lib/redact";
import { OCTET, aspectFor, extFor, isInlineMime, mediaCost, settleMime } from "./media";
import { createAssetsRepo, toAssetDTO, type AssetPatch, type AssetRow } from "./repo";

export interface PollPolicy {
  initialMs: number;
  factor: number;
  maxMs: number;
  /** total time before a queued video is given up */
  maxWaitMs: number;
  /** consecutive poll errors before giving up */
  maxErrors: number;
}

export const DEFAULT_POLL: PollPolicy = { initialMs: 2_000, factor: 1.6, maxMs: 30_000, maxWaitMs: 30 * 60_000, maxErrors: 5 };

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface AssetsDeps {
  media: MediaRouter;
  workspace: WorkspaceService;
  /** accepted per the W1 contract; media cost lives on the asset row (see concerns) */
  usage?: UsageService;
  settings?: SettingsService;
  /** timer used by the video poller (tests pass a fake) */
  sleep?: Sleep;
  poll?: Partial<PollPolicy>;
  /** resume polling of queued videos left from a previous process (default true) */
  resumeOnStart?: boolean;
}

export type GenerateInput = Parameters<AssetsService["generate"]>[0];

export interface AssetFile {
  data: Uint8Array;
  mime: string;
  filename: string;
  inline: boolean;
}

export interface AssetsModuleService extends AssetsService {
  list(q: { runId?: string; kind?: AssetKind; limit?: number }): Promise<AssetDTO[]>;
  get(id: string): Promise<AssetDTO>;
  file(id: string): Promise<AssetFile>;
  remove(id: string): Promise<void>;
  /**
   * Restarts pollers for queued videos found in the table and returns how
   * many resumed now. A video whose provider is gone is failed; one whose
   * provider is only unavailable stays queued and is retried in the background.
   */
  resumePending(): Promise<number>;
  /** resolves once every live poller has settled */
  idle(): Promise<void>;
  close(): Promise<void>;
}

const MAX_BYTES: Record<AssetKind, number> = { image: 50 * 1024 * 1024, video: 500 * 1024 * 1024 };

const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * True when resolving a queued video's provider failed for good: the provider
 * row is gone (404, unknown provider) or can no longer make videos. Anything
 * else (vault locked, network, provider not configured yet) is transient and
 * the video stays queued.
 */
export function providerGone(err: unknown): boolean {
  if (!(err instanceof HttpError)) return false;
  return err.status === 404 || err.code === "unknown_provider" || err.code === "wrong_capability";
}

function sizeDims(size: CreateAssetBody["size"]): { width: number | null; height: number | null } {
  if (!size) return { width: null, height: null };
  const [w, h] = size.split("x").map(Number);
  return { width: w ?? null, height: h ?? null };
}

export function createAssetsService(ctx: ModuleContext, deps: AssetsDeps): AssetsModuleService {
  const repo = createAssetsRepo(ctx.db);
  const log = ctx.logger.child({ module: "assets" });
  const policy: PollPolicy = { ...DEFAULT_POLL, ...deps.poll };
  const sleep = deps.sleep ?? defaultSleep;
  const pollers = new Map<string, { ac: AbortController; done: Promise<void> }>();
  let closed = false;

  async function publish(row: AssetRow): Promise<void> {
    await ctx.events.publish({ type: "asset.updated", runId: row.runId, data: { asset: toAssetDTO(row) } }).catch(() => undefined);
  }

  async function patch(id: string, p: AssetPatch): Promise<AssetRow | null> {
    const row = await repo.update(id, p, ctx.clock.now());
    if (row) await publish(row);
    return row;
  }

  async function resolveMedia(kind: AssetKind, override: { providerId?: string; model?: string }) {
    try {
      return await deps.media.resolve(kind, override);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw unavailable(clip(`no ${kind} provider is available: ${message(err)}`, 240));
    }
  }

  async function store(id: string, kind: AssetKind, media: GeneratedMedia): Promise<{ blobKey: string; mime: string; ext: string; data: Uint8Array }> {
    const data = media.data;
    if (!(data instanceof Uint8Array) || data.byteLength === 0) throw new Error(`the provider returned an empty ${kind}`);
    if (data.byteLength > MAX_BYTES[kind]) throw new Error(`the ${kind} is ${data.byteLength} bytes, over the ${MAX_BYTES[kind]} byte limit`);
    const { mime, ext } = settleMime(kind, media.mime, data);
    const blobKey = `assets/${id}.${ext}`;
    await ctx.blob.put(blobKey, data, mime);
    return { blobKey, mime, ext, data };
  }

  /** Best effort copy into <root>/assets through the workspace jail. */
  async function copyToWorkspace(root: string, row: AssetRow, ext: string, data: Uint8Array): Promise<void> {
    const rel = `assets/${row.id}.${ext}`;
    try {
      const abs = await deps.workspace.resolveInside(root, rel);
      const bytes = await Bun.write(abs, data);
      await ctx.events.publish({ type: "file.changed", runId: row.runId, data: { path: rel, op: "create", bytes } }).catch(() => undefined);
    } catch (err) {
      log.log("warn", "could not copy asset into the workspace", { assetId: row.id, error: clip(message(err), 200) });
    }
  }

  async function complete(row: AssetRow, media: GeneratedMedia, root: string | null, units: { images?: number; seconds?: number }, dims: { width: number | null; height: number | null }): Promise<AssetRow> {
    const stored = await store(row.id, row.kind, media);
    if (root) await copyToWorkspace(root, row, stored.ext, stored.data);
    const done = await patch(row.id, {
      status: "done",
      blobKey: stored.blobKey,
      mime: stored.mime,
      width: media.width ?? dims.width,
      height: media.height ?? dims.height,
      durationMs: media.durationMs ?? (units.seconds ? units.seconds * 1000 : null),
      costUsd: mediaCost(row.kind, row.model, units),
      error: null,
    });
    if (!done) {
      // deleted while generating: do not leave an orphan blob behind
      await ctx.blob.delete(stored.blobKey).catch(() => undefined);
      return { ...row, status: "failed", error: "deleted" };
    }
    return done;
  }

  async function fail(row: AssetRow, err: unknown, signal?: AbortSignal): Promise<AssetRow> {
    const error = signal?.aborted ? "aborted" : clip(message(err), 500);
    return (await patch(row.id, { status: "failed", error })) ?? { ...row, status: "failed", error };
  }

  async function runImage(row: AssetRow, provider: MediaProvider, input: GenerateInput): Promise<AssetDTO> {
    try {
      const res = await provider.generateImage!({ model: row.model, prompt: row.prompt, size: input.size, n: 1, signal: input.signal });
      const image = res?.images?.[0];
      if (!image) throw new Error("the provider returned no image");
      return toAssetDTO(await complete(row, image, input.workspaceRoot ?? null, { images: 1 }, sizeDims(input.size)));
    } catch (err) {
      return toAssetDTO(await fail(row, err, input.signal));
    }
  }

  async function pollLoop(row: AssetRow, provider: MediaProvider, root: string | null, seconds: number | undefined, signal: AbortSignal): Promise<void> {
    let delay = policy.initialMs;
    let waited = 0;
    let errors = 0;
    let status = row.status;
    for (;;) {
      await sleep(delay, signal);
      waited += delay;
      let res: VideoPoll | null = null;
      try {
        res = await provider.pollVideo!(row.jobId!, signal);
        errors = 0;
      } catch (err) {
        if (signal.aborted) return;
        errors++;
        if (errors >= policy.maxErrors) {
          await fail(row, new Error(`polling failed ${errors} times in a row: ${message(err)}`));
          return;
        }
      }
      if (signal.aborted) return;
      if (res?.status === "done") {
        if (!res.video) {
          await fail(row, new Error("the provider finished without a video"));
          return;
        }
        try {
          await complete(row, res.video, root, { seconds: res.video.durationMs ? res.video.durationMs / 1000 : seconds }, { width: null, height: null });
        } catch (err) {
          await fail(row, err);
        }
        return;
      }
      if (res?.status === "failed") {
        await fail(row, new Error(res.error || "the provider reported a failed job"));
        return;
      }
      if (res?.status === "running" && status !== "running") {
        status = "running";
        if (!(await patch(row.id, { status: "running" }))) return;
      }
      if (waited >= policy.maxWaitMs) {
        await fail(row, new Error("timed out waiting for the provider"));
        return;
      }
      delay = Math.min(policy.maxMs, Math.round(delay * policy.factor));
    }
  }

  function track(row: AssetRow, provider: MediaProvider, root: string | null, seconds: number | undefined): void {
    watch(row, (signal) => pollLoop(row, provider, root, seconds, signal));
  }

  function watch(row: AssetRow, loop: (signal: AbortSignal) => Promise<void>): void {
    if (closed || pollers.has(row.id)) return;
    const ac = new AbortController();
    const done = loop(ac.signal)
      .catch((err) => {
        if (!ac.signal.aborted) log.log("error", "video poller crashed", { assetId: row.id, error: clip(message(err), 200) });
      })
      .finally(() => {
        pollers.delete(row.id);
      });
    pollers.set(row.id, { ac, done });
  }

  async function resolveVideo(row: AssetRow): Promise<MediaProvider> {
    const { provider } = await deps.media.resolve("video", { providerId: row.providerId, model: row.model });
    if (!provider.pollVideo) throw new HttpError(422, "wrong_capability", `provider ${provider.id} cannot poll videos`);
    return provider;
  }

  /**
   * Background retry of a queued video whose provider could not be resolved
   * for a transient reason. Gives up quietly after maxErrors attempts and
   * leaves the row queued for the next resumePending (next boot).
   */
  async function resumeLater(row: AssetRow, signal: AbortSignal): Promise<void> {
    let delay = policy.maxMs;
    for (let attempt = 1; attempt <= policy.maxErrors; attempt++) {
      await sleep(delay, signal);
      if (signal.aborted) return;
      let provider: MediaProvider;
      try {
        provider = await resolveVideo(row);
      } catch (err) {
        if (signal.aborted) return;
        if (providerGone(err)) {
          await fail(row, err);
          return;
        }
        delay = Math.min(policy.maxWaitMs, Math.round(delay * policy.factor));
        continue;
      }
      return pollLoop(row, provider, null, undefined, signal);
    }
    log.log("warn", "queued video left queued, its provider is still unavailable", { assetId: row.id });
  }

  async function startVideo(row: AssetRow, provider: MediaProvider, input: GenerateInput): Promise<AssetDTO> {
    try {
      const res = await provider.startVideo!({ model: row.model, prompt: row.prompt, durationSec: input.durationSec, aspect: aspectFor(input.size), signal: input.signal });
      const jobId = typeof res?.jobId === "string" ? res.jobId.slice(0, 1024) : "";
      if (!jobId) throw new Error("the provider returned no job id");
      const queued = (await repo.update(row.id, { jobId }, ctx.clock.now())) ?? { ...row, jobId };
      track(queued, provider, input.workspaceRoot ?? null, input.durationSec);
      return toAssetDTO(queued);
    } catch (err) {
      return toAssetDTO(await fail(row, err, input.signal));
    }
  }

  const service: AssetsModuleService = {
    async generate(input) {
      if (closed) throw unavailable("assets module is shutting down");
      const prompt = redact(String(input.prompt ?? "").trim());
      if (!prompt) throw badRequest("prompt is required");
      const { provider, model } = await resolveMedia(input.kind, { providerId: input.providerId, model: input.model });
      if (input.kind === "image" && !provider.generateImage) throw new HttpError(422, "unsupported", `provider ${provider.id} cannot generate images`);
      if (input.kind === "video" && (!provider.startVideo || !provider.pollVideo)) throw new HttpError(422, "unsupported", `provider ${provider.id} cannot generate videos`);
      const now = ctx.clock.now();
      const row: AssetRow = {
        id: ctx.clock.id(),
        runId: input.runId ?? null,
        kind: input.kind,
        status: input.kind === "image" ? "running" : "queued",
        providerId: provider.id,
        model,
        prompt,
        blobKey: null,
        mime: null,
        width: null,
        height: null,
        durationMs: null,
        costUsd: 0,
        error: null,
        jobId: null,
        createdAt: now,
        updatedAt: now,
      };
      await repo.insert(row);
      await publish(row);
      return input.kind === "image" ? runImage(row, provider, input) : startVideo(row, provider, input);
    },

    async list(q) {
      const rows = await repo.list({ runId: q.runId, kind: q.kind, limit: Math.min(Math.max(q.limit ?? 60, 1), 200) });
      return rows.map(toAssetDTO);
    },

    async get(id) {
      const row = await repo.get(id);
      if (!row) throw notFound("asset");
      return toAssetDTO(row);
    },

    async file(id) {
      const row = await repo.get(id);
      if (!row || row.status !== "done" || !row.blobKey) throw notFound("asset file");
      const blob = await ctx.blob.get(row.blobKey);
      if (!blob) throw notFound("asset file");
      const stored = row.mime ?? blob.contentType;
      const inline = isInlineMime(stored);
      const mime = inline ? stored : OCTET;
      return { data: blob.data, mime, inline, filename: `${row.id}.${extFor(mime)}` };
    },

    async remove(id) {
      const row = await repo.get(id);
      if (!row) throw notFound("asset");
      const live = pollers.get(id);
      if (live) {
        live.ac.abort(new Error("asset deleted"));
        await live.done;
      }
      if (row.blobKey) await ctx.blob.delete(row.blobKey);
      await repo.remove(id);
    },

    async resumePending() {
      if (closed) return 0;
      let n = 0;
      for (const row of await repo.pendingVideos()) {
        if (pollers.has(row.id)) continue;
        try {
          track(row, await resolveVideo(row), null, undefined);
          n++;
        } catch (err) {
          if (providerGone(err)) await fail(row, err);
          else {
            log.log("warn", "could not resolve the provider of a queued video, retrying later", { assetId: row.id, error: clip(redact(message(err)), 200) });
            watch(row, (signal) => resumeLater(row, signal));
          }
        }
      }
      return n;
    },

    async idle() {
      while (pollers.size) await Promise.allSettled([...pollers.values()].map((p) => p.done));
    },

    async close() {
      closed = true;
      const live = [...pollers.values()];
      for (const p of live) p.ac.abort(new Error("shutting down"));
      await Promise.allSettled(live.map((p) => p.done));
    },
  };
  return service;
}
