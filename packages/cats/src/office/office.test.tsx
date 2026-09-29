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

  test("the plan whiteboard shows its cards by column", () => {
    const html = renderToStaticMarkup(<Office {...props(3)} />);
    expect(html).toContain("Plan");
    expect(html).toContain("Doing");
    expect(html).toContain("Build the");
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
});
