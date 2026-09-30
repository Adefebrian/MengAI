// The Office component: every cat gets its own desk and floor actor at
// every crew size, desks are selectable buttons with honest names, reduced
// motion and `still` render no motion at all and write beats out, the hero
// leaves the meeting room and the pantry out, beats report done.
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentRole } from "@mengai/shared";
import { Office, type OfficeAgent, type OfficeProps } from "../index";
import { MOTION_CLASS, emulateReducedMotion, mount, wait, type Mounted } from "../test-kit";

const ROLES: AgentRole[] = ["lead", "engineer", "reviewer", "qa", "designer", "researcher", "security", "operator"];

function agent(i: number, over: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id: `c${i}`,
    name: `Cat ${i}`,
    role: ROLES[i % ROLES.length]!,
    look: { coat: "tabby", seed: 300 + i },
    status: "working",
    activity: "code",
    mood: "focused",
    energy: 0.3,
    parentId: i === 0 ? null : "c0",
    taskTitle: `Task number ${i}`,
    statusText: `Doing thing ${i}`,
    file: `src/file-${i}.ts`,
    ...over,
  };
}

function props(n: number, over: Partial<OfficeProps> = {}): OfficeProps {
  return {
    agents: Array.from({ length: n }, (_, i) => agent(i)),
    meetings: [],
    beats: [],
    plan: [
      { id: "p1", title: "Build the form", status: "doing", ownerId: "c1" },
      { id: "p2", title: "Review the form", status: "todo", ownerId: "c2" },
    ],
    label: `The office, ${n} cats at work`,
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

describe("Office", () => {
  test("every crew size from 1 to 12 gets one desk and one floor actor per cat", () => {
    for (const n of [1, 2, 3, 5, 8, 12]) {
      const html = renderToStaticMarkup(<Office {...props(n)} />);
      for (let i = 0; i < n; i++) {
        expect(html).toContain(`class="of-desk" data-agent="c${i}"`);
        expect(html).toContain(`data-agent="c${i}" data-where="desk"`);
      }
      expect(html).toContain(`aria-label="The office, ${n} cats at work"`);
      expect(html).toContain('aria-hidden="true"');
    }
  });

  test("desks are buttons when selectable: the whole desk, an honest name, pressed state", () => {
    let picked = "";
    mounted = mount(<Office {...props(4)} selectedId="c2" onSelect={(id) => (picked = id)} />);
    const buttons = [...mounted.host.querySelectorAll<HTMLButtonElement>("button.office-hit")];
    expect(buttons.length).toBe(4);
    const c2 = buttons.find((b) => b.getAttribute("aria-label")?.startsWith("Cat 2"))!;
    expect(c2.getAttribute("aria-pressed")).toBe("true");
    expect(c2.getAttribute("aria-label")).toBe("Cat 2, Reviewer, writing code, Task number 2");
    buttons.find((b) => b.getAttribute("aria-label")?.startsWith("Cat 1"))!.click();
    expect(picked).toBe("c1");
  });

  test("no buttons when the scene is not selectable", () => {
    const html = renderToStaticMarkup(<Office {...props(3)} />);
    expect(html).not.toContain("<button");
    expect(html).toContain('role="group"');
  });

  test("each monitor names the cat's file, each desk card its name and task", () => {
    const html = renderToStaticMarkup(<Office {...props(3)} />);
    expect(html).toContain("file-1.ts");
    expect(html).toContain("Cat 1");
    expect(html).toContain("Task number 1");
  });

  test("the plan whiteboard shows its cards by column, each with its owner's coat", () => {
    const html = renderToStaticMarkup(<Office {...props(3)} />);
    expect(html).toContain("Doing");
    expect(html).toContain("To do");
    // a chip keeps the whole title when it fits, else its short title (the verb and its head noun)
    expect(html).toMatch(/>Build (the )?form</);
    expect(html).toContain("0 of 2");
    expect(html).toMatch(/class="cat of-token" data-coat="[a-z]+"/);
    // a small board names itself and the latest move
    const hero = renderToStaticMarkup(<Office {...props(3)} variant="hero" />);
    expect(hero).toContain("Plan");
    expect(hero).toContain("Doing: Build the");
  });

  test("the hero has no meeting room and no pantry", () => {
    const hero = renderToStaticMarkup(<Office {...props(5)} variant="hero" />);
    expect(hero).not.toContain("Pantry");
    expect(hero).not.toContain("Meeting room");
    const full = renderToStaticMarkup(<Office {...props(5)} />);
    expect(full).toContain("Pantry");
    expect(full).toContain("Meeting room");
  });

  test("reduced motion: no motion class anywhere, the scene says still", () => {
    restore = emulateReducedMotion(true);
    mounted = mount(<Office {...props(6)} />);
    const office = mounted.host.querySelector(".office")!;
    expect(office.getAttribute("data-motion")).toBe("still");
    const moving = [...mounted.host.querySelectorAll("[class]")].filter((el) => MOTION_CLASS.test(el.getAttribute("class") ?? ""));
    expect(moving).toEqual([]);
  });

  test("still writes each beat out under the scene and reports it done", async () => {
    const done: string[] = [];
    const p = props(4, { still: true, onBeatDone: (id) => done.push(id) });
    mounted = mount(<Office {...p} />);
    mounted.render(<Office {...p} beats={[{ id: "b1", kind: "handoff", fromId: "c1", toId: "c2", taskTitle: "The form" }]} />);
    await wait(50);
    const notes = mounted.host.querySelector(".office-notes");
    expect(notes?.textContent).toContain('Cat 1 hands "The form" to Cat 2');
    await wait(2400);
    expect(done).toEqual(["b1"]);
  });

  test("live: the newest beat is spoken politely", async () => {
    const p = props(4);
    mounted = mount(<Office {...p} />);
    mounted.render(<Office {...p} beats={[{ id: "a", kind: "ask", fromId: "c3", toId: "c0", question: "May I?" }]} />);
    await wait(20);
    const live = mounted.host.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("Cat 3 asks Cat 0: May I?");
    expect(mounted.host.querySelector(".office-notes")).toBeNull();
  });

  test("a status line shows in a bubble over the cat", () => {
    const html = renderToStaticMarkup(<Office {...props(2)} />);
    expect(html).toContain("of-bubble");
    expect(html).toContain("Doing thing 1");
  });

  test("a stopped cat dims, an error shows the warning shape", () => {
    const agents = [agent(0), agent(1, { status: "stopped" }), agent(2, { status: "error", mood: "frustrated" })];
    const html = renderToStaticMarkup(<Office {...props(3)} agents={agents} />);
    expect(html).toContain('data-pose="stopped"');
    expect(html).toContain("cat-warning");
    expect(html).toContain("Stopped");
    expect(html).toContain("Error");
  });

  test("the fund dresses the floor: a ticker, a risk committee, two market screens per desk", () => {
    const html = renderToStaticMarkup(<Office {...props(4)} theme="fund" />);
    expect(html).toContain('data-theme-office="fund"');
    expect(html).toContain("PAWS");
    expect(html).toContain("Risk committee");
    expect(html).toContain('data-mode="chart"');
    const monitors = html.match(/class="of-monitor"/g)?.length ?? 0;
    expect(monitors).toBe(8);
    const studio = renderToStaticMarkup(<Office {...props(4)} />);
    expect(studio).not.toContain("PAWS");
    expect(studio).toContain("Test rack");
  });

  test("a trader executing an order stands at its desk with a ticket", () => {
    const agents = [agent(0), agent(1, { activity: "automate" }), agent(2)];
    const html = renderToStaticMarkup(<Office {...props(3)} agents={agents} theme="fund" />);
    expect(html).toContain("of-lifted");
    expect(html).toMatch(/>(Buy|Sell)</);
  });

  test("a hire walks in through the door carrying a box", async () => {
    const p = props(4);
    mounted = mount(<Office {...p} />);
    const next = [...p.agents, agent(4, { name: "New cat" })];
    mounted.render(<Office {...p} agents={next} />);
    await wait(40);
    const actor = mounted.host.querySelector('.of-actor[data-agent="c4"]');
    expect(actor?.getAttribute("data-where")).toBe("floor");
    expect(actor?.querySelector(".of-box")).not.toBeNull();
    expect(mounted.host.querySelector(".of-door")?.hasAttribute("data-open")).toBe(true);
    expect(mounted.host.querySelector('[aria-live="polite"]')?.textContent).toBe("New cat joins the crew");
  });

  test("a leaver packs a box, walks out, and leaves a free desk", async () => {
    const p = props(5, { still: true });
    mounted = mount(<Office {...p} />);
    mounted.render(<Office {...p} agents={p.agents.filter((a) => a.id !== "c3")} />);
    await wait(60);
    expect(mounted.host.querySelector(".office-notes")?.textContent).toContain("Cat 3 packs a box and leaves the office");
    expect(mounted.host.querySelector('[data-vacant]')?.textContent).toContain("Free desk");
    expect(mounted.host.querySelector('.of-desk[data-agent="c3"]')).toBeNull();
  });

  test("windows show the clock, the rack shows the tests", () => {
    const html = renderToStaticMarkup(<Office {...props(4)} />);
    expect(html).toMatch(/class="of-window" data-day="(day|dusk|night)"/);
    mounted = mount(<Office {...props(4)} agents={[agent(0), agent(1, { activity: "run" }), agent(2), agent(3)]} />);
    expect(mounted.host.querySelector("[data-rack]")?.getAttribute("data-rack")).toBe("testing");
    expect(mounted.host.textContent).toContain("Tests running");
  });

  test("the story clock sets the sky: a day with the sun until 18:00, dusk, night only late", async () => {
    for (const [hour, day] of [[10, "day"], [18.5, "dusk"], [21, "night"]] as const) {
      mounted = mount(<Office {...props(4)} hour={hour} />);
      await wait(10);
      expect(mounted.host.querySelector(".of-window")?.getAttribute("data-day")).toBe(day);
      if (day === "day") expect(mounted.host.querySelector(".of-window .of-sun")).not.toBeNull();
      if (day === "night") expect(mounted.host.querySelector(".of-window .of-moon")).not.toBeNull();
      mounted.unmount();
      mounted = null;
    }
  });

  test("every monitor with work on it shows its screen; the paw stays for a resting cat", () => {
    const agents = [
      agent(0, { activity: "think", status: "thinking" }),
      agent(1, { activity: "handoff" }),
      agent(2, { activity: "wait", status: "waiting" }),
      agent(3, { activity: "ask", status: "waiting" }),
      agent(4, { activity: "rest", status: "idle", taskTitle: null, file: null }),
    ];
    const html = renderToStaticMarkup(<Office {...props(5)} agents={agents} />);
    const modeOf = (id: string) => html.split(`class="of-desk" data-agent="${id}"`)[1]?.match(/class="of-monitor" data-mode="([a-z]+)"/)?.[1];
    // the lead's plan board, the engineer's editor, the reviewer's diff, QA's test run with ticks, the resting cat's paw
    expect(["c0", "c1", "c2", "c3", "c4"].map(modeOf)).toEqual(["board", "code", "review", "run", "idle"]);
    expect(html).toContain("of-diff-add");
    expect(html).toContain("of-run-check");
  });

  test("the fund's second screen shows a sparkline or an order ticket between calls", () => {
    const agents = [agent(0, { activity: "think" }), agent(1, { activity: "handoff" }), agent(2, { activity: "wait", status: "waiting" }), agent(3, { activity: "ask", status: "waiting" })];
    const html = renderToStaticMarkup(<Office {...props(4)} agents={agents} theme="fund" />);
    const modes = [...html.matchAll(/class="of-monitor" data-mode="([a-z]+)"/g)].map((m) => m[1]);
    expect(modes.filter((m) => m === "idle")).toEqual([]);
    expect(modes).toContain("spark");
    expect(modes).toContain("ticket");
  });

  test("every floor cat stands on a flat contact ellipse, in a depth slot", () => {
    const html = renderToStaticMarkup(<Office {...props(3)} />);
    expect(html.match(/class="of-contact"/g)?.length).toBe(3);
    expect(html.match(/class="of-slot" data-slot=""/g)?.length).toBe(3);
    expect(html).toMatch(/<clipPath id="[^"]+-depth-0"/);
  });

  test("two scenes on one page never share a clip path id", () => {
    const html = renderToStaticMarkup(
      <>
        <Office {...props(4)} />
        <Office {...props(4)} variant="hero" theme="fund" />
      </>,
    );
    const ids = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(8);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
