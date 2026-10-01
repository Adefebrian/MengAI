// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Dynamic progress, as data: the ring's two adjacent arcs (done, then the
// tasks running now, never past the whole) and its tone per state; the
// ear's rotation order (the stage, who works, what is left) and its 6 s
// step; the tuck after 20 s without news and the 8 s it stays out; and the
// news key that changes on a stage, a task started or done, an ask or a
// moment, and on nothing else.
import { describe, expect, test } from "bun:test";
import type { MengaiEvent } from "@mengai/shared";
import { PREVIEW_RUN_ID, Script, askOwner, previewLive, runDTO, sampleRun, taskDTO } from "../fixture";
import { LOG_KEEP, applyEvent, deriveModel, emptyLive, foldHints, type IslandLive, type IslandModel } from "../live";
import { EAR_CYCLE_MS, TUCK_MS, UNTUCK_MIN_MS, earCycle, earIndex, newsKey, ringOf, tuckState } from "../progress";

const NOW = 1_800_000_000_000;
const RUN = PREVIEW_RUN_ID;
const ZERO = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0, calls: 0 };

function fold(events: readonly MengaiEvent[], live: IslandLive = emptyLive()): IslandLive {
  let l = live;
  for (const e of events) l = applyEvent(l, e, e.ts + 10).live;
  return l;
}

function model(s: Script): IslandModel {
  return deriveModel(fold(s.events));
}

describe("the ring", () => {
  test("two adjacent arcs: done from the top, then the running share, never past the whole", () => {
    const s = new Script(RUN, NOW - 30_000);
    s.emit("run.created", { run: runDTO(RUN, "Four tasks", s.now) });
    const status = ["done", "running", "queued", "queued", "cancelled"] as const;
    status.forEach((st, i) => s.emit("task.created", { task: taskDTO(RUN, `t-${i}`, `Task ${i}`, "engineer", null, s.now, { status: st }) }));
    s.emit("run.usage", { usage: ZERO, budgetTokens: 400_000, budgetUsd: 0, progress: 0.25 });
    const r = ringOf(model(s));
    expect(r.done).toBe(0.25);
    expect(r.inFlight).toBe(0.25);
    expect(r.tone).toBe("run");

    // the fixture: 62% done, both of its two tasks running, so the running share fills the rest
    const f = ringOf(model(sampleRun(NOW - 60_000)));
    expect(f.done).toBe(0.62);
    expect(f.inFlight).toBeCloseTo(0.38, 10);
    expect(f.done + f.inFlight).toBeLessThanOrEqual(1);
  });

  test("tone per state: waits on you, paused, budget low, failed, shipped", () => {
    const ask = sampleRun(NOW - 60_000);
    askOwner(ask);
    expect(ringOf(model(ask)).tone).toBe("wait");

    const paused = sampleRun(NOW - 60_000);
    paused.emit("run.status", { status: "paused", reason: "owner paused" });
    expect(ringOf(model(paused)).tone).toBe("paused");

    const low = sampleRun(NOW - 60_000);
    low.emit("run.usage", { usage: { ...ZERO, inputTokens: 300_000, outputTokens: 30_000 }, budgetTokens: 400_000, budgetUsd: 0, progress: 0.7 });
    const lowModel = model(low);
    expect(lowModel.active!.budget).toBeCloseTo(0.825, 5);
    expect(ringOf(lowModel).tone).toBe("low");

    const said = sampleRun(NOW - 60_000);
    said.emit("moment", { kind: "budget_low", agentId: "a-oyen", taskId: null, level: "bad", text: "Budget is running low." }, "a-oyen");
    expect(ringOf(model(said)).tone).toBe("low");

    // a failure closes the ring in the danger tone: never an empty track, dark on black
    expect(ringOf(deriveModel(previewLive("failed", NOW)))).toEqual({ done: 1, inFlight: 0, tone: "failed" });
    const shipped = ringOf(deriveModel(previewLive("shipped", NOW)));
    expect(shipped).toEqual({ done: 1, inFlight: 0, tone: "shipped" });
    expect(ringOf(deriveModel(emptyLive()))).toEqual({ done: 0, inFlight: 0, tone: "paused" });
  });
});

describe("the ear's rotation", () => {
  test("the stage, then each cat at work naming that cat, then what is left", () => {
    const cycle = earCycle(model(sampleRun(NOW - 60_000)));
    expect(cycle.map((i) => i.kind)).toEqual(["stage", "who", "who", "who", "left"]);
    expect(cycle.map((i) => i.text)).toEqual(["Review 5 of 7", "Oyen reviewing", "Gembul coding", "Klepon reviewing", "2 tasks left"]);
    expect(cycle.map((i) => i.cat?.name ?? null)).toEqual([null, "Oyen", "Gembul", "Klepon", null]);
    expect(cycle[0]!.texts).toEqual(["Review 5 of 7", "Review", "5 of 7"]);
    expect(cycle[4]!.texts).toEqual(["2 tasks left", "2 left"]);
  });

  test("one task left reads singular; nothing left drops the item", () => {
    const s = sampleRun(NOW - 60_000);
    s.emit("task.updated", { task: taskDTO(RUN, "t-export", "Build the CSV export", "engineer", "a-gembul", s.now, { status: "done" }) }, "a-gembul", "t-export");
    expect(earCycle(model(s)).at(-1)!.text).toBe("1 task left");
    s.emit("task.updated", { task: taskDTO(RUN, "t-review", "Review the export", "reviewer", "a-klepon", s.now, { status: "done" }) }, "a-klepon", "t-review");
    expect(earCycle(model(s)).some((i) => i.kind === "left")).toBe(false);
  });

  test("nothing rotates while an ask waits, the run is paused, or no run is live", () => {
    const ask = sampleRun(NOW - 60_000);
    askOwner(ask);
    expect(earCycle(model(ask))).toEqual([]);
    const paused = sampleRun(NOW - 60_000);
    paused.emit("run.status", { status: "paused", reason: null });
    expect(earCycle(model(paused))).toEqual([]);
    expect(earCycle(deriveModel(emptyLive()))).toEqual([]);
  });

  test("a step every 6 s, round and round", () => {
    expect(earIndex(5, NOW, NOW)).toBe(0);
    expect(earIndex(5, NOW, NOW + EAR_CYCLE_MS - 1)).toBe(0);
    expect(earIndex(5, NOW, NOW + EAR_CYCLE_MS)).toBe(1);
    expect(earIndex(5, NOW, NOW + EAR_CYCLE_MS * 5)).toBe(0);
    expect(earIndex(1, NOW, NOW + EAR_CYCLE_MS * 3)).toBe(0);
    expect(earIndex(3, NOW, NOW - 1000)).toBe(0);
  });
});

describe("the tuck", () => {
  test("no news for 20 s tucks; until then it says when it will", () => {
    expect(tuckState(NOW, NOW + TUCK_MS - 1)).toEqual({ tucked: false, nextAt: NOW + TUCK_MS });
    expect(tuckState(NOW, NOW + TUCK_MS)).toEqual({ tucked: true, nextAt: null });
  });

  test("once out of the tuck it stays out at least 8 s", () => {
    const news = NOW;
    const out = NOW + 60_000;
    expect(tuckState(news, out + UNTUCK_MIN_MS - 1, out)).toEqual({ tucked: false, nextAt: out + UNTUCK_MIN_MS });
    expect(tuckState(news, out + UNTUCK_MIN_MS, out).tucked).toBe(true);
    // fresh news still holds it out the full 20 s
    expect(tuckState(out, out + UNTUCK_MIN_MS, out).tucked).toBe(false);
  });
});

describe("the news key", () => {
  test("changes on a stage, a task started or done, an ask, a moment; not on chatter", () => {
    const s = sampleRun(NOW - 60_000);
    let live = fold(s.events);
    const key = () => newsKey(deriveModel(live));
    const apply = (e: MengaiEvent) => {
      live = applyEvent(live, e, e.ts + 10).live;
    };
    let k = key();
    apply(s.emit("agent.say", { text: "hmm", to: null }, "a-gembul"));
    apply(s.emit("tool.call", { callId: "c1", tool: "read_file", activity: "read", argsPreview: "a.ts" }, "a-gembul"));
    expect(key()).toBe(k);

    const changes: Array<() => void> = [
      () => apply(s.emit("run.stage", { stage: "testing", previous: "review", reason: "ok" })),
      () => apply(s.emit("task.created", { task: taskDTO(RUN, "t-test", "Test it", "qa", "a-tempe", s.now, { status: "running" }) }, "a-oyen", "t-test")),
      () => apply(s.emit("task.updated", { task: taskDTO(RUN, "t-export", "Build the CSV export", "engineer", "a-gembul", s.now, { status: "done" }) }, "a-gembul", "t-export")),
      () => askOwner(s),
      () => apply(s.emit("moment", { kind: "rethink", agentId: "a-gembul", taskId: null, level: "info", text: "" }, "a-gembul")),
    ];
    for (const change of changes) {
      const before = s.events.length;
      change();
      for (const e of s.events.slice(before)) if (e.seq > live.lastSeq) apply(e);
      expect(key()).not.toBe(k);
      k = key();
    }
    const m = deriveModel(live);
    expect(newsKey(m, "hire:a-kopi")).not.toBe(newsKey(m));
  });

  test("an engine hint that leaves the kept log is no news: the newest moment and the low budget word stay", () => {
    const s = sampleRun(NOW - 60_000);
    let live = fold(s.events);
    const apply = (e: MengaiEvent) => {
      live = applyEvent(live, e, e.ts + 10).live;
    };
    const hint = s.emit("moment", { kind: "budget_low", agentId: "a-oyen", taskId: null, level: "bad", text: "" }, "a-oyen");
    apply(hint);
    const k = newsKey(deriveModel(live));
    expect(deriveModel(live).active!.lastMoment).toBe(hint.seq);
    // chatter until the log is trimmed past the hint
    for (let i = 0; i < LOG_KEEP * 2 + 2; i++) apply(s.emit("agent.say", { text: `still on it ${i}`, to: null }, "a-gembul"));
    expect(live.runs[RUN]!.log.some((e) => e.seq === hint.seq)).toBe(false);
    const m = deriveModel(live);
    expect(m.active!.lastMoment).toBe(hint.seq);
    expect(m.active!.budgetLow).toBe(true);
    expect(ringOf(m).tone).toBe("low");
    expect(newsKey(m)).toBe(k);
    // a running maximum: a log with less in it never lowers what was kept
    const kept = { lastMoment: hint.seq, saidLow: true };
    expect(foldHints(kept, [])).toBe(kept);
    expect(foldHints(kept, live.runs[RUN]!.log)).toBe(kept);
    // the run leaves with its hints
    apply(s.emit("run.status", { status: "failed", reason: "stopped" }));
    expect(live.hints[RUN]).toBeUndefined();
  });
});
