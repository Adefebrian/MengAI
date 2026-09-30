// DeliveryTracker: one stop per stage with its pictogram, ticks behind the
// courier, the returned stop and the Round tag during a loop, the U-turn on
// a move back, the arrival once, stills under reduced motion, selection
// (own or controlled) with Back to live and Escape, and the law guard on
// tracker.css.
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { COMPANY_STAGES, COMPANY_STAGE_LABEL } from "@mengai/shared";
import { DeliveryTracker, type DeliveryTrackerProps, type TrackerStage } from "../index";
import { emulateReducedMotion, mount, wait, type Mounted } from "../test-kit";
import { STAGE_PICTOGRAM, pictogramFor } from "./art";
import { ARRIVE_MS, DRIVE_MS, TURN_MS, clampIndex, roadShare, roundTag, stopLine, stopStates } from "./model";

const studio: TrackerStage[] = COMPANY_STAGES.studio.map((id) => ({ id, label: COMPANY_STAGE_LABEL[id]!, detail: null }));
const fund: TrackerStage[] = COMPANY_STAGES.fund.map((id) => ({ id, label: COMPANY_STAGE_LABEL[id]!, detail: null }));

function props(over: Partial<DeliveryTrackerProps> = {}): DeliveryTrackerProps {
  return {
    stages: studio,
    current: 3,
    done: false,
    status: "Gembul is writing the serializer.",
    eta: "96k tokens to go",
    courier: { name: "Oyen", look: { coat: "ginger", seed: 7 } },
    ...over,
  };
}

let mounted: Mounted | null = null;
let restore: (() => void) | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  restore?.();
  restore = null;
});

function root(): HTMLElement {
  return mounted!.host.querySelector(".tracker") as HTMLElement;
}
function items(): HTMLElement[] {
  return [...mounted!.host.querySelectorAll<HTMLElement>(".tracker-item")];
}

describe("the model", () => {
  test("stops before the courier are done, its own is active, a loop marks the stop it turned back at", () => {
    expect(stopStates(7, 3, false, null)).toEqual(["done", "done", "done", "active", "todo", "todo", "todo"]);
    expect(stopStates(7, 3, false, 4)).toEqual(["done", "done", "done", "active", "returned", "todo", "todo"]);
    expect(stopStates(7, 6, true, null).every((s) => s === "done")).toBe(true);
    expect(clampIndex(9, 7)).toBe(6);
    expect(clampIndex(-2, 7)).toBe(0);
    expect(clampIndex(Number.NaN, 7)).toBe(0);
    expect(roadShare(0, 7)).toBe(0);
    expect(roadShare(6, 7)).toBe(1);
    expect(roadShare(3, 7)).toBeCloseTo(0.5);
  });

  test("the round tag shows from the second round until done", () => {
    expect(roundTag(0, false)).toBeNull();
    expect(roundTag(1, false)).toBe("Round 2");
    expect(roundTag(2, false)).toBe("Round 3");
    expect(roundTag(1, true)).toBeNull();
  });

  test("every studio and fund stage has its own pictogram, unknown ones a flag", () => {
    for (const id of [...COMPANY_STAGES.studio, ...COMPANY_STAGES.fund]) expect(STAGE_PICTOGRAM[id]).toBeDefined();
    expect(new Set([...COMPANY_STAGES.studio, ...COMPANY_STAGES.fund].map(pictogramFor)).size).toBe(14);
    expect(pictogramFor("anything")).toBe("flag");
  });

  test("a stop without its own detail says what its state means", () => {
    expect(stopLine({ id: "review", label: "Review", detail: "csv.ts went to review." }, "done", "Oyen")).toBe("csv.ts went to review.");
    expect(stopLine({ id: "review", label: "Review" }, "todo", "Oyen")).toBe("Oyen has not reached this stop yet.");
    expect(stopLine({ id: "review", label: "Review" }, "returned", "Oyen")).toContain("sent the work back");
  });
});

describe("DeliveryTracker", () => {
  test("one stop per stage, the courier's stop is the current step, and the driver line names it", () => {
    mounted = mount(<DeliveryTracker {...props()} />);
    expect(items()).toHaveLength(7);
    const cur = mounted.host.querySelector('[aria-current="step"]');
    expect(cur?.textContent).toContain("Working");
    expect(mounted.host.querySelector(".tracker-stage")?.textContent).toContain("4 of 7");
    expect(mounted.host.querySelector(".tracker-stage")?.textContent).toContain("96k tokens to go");
    expect(items().map((li) => li.dataset.state)).toEqual(["done", "done", "done", "active", "todo", "todo", "todo"]);
    expect(mounted.host.querySelectorAll(".tk-stamp-pass")).toHaveLength(3);
    const status = mounted.host.querySelector(".tracker-now");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toBe("Gembul is writing the serializer.");
    expect(mounted.host.querySelector(".tracker-stops")?.getAttribute("aria-label")).toBe("7 stops, at stop 4");
    expect(mounted.host.querySelector(".tracker-stop")?.getAttribute("aria-label")).toBe("Goal received, stop 1 of 7, done");
  });

  test("the art is aria-hidden and the courier rides on the road's share", () => {
    mounted = mount(<DeliveryTracker {...props()} />);
    for (const sel of [".tracker-road", ".tracker-pick", ".tracker-courier-track"]) {
      expect(mounted.host.querySelector(sel)?.getAttribute("aria-hidden")).toBe("true");
    }
    const route = mounted.host.querySelector(".tracker-route") as HTMLElement;
    expect(route.style.getPropertyValue("--tk-n")).toBe("7");
    expect(route.style.getPropertyValue("--tk-at")).toBe("3");
    expect(Number(route.style.getPropertyValue("--tk-fill"))).toBeCloseTo(0.5);
    expect(mounted.host.querySelector(".tk-courier")?.getAttribute("data-coat")).toBe("ginger");
  });

  test("a fund run reads the fund stops", () => {
    mounted = mount(<DeliveryTracker {...props({ stages: fund, current: 3 })} />);
    expect(mounted.host.querySelector('[aria-current="step"]')?.textContent).toContain("Risk review");
    expect(items().map((li) => li.textContent)).toEqual(fund.map((s) => s.label));
  });

  test("a loop back marks the stop it turned at, wears Round 2, and clears once passed", () => {
    mounted = mount(<DeliveryTracker {...props({ current: 4 })} />);
    expect(mounted.host.querySelector(".tracker-round")).toBeNull();
    mounted.render(<DeliveryTracker {...props({ current: 3, looping: true, loops: 1 })} />);
    expect(items()[4]!.dataset.state).toBe("returned");
    expect(mounted.host.querySelector(".tk-stamp-return")).not.toBeNull();
    expect(mounted.host.querySelector(".tracker-round")?.textContent).toBe("Round 2");
    mounted.render(<DeliveryTracker {...props({ current: 4, looping: false, loops: 1 })} />);
    expect(items()[4]!.dataset.state).toBe("active");
    expect(mounted.host.querySelector(".tk-stamp-return")).toBeNull();
    expect(mounted.host.querySelector(".tracker-round")?.textContent).toBe("Round 2");
  });

  test("mounted mid-loop, the stop after the courier is the one that sent it back", () => {
    mounted = mount(<DeliveryTracker {...props({ stages: fund, current: 2, looping: true, loops: 1 })} />);
    expect(items()[3]!.dataset.state).toBe("returned");
  });

  test("a move back turns the courier round, drives, then faces forward again", async () => {
    mounted = mount(<DeliveryTracker {...props({ current: 4 })} />);
    expect(root().dataset.dir).toBeUndefined();
    mounted.render(<DeliveryTracker {...props({ current: 3, looping: true, loops: 1 })} />);
    expect(root().dataset.dir).toBe("back");
    expect(root().hasAttribute("data-drive")).toBe(true);
    await wait(TURN_MS + DRIVE_MS + 60);
    expect(root().dataset.dir).toBeUndefined();
    expect(root().hasAttribute("data-drive")).toBe(false);
    mounted.render(<DeliveryTracker {...props({ current: 4, loops: 1 })} />);
    expect(root().dataset.dir).toBeUndefined();
    expect(root().hasAttribute("data-drive")).toBe(true);
  });

  test("the arrival plays once when the run reaches the last stop, never on mount", async () => {
    mounted = mount(<DeliveryTracker {...props({ current: 6, done: true })} />);
    expect(root().hasAttribute("data-done")).toBe(true);
    expect(root().hasAttribute("data-arrive")).toBe(false);
    mounted.unmount();
    mounted = mount(<DeliveryTracker {...props({ current: 5 })} />);
    mounted.render(<DeliveryTracker {...props({ current: 6, done: true, status: "Delivered." })} />);
    expect(root().hasAttribute("data-arrive")).toBe(true);
    expect(items().every((li) => li.dataset.state === "done")).toBe(true);
    expect(mounted.host.querySelector(".tk-head .c-eye-closed")).not.toBeNull();
    expect(root().hasAttribute("data-idle")).toBe(false);
    await wait(ARRIVE_MS + 60);
    expect(root().hasAttribute("data-arrive")).toBe(false);
    expect(root().hasAttribute("data-done")).toBe(true);
  });

  test("reduced motion and still: the courier waits at its stop, no loop, no turn, no arrival", () => {
    restore = emulateReducedMotion(true);
    mounted = mount(<DeliveryTracker {...props({ current: 4 })} />);
    expect(root().dataset.motion).toBe("still");
    expect(root().hasAttribute("data-idle")).toBe(false);
    mounted.render(<DeliveryTracker {...props({ current: 3, looping: true, loops: 1 })} />);
    expect(root().dataset.dir).toBeUndefined();
    expect(root().hasAttribute("data-drive")).toBe(false);
    mounted.render(<DeliveryTracker {...props({ current: 6, done: true })} />);
    expect(root().hasAttribute("data-arrive")).toBe(false);
    expect(mounted.host.querySelector(".tracker-round")).toBeNull();
    restore();
    restore = null;
    mounted.unmount();
    mounted = mount(<DeliveryTracker {...props({ still: true })} />);
    expect(root().dataset.motion).toBe("still");
    expect(mounted.host.querySelector(".tk-courier")?.classList.contains("cat--live")).toBe(false);
  });

  test("live: the courier idles while the run goes on", () => {
    mounted = mount(<DeliveryTracker {...props()} />);
    expect(root().dataset.motion).toBe("live");
    expect(root().hasAttribute("data-idle")).toBe(true);
    expect(mounted.host.querySelector(".tk-courier")?.classList.contains("cat--live")).toBe(true);
  });

  test("tapping a stop reads it in the driver card; Back to live returns to the status", () => {
    const picked: number[] = [];
    const stages = studio.map((s) => (s.id === "hired" ? { ...s, detail: "Gembul and Klepon joined the crew." } : s));
    mounted = mount(<DeliveryTracker {...props({ stages, onStageSelect: (i) => picked.push(i) })} />);
    const stops = () => [...mounted!.host.querySelectorAll<HTMLButtonElement>(".tracker-stop")];
    act(() => stops()[2]!.click());
    expect(picked).toEqual([2]);
    expect(root().hasAttribute("data-selecting")).toBe(true);
    expect(stops()[2]!.getAttribute("aria-pressed")).toBe("true");
    expect(mounted.host.querySelector(".tracker-stage-label")?.textContent).toBe("Team hired");
    expect(mounted.host.querySelector(".tracker-stage")?.textContent).toContain("3 of 7");
    expect(mounted.host.querySelector(".tracker-state")?.textContent).toBe("done");
    expect(mounted.host.querySelector(".tracker-now")?.textContent).toBe("Gembul and Klepon joined the crew.");
    expect(mounted.host.querySelector(".tracker-eta")).toBeNull();
    expect((mounted.host.querySelector(".tracker-route") as HTMLElement).style.getPropertyValue("--tk-sel")).toBe("2");
    const live = mounted.host.querySelector<HTMLButtonElement>(".tracker-live");
    expect(live?.textContent).toBe("Back to live");
    act(() => live!.click());
    expect(picked).toEqual([2, 3]);
    expect(root().hasAttribute("data-selecting")).toBe(false);
    expect(mounted.host.querySelector(".tracker-now")?.textContent).toBe("Gembul is writing the serializer.");
    expect(mounted.host.querySelector(".tracker-live")).toBeNull();
    // the stop the courier is at is live; a second tap on a picked stop is live again
    act(() => stops()[5]!.click());
    expect(mounted.host.querySelector(".tracker-now")?.textContent).toBe("Oyen has not reached this stop yet.");
    act(() => stops()[5]!.click());
    expect(root().hasAttribute("data-selecting")).toBe(false);
    expect(stops()[3]!.hasAttribute("aria-pressed")).toBe(false);
  });

  test("Escape returns to live", () => {
    mounted = mount(<DeliveryTracker {...props()} />);
    act(() => mounted!.host.querySelectorAll<HTMLButtonElement>(".tracker-stop")[1]!.click());
    expect(root().hasAttribute("data-selecting")).toBe(true);
    act(() => {
      root().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(root().hasAttribute("data-selecting")).toBe(false);
  });

  test("controlled: the parent's selected index drives the card, the current stop means live", () => {
    mounted = mount(<DeliveryTracker {...props({ selected: 1 })} />);
    expect(mounted.host.querySelector(".tracker-stage-label")?.textContent).toBe("Oyen plans");
    act(() => mounted!.host.querySelectorAll<HTMLButtonElement>(".tracker-stop")[5]!.click());
    // still the parent's pick until it changes the prop
    expect(mounted.host.querySelector(".tracker-stage-label")?.textContent).toBe("Oyen plans");
    mounted.render(<DeliveryTracker {...props({ selected: 3 })} />);
    expect(root().hasAttribute("data-selecting")).toBe(false);
    expect(mounted.host.querySelector(".tracker-stage-label")?.textContent).toBe("Working");
  });

  test("compact marks the root for the strip layout", () => {
    mounted = mount(<DeliveryTracker {...props({ compact: true })} />);
    expect(root().hasAttribute("data-compact")).toBe(true);
  });

  test("no stages renders nothing", () => {
    mounted = mount(<DeliveryTracker {...props({ stages: [] })} />);
    expect(mounted.host.querySelector(".tracker")).toBeNull();
  });
});

describe("tracker.css law guard", async () => {
  const css = await Bun.file(new URL("./tracker.css", import.meta.url)).text();
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

  test("no gradient, shadow, blur, glow, side line or pseudo-element bar", () => {
    expect(code).not.toMatch(/gradient|box-shadow|drop-shadow|text-shadow|filter\s*:|backdrop-filter|blur\(/i);
    expect(code).not.toMatch(/border-(left|right|top|bottom|inline|block)[\w-]*\s*:/i);
    expect(code).not.toMatch(/::?(before|after)/);
  });

  test("no em-dash, no emoji, no purple", () => {
    expect(css.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(/\p{Extended_Pictographic}/u.test(css)).toBe(false);
    for (const hex of code.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? []) {
      const v = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1);
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const l = (max + min) / 2;
      const s = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
      let h = d === 0 ? 0 : max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
      expect({ hex, purple: s > 0.2 && h >= 235 && h <= 330 }).toEqual({ hex, purple: false });
    }
  });

  test("keyframes move transform and opacity only, every animation names one", () => {
    const names = [...code.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(5);
    for (const block of code.split("@keyframes").slice(1)) {
      const body = block.slice(block.indexOf("{") + 1);
      const end = body.search(/\n}\n/);
      for (const m of body.slice(0, end).matchAll(/([a-z-]+)\s*:/g)) expect(["transform", "opacity"]).toContain(m[1]!);
    }
    for (const m of code.matchAll(/animation\s*:\s*([\w-]+)/g)) {
      if (m[1] !== "none") expect(names).toContain(m[1]);
    }
  });

  test("transitions name transform, opacity or background-color; durations and easing are tokens", () => {
    for (const m of code.matchAll(/transition\s*:\s*([^;]+);/g)) {
      if (m[1]!.trim() === "none" || m[1]!.trim() === "none !important") continue;
      for (const part of m[1]!.split(",")) expect(["transform", "opacity", "background-color"]).toContain(part.trim().split(/\s+/)[0]!);
    }
    expect(code).not.toMatch(/cubic-bezier|ease-in|ease-out|ease-in-out/);
    expect(code).not.toMatch(/(?:animation|transition)[^;]*?\b\d+(?:\.\d+)?m?s\b/);
  });

  test("type and spacing use tokens, reduced motion stills everything", () => {
    for (const m of code.matchAll(/font-size\s*:\s*([^;]+);/g)) expect(m[1]).toMatch(/^var\(--text-/);
    for (const m of code.matchAll(/(?:^|[\s;{])(padding|margin|gap|row-gap|column-gap)[\w-]*\s*:\s*([^;]+);/g)) {
      expect({ rule: m[0].trim(), raw: /\d+px/.test(m[2]!.replace(/var\([^)]*\)/g, "")) }).toEqual({ rule: m[0].trim(), raw: false });
    }
    expect(code).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.tracker,\s*\.tracker \*\s*\{\s*animation: none !important;\s*transition: none !important;/);
  });

  test("the JS timings mirror the CSS tokens", () => {
    expect(DRIVE_MS).toBe(400);
    expect(TURN_MS).toBe(150);
    expect(code).toContain("transform var(--dur-400) var(--ease-standard)");
    expect(code).toContain("transition: transform var(--dur-150) var(--ease-standard)");
    // hop from 400 + 600, prints from 600 + 2 staggers + 600: all inside the arrival window
    expect(ARRIVE_MS).toBeGreaterThanOrEqual(400 + 600);
    expect(ARRIVE_MS).toBeLessThanOrEqual(1600);
  });
});
