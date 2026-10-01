// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The moments on the page, end to end: events of the stream go through
// the feed (useIslandLive), the deriver and the director
// (useIslandMoments) into the island. A cat comes out under the shape (a
// sibling, touching its bottom edge), the ear names what changed and who,
// the sentence is read out politely, and the window grows to hold the stage
// with only the shape and the cat taking the pointer, then drops back when
// the moment ends. Asks keep their answer panel with the asking cat under
// it, holding its prop, reacting at once to Approve and Deny; Dismiss sends
// the failed lead back; a click on a cat says hi, three call a crew cat
// out; a quiet island tucks into the notch, the pointer near folds the
// ears and inside is hover intent; the ring draws three arcs in the run's
// tone; the ear rotates; a finished stage pops the body. Reduced motion
// keeps the information and drops the movement and the quirks. The clock
// is injected; `epoch` stands for a jump of it.
import { afterEach, describe, expect, test } from "bun:test";
import type { MengaiEvent } from "@mengai/shared";
import { act, useEffect, useMemo, useRef } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { PREVIEW_RUN_ID, Script, agentDTO, fold, taskDTO } from "../fixture";
import { QUIRK_GAP_MAX_MS, QUIRK_QUIET_MS } from "../director";
import { FAR_RETURN_MS, Island, ringDash } from "../Island";
import { IslandApp } from "../IslandApp";
import { clearFinish, deriveModel, type IslandLive } from "../live";
import { EAR_CYCLE_MS, TUCK_MS } from "../progress";
import { NO_NOTCH_GEOMETRY, PREVIEW_GEOMETRY, previewBridge, type IslandGeometry, type NativeSize, type PointerZone, type PreviewBridge } from "../native";
import { SCENARIOS, findScenario, scenarioRun } from "../scenarios";
import { useIslandLive } from "../useIslandLive";
import { useIslandMoments, type IslandMoments } from "../useIslandMoments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_800_000_000_000;
const RUN = PREVIEW_RUN_ID;
let root: ReactRoot | null = null;
let host: HTMLElement | null = null;

const settle = async (rounds = 4, ms = 20) => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }
};

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.history.replaceState(null, "", "/island");
});

interface HarnessProps {
  initial: IslandLive;
  now: () => number;
  epoch: number;
  geometry: IslandGeometry;
  reduced: boolean;
  bridge: PreviewBridge;
  onApply: (apply: (e: MengaiEvent) => void) => void;
}

/** The feed, the moments and the island wired as IslandApp wires them, the clock in the test's hands. */
function Harness({ initial, now, epoch, geometry, reduced, bridge, onApply }: HarnessProps) {
  const sink = useRef<IslandMoments | null>(null);
  const feed = useIslandLive({ api: null, initial, now, onEvent: (b, e, a) => sink.current?.onEvent(b, e, a) });
  const model = useMemo(() => deriveModel(feed.live), [feed.live]);
  const moments = useIslandMoments({ model, now, quirks: !reduced, seed: 7, epoch });
  sink.current = moments;
  const { apply, update } = feed;
  useEffect(() => onApply(apply), [apply, onApply]);
  return <Island model={model} geometry={geometry} bridge={bridge} api={null} reduced={reduced} now={now} moments={moments} clockEpoch={epoch} onFinishDone={() => update(clearFinish)} />;
}

interface Rig {
  el: HTMLElement;
  bridge: PreviewBridge;
  script: Script;
  /** one event of the stream, stamped now */
  emit<T extends MengaiEvent["type"]>(type: T, data: MengaiEvent<T>["data"], agentId?: string | null, taskId?: string | null, runId?: string | null): Promise<void>;
  /** the clock moves on by ms (a jump the hooks hear through epoch) */
  advance(ms: number): Promise<void>;
  island(): HTMLElement;
  calls(): NativeSize[];
  now(): number;
}

async function rig(opts: { geometry?: IslandGeometry; reduced?: boolean; live?: (now: number) => { live: IslandLive; script: Script } } = {}): Promise<Rig> {
  let t = NOW;
  const now = () => t;
  let epoch = 0;
  const geometry = opts.geometry ?? PREVIEW_GEOMETRY;
  const reduced = opts.reduced ?? true;
  const bridge = previewBridge(geometry, () => {});
  const start = opts.live ? opts.live(t) : (() => {
    const script = scenarioRun(t);
    return { live: fold(script, t), script };
  })();
  let apply: (e: MengaiEvent) => void = () => {};
  const onApply = (a: (e: MengaiEvent) => void) => {
    apply = a;
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const render = () => root!.render(<Harness initial={start.live} now={now} epoch={epoch} geometry={geometry} reduced={reduced} bridge={bridge} onApply={onApply} />);
  await act(async () => render());
  await settle();
  const el = host;
  return {
    el,
    bridge,
    script: start.script,
    async emit(type, data, agentId = null, taskId = null, runId) {
      start.script.at(t);
      const e = start.script.emit(type, data, agentId, taskId, runId === undefined ? RUN : runId);
      await act(async () => apply(e));
      await settle(3);
    },
    async advance(ms) {
      t += ms;
      epoch += 1;
      await act(async () => render());
      await settle(3);
    },
    island: () => el.querySelector<HTMLElement>(".island")!,
    calls: () => bridge.calls.filter((c) => c.cmd === "island_set_state").map((c) => c.args as NativeSize),
    now,
  };
}

const stageCats = (el: Element) => [...el.querySelectorAll<HTMLButtonElement>(".moment-stage .moment-cat")];
const ear = (el: Element) => el.querySelector(".island-ear-text")?.textContent ?? "";
const live = (el: Element) => el.querySelector(".island-live[aria-live]")?.textContent ?? "";
const press = async (b: HTMLElement | null | undefined) => {
  await act(async () => {
    b?.click();
  });
  await settle(3);
};
/** The rig holds each pose ACTIVITY_MIN_DWELL_MS (1200 ms): an owner reads the ask before answering. */
const readTheAsk = () => settle(1, 1250);
const button = (el: Element, label: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label) ?? null;

/** The shell's NEAR_X (island.rs): how far beside the shape, or the folded ears' band, the pointer is still near. */
const NEAR_X = 48;

/**
 * The shell's zone math (island.rs pointer) over the last window the page
 * sent, window-local points: inside a hit rect (none: the whole window),
 * near within NEAR_X beside the shape or the band in the menu bar band,
 * else far. Like the shell it calls the page only when the zone changes.
 */
function shellPointer(r: Rig, geometry: IslandGeometry = PREVIEW_GEOMETRY) {
  let last: PointerZone | null = null;
  return async (x: number, y: number): Promise<PointerZone> => {
    const size = r.calls().at(-1)!;
    const rects = size.hit ?? [{ x: 0, y: 0, width: size.width, height: size.height }];
    const shape = rects[0]!;
    const beside = (left: number, width: number) => x >= left - NEAR_X && x <= left + width + NEAR_X;
    const inside = rects.some((h) => x >= h.x && x < h.x + h.width && y >= h.y && y < h.y + h.height);
    const inBar = y >= 0 && y <= geometry.menuBarHeight;
    const band = size.band && size.band.width > 0 ? size.band : null;
    const zone: PointerZone = inside ? "inside" : inBar && (beside(shape.x, shape.width) || (!!band && beside(band.x, band.width))) ? "near" : "far";
    if (zone !== last) {
      last = zone;
      await act(async () => r.bridge.emitPointer({ zone, x, y }));
      await settle(2);
    }
    return zone;
  };
}

function shellAsk(r: Rig) {
  const at = r.now();
  return r.emit(
    "approval.requested",
    { approval: { id: "ap-shell", runId: RUN, agentId: "a-klepon", capability: "shell", risk: "write", title: "Run npm install papaparse", detail: { command: "npm install papaparse" }, status: "pending", scope: "once", createdAt: at, decidedAt: null, expiresAt: at + 600_000 } },
    "a-klepon",
    "t-review",
  );
}

describe("a moment through the pipeline", () => {
  test("a hire: the cat comes out under the shape, the ear names it, the sentence is read out, the window holds both", async () => {
    const r = await rig();
    const before = r.calls().at(-1)!;
    expect(before.hit).toBeUndefined();
    await r.emit("agent.spawned", { agent: agentDTO(RUN, "a-kopi", "Kopi", "engineer", r.now()), reason: "work is waiting", hiredBy: "a-oyen" }, "a-kopi");
    const island = r.island();
    const stage = island.nextElementSibling as HTMLElement;
    // a sibling of the shape, never inside it
    expect(stage.classList.contains("moment-stage")).toBe(true);
    expect(island.contains(stage)).toBe(false);
    expect(stage.getAttribute("aria-label")).toBe("Kopi joined the crew as an engineer.");
    expect(stageCats(r.el).map((b) => b.getAttribute("aria-label"))).toEqual(["Kopi, Engineer, needs you"]);
    expect(ear(r.el)).toBe("Kopi joined");
    expect(live(r.el)).toBe("Kopi joined the crew as an engineer.");
    // the ear never shrinks for a label: as wide as before
    const grown = r.calls().at(-1)!;
    expect(grown.width).toBe(before.width);
    expect(grown.height).toBe(before.height + 72);
    // only the shape and the cat take the pointer; the cat touches the shape's bottom edge
    // the cat's 48 pt slot is centred under the shape; the shell gets whole points covering it
    const left = (before.width - 48) / 2;
    expect(grown.hit).toEqual([
      { x: 0, y: 0, width: before.width, height: before.height },
      { x: Math.floor(left), y: before.height, width: Math.ceil(left + 48) - Math.floor(left), height: 48 },
    ]);
    // the moment ends: the stage leaves and the window drops back to the shape
    await r.advance(2300);
    expect(r.el.querySelector(".moment-stage")).toBeNull();
    expect(live(r.el)).toBe("");
    expect(r.calls().at(-1)).toEqual(before);
  });

  test("an engine hint names the cat it is about and what it holds", async () => {
    const r = await rig();
    await r.emit("moment", { kind: "review_fail", agentId: "a-klepon", taskId: "t-review", level: "bad", text: "Klepon found a bug and sent the export back." }, "a-klepon", "t-review");
    expect(ear(r.el)).toBe("Needs a look");
    const cat = r.el.querySelector<HTMLElement>(".moment-stage .cat")!;
    expect(cat.dataset.holding).toBe("bugcard");
    expect(live(r.el)).toBe("Klepon found a bug and sent the export back.");
  });

  test("a finished stage pops the body with its sentence", async () => {
    const r = await rig();
    await r.emit("task.updated", { task: taskDTO(RUN, "t-review", "Review the export", "reviewer", "a-klepon", r.now(), { status: "done", startedAt: r.now(), endedAt: r.now() }) }, "a-klepon", "t-review");
    await r.emit("run.stage", { stage: "testing", previous: "review", reason: "Review passed" });
    expect(r.island().dataset.view).toBe("pop");
    expect(r.el.querySelector(".island-body")?.textContent).toContain("Klepon finished review, testing is next.");
    expect(r.el.querySelector(".island-body")?.textContent).toContain("Now testing, stage 6 of 7.");
    expect(ear(r.el)).toBe("Stage done");
    await r.advance(2500);
    expect(r.island().dataset.view).toBe("collapsed");
  });
});

describe("the window around the stage", () => {
  const kopi = (r: Rig) => r.emit("agent.spawned", { agent: agentDTO(RUN, "a-kopi", "Kopi", "engineer", r.now()), reason: "work is waiting", hiredBy: "a-oyen" }, "a-kopi");

  test("the next stage never starts with the last stage's cats: its first window holds the shape alone", async () => {
    const r = await rig();
    const before = r.calls().at(-1)!;
    await kopi(r);
    const grown = r.calls().at(-1)!;
    expect(grown.hit).toHaveLength(2);
    await r.advance(2300);
    expect(r.el.querySelector(".moment-stage")).toBeNull();
    expect(r.calls().at(-1)).toEqual(before);
    const from = r.calls().length;
    await r.emit("moment", { kind: "review_fail", agentId: "a-klepon", taskId: "t-review", level: "bad", text: "Klepon sent the export back." }, "a-klepon", "t-review");
    const next = r.calls().slice(from);
    const first = next.find((c) => c.height === grown.height)!;
    expect(first.hit).toEqual([grown.hit![0]!]);
    // then its own cat joins the hit rects as it comes out
    expect(next.at(-1)!.hit).toHaveLength(2);
  });

  test("a window drop still waiting out a morph ends with the island: nothing reaches the shell after an unmount", async () => {
    const r = await rig({ reduced: false });
    const before = r.calls().at(-1)!;
    await kopi(r);
    expect(r.calls().at(-1)!.height).toBe(before.height + 72);
    // the moment ends: the cat goes back up (the stage hold), then the stage leaves and the
    // drop to the bare shape waits out a morph no morph end will call (SETTLE_MS)
    await r.advance(2300);
    await settle(1, 260);
    expect(r.el.querySelector(".moment-stage")).toBeNull();
    expect(r.calls().at(-1)!.height).toBe(before.height + 72);
    const sent = r.bridge.calls.length;
    await act(async () => root?.unmount());
    root = null;
    await settle(1, 450);
    expect(r.bridge.calls.length).toBe(sent);
  });
});

describe("asks", () => {
  test("the asking cat holds its prop under the answer panel; a click on it points to Approve; Approve plays its yes at once", async () => {
    const r = await rig();
    await shellAsk(r);
    expect(r.island().dataset.view).toBe("ask");
    const cat = r.el.querySelector<HTMLElement>(".moment-stage .cat")!;
    expect(cat.dataset.holding).toBe("terminal");
    expect(stageCats(r.el)[0]!.getAttribute("aria-label")).toContain("Klepon");
    await press(stageCats(r.el)[0]);
    expect(document.activeElement?.textContent?.trim()).toBe("Approve");
    await readTheAsk();
    await press(button(r.el, "Approve"));
    expect(r.el.querySelector(".island-result")?.textContent).toBe("Approved. Klepon goes ahead.");
    const reacting = r.el.querySelector<HTMLElement>(".moment-stage .cat")!;
    expect(reacting.dataset.pose).toBe("celebrate");
    expect(stageCats(r.el)).toHaveLength(1);
    expect(live(r.el)).toBe("Klepon got your yes.");
    await r.advance(1300);
    expect(r.el.querySelector(".moment-stage .cat")).toBeNull();
  });

  test("Deny: ears down", async () => {
    const r = await rig();
    await shellAsk(r);
    await readTheAsk();
    await press(button(r.el, "Deny"));
    expect(r.el.querySelector<HTMLElement>(".moment-stage .cat")?.dataset.pose).toBe("stopped");
    expect(live(r.el)).toBe("Klepon got your no.");
  });

  test("Escape puts the ask aside: the cat goes back in, the ring turns amber, the ear counts it", async () => {
    const r = await rig();
    await shellAsk(r);
    await act(async () => {
      r.island().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle(3);
    expect(r.island().dataset.view).toBe("collapsed");
    expect(stageCats(r.el)).toHaveLength(0);
    expect(r.el.querySelector<HTMLElement>(".island-ring")?.dataset.tone).toBe("wait");
    expect(ear(r.el)).toBe("Needs you");
  });

  test("stepping through the queue brings the cat of the ask on screen", async () => {
    const r = await rig();
    await shellAsk(r);
    const at = r.now() + 1;
    await r.emit(
      "approval.requested",
      { approval: { id: "ap-file", runId: RUN, agentId: "a-gembul", capability: "fs", risk: "write", title: "Write src/export/csv.ts", detail: {}, status: "pending", scope: "once", createdAt: at, decidedAt: null, expiresAt: at + 600_000 } },
      "a-gembul",
      "t-export",
    );
    expect(r.el.querySelector<HTMLElement>(".moment-stage .cat")?.dataset.holding).toBe("terminal");
    await press(button(r.el, "Next request"));
    await settle(4);
    const cat = r.el.querySelector<HTMLElement>(".moment-stage .cat")!;
    expect(cat.dataset.holding).toBe("page");
    expect(stageCats(r.el)[0]!.getAttribute("aria-label")).toContain("Gembul");
  });
});

describe("the run's end", () => {
  test("a failure keeps Oyen lying still under the island until Dismiss", async () => {
    const r = await rig();
    await r.emit("run.status", { status: "failed", reason: "The provider refused the request." });
    expect(r.island().dataset.view).toBe("failed");
    expect(r.el.querySelector<HTMLElement>(".moment-stage .cat")?.dataset.pose).toBe("stopped");
    const ring = r.el.querySelector<HTMLElement>(".island-ring")!;
    expect(ring.dataset.tone).toBe("failed");
    // closed in --island-danger next to "Failed": the stroke runs the whole circle, never an empty track on black
    expect(ring.querySelector("circle")!.style.strokeDasharray.replace(/,/g, "").replace(/px/g, "")).toBe(ringDash(1, 0));
    expect(ear(r.el)).toBe("Failed");
    await r.advance(60_000);
    expect(r.el.querySelector<HTMLElement>(".moment-stage .cat")).not.toBeNull();
    await press(button(r.el, "Dismiss"));
    expect(r.el.querySelector(".moment-stage .cat")).toBeNull();
    expect(r.island().dataset.view).toBe("idle");
  });

  test("the ship: three cats, the lead in the middle, the ring closed in green", async () => {
    const r = await rig();
    for (const [id, title, role, agent] of [
      ["t-export", "Build the CSV export", "engineer", "a-gembul"],
      ["t-review", "Review the export", "reviewer", "a-klepon"],
    ] as const) {
      await r.emit("task.updated", { task: taskDTO(RUN, id, title, role, agent, r.now(), { status: "done", startedAt: r.now(), endedAt: r.now() }) }, agent, id);
    }
    await r.emit("run.status", { status: "done", reason: null });
    expect(r.island().dataset.view).toBe("shipped");
    expect(stageCats(r.el).map((b) => b.getAttribute("aria-label")?.split(",")[0])).toEqual(["Gembul", "Oyen", "Klepon"]);
    expect(r.el.querySelector<HTMLElement>(".island-ring")?.dataset.tone).toBe("shipped");
    const hit = r.calls().at(-1)!.hit!;
    expect(hit).toHaveLength(4);
  });
});

describe("taps and quirks", () => {
  test("a click on the band's mini cat calls it out instead of opening the run; three quick clicks call a crew cat out to wave", async () => {
    const r = await rig();
    const cat = () => r.el.querySelector<HTMLElement>(".island .island-cat")!;
    expect(cat().querySelector(".cat")?.getAttribute("aria-label")).toMatch(/^Oyen, the CEO/);
    await press(cat());
    expect(stageCats(r.el)[0]!.getAttribute("aria-label")).toContain("Oyen");
    expect(ear(r.el)).toBe("Oyen says hi");
    // the band's own click (open the run) is not triggered by the cat
    expect(r.bridge.calls.some((c) => c.cmd === "island_open_main")).toBe(false);
    await press(cat());
    await press(cat());
    const caller = stageCats(r.el)[0]!.getAttribute("aria-label")!;
    expect(caller.startsWith("Oyen")).toBe(false);
    expect(live(r.el)).toMatch(/pops out to wave\.$/);
  });

  test("a quiet island lets a crew cat fool around once the director allows it; reduced motion never", async () => {
    const r = await rig({ reduced: false });
    expect(stageCats(r.el)).toHaveLength(0);
    // news in the same instant keeps it out of the tuck
    await r.advance(QUIRK_GAP_MAX_MS + QUIRK_QUIET_MS);
    await r.emit("task.updated", { task: taskDTO(RUN, "t-test", "Test the CSV export", "qa", "a-tempe", r.now(), { status: "running", startedAt: r.now() }) }, "a-tempe", "t-test");
    await settle(6);
    const quirk = r.el.querySelector<HTMLElement>(".moment-stage .cat");
    expect(quirk?.dataset.size).toBe("32");
    expect(live(r.el)).toBe("");
    await act(async () => root?.unmount());
    root = null;
    host?.remove();
    const still = await rig({ reduced: true });
    await still.advance(QUIRK_GAP_MAX_MS + QUIRK_QUIET_MS);
    await settle(6);
    expect(still.el.querySelector(".moment-stage .cat")).toBeNull();
  });
});

describe("auto hide", () => {
  test("no news for 20 s tucks into exactly the notch; news brings it back", async () => {
    const r = await rig();
    expect(r.island().dataset.view).toBe("collapsed");
    const open = r.calls().at(-1)!;
    await r.advance(TUCK_MS + 10);
    expect(r.island().dataset.view).toBe("tucked");
    // exactly the notch, with the footprint the ears come back to as the shell's near band
    const notch = PREVIEW_GEOMETRY.notchWidth;
    expect(r.calls().at(-1)).toEqual({ state: "collapsed", width: notch, height: PREVIEW_GEOMETRY.notchHeight, band: { x: (notch - open.width) / 2, width: open.width } });
    await r.emit("task.updated", { task: taskDTO(RUN, "t-test", "Test the CSV export", "qa", "a-tempe", r.now(), { status: "running", startedAt: r.now() }) }, "a-tempe", "t-test");
    expect(r.island().dataset.view).toBe("collapsed");
  });

  test("without a notch the tuck leaves the screen", async () => {
    const r = await rig({ geometry: NO_NOTCH_GEOMETRY });
    await r.advance(TUCK_MS + 10);
    expect(r.island().dataset.view).toBe("tucked");
    expect(r.calls().at(-1)!.state).toBe("hidden");
  });

  test("the pointer near folds the ears at once; far for 600 ms brings them back; inside the shape is hover intent", async () => {
    const r = await rig();
    await act(async () => r.bridge.emitPointer({ zone: "near", x: -20, y: 10 }));
    await settle(2);
    expect(r.island().dataset.view).toBe("tucked");
    await act(async () => r.bridge.emitPointer({ zone: "far", x: -300, y: 80 }));
    await settle(2);
    expect(r.island().dataset.view).toBe("tucked");
    await settle(1, 650);
    expect(r.island().dataset.view).toBe("collapsed");
    // a cat on the stage is not the shape: no peek
    await act(async () => r.bridge.emitPointer({ zone: "inside", x: 200, y: 60 }));
    await settle(1, 250);
    expect(r.island().dataset.view).toBe("collapsed");
    await act(async () => r.bridge.emitPointer({ zone: "inside", x: 200, y: 10 }));
    await settle(1, 250);
    expect(r.island().dataset.view).toBe("peek");
    await act(async () => r.bridge.emitPointer({ zone: "far", x: -300, y: 80 }));
    await settle(1, 400);
    expect(r.island().dataset.view).toBe("collapsed");
  });

  test("folded, a pointer resting over a former ear stays near: the ears stay folded until it truly leaves", async () => {
    const r = await rig();
    const pointer = shellPointer(r);
    const open = r.calls().at(-1)!;
    expect(open.band).toBeUndefined();
    // on its way to the menu bar, just right of the open ears: near folds them
    expect(await pointer(open.width + 30, 10)).toBe("near");
    expect(r.island().dataset.view).toBe("tucked");
    const notch = PREVIEW_GEOMETRY.notchWidth;
    const folded = r.calls().at(-1)!;
    expect(folded.width).toBe(notch);
    expect(folded.band).toEqual({ x: (notch - open.width) / 2, width: open.width });
    // it comes to rest on a menu bar item where the right ear was: beside the bare notch
    // that is far, so without the band the ears would come back under it and take its click
    const ear = (open.width - notch) / 2;
    const overEar = notch + ear - 10;
    expect(overEar).toBeGreaterThan(notch + NEAR_X);
    expect(await pointer(overEar, 10)).toBe("near");
    await settle(1, FAR_RETURN_MS + 1500);
    expect(r.island().dataset.view).toBe("tucked");
    expect(r.calls().at(-1)).toEqual(folded);
    // the same over the left ear
    expect(await pointer(-ear + 10, 10)).toBe("near");
    await settle(1, FAR_RETURN_MS + 100);
    expect(r.island().dataset.view).toBe("tucked");
    // it truly leaves: far for FAR_RETURN_MS brings the ears back, and the band goes
    expect(await pointer(notch + ear + NEAR_X + 20, 10)).toBe("far");
    await settle(1, FAR_RETURN_MS - 300);
    expect(r.island().dataset.view).toBe("tucked");
    await settle(1, 400);
    expect(r.island().dataset.view).toBe("collapsed");
    expect(r.calls().at(-1)).toEqual(open);
  });

  test("the pill ignores near", async () => {
    const pill = await rig({ geometry: NO_NOTCH_GEOMETRY });
    await act(async () => pill.bridge.emitPointer({ zone: "near", x: -20, y: 10 }));
    await settle(2);
    expect(pill.island().dataset.view).toBe("collapsed");
  });
});

describe("dynamic progress", () => {
  test("the ring's dash: done solid from the top, the running share in dots at 45% ink, the rest left to the track", () => {
    const parts = (s: string) => s.split(" ").map(Number);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const p = parts(ringDash(0.5, 0.25));
    expect(p[0]).toBe(0.5);
    expect(p[1]).toBe(0);
    expect(sum(p)).toBeCloseTo(1, 4);
    const dots = p.slice(2, -2);
    expect(dots.length % 2).toBe(0);
    const inked = sum(dots.filter((_, i) => i % 2 === 0));
    expect(inked / 0.25).toBeCloseTo(0.45, 3);
    expect(p.at(-1)).toBeCloseTo(0.25, 3);
    // never past the whole; nothing drawn when nothing is done or running
    expect(sum(parts(ringDash(0.9, 0.5)))).toBeCloseTo(1, 4);
    expect(parts(ringDash(0.9, 0.5)).at(-1)).toBe(0);
    expect(parts(ringDash(0, 0))).toEqual([0, 0, 0, 1]);
    expect(parts(ringDash(Number.NaN, -1))).toEqual([0, 0, 0, 1]);
  });

  test("one stroke in the run's tone over its track: the done share solid, the running share right after it", async () => {
    const r = await rig();
    const ring = r.el.querySelector<HTMLElement>(".island-ring")!;
    expect(ring.dataset.tone).toBe("run");
    const arcs = [...ring.querySelectorAll("circle")];
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.getAttribute("pathLength")).toBe("1");
    // 62% done, two of six tasks running
    expect(arcs[0]!.style.strokeDasharray.replace(/,/g, "").replace(/px/g, "")).toBe(ringDash(0.62, 2 / 6));
    expect(ring.getAttribute("aria-label")).toBe("62 percent of the tasks done");
    await r.emit("run.status", { status: "paused", reason: "Paused by you" });
    expect(r.el.querySelector<HTMLElement>(".island-ring")?.dataset.tone).toBe("paused");
    expect(ear(r.el)).toBe("Paused");
  });

  test("the ear rotates every 6 s through what is true now; the mini cat turns to the cat it names; the shape keeps its width", async () => {
    const r = await rig();
    const width = r.island().style.width;
    expect(ear(r.el)).toBe("Review 5 of 7");
    await r.advance(EAR_CYCLE_MS);
    await settle(2, 30);
    const second = ear(r.el);
    expect(second).not.toBe("Review 5 of 7");
    await r.advance(EAR_CYCLE_MS);
    await settle(2, 30);
    expect(ear(r.el)).toMatch(/^Gembul/);
    expect(r.el.querySelector(".island-cat .cat")?.getAttribute("aria-label")).toMatch(/^Gembul, Engineer/);
    expect(r.island().style.width).toBe(width);
  });
});

/** The gallery writes its query to the page's own URL. */
function atIsland() {
  (window as unknown as { happyDOM?: { setURL(url: string): void } }).happyDOM?.setURL("http://localhost:3000/island");
}

describe("the scenario gallery", () => {
  test("?scenario= opens that scenario with its line under the screen and its button pressed; it plays through the real pipeline", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    atIsland();
    await act(async () => root!.render(<IslandApp search="?scenario=hire&motion=reduced" />));
    await settle();
    const hire = findScenario("hire")!;
    expect(host.querySelector(".island-preview-now-text")?.textContent).toBe(hire.description);
    expect(host.querySelector('.island-preview-scenarios button[aria-pressed="true"]')?.textContent).toBe("Hire");
    // every scenario has its button
    expect(host.querySelectorAll(".island-preview-scenarios button")).toHaveLength(SCENARIOS.length);
    await settle(1, 1300);
    expect(host.querySelector(".moment-stage")?.getAttribute("aria-label")).toBe("Kopi joined the crew as an engineer.");
    expect(host.querySelector(".island-ear-text")?.textContent).toBe("Kopi joined");
  });

  test("Play all tours with Pause and Resume; Replay plays it again; picking a state ends the tour and keeps ?state= working", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    atIsland();
    await act(async () => root!.render(<IslandApp search="?scenario=tap" />));
    await settle();
    const btn = (label: string) => [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label) ?? null;
    await press(btn("Play all"));
    expect(host.querySelector(".island-preview-now-title")?.textContent).toContain(`1 of ${SCENARIOS.length}`);
    expect(host.querySelector(".island-preview-now-text")?.textContent).toBe(SCENARIOS[0]!.description);
    expect(window.location.search).toContain(`scenario=${SCENARIOS[0]!.id}`);
    await press(btn("Pause tour"));
    expect(btn("Resume tour")).not.toBeNull();
    await press(btn("Resume tour"));
    expect(btn("Pause tour")).not.toBeNull();
    await press(btn("Stop tour"));
    expect(btn("Play all")).not.toBeNull();
    await press(btn("Replay"));
    expect(host.querySelector<HTMLElement>(".island")).not.toBeNull();
    await press(btn("Expanded"));
    expect(host.querySelector<HTMLElement>(".island")?.dataset.view).toBe("ask");
    expect(window.location.search).toContain("state=expanded");
    expect(window.location.search).not.toContain("scenario=");
    await press(btn("Reduced"));
    expect(host.querySelector<HTMLElement>(".island")?.dataset.motion).toBe("still");
    expect(window.location.search).toContain("motion=reduced");
  });

  test("an unknown scenario falls back to the sample state", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<IslandApp search="?scenario=nope" />));
    await settle();
    expect(host.querySelector<HTMLElement>(".island")?.dataset.view).toBe("collapsed");
    expect(host.querySelector('.island-preview-states button[aria-pressed="true"]')?.textContent).toBe("Collapsed");
  });
});
