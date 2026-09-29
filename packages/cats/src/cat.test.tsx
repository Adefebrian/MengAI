import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import {
  ACTIVITIES,
  ACTIVITY_LABEL,
  ACTIVITY_MIN_DWELL_MS,
  AGENT_ROLES,
  AGENT_STATUSES,
  COATS,
  MOODS,
  type Activity,
  type AgentStatus,
  type Mood,
} from "@mengai/shared";
import { Cat, type CatProps } from "./index";
import { emulateReducedMotion, fakeIntersection, motionClasses, mount, wait, type Mounted } from "./test-kit";

function props(over: Partial<CatProps> = {}): CatProps {
  return {
    look: { coat: "ginger", seed: 1234 },
    role: "engineer",
    status: "working",
    activity: "code",
    mood: "calm",
    label: "Kopi, Engineer, writing code",
    ...over,
  };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

let mounted: Mounted | null = null;
let restore: (() => void) | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  restore?.();
  restore = null;
});

describe("every status, activity and mood renders", () => {
  test("labelled, tagged, and drawn for all 600 combinations", () => {
    let count = 0;
    for (const status of AGENT_STATUSES) {
      for (const activity of ACTIVITIES) {
        for (const mood of MOODS) {
          const label = `Mochi, Engineer, ${status} ${activity} ${mood}`;
          const html = renderToStaticMarkup(<Cat {...props({ status, activity, mood, label })} />);
          expect(html).toContain(`aria-label="${escapeAttr(label)}"`);
          expect(html).toContain(`data-status="${status}"`);
          expect(html).toContain(`data-activity="${activity}"`);
          expect(html).toContain(`data-mood="${mood}"`);
          expect(html).toContain(`data-pose="${status === "stopped" ? "stopped" : activity}"`);
          expect(html).toContain('role="img"');
          expect(html).toContain('viewBox="0 0 160 160"');
          expect(html).toContain('aria-hidden="true"');
          count++;
        }
      }
    }
    expect(count).toBe(AGENT_STATUSES.length * ACTIVITIES.length * MOODS.length);
  });

  test("every coat and role renders with a known coat", () => {
    for (const coat of COATS) {
      for (const role of AGENT_ROLES) {
        const html = renderToStaticMarkup(<Cat {...props({ look: { coat, seed: 7 }, role, activity: "rest", status: "idle" })} />);
        expect(html).toContain(`data-coat="${coat}"`);
        expect(html).toContain(`data-role="${role}"`);
      }
    }
  });

  test("an unknown coat falls back to one of the eight by seed", () => {
    const html = renderToStaticMarkup(<Cat {...props({ look: { coat: "plaid", seed: 3 } })} />);
    expect(html).toContain(`data-coat="${COATS[3]}"`);
  });

  test("every size keeps its own box", () => {
    for (const size of [48, 64, 96, 160] as const) {
      const html = renderToStaticMarkup(<Cat {...props({ size })} />);
      expect(html).toContain(`data-size="${size}"`);
    }
  });
});

describe("still and reduced motion", () => {
  test("still renders a distinct static pose per activity, with the label text", () => {
    const shapes = new Map<string, Activity>();
    for (const activity of ACTIVITIES) {
      const html = renderToStaticMarkup(<Cat {...props({ activity, status: "working", still: true })} />);
      const host = document.createElement("div");
      host.innerHTML = html;
      expect(motionClasses(host)).toEqual([]);
      expect(host.querySelector(".cat")?.getAttribute("data-motion")).toBe("still");
      expect(host.querySelector(".cat-caption")?.textContent).toBe(ACTIVITY_LABEL[activity]);
      expect(host.querySelector(".cat")?.getAttribute("aria-label")).toBe("Kopi, Engineer, writing code");
      const svg = host.querySelector("svg")!;
      svg.querySelectorAll("[data-pose]").forEach((el) => el.removeAttribute("data-pose"));
      const drawn = svg.innerHTML;
      expect(shapes.has(drawn)).toBe(false);
      shapes.set(drawn, activity);
    }
    expect(shapes.size).toBe(ACTIVITIES.length);
  });

  test("the stopped still lies down with its words", () => {
    mounted = mount(<Cat {...props({ status: "stopped", activity: "rest", still: true })} />);
    expect(mounted.host.querySelector(".cat-lie")).not.toBeNull();
    expect(mounted.host.querySelector(".cat-caption")?.textContent).toBe("Stopped");
  });

  test("small still cats keep their square box: no caption under 96 px", () => {
    mounted = mount(<Cat {...props({ size: 48, still: true })} />);
    expect(mounted.host.querySelector(".cat-caption")).toBeNull();
    expect(mounted.host.querySelector(".cat")?.getAttribute("aria-label")).toBe("Kopi, Engineer, writing code");
  });

  test("reduced motion sets no animation class for any status, activity or mood", () => {
    restore = emulateReducedMotion(true);
    mounted = mount(<Cat {...props()} />);
    for (const status of AGENT_STATUSES) {
      for (const activity of ACTIVITIES) {
        for (const mood of ["calm", "frustrated"] as Mood[]) {
          mounted.render(<Cat {...props({ status, activity, mood, interactive: true, onSelect: () => {}, celebrateKey: 1 })} />);
          expect(motionClasses(mounted.host)).toEqual([]);
          expect(mounted.host.querySelector(".cat")?.getAttribute("data-motion")).toBe("still");
          expect(mounted.host.querySelector("[data-fade]")).toBeNull();
        }
      }
    }
  });

  test("reduced motion shows the label text under the cat", () => {
    restore = emulateReducedMotion(true);
    mounted = mount(<Cat {...props({ activity: "research", status: "working" })} />);
    expect(mounted.host.querySelector(".cat-caption")?.textContent).toBe(ACTIVITY_LABEL.research);
  });

  test("motion allowed: the live class is on and there is no caption", () => {
    restore = emulateReducedMotion(false);
    mounted = mount(<Cat {...props()} />);
    const root = mounted.host.querySelector(".cat")!;
    expect(root.classList.contains("cat--live")).toBe(true);
    expect(root.getAttribute("data-motion")).toBe("live");
    expect(mounted.host.querySelector(".cat-caption")).toBeNull();
  });
});

describe("activity dwell and crossfade", () => {
  test("a new activity waits out the dwell, then crossfades", async () => {
    restore = emulateReducedMotion(false);
    mounted = mount(<Cat {...props({ activity: "code" })} />);
    const root = () => mounted!.host.querySelector(".cat")!;
    mounted.render(<Cat {...props({ activity: "read" })} />);
    mounted.render(<Cat {...props({ activity: "run" })} />);
    expect(root().getAttribute("data-pose")).toBe("code");
    await wait(ACTIVITY_MIN_DWELL_MS + 60);
    expect(root().getAttribute("data-pose")).toBe("run");
    const rigs = mounted.host.querySelectorAll(".cat-rig");
    expect(rigs.length).toBe(2);
    expect(rigs[0]!.getAttribute("data-fade")).toBe("out");
    expect(rigs[0]!.getAttribute("data-pose")).toBe("code");
    expect(rigs[1]!.getAttribute("data-fade")).toBe("in");
    await wait(340);
    expect(mounted.host.querySelectorAll(".cat-rig").length).toBe(1);
    expect(mounted.host.querySelector("[data-fade]")).toBeNull();
  });

  test("still cats swap poses without a crossfade", async () => {
    mounted = mount(<Cat {...props({ activity: "code", still: true })} />);
    mounted.render(<Cat {...props({ activity: "plan", still: true })} />);
    await wait(ACTIVITY_MIN_DWELL_MS + 60);
    expect(mounted.host.querySelectorAll(".cat-rig").length).toBe(1);
    expect(mounted.host.querySelector(".cat")?.getAttribute("data-pose")).toBe("plan");
  });
});

describe("celebration, interaction, offscreen", () => {
  test("celebrateKey plays once when it changes, never on mount", async () => {
    restore = emulateReducedMotion(false);
    mounted = mount(<Cat {...props({ celebrateKey: 0 })} />);
    const root = () => mounted!.host.querySelector(".cat")!;
    expect(root().classList.contains("cat-celebrate")).toBe(false);
    mounted.render(<Cat {...props({ celebrateKey: 1 })} />);
    expect(root().classList.contains("cat-celebrate")).toBe(true);
    expect(mounted.host.querySelectorAll(".cat-print").length).toBe(4);
    await wait(960);
    expect(root().classList.contains("cat-celebrate")).toBe(false);
    expect(mounted.host.querySelector(".cat-print")).toBeNull();
  });

  test("with onSelect the cat is a button that selects and reacts to a tap", () => {
    restore = emulateReducedMotion(false);
    let selected = 0;
    mounted = mount(<Cat {...props({ interactive: true, onSelect: () => selected++ })} />);
    const button = mounted.host.querySelector("button.cat") as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Kopi, Engineer, writing code");
    act(() => button.click());
    expect(selected).toBe(1);
    expect(button.classList.contains("cat-react-tap")).toBe(true);
  });

  test("interactive cats follow the pointer through custom properties only", async () => {
    restore = emulateReducedMotion(false);
    mounted = mount(<Cat {...props({ interactive: true })} />);
    const root = mounted.host.querySelector(".cat") as HTMLElement;
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 900, clientY: 20 }));
    });
    await wait(40);
    expect(root.style.getPropertyValue("--cat-look-x")).not.toBe("");
    expect(Number(root.style.getPropertyValue("--cat-look-x"))).toBeGreaterThan(0);
  });

  test("an offscreen cat is paused and a visible one resumes", () => {
    restore = emulateReducedMotion(false);
    const io = fakeIntersection();
    try {
      mounted = mount(<Cat {...props()} />);
      const root = mounted.host.querySelector(".cat")!;
      expect(io.observers.length).toBeGreaterThan(0);
      io.observers.at(-1)!.fire(false);
      expect(root.hasAttribute("data-offscreen")).toBe(true);
      io.observers.at(-1)!.fire(true);
      expect(root.hasAttribute("data-offscreen")).toBe(false);
    } finally {
      io.restore();
    }
  });

  test("statuses drive the status layer on the root", () => {
    for (const status of AGENT_STATUSES as readonly AgentStatus[]) {
      const html = renderToStaticMarkup(<Cat {...props({ status, activity: "rest" })} />);
      expect(html).toContain(`data-cat-status="${status}"`);
      if (status === "stopped") expect(html).toContain('class="cat-lie"');
    }
  });
});
