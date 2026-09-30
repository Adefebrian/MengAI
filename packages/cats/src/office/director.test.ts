// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The director on a fake clock: beats play in order per cat, cats who are
// not involved keep working, every beat reports done once, asks park at the
// CEO until the answer, meetings seat and release the crew, a new plan
// replays a beat in flight, reduced motion moves instantly, a paused scene
// holds still.
import { describe, expect, test } from "bun:test";
import type { AgentRole } from "@mengai/shared";
import type { OfficeAgent, OfficeBeat, OfficeMeeting } from "../office-contract";
import { Director, TIMING, daypartOf, samePlaces, type TimerHost } from "./director";
import { bandOf, deskOf, pathLength, planOffice, route, type OfficeVariant } from "./geometry";

class FakeTimers implements TimerHost {
  t = 0;
  private seq = 0;
  private q = new Map<number, { at: number; fn: () => void }>();
  set(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.q.set(id, { at: this.t + ms, fn });
    return id;
  }
  clear(h: unknown): void {
    this.q.delete(h as number);
  }
  now(): number {
    return this.t;
  }
  /** Moves time forward, firing due timers and letting the scripts' promises settle between them. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      await flush();
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.q) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.q.delete(next[0]);
      this.t = Math.max(this.t, next[1].at);
      next[1].fn();
    }
    this.t = end;
    await flush();
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const ROLES: AgentRole[] = ["lead", "engineer", "reviewer", "qa", "designer", "researcher", "security", "operator"];

function agent(i: number, over: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id: `a${i}`,
    name: `Cat${i}`,
    role: ROLES[i % ROLES.length]!,
    look: { coat: "ginger", seed: 1000 + i },
    status: "working",
    activity: "code",
    mood: "calm",
    energy: 0.2,
    parentId: i === 0 ? null : "a0",
    taskTitle: `Task ${i}`,
    statusText: null,
    file: null,
    ...over,
  };
}

function setup(n = 5, variant: OfficeVariant = "full", width = 1280) {
  const timers = new FakeTimers();
  const done: string[] = [];
  const d = new Director({ timers, onBeatDone: (id) => done.push(id) });
  const agents = Array.from({ length: n }, (_, i) => agent(i));
  const plan = planOffice(agents, width, variant);
  d.attach();
  d.setAgents(agents);
  d.setPlan(plan);
  return { d, timers, done, agents, plan };
}

const LONG = 60_000;

describe("beats", () => {
  test("a handoff stands the giver up, walks it over, hands the card and brings it back", async () => {
    const { d, timers, done, plan } = setup();
    d.setBeats([{ id: "b1", kind: "handoff", fromId: "a1", toId: "a2", taskTitle: "Ship it" }]);
    await timers.advance(1);
    expect(d.actor("a1").where).toBe("floor");
    await timers.advance(TIMING.stand + 5);
    expect(d.actor("a1").carry).toBe("card");
    expect(d.actor("a1").pose).toBe("walk");
    await timers.advance(LONG);
    expect(done).toEqual(["b1"]);
    expect(d.actor("a1").where).toBe("desk");
    expect(d.actor("a2").react?.kind).toBe("catch");
    expect(d.position("a1")).toEqual(deskOf(plan, "a1")!.home.p);
    expect(d.noteList()[0]!.text).toContain("hands");
  });

  test("beats queue per cat in order, other cats play at the same time", async () => {
    const { d, timers, done } = setup();
    d.setBeats([
      { id: "x1", kind: "deliver", fromId: "a1", taskTitle: "One" },
      { id: "y1", kind: "deliver", fromId: "a3", taskTitle: "Other" },
      { id: "x2", kind: "review", reviewerId: "a1", ownerId: "a4", passed: true, taskTitle: "Two" },
    ]);
    await timers.advance(1);
    expect(d.isBusy("a1")).toBe(true);
    expect(d.isBusy("a3")).toBe(true);
    expect(d.pendingCount()).toBe(1);
    await timers.advance(LONG * 2);
    expect(done.indexOf("x1")).toBeLessThan(done.indexOf("x2"));
    expect(done.sort()).toEqual(["x1", "x2", "y1"]);
  });

  test("an ask parks at the CEO with the paw up, the decision stamps the card and walks it home", async () => {
    const { d, timers, done, plan } = setup();
    d.setBeats([{ id: "q", kind: "ask", fromId: "a3", toId: "a0", question: "May I?" }]);
    await timers.advance(20_000);
    expect(done).toEqual(["q"]);
    expect(d.actor("a3").where).toBe("floor");
    expect(d.actor("a3").pose).toBe("back");
    expect(d.actor("a3").paw).toBe(true);
    expect(plan.ceo.visitors.map((s) => s.p)).toContainEqual(d.position("a3")!);
    d.setBeats([{ id: "r", kind: "decided", byId: "a0", toId: "a3", approved: true, answer: "Yes" }]);
    await timers.advance(1);
    expect(d.actor("a0").react?.kind).toBe("approve");
    await timers.advance(TIMING.nod + 10);
    expect(d.actor("a3").carry).toBe("card-pass");
    await timers.advance(LONG);
    expect(done).toEqual(["q", "r"]);
    expect(d.actor("a3").where).toBe("desk");
  });

  test("a no shakes the head and stamps a return on a cat at its desk", async () => {
    const { d, timers, done } = setup();
    d.setBeats([{ id: "n", kind: "decided", byId: "a0", toId: "a2", approved: false, answer: "Not yet" }]);
    await timers.advance(1);
    expect(d.actor("a0").react?.kind).toBe("shake");
    await timers.advance(TIMING.nod + 10);
    expect(d.actor("a2").react?.kind).toBe("stamp-return");
    await timers.advance(LONG);
    expect(done).toEqual(["n"]);
  });

  test("an asker that never hears back walks home after a while", async () => {
    const { d, timers } = setup();
    d.setBeats([{ id: "q", kind: "ask", fromId: "a2", toId: "a0", question: "Hello?" }]);
    await timers.advance(TIMING.park + LONG);
    expect(d.actor("a2").where).toBe("desk");
  });

  test("a beat with unknown cats is done at once", async () => {
    const { d, timers, done } = setup();
    d.setBeats([{ id: "u", kind: "handoff", fromId: "ghost", toId: "a1", taskTitle: "x" }]);
    await timers.advance(1);
    expect(done).toEqual(["u"]);
  });

  test("each beat plays once, even when the same list comes again", async () => {
    const { d, timers, done } = setup();
    const beats: OfficeBeat[] = [{ id: "once", kind: "deliver", fromId: "a1", taskTitle: "x" }];
    d.setBeats(beats);
    d.setBeats(beats);
    await timers.advance(LONG);
    d.setBeats(beats);
    await timers.advance(LONG);
    expect(done).toEqual(["once"]);
  });

  test("celebrate stands everyone up at once and sits them back down", async () => {
    const { d, timers, done } = setup(4);
    d.setBeats([{ id: "c", kind: "celebrate", agentIds: ["a0", "a1", "a2", "a3"] }]);
    await timers.advance(TIMING.stand + 5);
    for (const id of ["a0", "a1", "a2", "a3"]) {
      expect(d.actor(id).where).toBe("floor");
      expect(d.actor(id).react?.kind).toBe("celebrate");
    }
    await timers.advance(LONG);
    expect(done).toEqual(["c"]);
    for (const id of ["a0", "a1", "a2", "a3"]) expect(d.actor(id).where).toBe("desk");
  });
});

describe("meetings", () => {
  const meeting = (endedAt: number | null, ids = ["a0", "a1", "a2", "a3"]): OfficeMeeting => ({
    id: "m1",
    kind: "sync",
    title: "Sync",
    agentIds: ids,
    agenda: ["One", "Two"],
    endedAt,
    notes: endedAt ? ["Done"] : [],
  });

  test("a meeting already in session when the scene opens has its crew in the seats at once", async () => {
    const { d, timers } = setup(6);
    d.setMeetings([meeting(null)]);
    await timers.advance(1);
    for (const id of ["a0", "a1", "a2", "a3"]) expect(d.actor(id).where).toBe("seat");
    expect(d.meetingView().seated.length).toBe(4);
    expect(d.meetingView().running).toBe(true);
  });

  test("attendees file into their seats a cat's width apart, a speaker takes turns, then they go back", async () => {
    const { d, timers, plan } = setup(6);
    await timers.advance(TIMING.opening + 10);
    d.setMeetings([meeting(null)]);
    // each cat sets off late enough to reach the room a cat's width behind the one ahead (never two at the gap at once)
    const ids = ["a0", "a1", "a2", "a3"];
    const off = new Map<string, number>();
    for (let t = 0; t < 8000 && off.size < ids.length; t += 50) {
      for (const id of ids) if (!off.has(id) && d.actor(id).where !== "desk") off.set(id, t);
      await timers.advance(50);
    }
    const seat0 = plan.meeting!.seats[0]!.spot;
    const arrive = ids.map((id) => off.get(id)! + (pathLength(route(plan, deskOf(plan, id)?.home ?? plan.ceo.desk!.home, seat0)) / plan.m.speed) * 1000).sort((a, b) => a - b);
    for (let i = 1; i < arrive.length; i++) expect(arrive[i]! - arrive[i - 1]!).toBeGreaterThanOrEqual(TIMING.stagger - 60);
    await timers.advance(LONG);
    for (const id of ["a0", "a1", "a2", "a3"]) expect(d.actor(id).where).toBe("seat");
    expect(d.actor("a4").where).toBe("desk");
    expect(d.meetingView().seated.length).toBe(4);
    const first = d.meetingView().speaker;
    await timers.advance(TIMING.talk + 5);
    expect(d.meetingView().speaker).not.toBe(first);
    d.setMeetings([meeting(1)]);
    expect(d.meetingView().running).toBe(false);
    await timers.advance(LONG);
    for (const id of ["a0", "a1", "a2", "a3"]) expect(d.actor(id).where).toBe("desk");
  });

  test("a beat for a cat in the meeting waits until it is back", async () => {
    const { d, timers, done } = setup(5);
    d.setMeetings([meeting(null)]);
    await timers.advance(LONG);
    d.setBeats([{ id: "w", kind: "deliver", fromId: "a1", taskTitle: "x" }]);
    await timers.advance(LONG);
    expect(done).toEqual([]);
    d.setMeetings([meeting(2)]);
    await timers.advance(LONG * 2);
    expect(done).toEqual(["w"]);
  });

  test("the hero huddles in front of the easel instead", async () => {
    const { d, timers, plan } = setup(5, "hero", 560);
    d.setMeetings([meeting(null)]);
    await timers.advance(LONG);
    for (const id of ["a0", "a1", "a2", "a3"]) {
      expect(d.actor(id).where).toBe("floor");
      expect(d.actor(id).pose).toBe("back");
      expect(plan.huddle.map((s) => s.p)).toContainEqual(d.position(id)!);
    }
  });
});

describe("the clock", () => {
  test("reduced motion walks at once, the beat still finishes", async () => {
    const { d, timers, done } = setup();
    d.setLive(false);
    d.setBeats([{ id: "s", kind: "handoff", fromId: "a1", toId: "a2", taskTitle: "x" }]);
    await timers.advance(TIMING.handReach + TIMING.handGive + 50);
    expect(done).toEqual(["s"]);
  });

  test("a paused scene holds still, then carries on", async () => {
    const { d, timers, done } = setup();
    d.setBeats([{ id: "p", kind: "deliver", fromId: "a1", taskTitle: "x" }]);
    await timers.advance(1);
    d.pause();
    await timers.advance(LONG);
    expect(done).toEqual([]);
    d.resume();
    await timers.advance(LONG);
    expect(done).toEqual(["p"]);
  });

  test("a new plan mid-beat sends everyone back and replays the beat", async () => {
    const { d, timers, done, agents } = setup();
    d.setBeats([{ id: "r1", kind: "deliver", fromId: "a1", taskTitle: "x" }]);
    await timers.advance(1500);
    expect(d.actor("a1").where).toBe("floor");
    d.setPlan(planOffice(agents, 768));
    expect(done).toEqual([]);
    await timers.advance(LONG);
    expect(done).toEqual(["r1"]);
    expect(d.actor("a1").where).toBe("desk");
  });

  test("an idle cat goes for a coffee and comes back with a mug", async () => {
    const timers = new FakeTimers();
    const d = new Director({ timers, ambient: false });
    const agents = [agent(0), agent(1, { status: "idle", activity: "rest" })];
    d.attach();
    d.setAgents(agents);
    d.setPlan(planOffice(agents, 1280));
    expect(d.coffeeNow("a1")).toBe(true);
    await timers.advance(TIMING.stand + 5);
    expect(d.actor("a1").where).toBe("floor");
    let t = 0;
    while (d.actor("a1").where !== "desk" && t < LONG) {
      await timers.advance(500);
      t += 500;
    }
    await timers.advance(TIMING.sit + 10);
    expect(d.actor("a1").where).toBe("desk");
    expect(d.actor("a1").mug).toBe(true);
    expect(d.brewing()).toBeGreaterThan(0);
    await timers.advance(TIMING.mug + 10);
    expect(d.actor("a1").mug).toBe(false);
  });

  test("idle life: left alone, an idle cat takes trips (coffee or a nap) and always comes back", async () => {
    const timers = new FakeTimers();
    const d = new Director({ timers });
    const agents = [agent(0), agent(1, { status: "idle", activity: "rest", mood: "tired" }), agent(2, { status: "idle", activity: "rest" })];
    d.attach();
    d.setAgents(agents);
    d.setPlan(planOffice(agents, 375));
    const seen = new Set<string>();
    for (let t = 0; t < 400_000; t += 1000) {
      await timers.advance(1000);
      for (const id of ["a1", "a2"]) seen.add(d.actor(id).where);
    }
    expect(seen.has("floor")).toBe(true);
    expect(seen.has("nap") || d.brewing() > 0).toBe(true);
    await timers.advance(LONG);
    d.setAgents(agents.map((a) => ({ ...a, status: "working" as const, activity: "code" as const })));
    await timers.advance(LONG);
    for (const id of ["a1", "a2"]) expect(d.actor(id).where).toBe("desk");
  });

  test("a nap: into the cat bed, then back to the desk", async () => {
    const timers = new FakeTimers();
    const d = new Director({ timers, ambient: false });
    const agents = [agent(0), agent(1, { status: "idle", activity: "rest" }), agent(2), agent(3)];
    const plan = planOffice(agents, 375);
    expect(plan.nap).not.toBeNull();
    d.attach();
    d.setAgents(agents);
    d.setPlan(plan);
    expect(d.napNow("a1")).toBe(true);
    await timers.advance(20_000);
    expect(d.actor("a1").where).toBe("nap");
    await timers.advance(TIMING.nap + LONG);
    expect(d.actor("a1").where).toBe("desk");
  });

  test("with no free cat bed, a nap is a doze on its own desk, and work wakes it", async () => {
    const timers = new FakeTimers();
    const d = new Director({ timers });
    const agents = [agent(0), agent(1, { status: "idle", activity: "rest" }), agent(2), agent(3)];
    const plan = planOffice(agents, 1280);
    expect(plan.nap).toBeNull();
    d.attach();
    d.setAgents(agents);
    d.setPlan(plan);
    expect(d.napNow("a1")).toBe(true);
    await timers.advance(10);
    expect(d.actor("a1").where).toBe("desk");
    expect(d.actor("a1").dozing).toBe(true);
    d.setAgents(agents.map((a) => (a.id === "a1" ? { ...a, status: "working" as const, activity: "code" as const } : a)));
    await timers.advance(1500);
    expect(d.actor("a1").dozing).toBe(false);
  });

  test("the windows follow the clock in three flat skies: day until 18:00, dusk, then night", () => {
    expect(daypartOf(6)).toBe("day");
    expect(daypartOf(12)).toBe("day");
    expect(daypartOf(17.9)).toBe("day");
    expect(daypartOf(18)).toBe("dusk");
    expect(daypartOf(19.5)).toBe("dusk");
    expect(daypartOf(20)).toBe("night");
    expect(daypartOf(23)).toBe("night");
    expect(daypartOf(2)).toBe("night");
    let hour = 12;
    const timers = new FakeTimers();
    const d = new Director({ timers, hour: () => hour });
    d.attach();
    expect(d.daypart()).toBe("day");
    hour = 21;
    return timers.advance(TIMING.day + 10).then(() => expect(d.daypart()).toBe("night"));
  });
});

describe("the company", () => {
  test("a hire steps in at the door carrying a box, walks to its desk and unpacks", async () => {
    const { d, timers, agents, done } = setup(4);
    const hire = agent(4, { name: "New" });
    const next = [...agents, hire];
    const plan = planOffice(next, 1280, "full", { keepOrder: true });
    d.setScene(next, plan, { arriving: ["a4"] });
    await timers.advance(1);
    expect(d.actor("a4").where).toBe("floor");
    expect(d.actor("a4").carry).toBe("box");
    expect(d.position("a4")).toEqual(plan.door!.spot.p);
    expect(d.doorOpen()).toBe(true);
    let t = 0;
    while (d.actor("a4").where !== "desk" && t < LONG) {
      await timers.advance(500);
      t += 500;
    }
    await timers.advance(TIMING.sit + 10);
    expect(d.actor("a4").where).toBe("desk");
    expect(d.actor("a4").unpack).toBe(true);
    expect(d.doorOpen()).toBe(false);
    expect(d.noteList().some((n) => n.text === "New joins the crew")).toBe(true);
    await timers.advance(TIMING.unpack + 10);
    expect(d.actor("a4").unpack).toBe(false);
    // the scene's own beats never reach onBeatDone
    expect(done).toEqual([]);
  });

  test("a hire walks in once, however often the same change comes again", async () => {
    const { d, timers, agents } = setup(4);
    const next = [...agents, agent(4)];
    const plan = planOffice(next, 1280, "full", { keepOrder: true });
    d.setScene(next, plan, { arriving: ["a4"] });
    await timers.advance(LONG);
    expect(d.actor("a4").where).toBe("desk");
    d.setScene(next, plan, { arriving: ["a4"] });
    await timers.advance(1);
    expect(d.actor("a4").where).toBe("desk");
    expect(d.noteList().filter((n) => n.text.includes("joins the crew")).length).toBe(1);
  });

  test("two hires take turns at the door", async () => {
    const { d, timers, agents } = setup(3);
    const next = [...agents, agent(3), agent(4)];
    d.setScene(next, planOffice(next, 1280, "full", { keepOrder: true }), { arriving: ["a3", "a4"] });
    await timers.advance(1);
    expect(d.actor("a3").where).toBe("floor");
    expect(d.actor("a4").where).toBe("out");
    await timers.advance(LONG);
    expect(d.actor("a3").where).toBe("desk");
    expect(d.actor("a4").where).toBe("desk");
  });

  test("a leaver packs a box, walks out of the door, then the scene hears it is gone", async () => {
    const { d, timers, agents, plan } = setup(5);
    const gone: string[] = [];
    d.onGone = (id) => gone.push(id);
    d.setScene(agents, plan, { leaving: ["a2"] });
    await timers.advance(TIMING.stand + 5);
    expect(d.actor("a2").where).toBe("floor");
    expect(d.actor("a2").carry).toBe("box");
    expect(d.actor("a2").packed).toBe(true);
    await timers.advance(LONG);
    expect(d.actor("a2").where).toBe("out");
    expect(gone).toEqual(["a2"]);
    expect(d.noteList()[0]!.text).toContain("leaves the office");
  });

  test("a hire into the same places keeps everyone else walking", async () => {
    const { d, timers, agents } = setup(5);
    const before = planOffice(agents, 1280, "full", { keepOrder: true });
    d.setPlan(before);
    d.setBeats([{ id: "w", kind: "deliver", fromId: "a1", taskTitle: "x" }]);
    await timers.advance(1500);
    expect(d.actor("a1").where).toBe("floor");
    const next = [...agents, agent(5)];
    const after = planOffice(next, 1280, "full", { keepOrder: true });
    expect(samePlaces(before, after)).toBe(true);
    d.setScene(next, after, { arriving: ["a5"] });
    // no reset: the walker is still on its way
    expect(d.actor("a1").where).toBe("floor");
    expect(d.actor("a1").carry).toBe("card");
  });

  test("the rack blinks while tests run, then shows pass or fail", async () => {
    const { d, timers, agents } = setup(4);
    d.setAgents(agents.map((a, i) => (i === 1 ? { ...a, activity: "run" as const } : a)));
    expect(d.rackView().mode).toBe("testing");
    d.setAgents(agents);
    expect(d.rackView().mode).toBe("pass");
    await timers.advance(TIMING.rackHold + 10);
    expect(d.rackView().mode).toBe("idle");
    d.setAgents(agents.map((a, i) => (i === 2 ? { ...a, activity: "run" as const } : a)));
    d.setAgents(agents.map((a, i) => (i === 2 ? { ...a, status: "error" as const } : a)));
    expect(d.rackView().mode).toBe("fail");
  });

  test("the lead approves with a stamp, a delivered target rings the bell", async () => {
    const { d, timers } = setup(4);
    d.setBeats([{ id: "y", kind: "decided", byId: "a0", toId: "a2", approved: true, answer: "Yes" }]);
    await timers.advance(1);
    expect(d.actor("a0").react?.kind).toBe("approve");
    const bell = d.bell();
    d.setBeats([{ id: "v", kind: "deliver", fromId: "a1", taskTitle: "Hit the target" }]);
    await timers.advance(LONG);
    expect(d.bell()).toBe(bell + 1);
  });
});

describe("wave b: docks, depth, ambient life, the camera, the story clock", () => {
  test("a visitor docks beside the target's monitor, its paw toward the desk, and goes behind the desk's front edge", async () => {
    const { d, timers, plan } = setup();
    const slot = document.createElementNS("http://www.w3.org/2000/svg", "g");
    slot.setAttribute("data-slot", "");
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    slot.appendChild(el);
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.appendChild(slot);
    d.clipBase = "t";
    d.register("a1", el);
    d.setBeats([{ id: "h", kind: "handoff", fromId: "a1", toId: "a2", taskTitle: "Ship it" }]);
    const docks = deskOf(plan, "a2")!.visits;
    let seen = false;
    for (let t = 0; t < 20_000 && !seen; t += 100) {
      await timers.advance(100);
      const at = d.position("a1");
      if (d.actor("a1").pose === "back" && at && docks.some((v) => v.p.x === at.x && v.p.y === at.y)) {
        seen = true;
        const dock = docks.find((v) => v.p.x === at.x && v.p.y === at.y)!;
        expect(el.getAttribute("data-lean")).toBe(dock.lean!);
        expect(slot.getAttribute("clip-path")).toBe(`url(#t-depth-${bandOf(plan, dock.p.y)})`);
      }
    }
    expect(seen).toBe(true);
    await timers.advance(LONG);
    // back home on its aisle: in front of every row it sat behind
    expect(d.actor("a1").where).toBe("desk");
  });

  test("ambient life: with idle cats about, one of them is nearly always out in the pantry, the bed or the corridor", async () => {
    const timers = new FakeTimers();
    const d = new Director({ timers });
    const agents = [agent(0), ...[1, 2, 3, 4].map((i) => agent(i, { status: "idle", activity: "rest" }))];
    d.attach();
    d.setAgents(agents);
    d.setPlan(planOffice(agents, 375));
    await timers.advance(3000);
    let out = 0;
    let most = 0;
    const samples = 200;
    for (let i = 0; i < samples; i++) {
      await timers.advance(1000);
      const away = agents.filter((a) => d.actor(a.id).where !== "desk").length;
      if (away > 0) out++;
      most = Math.max(most, away);
    }
    expect(out / samples).toBeGreaterThan(0.7);
    // one idle cat at a time (JEV motion.intensity ambient tier 1)
    expect(most).toBe(1);
    // the lead stays in the office
    expect(d.actor("a0").where).toBe("desk");
  });

  test("the scene opens on its first idle cat already out on a break, not getting up", async () => {
    const timers = new FakeTimers();
    const d = new Director({ timers });
    const agents = [agent(0), agent(1, { status: "idle", activity: "rest" }), agent(2)];
    const plan = planOffice(agents, 375);
    d.attach();
    d.setAgents(agents);
    d.setPlan(plan);
    await timers.advance(TIMING.ambientFirst + 5);
    const v = d.actor("a1");
    expect(v.where === "floor" || v.where === "nap").toBe(true);
    const at = d.position("a1")!;
    const places = [...(plan.pantry?.spots ?? []), ...(plan.nap ? [plan.nap.spot] : [])].map((s) => s.p);
    expect(places.some((p) => p.x === at.x && p.y === at.y) || (plan.corridor !== null && Math.abs(at.y - plan.lanes[0]!.yR) < 0.5)).toBe(true);
    await timers.advance(LONG * 2);
    expect(d.actor("a1").where).toBe("desk");
  });

  test("ambient life never takes a cat a beat is about to walk to", async () => {
    const timers = new FakeTimers();
    const d = new Director({ timers });
    const agents = [agent(0), agent(1), agent(2, { status: "waiting", activity: "wait" })];
    d.attach();
    d.setAgents(agents);
    d.setPlan(planOffice(agents, 375));
    d.setBeats([{ id: "h", kind: "handoff", fromId: "a1", toId: "a2", taskTitle: "x" }]);
    for (let t = 0; t < 6000; t += 200) {
      await timers.advance(200);
      expect(d.actor("a2").where).toBe("desk");
    }
  });

  test("the camera looks where the beat plays, then at the meeting, then rests", async () => {
    const { d, timers, plan } = setup(6, "full", 343);
    expect(d.cameraFocus()).toBeNull();
    d.setBeats([{ id: "r", kind: "review", reviewerId: "a1", ownerId: "a4", passed: true, taskTitle: "x" }]);
    await timers.advance(1);
    const desk = deskOf(plan, "a4")!;
    expect(d.cameraFocus()).toBeCloseTo(desk.rect.y + desk.rect.h * 0.6, 0);
    await timers.advance(LONG);
    expect(d.cameraFocus()).toBeNull();
    await timers.advance(TIMING.opening);
    d.setMeetings([{ id: "m", kind: "sync", title: "Sync", agentIds: ["a1", "a2"], agenda: ["One"], endedAt: null, notes: [] }]);
    expect(d.cameraFocus()).toBeCloseTo(plan.meeting!.table.y + plan.meeting!.table.h / 2, 0);
    d.setMeetings([{ id: "m", kind: "sync", title: "Sync", agentIds: ["a1", "a2"], agenda: ["One"], endedAt: 1, notes: [] }]);
    expect(d.cameraFocus()).toBeNull();
  });

  test("the story clock drives the sky: day, dusk, night only late; null goes back to the local hour", () => {
    const timers = new FakeTimers();
    const d = new Director({ timers, hour: () => 3 });
    d.attach();
    expect(d.daypart()).toBe("night");
    d.setHour(9.5);
    expect(d.daypart()).toBe("day");
    expect(d.hourNow()).toBe(9.5);
    d.setHour(18.4);
    expect(d.daypart()).toBe("dusk");
    d.setHour(21);
    expect(d.daypart()).toBe("night");
    d.setHour(null);
    expect(d.hourNow()).toBe(3);
  });
});
