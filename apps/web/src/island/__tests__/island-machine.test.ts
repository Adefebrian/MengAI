// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's state machine, as data: event sequences of the all-runs
// stream folded into the live model, then the view and the exact size of
// the shape for it. Nothing waits on the owner: collapsed with the stage
// ("Review 5 of 7") and the notch plus two equal ears; hover peeks at the
// crew; a cat's yes or no question or a live order expands the island with
// a queue, oldest first; a paper order never asks; a run that ships plays
// its celebration for SHIP_MS then leaves; a failed run stays until the
// owner acts; a stale finish from a replay is never played; no notch gives
// a pill. The window grows to the union of both sizes first and drops to
// the target after the morph; the shell's geometry is read defensively and
// only /app paths may open in the main window.
import { describe, expect, test } from "bun:test";
import type { MengaiEvent, RunDTO } from "@mengai/shared";
import { Script, askOwner, orderDTO, previewLive, runDTO, sampleRun, PREVIEW_RUN_ID } from "../fixture";
import { FRESH_MS, applyEvent, clearFinish, deriveModel, emptyLive, withOrders, withRunList, withSnapshot, type IslandLive } from "../live";
import {
  BODY_W,
  EAR_INNER,
  EAR_MIN,
  EAR_OUTER,
  MINI_CAT,
  RING,
  RING_GAP,
  SHIP_MS,
  earTexts,
  estimateText,
  frameOf,
  grows,
  nativeStateOf,
  pickView,
  shrinks,
  unionSize,
  type IslandView,
  type Measure,
} from "../machine";
import { NO_NOTCH_GEOMETRY, PREVIEW_GEOMETRY, isAppPath, readGeometry, tauriInvoke } from "../native";

const LONG_DASH = String.fromCharCode(0x2014);
const NOW = 1_800_000_000_000;
/** A Geist-like width: 6.5 points a character at 13 px. */
const measure: Measure = (t) => Math.ceil(t.length * 6.5);

function fold(events: readonly MengaiEvent[], live: IslandLive = emptyLive(), now = NOW): IslandLive {
  let l = live;
  for (const e of events) l = applyEvent(l, e, now).live;
  return l;
}

function viewOf(live: IslandLive, opts: { hover?: boolean; snoozed?: boolean; now?: number } = {}): IslandView {
  return pickView({ model: deriveModel(live), hover: opts.hover ?? false, snoozed: opts.snoozed ?? false, pinned: false, now: opts.now ?? NOW });
}

describe("the island's views from the event stream", () => {
  test("nothing live: idle, exactly the notch, nothing shows", () => {
    const model = deriveModel(emptyLive());
    expect(viewOf(emptyLive())).toBe("idle");
    const f = frameOf({ view: "idle", model, geometry: PREVIEW_GEOMETRY, measure });
    expect(f.native).toBe("collapsed");
    expect([f.width, f.height]).toEqual([PREVIEW_GEOMETRY.notchWidth, PREVIEW_GEOMETRY.notchHeight]);
    expect(f.band.ear).toBe(0);
    expect(f.body).toBeNull();
    expect(f.radius.top).toBe(0);
  });

  test("a run in review: collapsed with mini Oyen, the ring and the stage, the notch plus two equal ears", () => {
    const live = fold(sampleRun(NOW - 60_000).events);
    const model = deriveModel(live);
    expect(model.active?.stageLabel).toBe("Review");
    expect(model.active?.stageIndex).toBe(4);
    expect(model.active?.stageCount).toBe(7);
    expect(model.active?.progress).toBeCloseTo(0.62);
    expect(model.active?.lead.name).toBe("Oyen");
    expect(model.asks).toEqual([]);
    expect(viewOf(live)).toBe("collapsed");
    const f = frameOf({ view: "collapsed", model, geometry: PREVIEW_GEOMETRY, measure });
    expect(f.band.text).toBe("Review 5 of 7");
    expect(f.band.ring).toBe(true);
    const ear = EAR_INNER + RING + RING_GAP + measure("Review 5 of 7") + EAR_OUTER;
    expect(f.band.ear).toBe(ear);
    expect(f.width).toBe(PREVIEW_GEOMETRY.notchWidth + ear * 2);
    expect(f.height).toBe(PREVIEW_GEOMETRY.notchHeight);
    expect(f.radius).toEqual({ top: 0, bottom: 10 });
    expect(f.native).toBe("collapsed");
  });

  test("a stage text too long for the ear drops to a shorter form instead of spilling into the notch", () => {
    const live = fold(sampleRun(NOW - 60_000).events);
    const model = deriveModel(live);
    const wide: Measure = (t) => t.length * 9;
    const f = frameOf({ view: "collapsed", model, geometry: PREVIEW_GEOMETRY, measure: wide });
    expect(f.band.text).toBe("Review");
    expect(f.band.ear).toBeLessThanOrEqual(144);
    expect(f.band.ear).toBeGreaterThanOrEqual(EAR_MIN);
    // the default estimate is generous, so the page never under-sizes an ear before its font loads
    expect(estimateText("Review 5 of 7")).toBeGreaterThan(measure("Review 5 of 7"));
  });

  test("hover peeks at the crew: who is doing what, three rows and the rest counted", () => {
    const live = fold(sampleRun(NOW - 60_000).events);
    const model = deriveModel(live);
    expect(viewOf(live, { hover: true })).toBe("peek");
    const a = model.active!;
    expect(a.crew).toHaveLength(5);
    expect(a.atWork).toBe(3);
    expect(a.crew.slice(0, 3).every((c) => c.atWork)).toBe(true);
    expect(a.crew.find((c) => c.name === "Gembul")?.doing).toBe("Writing the CSV export button");
    const f = frameOf({ view: "peek", model, geometry: PREVIEW_GEOMETRY, measure });
    expect(f.native).toBe("peek");
    expect(f.width).toBe(Math.max(BODY_W.peek, PREVIEW_GEOMETRY.notchWidth + f.band.ear * 2));
    // band + padding 8 + head 44 + gap + 3 rows of 32 + gap + the "and 2 more" line + padding 16
    expect(f.height).toBe(32 + 8 + 44 + 8 + 96 + 8 + 20 + 16);
    expect(f.radius.top).toBe(0);
    expect(f.radius.bottom).toBe(28);
  });

  test("a measured body height wins over the estimate", () => {
    const model = deriveModel(fold(sampleRun(NOW - 60_000).events));
    const f = frameOf({ view: "peek", model, geometry: PREVIEW_GEOMETRY, measure, bodyHeight: 150.4 });
    expect(f.height).toBe(32 + 151);
    expect(f.body).toEqual({ width: f.width, height: 151 });
  });

  test("a cat's yes or no question expands the island; a live order joins the queue, oldest first", () => {
    const s = sampleRun(NOW - 60_000);
    askOwner(s);
    let live = fold(s.events);
    let model = deriveModel(live);
    expect(model.asks).toHaveLength(1);
    const ask = model.asks[0]!;
    expect(ask.kind).toBe("cat");
    if (ask.kind !== "cat") throw new Error("expected a cat ask");
    expect(ask.who.name).toBe("Klepon");
    expect(ask.agentId).toBe("a-klepon");
    expect(ask.yesNo).toBe(true);
    expect(ask.path).toBe(`/app/runs/${PREVIEW_RUN_ID}`);
    expect(viewOf(live)).toBe("ask");
    const f = frameOf({ view: "ask", model, geometry: PREVIEW_GEOMETRY, measure });
    expect(f.native).toBe("expanded");
    expect(f.band.text).toBe("Needs you");
    expect(f.band.ring).toBe(false);
    expect(f.width).toBe(Math.max(BODY_W.ask, f.band.width));

    const t = new Script(PREVIEW_RUN_ID, NOW - 1000, 500);
    t.emit("trade.order", { order: orderDTO("o-live", PREVIEW_RUN_ID, NOW - 59_990) }, "a-gembul", null, null);
    live = fold(t.events, live);
    model = deriveModel(live);
    expect(model.asks.map((a) => a.id)).toEqual(["order:o-live", "request:rq-install"]);
    const order = model.asks[0]!;
    if (order.kind !== "order") throw new Error("expected an order ask");
    expect(order.title).toBe("Buy 0.25 BTCUSDT");
    expect(order.detail).toBe("Limit at $64,120.00, about $16,030.00");
    expect(order.who).toBe("Gembul");
    expect(earTexts("ask", model, model.asks.length)).toEqual(["2 waiting"]);

    // the order is approved elsewhere: it leaves the queue from its own event
    const u = new Script(PREVIEW_RUN_ID, NOW, 600);
    u.emit("trade.order", { order: orderDTO("o-live", PREVIEW_RUN_ID, NOW - 59_990, { status: "approved" }) }, null, null, null);
    live = fold(u.events, live);
    expect(deriveModel(live).asks.map((a) => a.id)).toEqual(["request:rq-install"]);

    // the owner answered the cat: the request is decided and the cat works again
    const v = new Script(PREVIEW_RUN_ID, NOW + 1000, 700);
    v.emit("request.decided", { requestId: "rq-install", byAgentId: null, byOwner: true, answer: "Yes, go ahead this once.", approved: true }, "a-klepon", "t-review");
    v.emit("agent.status", { status: "working", activity: "review", mood: "focused", statusText: "Back to the review", taskId: "t-review" }, "a-klepon", "t-review");
    live = fold(v.events, live);
    expect(deriveModel(live).asks).toEqual([]);
    expect(viewOf(live)).toBe("collapsed");
  });

  test("a paper order never waits on the owner, and an open question is answered in the app", () => {
    const s = sampleRun(NOW - 60_000);
    s.emit("trade.order", { order: orderDTO("o-paper", PREVIEW_RUN_ID, NOW - 50_000, { mode: "paper" }) }, "a-gembul", null, null);
    s.emit("request.raised", { requestId: "rq-color", fromAgentId: "a-onde", toAgentId: null, question: "Which accent should the export button use, teal or ink?", toOwner: true }, "a-onde", null);
    s.emit("agent.status", { status: "approval", activity: "ask", mood: "calm", statusText: "Meowing for you: which accent?", taskId: null }, "a-onde", null);
    const model = deriveModel(fold(s.events));
    expect(model.asks.map((a) => a.id)).toEqual(["request:rq-color"]);
    const ask = model.asks[0]!;
    expect(ask.kind === "cat" && ask.yesNo).toBe(false);
  });

  test("a cat that waited before the island joined still shows as an ask, from its own status", () => {
    const s = sampleRun(NOW - 60_000);
    s.emit("agent.status", { status: "approval", activity: "ask", mood: "calm", statusText: "Meowing for you: May I run git push, a high risk tool?", taskId: "t-export" }, "a-gembul", "t-export");
    const model = deriveModel(fold(s.events));
    expect(model.asks).toHaveLength(1);
    const ask = model.asks[0]!;
    if (ask.kind !== "cat") throw new Error("expected a cat ask");
    expect(ask.title).toBe("May I run git push, a high risk tool?");
    expect(ask.yesNo).toBe(true);
    expect(ask.agentId).toBe("a-gembul");
  });

  test("Escape puts the queue aside: collapsed says how many wait, and hover brings it back", () => {
    const s = sampleRun(NOW - 60_000);
    askOwner(s);
    const live = fold(s.events);
    expect(viewOf(live, { snoozed: true })).toBe("collapsed");
    const model = deriveModel(live);
    expect(frameOf({ view: "collapsed", model, geometry: PREVIEW_GEOMETRY, measure }).band.text).toBe("Needs you");
    expect(viewOf(live, { snoozed: true, hover: true })).toBe("ask");
  });

  test("a run that ships plays its celebration for SHIP_MS, then the island settles", () => {
    const s = sampleRun(NOW - 60_000);
    s.emit("run.status", { status: "done", reason: null });
    const live = fold(s.events, emptyLive(), s.now);
    expect(live.runs[PREVIEW_RUN_ID]).toBeUndefined();
    expect(live.finish?.kind).toBe("shipped");
    expect(live.finish?.lead.name).toBe("Oyen");
    expect(live.finish?.lead.activity).toBe("celebrate");
    const at = live.finish!.at;
    expect(viewOf(live, { now: at + 10 })).toBe("shipped");
    expect(viewOf(live, { now: at + 10, hover: true })).toBe("shipped");
    expect(viewOf(live, { now: at + SHIP_MS + 1 })).toBe("idle");
    const f = frameOf({ view: "shipped", model: deriveModel(live), geometry: PREVIEW_GEOMETRY, measure });
    expect(f.native).toBe("expanded");
    expect(f.band.text).toBe("Shipped");
    expect(f.band.ring).toBe(true);
    expect(f.height).toBe(32 + 8 + 44 + 16);
    expect(f.radius.bottom).toBeLessThanOrEqual(Math.floor(f.height / 3));
    expect(viewOf(clearFinish(live))).toBe("idle");
  });

  test("a failed run shows its reason and stays until the owner acts", () => {
    const s = sampleRun(NOW - 60_000);
    s.emit("run.status", { status: "failed", reason: "The provider refused the request" });
    const live = fold(s.events, emptyLive(), s.now);
    expect(live.finish?.kind).toBe("failed");
    expect(live.finish?.reason).toBe("The provider refused the request");
    expect(viewOf(live, { now: s.now + SHIP_MS * 10 })).toBe("failed");
    const f = frameOf({ view: "failed", model: deriveModel(live), geometry: PREVIEW_GEOMETRY, measure });
    expect(f.native).toBe("expanded");
    expect(f.band.text).toBe("Failed");
    expect(viewOf(clearFinish(live))).toBe("idle");
  });

  test("a finish replayed after a reconnect is not played again, and a stopped run just leaves", () => {
    const s = sampleRun(NOW - 60_000);
    s.emit("run.status", { status: "done", reason: null });
    const stale = fold(s.events, emptyLive(), s.now + FRESH_MS + 1);
    expect(stale.finish).toBeNull();
    const t = sampleRun(NOW - 60_000);
    t.emit("run.status", { status: "stopped", reason: "You stopped the run" });
    const stopped = fold(t.events, emptyLive(), t.now);
    expect(stopped.finish).toBeNull();
    expect(viewOf(stopped)).toBe("idle");
  });

  test("the newest running run is the active one", () => {
    const a = sampleRun(NOW - 60_000, "run-a");
    const b = new Script("run-b", NOW - 30_000, 900);
    b.emit("run.created", { run: runDTO("run-b", "Write the launch notes", NOW - 30_000) });
    const live = fold([...a.events, ...b.events]);
    expect(deriveModel(live).active?.runId).toBe("run-b");
    expect(deriveModel(live).liveRuns).toBe(2);
  });

  test("a run the island does not follow going live asks for its snapshot; the list drops runs that ended", () => {
    const e = { seq: 5, ts: NOW, type: "run.status", runId: "run-z", agentId: null, taskId: null, data: { status: "running", reason: null } } as MengaiEvent;
    expect(applyEvent(emptyLive(), e, NOW).fetch).toBe("run-z");
    const live = fold(sampleRun(NOW - 60_000).events);
    const list: RunDTO[] = [
      runDTO(PREVIEW_RUN_ID, "x", NOW - 60_000, { status: "done" }),
      runDTO("run-old", "older", NOW - 90_000),
      runDTO("run-new", "newer", NOW - 10_000),
      runDTO("run-done", "done", NOW - 5_000, { status: "failed" }),
    ];
    const r = withRunList(live, list);
    expect(r.live.runs[PREVIEW_RUN_ID]).toBeUndefined();
    expect(r.live.finish).toBeNull();
    expect(r.missing).toEqual(["run-new", "run-old"]);
  });

  test("a snapshot older than what the stream already gave is ignored", () => {
    const live = fold(sampleRun(NOW - 60_000).events);
    const held = live.runs[PREVIEW_RUN_ID]!;
    const snap = { run: held.run!, agents: [], tasks: [], handoffs: [], decisions: [], approvals: [], lastSeq: held.lastSeq - 5 };
    expect(withSnapshot(live, snap)).toBe(live);
  });

  test("the order list from GET /api/trading/orders replaces what the island knew", () => {
    const live = withOrders(emptyLive(), [orderDTO("o-1", null, NOW - 5), orderDTO("o-2", null, NOW - 1, { status: "filled" })]);
    const model = deriveModel(live);
    expect(model.asks.map((a) => a.id)).toEqual(["order:o-1"]);
    expect(model.asks[0]!.path).toBe("/app/trading");
  });

  test("no notch: a pill that hugs its content under the menu bar", () => {
    const model = deriveModel(fold(sampleRun(NOW - 60_000).events));
    const f = frameOf({ view: "collapsed", model, geometry: NO_NOTCH_GEOMETRY, measure });
    expect(f.band.notch).toBe(false);
    expect(f.width).toBe(EAR_OUTER + MINI_CAT + 8 + RING + RING_GAP + measure("Review 5 of 7") + EAR_OUTER);
    expect(f.height).toBe(32);
    expect(f.radius).toEqual({ top: 16, bottom: 16 });
    const idle = frameOf({ view: "idle", model: deriveModel(emptyLive()), geometry: NO_NOTCH_GEOMETRY, measure });
    expect([idle.width, idle.height]).toEqual([EAR_OUTER + MINI_CAT + EAR_OUTER, 32]);
    const grown = frameOf({ view: "failed", model: deriveModel(previewLive("failed", NOW)), geometry: NO_NOTCH_GEOMETRY, measure });
    expect(grown.radius.top).toBe(grown.radius.bottom);
  });

  test("every preview state lands on its view, in plain words", () => {
    const want: Record<string, IslandView> = { idle: "idle", collapsed: "collapsed", expanded: "ask", shipped: "shipped", failed: "failed" };
    for (const [state, view] of Object.entries(want)) {
      const live = previewLive(state as "idle", NOW);
      expect(viewOf(live, { now: NOW + 1000 })).toBe(view);
      const model = deriveModel(live);
      const text = JSON.stringify(model);
      expect(text.includes(LONG_DASH)).toBe(false);
    }
    expect(viewOf(previewLive("peek", NOW), { hover: true })).toBe("peek");
  });

  test("native states follow the views", () => {
    expect(nativeStateOf("idle")).toBe("collapsed");
    // no notch and nothing running: the pill leaves the screen instead of covering a title bar
    expect(nativeStateOf("idle", false)).toBe("hidden");
    expect(nativeStateOf("collapsed", false)).toBe("collapsed");
    expect(nativeStateOf("collapsed")).toBe("collapsed");
    expect(nativeStateOf("peek")).toBe("peek");
    for (const v of ["ask", "shipped", "failed"] as const) expect(nativeStateOf(v)).toBe("expanded");
  });
});

describe("the native window around the shape", () => {
  test("it grows to the union first and shrinks to the target after the morph", () => {
    const collapsed = { width: 439, height: 32 };
    const expanded = { width: 400, height: 190 };
    expect(grows(collapsed, expanded)).toBe(true);
    expect(shrinks(collapsed, expanded)).toBe(true);
    expect(unionSize(collapsed, expanded)).toEqual({ width: 439, height: 190 });
    expect(grows(expanded, expanded)).toBe(false);
    expect(shrinks(expanded, expanded)).toBe(false);
  });

  test("the shell's geometry is read defensively", () => {
    expect(readGeometry({ hasNotch: true, notchWidth: 200, notchHeight: 38, menuBarHeight: 38, scale: 2 })).toEqual({ hasNotch: true, notchWidth: 200, notchHeight: 38, menuBarHeight: 38, scale: 2 });
    expect(readGeometry({ hasNotch: true, notchWidth: -4, notchHeight: "x", menuBarHeight: 9999, scale: 0 })).toEqual(PREVIEW_GEOMETRY);
    expect(readGeometry(null)).toEqual(NO_NOTCH_GEOMETRY);
    expect(readGeometry({ hasNotch: false, notchWidth: 200, notchHeight: 30, menuBarHeight: 25, scale: 1 })).toEqual({ hasNotch: false, notchWidth: 0, notchHeight: 0, menuBarHeight: 25, scale: 1 });
  });

  test("only app paths may open in the main window, and Tauri is found only when its internals are there", () => {
    expect(isAppPath("/app")).toBe(true);
    expect(isAppPath("/app/runs/r1")).toBe(true);
    expect(isAppPath("/app/trading")).toBe(true);
    expect(isAppPath("/")).toBe(false);
    expect(isAppPath("https://evil.example/app")).toBe(false);
    expect(isAppPath("//evil.example/app")).toBe(false);
    expect(isAppPath("/application")).toBe(false);
    expect(isAppPath("/app//evil")).toBe(false);
    expect(tauriInvoke({})).toBeNull();
    expect(tauriInvoke({ __TAURI_INTERNALS__: {} })).toBeNull();
    expect(typeof tauriInvoke({ __TAURI_INTERNALS__: { invoke: async () => null } })).toBe("function");
  });
});
