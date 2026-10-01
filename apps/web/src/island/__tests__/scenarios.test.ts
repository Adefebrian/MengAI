// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The scenario gallery, as data: every scenario the owner asked for is
// there, once, with a plain one-line description, and each one, played
// through the real reducer, the moments deriver and the director (no hand
// set frame), brings exactly the moment, ask, ring tone or owner action it
// describes, with the cat and the prop it names.
import { describe, expect, test } from "bun:test";
import { Director, QUIRK_GAP_MAX_MS, type Cue, type OfferResult } from "../director";
import { applyEvent, deriveModel, type IslandLive } from "../live";
import { askMoments, deriveMoments, quirkMoment } from "../moments";
import { ringOf, TUCK_MS, newsKey } from "../progress";
import { SCENARIOS, SCENARIO_GROUPS, findScenario, previewClock, type Scenario, type ScenarioCtx } from "../scenarios";

const NOW = 1_800_000_000_000;
const LONG_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

interface Played {
  live: IslandLive;
  director: Director;
  offered: Array<{ m: Cue; r: OfferResult }>;
  asks: Cue[];
  pressed: string[];
  keys: string[];
  pointers: string[];
  taps: number;
  skipped: number;
  clock: number;
  keysSeen: string[];
}

/** Every step at its time, the island clock moving with it (and jumping on a skip). */
function play(sc: Scenario): Played {
  let skipped = 0;
  let clock = NOW;
  const start = sc.start(clock);
  let live = start.live;
  const director = new Director({ now: clock, seed: 7 });
  const out: Played = { live, director, offered: [], asks: [], pressed: [], keys: [], pointers: [], taps: 0, skipped: 0, clock, keysSeen: [newsKey(deriveModel(live))] };
  const ctx: ScenarioCtx = {
    now: () => clock,
    emit(type, data, agentId = null, taskId = null, runId) {
      start.script.at(clock);
      const e = start.script.emit(type, data, agentId, taskId, runId === undefined ? start.script.runId : runId);
      const before = live;
      live = applyEvent(before, e, clock).live;
      for (const m of deriveMoments(before, e, live, clock)) out.offered.push({ m, r: director.offer(m, clock) });
      const asks = askMoments(deriveModel(live), clock);
      director.syncAsks(asks, clock);
      out.asks = asks;
      out.keysSeen.push(newsKey(deriveModel(live)));
    },
    pointer: (zone) => void out.pointers.push(zone),
    skip: (ms) => {
      skipped += ms;
      clock += ms;
    },
    press: (label) => void out.pressed.push(label),
    tapCat: () => {
      out.taps += 1;
    },
    key: (k) => void out.keys.push(k),
  };
  for (const s of [...sc.steps].sort((a, b) => a.at - b.at)) {
    clock = Math.max(clock, NOW + skipped + s.at);
    s.run(ctx);
  }
  return { ...out, live, skipped, clock };
}

const played = (id: string) => {
  const sc = findScenario(id);
  if (!sc) throw new Error(`no scenario ${id}`);
  return play(sc);
};
const only = (p: Played) => p.offered.filter((o) => o.r === "play" || o.r === "queue").map((o) => o.m);

describe("the gallery lists every scenario", () => {
  test("each asked-for scenario is there once, with a url-safe id, a title, a plain line and a length", () => {
    const want = [
      "idle",
      "collapsed",
      "ear-rotation",
      "ring-run",
      "ring-wait",
      "ring-paused",
      "ring-low",
      "ring-failed",
      "ring-shipped",
      "tucked",
      "near",
      "peek",
      "ask-shell",
      "ask-file",
      "ask-network",
      "ask-automation",
      "approve",
      "deny",
      "ask-order",
      "ask-question",
      "ask-queue",
      "hire",
      "let-go",
      "handoff",
      "review-pass",
      "review-fail",
      "ceo-approved",
      "ceo-denied",
      "rethink",
      "stuck",
      "budget-low",
      "stage-done",
      "shipped",
      "failed",
      "quirk",
      "tap",
      "tap-combo",
    ];
    expect(SCENARIOS.map((s) => s.id)).toEqual(want);
    const groups = new Set(SCENARIO_GROUPS.map((g) => g.id));
    const titles = new Set<string>();
    for (const s of SCENARIOS) {
      expect(s.id).toMatch(/^[a-z][a-z-]*$/);
      expect(groups.has(s.group)).toBe(true);
      expect(titles.has(s.title)).toBe(false);
      titles.add(s.title);
      expect(s.description).toMatch(/^[A-Z].*\.$/);
      expect(s.description.length).toBeLessThanOrEqual(160);
      expect(s.description.includes(LONG_DASH) || s.description.includes(EN_DASH)).toBe(false);
      expect(s.ms).toBeGreaterThanOrEqual(3000);
      for (const step of s.steps) expect(step.at).toBeLessThan(s.ms);
    }
    expect(findScenario("nope")).toBeNull();
  });

  test("the preview clock runs in real time and jumps forward on a skip", () => {
    let real = 1000;
    const c = previewClock(NOW, () => real);
    expect(c.now()).toBe(NOW);
    real += 250;
    expect(c.now()).toBe(NOW + 250);
    c.skip(TUCK_MS);
    expect(c.now()).toBe(NOW + 250 + TUCK_MS);
    c.skip(-5);
    expect(c.now()).toBe(NOW + 250 + TUCK_MS);
  });
});

describe("each scenario, through the real pipeline, brings what it says", () => {
  test("the run: idle, live, ring tones, the tuck and the pointer", () => {
    expect(deriveModel(played("idle").live).active).toBeNull();
    for (const id of ["collapsed", "ear-rotation"]) {
      const p = played(id);
      expect(deriveModel(p.live).active?.stageLabel).toBe("Review");
      expect(p.offered).toHaveLength(0);
    }
    const run = played("ring-run");
    const r = ringOf(deriveModel(run.live));
    expect(r).toEqual({ done: 0.75, inFlight: 0.25, tone: "run" });
    expect(deriveModel(run.live).active?.runningCount).toBe(2);
    const wait = played("ring-wait");
    expect(ringOf(deriveModel(wait.live)).tone).toBe("wait");
    expect(wait.keys).toEqual(["Escape"]);
    expect(ringOf(deriveModel(played("ring-paused").live)).tone).toBe("paused");
    expect(ringOf(deriveModel(played("ring-low").live)).tone).toBe("low");
    expect(ringOf(deriveModel(played("ring-failed").live))).toEqual({ done: 1, inFlight: 0, tone: "failed" });
    expect(ringOf(deriveModel(played("ring-shipped").live)).tone).toBe("shipped");
    const tucked = played("tucked");
    expect(tucked.skipped).toBeGreaterThanOrEqual(TUCK_MS - 1000);
    // the last step is news: the tuck ends
    expect(tucked.keysSeen.at(-1)).not.toBe(tucked.keysSeen[0]);
    expect(played("near").pointers).toEqual(["near", "far"]);
    expect(played("peek").pointers).toEqual(["inside"]);
  });

  test("asks: the asking cat holds what the ask is about", () => {
    const props: Record<string, [string, string, string]> = {
      "ask-shell": ["ask_approval", "Klepon", "terminal"],
      "ask-file": ["ask_approval", "Gembul", "page"],
      "ask-network": ["ask_approval", "Tempe", "spyglass"],
      "ask-automation": ["ask_approval", "Onde", "runbook"],
      "ask-order": ["ask_order", "Gembul", "card"],
      "ask-question": ["ask_question", "Onde", "page"],
    };
    for (const [id, [type, name, prop]] of Object.entries(props)) {
      const p = played(id);
      const now = p.director.tick(p.clock).current!;
      expect(now.type).toBe(type as Cue["type"]);
      expect(now.cats[0]!.cat.name).toBe(name);
      expect(now.cats[0]!.prop).toBe(prop as never);
      expect(SCENARIOS.find((s) => s.id === id)!.description).toContain(name);
    }
    expect(played("approve").pressed).toEqual(["Approve"]);
    expect(played("deny").pressed).toEqual(["Deny"]);
    const queue = played("ask-queue");
    expect(queue.asks.map((a) => a.cats[0]!.cat.name)).toEqual(["Klepon", "Gembul", "Gembul"]);
    expect(queue.asks.map((a) => a.type)).toEqual(["ask_approval", "ask_approval", "ask_order"]);
    expect(queue.pressed).toEqual(["Next request"]);
  });

  test("the crew: each moment, its cat, as the line says", () => {
    const want: Record<string, [Cue["type"], string[]]> = {
      hire: ["hire", ["Kopi"]],
      "let-go": ["let_go", ["Onde"]],
      handoff: ["handoff", ["Gembul", "Klepon"]],
      "review-pass": ["review_pass", ["Klepon"]],
      "review-fail": ["review_fail", ["Klepon"]],
      "ceo-approved": ["ceo_approved", ["Oyen"]],
      "ceo-denied": ["ceo_denied", ["Oyen"]],
      rethink: ["rethink", ["Gembul"]],
      stuck: ["stuck", ["Tempe"]],
      "budget-low": ["budget_low", ["Oyen"]],
      "stage-done": ["stage_done", ["Klepon"]],
      shipped: ["shipped", ["Gembul", "Oyen", "Klepon"]],
      failed: ["failed", ["Oyen"]],
    };
    for (const [id, [type, names]] of Object.entries(want)) {
      const p = played(id);
      const ms = only(p);
      expect(ms.map((m) => m.type)).toEqual([type]);
      expect(ms[0]!.cats.map((c) => c.cat.name)).toEqual(names);
      const line = SCENARIOS.find((s) => s.id === id)!.description;
      for (const n of names) expect(line).toContain(n);
    }
    expect(only(played("review-fail"))[0]!.cats[0]!.prop).toBe("bugcard");
    expect(only(played("budget-low"))[0]!.cats[0]!.prop).toBe("clipboard");
    expect(ringOf(deriveModel(played("budget-low").live)).tone).toBe("low");
    expect(played("failed").pressed).toEqual(["Dismiss"]);
  });

  test("play: a quirk falls due after the fast forward; taps are the owner's clicks", () => {
    const p = played("quirk");
    expect(p.skipped).toBeGreaterThan(QUIRK_GAP_MAX_MS);
    const seed = p.director.quirkDue(p.clock);
    expect(seed).not.toBeNull();
    const m = quirkMoment(deriveModel(p.live), seed!, p.clock)!;
    expect(m.type).toBe("quirk");
    expect(m.cats[0]!.quirk).not.toBeNull();
    expect(played("tap").taps).toBe(1);
    expect(played("tap-combo").taps).toBe(3);
  });
});
