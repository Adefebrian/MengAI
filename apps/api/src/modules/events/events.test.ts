// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import { SSE_EVENT_NAME, type MengaiEvent } from "@mengai/shared";
import { createTestDb, fakeClock, silentLogger } from "../../testing";
import { createEventsModule } from "./index";
import { Hono } from "hono";
import { jsonErrorHandler } from "../../core/app";

function wrap(routes: Hono): Hono {
  const app = new Hono();
  app.onError(jsonErrorHandler(silentLogger));
  app.route("/", routes);
  return app;
}

async function setup(opts: { heartbeatMs?: number; maxStreams?: number } = {}) {
  const db = await createTestDb();
  const clock = fakeClock();
  const mod = createEventsModule({ db, clock, logger: silentLogger }, opts);
  return { db, clock, mod, bus: mod.service };
}

/** Reads SSE frames until `done(frames)` is true or the timeout passes, then cancels the stream. */
async function readFrames(res: Response, done: (frames: string[]) => boolean, timeoutMs = 2000): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const frames = text.split("\n\n").filter(Boolean);
      if (done(frames)) return frames;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now()))),
      ]);
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text.split("\n\n").filter(Boolean);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const eventFrames = (frames: string[]) =>
  frames
    .filter((f) => f.includes(`event: ${SSE_EVENT_NAME}`))
    .map((f) => {
      const id = Number(/^id: (\d+)$/m.exec(f)?.[1]);
      const data = JSON.parse(/^data: (.*)$/m.exec(f)![1]!) as MengaiEvent;
      return { id, data };
    });

describe("events", () => {
  test("publish appends with seq from the insert and redacts payload strings", async () => {
    const { bus, db } = await setup();
    const seen: MengaiEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    const a = await bus.publish({ type: "agent.say", runId: "r1", agentId: "a1", data: { text: "key sk-abcdefghijklmnopqrstuvwxyz0123", to: null } });
    const b = await bus.publish({ type: "error", runId: null, data: { message: "x", code: null } });
    off();
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(a.data.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect(seen.map((e) => e.seq)).toEqual([1, 2]);
    const rows = await db.query<{ data: string; run_id: string | null; agent_id: string | null }>`select data, run_id, agent_id from events order by seq`;
    expect(rows[0]!.run_id).toBe("r1");
    expect(rows[0]!.agent_id).toBe("a1");
    expect(rows[0]!.data).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect(bus.subscribers()).toBe(0);
    await db.close();
  });

  test("concurrent publishes reach subscribers in seq order", async () => {
    const { bus, db } = await setup();
    const seen: number[] = [];
    bus.subscribe((e) => seen.push(e.seq));
    await Promise.all(Array.from({ length: 20 }, (_, i) => bus.publish({ type: "error", runId: null, data: { message: `m${i}`, code: null } })));
    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    await db.close();
  });

  test("SSE replays after Last-Event-ID, then streams live events, then cleans up", async () => {
    const { bus, mod, db } = await setup();
    for (let i = 0; i < 5; i++) await bus.publish({ type: "error", runId: "r1", data: { message: `m${i}`, code: null } });
    const res = await wrap(mod.routes!).request("/", { headers: { "last-event-id": "3" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    setTimeout(() => void bus.publish({ type: "error", runId: "r1", data: { message: "live", code: null } }), 30);
    const frames = await readFrames(res, (f) => eventFrames(f).length >= 3);
    const events = eventFrames(frames);
    expect(events.map((e) => e.id)).toEqual([4, 5, 6]);
    expect(events.map((e) => e.data.seq)).toEqual([4, 5, 6]);
    expect((events[2]!.data.data as { message: string }).message).toBe("live");
    await Bun.sleep(5);
    expect(bus.subscribers()).toBe(0);
    await db.close();
  });

  test("runId and after filters; Last-Event-ID wins over after", async () => {
    const { bus, mod, db } = await setup();
    await bus.publish({ type: "error", runId: "r1", data: { message: "a", code: null } });
    await bus.publish({ type: "error", runId: "r2", data: { message: "b", code: null } });
    await bus.publish({ type: "error", runId: "r1", data: { message: "c", code: null } });
    const res = await wrap(mod.routes!).request("/?runId=r1&after=0");
    const events = eventFrames(await readFrames(res, (f) => eventFrames(f).length >= 2));
    expect(events.map((e) => e.id)).toEqual([1, 3]);
    const res2 = await wrap(mod.routes!).request("/?after=0", { headers: { "last-event-id": "2" } });
    const events2 = eventFrames(await readFrames(res2, (f) => eventFrames(f).length >= 1));
    expect(events2.map((e) => e.id)).toEqual([3]);
    await db.close();
  });

  test("without after or Last-Event-ID only live events arrive", async () => {
    const { bus, mod, db } = await setup();
    await bus.publish({ type: "error", runId: null, data: { message: "old", code: null } });
    const res = await wrap(mod.routes!).request("/");
    setTimeout(() => void bus.publish({ type: "error", runId: null, data: { message: "new", code: null } }), 20);
    const events = eventFrames(await readFrames(res, (f) => eventFrames(f).length >= 1));
    expect(events.map((e) => e.id)).toEqual([2]);
    await db.close();
  });

  test("heartbeat comment is sent on the interval", async () => {
    const { mod, db } = await setup({ heartbeatMs: 20 });
    const res = await wrap(mod.routes!).request("/");
    const frames = await readFrames(res, (f) => f.some((x) => x.includes(": ping")));
    expect(frames.some((x) => x.includes(": ping"))).toBe(true);
    await db.close();
  });

  test("bad query and bad Last-Event-ID are rejected; stream cap returns 503", async () => {
    const { mod, db } = await setup({ maxStreams: 1 });
    expect((await wrap(mod.routes!).request("/?after=-1")).status).toBe(422);
    expect((await wrap(mod.routes!).request("/?runId=bad%20id")).status).toBe(422);
    const r = await wrap(mod.routes!).request("/", { headers: { "last-event-id": "abc" } });
    expect(r.status).toBe(400);
    const first = await wrap(mod.routes!).request("/");
    const second = await wrap(mod.routes!).request("/");
    expect(second.status).toBe(503);
    await first.body!.cancel();
    await db.close();
  });
});
