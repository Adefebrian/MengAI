// The director on a fake clock: beats play in order per cat, cats who are
// not involved keep working, every beat reports done once, asks park at the
// CEO until the answer, meetings seat and release the crew, a new plan
// replays a beat in flight, reduced motion moves instantly, a paused scene
// holds still.
import { describe, expect, test } from "bun:test";
import type { AgentRole } from "@mengai/shared";
import type { OfficeAgent, OfficeBeat, OfficeMeeting } from "../office-contract";
import { Director, TIMING, type TimerHost } from "./director";
import { deskOf, planOffice, type OfficeVariant } from "./geometry";

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
    expect(d.actor("a0").react?.kind).toBe("nod");
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

  test("attendees file into their seats with a stagger, a speaker takes turns, then they go back", async () => {
    const { d, timers } = setup(6);
    d.setMeetings([meeting(null)]);
    await timers.advance(TIMING.stand + 5);
    // the stagger: the fourth attendee has not stood up yet
    expect(d.actor("a0").where).toBe("floor");
    expect(d.actor("a3").where).toBe("desk");
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
    const d = new Director({ timers });
    const agents = [agent(0), agent(1, { status: "idle", activity: "rest" })];
    d.attach();
    d.setAgents(agents);
    d.setPlan(planOffice(agents, 1280));
    await timers.advance(TIMING.idleMax + LONG);
    expect(d.actor("a1").where).toBe("desk");
    expect(d.actor("a1").mug).toBe(true);
    expect(d.brewing()).toBeGreaterThan(0);
  });
});
