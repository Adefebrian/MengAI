// Assets module tests on the shared test kit: image flow with a fake
// MediaProvider, video polling with fake timers, file route headers and
// ranges, delete, resume. The workspace fake jails to a temp folder.
import { afterAll, describe, expect, test } from "bun:test";
import type { AssetDTO } from "@mengai/shared";
import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ModuleContext } from "../../core/module";
import type { BlobStore } from "../../core/ports/blob";
import type { GeneratedMedia, ImageRequest, MediaProvider, MediaRouter, VideoPoll, VideoRequest } from "../../core/ports/media";
import type { WorkspaceService } from "../../core/services";
import { HttpError, errorBody } from "../../lib/http";
import { captureEvents, createTestDb, fakeClock, memoryKv, memoryVault, silentLogger } from "../../testing";
import { createAssetsModule } from "./index";
import { parseRange } from "./routes";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
const SVG = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);

const temps: string[] = [];
afterAll(async () => {
  for (const d of temps) await rm(d, { recursive: true, force: true });
});

function memoryBlob(): BlobStore & { map: Map<string, { data: Uint8Array; contentType: string }> } {
  const map = new Map<string, { data: Uint8Array; contentType: string }>();
  return {
    map,
    async put(key, data, contentType) {
      const bytes = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(await data.arrayBuffer());
      map.set(key, { data: bytes, contentType });
      return { key, size: bytes.byteLength };
    },
    async get(key) {
      return map.get(key) ?? null;
    },
    async delete(key) {
      map.delete(key);
    },
    async exists(key) {
      return map.has(key);
    },
  };
}

function tempWorkspace(root: string): WorkspaceService {
  const unused = () => Promise.reject(new Error("not used in these tests"));
  return {
    async resolveInside(r, rel) {
      if (r !== root || rel.startsWith("/") || rel.split("/").includes("..")) throw new HttpError(403, "path_outside_workspace", "escape");
      return `${root}/${rel}`;
    },
    list: unused,
    read: unused,
    write: unused,
    edit: unused,
    remove: unused,
    search: unused,
    digest: unused,
  };
}

/** Manual timer: the poller's sleep() parks here until the test releases it. */
function fakeTimers() {
  const pending: Array<{ ms: number; resolve: () => void; reject: (e: unknown) => void }> = [];
  const delays: number[] = [];
  return {
    delays,
    pending,
    sleep(ms: number, signal: AbortSignal) {
      delays.push(ms);
      return new Promise<void>((resolve, reject) => {
        const entry = { ms, resolve, reject };
        pending.push(entry);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
    async fire() {
      await until(() => pending.length > 0);
      pending.shift()!.resolve();
    },
  };
}

async function until(fn: () => boolean, tries = 500): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return;
    await Bun.sleep(1);
  }
  throw new Error("condition not reached");
}

interface FakeProvider extends MediaProvider {
  imageCalls: ImageRequest[];
  videoCalls: VideoRequest[];
  polls: VideoPoll[];
}

function fakeProvider(opts: { image?: GeneratedMedia | Error; polls?: Array<VideoPoll | Error>; noImage?: boolean } = {}): FakeProvider {
  const imageCalls: ImageRequest[] = [];
  const videoCalls: VideoRequest[] = [];
  const script = [...(opts.polls ?? [])];
  const p: FakeProvider = {
    id: "prov-media",
    protocol: "openai_images",
    imageCalls,
    videoCalls,
    polls: [],
    async startVideo(req) {
      videoCalls.push(req);
      return { jobId: "job-42" };
    },
    async pollVideo() {
      const next = script.shift() ?? { status: "running" };
      if (next instanceof Error) throw next;
      p.polls.push(next);
      return next;
    },
  };
  if (!opts.noImage) {
    p.generateImage = async (req) => {
      imageCalls.push(req);
      if (opts.image instanceof Error) throw opts.image;
      return { images: [opts.image ?? { data: PNG, mime: "image/png" }] };
    };
  }
  return p;
}

async function setup(provider: FakeProvider, extra: { poll?: Record<string, number>; resumeOnStart?: boolean; db?: ModuleContext["db"]; resolveErrors?: unknown[] } = {}) {
  const clock = fakeClock();
  const events = captureEvents(clock);
  const blob = memoryBlob();
  const root = await mkdtemp(`${tmpdir()}/mengai-assets-`);
  temps.push(root);
  const ctx: ModuleContext = {
    config: { mode: "local", version: "test", dataDir: "/tmp", workspacesDir: "/tmp", webDir: null, allowedOrigins: [], allowedHosts: [], controlToken: null },
    db: extra.db ?? (await createTestDb()),
    kv: memoryKv(),
    blob,
    vault: memoryVault(),
    clock,
    logger: silentLogger,
    events,
  };
  const timers = fakeTimers();
  const resolved: Array<{ kind: string; override: unknown }> = [];
  const media: MediaRouter = {
    async resolve(kind, override) {
      resolved.push({ kind, override });
      const err = extra.resolveErrors?.shift();
      if (err !== undefined) throw err;
      return { provider, model: override?.model ?? (kind === "image" ? "gpt-image-1" : "sora-2") };
    },
  };
  const mod = createAssetsModule(ctx, { media, workspace: tempWorkspace(root), sleep: timers.sleep, poll: extra.poll, resumeOnStart: extra.resumeOnStart ?? false });
  const app = new Hono()
    .onError((err, c) => (err instanceof HttpError ? c.json(errorBody(err.code, err.message), err.status) : c.json(errorBody("internal", String(err)), 500)))
    .route("/api/assets", mod.routes!);
  return { ctx, clock, events, blob, root, timers, resolved, mod, app };
}

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("image generation", () => {
  test("stores the blob, copies into the workspace, records cost and events", async () => {
    const provider = fakeProvider();
    const s = await setup(provider);
    const root = s.root;
    const asset = await s.mod.service.generate({ kind: "image", prompt: "a calm orange cat", size: "1536x1024", workspaceRoot: root, runId: "run-1" });
    expect(asset.status).toBe("done");
    expect(asset.url).toBe(`/api/assets/${asset.id}/file`);
    expect(asset.mime).toBe("image/png");
    expect(asset.width).toBe(1536);
    expect(asset.height).toBe(1024);
    expect(asset.costUsd).toBe(0.042);
    expect(asset.runId).toBe("run-1");
    expect(provider.imageCalls[0]).toMatchObject({ model: "gpt-image-1", prompt: "a calm orange cat", size: "1536x1024", n: 1 });
    const stored = s.blob.map.get(`assets/${asset.id}.png`)!;
    expect(stored.contentType).toBe("image/png");
    expect([...stored.data]).toEqual([...PNG]);
    const copied = new Uint8Array(await Bun.file(`${root}/assets/${asset.id}.png`).arrayBuffer());
    expect([...copied]).toEqual([...PNG]);
    expect(s.events.ofType("asset.updated").map((e) => e.data.asset.status)).toEqual(["running", "done"]);
    expect(s.events.ofType("file.changed")[0]!.data).toEqual({ path: `assets/${asset.id}.png`, op: "create", bytes: PNG.byteLength });
    const listed = await s.mod.service.list({ runId: "run-1" });
    expect(listed.map((a) => a.id)).toEqual([asset.id]);
  });

  test("provider failure returns a failed asset with a redacted error", async () => {
    const leaked = "sk-" + "proj-" + "abcdefghijklmnopqrstuvwx";
    const s = await setup(fakeProvider({ image: new Error(`401 from vendor, key ${leaked} rejected`) }));
    const asset = await s.mod.service.generate({ kind: "image", prompt: "cat" });
    expect(asset.status).toBe("failed");
    expect(asset.url).toBeNull();
    expect(asset.error).toContain("401 from vendor");
    expect(asset.error).not.toContain(leaked);
    expect(s.blob.map.size).toBe(0);
  });

  test("prompts are redacted before they reach the provider or the table", async () => {
    const provider = fakeProvider();
    const s = await setup(provider);
    const secret = "ghp" + "_" + "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2";
    const asset = await s.mod.service.generate({ kind: "image", prompt: `logo for token ${secret}` });
    expect(asset.prompt).not.toContain(secret);
    expect(provider.imageCalls[0]!.prompt).not.toContain(secret);
  });

  test("unsafe declared types are stored as octet-stream and served as attachments", async () => {
    const s = await setup(fakeProvider({ image: { data: SVG, mime: "image/svg+xml" } }));
    const asset = await s.mod.service.generate({ kind: "image", prompt: "icon" });
    expect(asset.mime).toBe("application/octet-stream");
    expect(s.blob.map.has(`assets/${asset.id}.bin`)).toBe(true);
    const res = await s.app.request(`/api/assets/${asset.id}/file`);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${asset.id}.bin"`);
  });

  test("a provider without image support is a 422", async () => {
    const s = await setup(fakeProvider({ noImage: true }));
    const res = await s.app.request("/api/assets", json({ kind: "image", prompt: "cat" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unsupported");
  });
});

describe("video generation", () => {
  test("returns queued, polls with backoff and finishes in the background", async () => {
    const provider = fakeProvider({ polls: [{ status: "queued" }, { status: "running", progress: 0.4 }, { status: "running" }, { status: "done", video: { data: MP4, mime: "video/mp4", durationMs: 8000 } }] });
    const s = await setup(provider);
    const asset = await s.mod.service.generate({ kind: "video", prompt: "cat stretching", durationSec: 8, size: "1024x1536", workspaceRoot: s.root });
    expect(asset.status).toBe("queued");
    expect(asset.url).toBeNull();
    expect(provider.videoCalls[0]).toMatchObject({ model: "sora-2", durationSec: 8, aspect: "9:16" });
    for (let i = 0; i < 4; i++) await s.timers.fire();
    await s.mod.service.idle();
    expect(s.timers.delays).toEqual([2000, 3200, 5120, 8192]);
    const done = await s.mod.service.get(asset.id);
    expect(done.status).toBe("done");
    expect(done.mime).toBe("video/mp4");
    expect(done.durationMs).toBe(8000);
    expect(done.costUsd).toBe(0.8);
    expect(s.events.ofType("asset.updated").map((e) => e.data.asset.status)).toEqual(["queued", "running", "done"]);
    expect(await Bun.file(`${s.root}/assets/${asset.id}.mp4`).exists()).toBe(true);
    const row = (await s.ctx.db.query<{ job_id: string }>`select job_id from assets where id = ${asset.id}`)[0]!;
    expect(row.job_id).toBe("job-42");
  });

  test("POST returns 202 for a queued video", async () => {
    const s = await setup(fakeProvider());
    const res = await s.app.request("/api/assets", json({ kind: "video", prompt: "cat", durationSec: 4 }));
    expect(res.status).toBe(202);
    expect(((await res.json()) as AssetDTO).status).toBe("queued");
    await s.mod.close!();
  });

  test("gives up after repeated poll errors and after the wait budget", async () => {
    const flaky = fakeProvider({ polls: [new Error("boom"), new Error("boom"), new Error("boom")] });
    const s = await setup(flaky, { poll: { maxErrors: 3 } });
    const a = await s.mod.service.generate({ kind: "video", prompt: "cat" });
    for (let i = 0; i < 3; i++) await s.timers.fire();
    await s.mod.service.idle();
    const failed = await s.mod.service.get(a.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("polling failed 3 times");

    const slow = fakeProvider();
    const s2 = await setup(slow, { poll: { initialMs: 1000, factor: 2, maxMs: 4000, maxWaitMs: 7000 } });
    const b = await s2.mod.service.generate({ kind: "video", prompt: "cat" });
    for (let i = 0; i < 3; i++) await s2.timers.fire();
    await s2.mod.service.idle();
    expect(s2.timers.delays).toEqual([1000, 2000, 4000]);
    const timedOut = await s2.mod.service.get(b.id);
    expect(timedOut.status).toBe("failed");
    expect(timedOut.error).toContain("timed out");
  });

  test("provider-reported failure marks the asset failed", async () => {
    const s = await setup(fakeProvider({ polls: [{ status: "failed", error: "content policy" }] }));
    const a = await s.mod.service.generate({ kind: "video", prompt: "cat" });
    await s.timers.fire();
    await s.mod.service.idle();
    expect((await s.mod.service.get(a.id)).error).toBe("content policy");
  });

  test("queued videos resume polling on module start", async () => {
    const provider = fakeProvider({ polls: [{ status: "done", video: { data: MP4, mime: "video/mp4" } }] });
    const first = await setup(provider);
    const a = await first.mod.service.generate({ kind: "video", prompt: "cat" });
    await first.mod.close!();
    expect((await first.mod.service.get(a.id)).status).toBe("queued");
    const second = await setup(provider, { db: first.ctx.db });
    expect(await second.mod.service.resumePending()).toBe(1);
    expect(second.resolved.at(-1)).toEqual({ kind: "video", override: { providerId: "prov-media", model: "sora-2" } });
    await second.timers.fire();
    await second.mod.service.idle();
    expect((await second.mod.service.get(a.id)).status).toBe("done");
  });
});

describe("resume after a restart", () => {
  async function leftQueued(provider: FakeProvider) {
    const first = await setup(provider);
    const a = await first.mod.service.generate({ kind: "video", prompt: "cat" });
    await first.mod.close!();
    return { db: first.ctx.db, id: a.id };
  }

  test("a transient resolve error keeps the video queued and retries", async () => {
    const provider = fakeProvider({ polls: [{ status: "done", video: { data: MP4, mime: "video/mp4" } }] });
    const { db, id } = await leftQueued(provider);
    const s = await setup(provider, { db, resolveErrors: [new Error("vault is locked"), new HttpError(503, "unavailable", "provider not ready")] });
    expect(await s.mod.service.resumePending()).toBe(0);
    expect((await s.mod.service.get(id)).status).toBe("queued");
    await s.timers.fire(); // retry 1: still unavailable
    await until(() => s.timers.pending.length > 0);
    expect((await s.mod.service.get(id)).status).toBe("queued");
    await s.timers.fire(); // retry 2: resolves, polling starts
    await s.timers.fire(); // first poll: done
    await s.mod.service.idle();
    expect((await s.mod.service.get(id)).status).toBe("done");
    expect(s.timers.delays.slice(0, 2)).toEqual([30_000, 48_000]);
  });

  test("a deleted or incapable provider fails the queued video", async () => {
    const provider = fakeProvider();
    const gone = await leftQueued(provider);
    const s = await setup(provider, { db: gone.db, resolveErrors: [new HttpError(404, "not_found", "provider not found")] });
    expect(await s.mod.service.resumePending()).toBe(0);
    const row = await s.mod.service.get(gone.id);
    expect(row.status).toBe("failed");
    expect(row.error).toContain("provider not found");

    const wrong = await leftQueued(provider);
    const s2 = await setup(provider, { db: wrong.db, resolveErrors: [new HttpError(422, "wrong_capability", "cannot generate video")] });
    await s2.mod.service.resumePending();
    expect((await s2.mod.service.get(wrong.id)).status).toBe("failed");
  });

  test("retries give up quietly and leave the row queued, close stops them", async () => {
    const provider = fakeProvider();
    const { db, id } = await leftQueued(provider);
    const errs = Array.from({ length: 10 }, () => new Error("network down"));
    const s = await setup(provider, { db, resolveErrors: errs, poll: { maxErrors: 2 } });
    await s.mod.service.resumePending();
    await s.timers.fire();
    await s.timers.fire();
    await s.mod.service.idle();
    expect((await s.mod.service.get(id)).status).toBe("queued");
    const s2 = await setup(provider, { db, resolveErrors: [new Error("still down")] });
    await s2.mod.service.resumePending();
    await until(() => s2.timers.pending.length > 0);
    await s2.mod.close!();
    expect((await s2.mod.service.get(id)).status).toBe("queued");
  });
});

describe("file route and delete", () => {
  test("serves bytes with the stored mime, nosniff and byte ranges", async () => {
    const s = await setup(fakeProvider());
    const asset = await s.mod.service.generate({ kind: "image", prompt: "cat" });
    const res = await s.app.request(`/api/assets/${asset.id}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="${asset.id}.png"`);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...PNG]);

    const part = await s.app.request(`/api/assets/${asset.id}/file`, { headers: { range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 2-5/${PNG.byteLength}`);
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([...PNG.slice(2, 6)]);
    const bad = await s.app.request(`/api/assets/${asset.id}/file`, { headers: { range: "bytes=999-" } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe(`bytes */${PNG.byteLength}`);
    expect(parseRange("bytes=-4", 10)).toEqual({ start: 6, end: 9 });
    expect(parseRange("bytes=0-1,4-5", 10)).toBeNull();

    expect((await s.app.request(`/api/assets/nope/file`)).status).toBe(404);
    expect((await s.app.request(`/api/assets/..%2Fx/file`)).status).toBe(422);
  });

  test("delete removes the row and the blob, and stops a live poller", async () => {
    const s = await setup(fakeProvider());
    const img = await s.mod.service.generate({ kind: "image", prompt: "cat" });
    const del = await s.app.request(`/api/assets/${img.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    expect(s.blob.map.size).toBe(0);
    expect((await s.app.request(`/api/assets/${img.id}/file`)).status).toBe(404);
    expect((await s.app.request(`/api/assets/${img.id}`, { method: "DELETE" })).status).toBe(404);

    const vid = await s.mod.service.generate({ kind: "video", prompt: "cat" });
    await until(() => s.timers.pending.length > 0);
    await s.mod.service.remove(vid.id);
    await s.mod.service.idle();
    const rows = await s.ctx.db.query`select id from assets`;
    expect(rows).toHaveLength(0);
  });

  test("POST validates the body and is rate limited", async () => {
    const s = await setup(fakeProvider());
    expect((await s.app.request("/api/assets", json({ kind: "gif", prompt: "cat" }))).status).toBe(422);
    expect((await s.app.request("/api/assets", json({ kind: "image", prompt: "" }))).status).toBe(422);
    expect((await s.app.request("/api/assets", json({ kind: "image", prompt: "cat", size: "10x10" }))).status).toBe(422);
    expect((await s.app.request("/api/assets", json({ kind: "image", prompt: "cat", workspaceRoot: "/etc" }))).status).toBe(422);
    const ok = await s.app.request("/api/assets", json({ kind: "image", prompt: "cat", model: "gpt-image-1-mini" }));
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as AssetDTO;
    expect(body.model).toBe("gpt-image-1-mini");
    expect(body.costUsd).toBe(0.011);
    let last: Response | null = null;
    for (let i = 0; i < 20; i++) last = await s.app.request("/api/assets", json({ kind: "image", prompt: `cat ${i}` }));
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    const listed = (await (await s.app.request("/api/assets?kind=image&limit=5")).json()) as AssetDTO[];
    expect(listed).toHaveLength(5);
  });
});
