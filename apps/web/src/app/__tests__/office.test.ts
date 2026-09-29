// The office as data: the store maps to the Office scene's props, and every
// scenario of the cat company becomes one beat, in order: a handoff walks a
// card over, a question walks to the CEO, the CEO answers yes or no, a
// review brings its verdict back, finished work is delivered, and the run
// ending makes the whole office celebrate. Meetings and CEO calls land in
// the store from their own events.
import { describe, expect, test } from "bun:test";
import type { MengaiEvent } from "@mengai/shared";
import { DEMO_EVENTS, DEMO_WARM_SEQ } from "../../demo/fixture";
import { emptyRunState, reduceRun, replay, stateFromSnapshot, type RunState } from "../../store/runStore";
import { followTarget, writingNow } from "../run/CodeEditor";
import { companyNow, officeAgents, officeMeetings, officePlan, toolTarget } from "../run/office";
import { queueGroups } from "../run/TaskQueue";
import { beatsBetween } from "../run/useOfficeBeats";

const EMDASH = "\u2014";
const all = replay(DEMO_EVENTS, emptyRunState("demo"));

/** Every beat the whole demo plays, folded event by event. */
function allBeats() {
  let s: RunState = emptyRunState("demo");
  const out = [];
  for (const e of DEMO_EVENTS) {
    const next = reduceRun(s, e);
    out.push(...(beatsBetween(s, next) ?? []));
    s = next;
  }
  return out;
}

describe("the office beats", () => {
  const beats = allBeats();
  const kinds = beats.map((b) => b.kind);

  test("a handoff walks the card from the CEO to the engineer", () => {
    const first = beats.find((b) => b.kind === "handoff");
    expect(first).toMatchObject({ kind: "handoff", fromId: "agent-kopi", toId: "agent-mochi", taskTitle: "Add a CSV serializer for daily sales rows" });
  });

  test("a question walks to the CEO and the CEO answers both ways", () => {
    expect(beats.find((b) => b.kind === "ask")).toMatchObject({ fromId: "agent-klepon", toId: "agent-kopi" });
    const decided = beats.filter((b) => b.kind === "decided");
    expect(decided.length).toBe(4);
    expect(decided.some((b) => b.kind === "decided" && !b.approved && b.toId === "agent-cilok")).toBe(true);
    expect(decided.every((b) => b.kind === "decided" && b.byId === "agent-kopi")).toBe(true);
  });

  test("a review brings its verdict to the maker, failed then passed", () => {
    const reviews = beats.filter((b) => b.kind === "review");
    expect(reviews.map((b) => b.kind === "review" && [b.reviewerId, b.ownerId, b.passed])).toEqual([
      ["agent-tempe", "agent-mochi", false],
      ["agent-tempe", "agent-mochi", true],
    ]);
  });

  test("finished work is delivered and the run ends in one celebration of the whole office", () => {
    expect(kinds.filter((k) => k === "deliver").length).toBeGreaterThanOrEqual(5);
    expect(kinds.at(-1)).toBe("celebrate");
    const party = beats.at(-1)!;
    expect(party.kind === "celebrate" && party.agentIds.length).toBe(6);
    expect(new Set(beats.map((b) => b.id)).size).toBe(beats.length);
  });

  test("a replay that jumps back is not one timeline, so the queue clears", () => {
    const early = replay(DEMO_EVENTS.slice(0, 40), emptyRunState("demo"));
    expect(beatsBetween(all, early)).toBeNull();
    expect(beatsBetween(early, early)).toEqual([]);
  });
});

describe("the office props", () => {
  test("every cat has its desk data: energy, its latest file, its task", () => {
    const at = replay(DEMO_EVENTS.filter((e) => e.seq <= DEMO_WARM_SEQ), emptyRunState("demo"));
    const agents = officeAgents(at, {});
    expect(agents.map((a) => a.name)).toEqual(["Kopi", "Mochi", "Klepon", "Tempe", "Onde", "Cilok"]);
    const mochi = agents.find((a) => a.id === "agent-mochi")!;
    expect(mochi.file).toBe("src/pages/report.tsx");
    expect(mochi.taskTitle).toBe("Wire Export to the report page");
    expect(mochi.energy).toBeGreaterThan(0);
    expect(mochi.energy).toBeLessThanOrEqual(1);
  });

  test("meetings come from their events, with notes once ended", () => {
    const meetings = officeMeetings(all);
    expect(meetings.map((m) => m.kind)).toEqual(["kickoff", "sync", "wrapup"]);
    expect(meetings.every((m) => m.endedAt !== null && m.notes.length > 0)).toBe(true);
    expect(all.meetings["m-kickoff"]!.decisions.length).toBe(2);
  });

  test("the whiteboard plan shows the work, not the review tasks", () => {
    const plan = officePlan(all);
    expect(plan.length).toBe(6);
    expect(plan.every((p) => p.status === "done")).toBe(true);
    const groups = queueGroups(all);
    expect(groups.done.length).toBe(6);
  });

  test("a snapshot with meetings paints them before the stream", () => {
    const snap = stateFromSnapshot({
      run: all.run!,
      agents: [],
      tasks: [],
      handoffs: [],
      decisions: [],
      approvals: [],
      meetings: [{ id: "m1", kind: "kickoff", title: "Kickoff", agentIds: [], agenda: ["Plan"], notes: [], startedAt: 5, endedAt: null }],
      lastSeq: 3,
    });
    expect(snap.meetingOrder).toEqual(["m1"]);
    expect(snap.meetings.m1!.endedAt).toBeNull();
  });
});

describe("the status line in cat voice", () => {
  test("at the approval it says who waits on you and for what", () => {
    const at = replay(DEMO_EVENTS.filter((e) => e.seq <= DEMO_WARM_SEQ), emptyRunState("demo"));
    expect(companyNow(at)).toBe("Mochi is waiting on you: install date-fns 4.1.0 with bun add.");
  });

  test("during the kickoff the crew is at the table", () => {
    const i = DEMO_EVENTS.findIndex((e) => e.type === "meeting.started");
    const s = replay(DEMO_EVENTS.slice(0, i + 1), emptyRunState("demo"));
    expect(companyNow(s)).toBe("Kickoff: CSV export. Kopi, Mochi and Klepon are at the table.");
  });

  test("at the end it is done and never uses an em dash", () => {
    expect(companyNow(all)).toContain("Done.");
    for (let n = 1; n <= DEMO_EVENTS.length; n += 7) {
      expect(companyNow(replay(DEMO_EVENTS.slice(0, n), emptyRunState("demo")))).not.toContain(EMDASH);
    }
  });
});

describe("the editor follows the crew", () => {
  test("a write in flight names its file, from a demo or an engine preview", () => {
    expect(toolTarget("src/report/csv.ts (31 lines)")).toBe("src/report/csv.ts");
    expect(toolTarget('{"path":"index.html","content":"<!doctype html>')).toBe("index.html");
    expect(toolTarget("src/report/fixtures/*.json (3 files)")).toBeNull();
    const i = DEMO_EVENTS.findIndex((e) => e.type === "tool.call" && (e as MengaiEvent<"tool.call">).data.tool === "fs_write");
    const s = replay(DEMO_EVENTS.slice(0, i + 1), emptyRunState("demo"));
    expect(writingNow(s)).toEqual({ "src/report/csv.ts": "agent-mochi" });
    expect(followTarget(s)).toBe("src/report/csv.ts");
  });

  test("with nothing in flight it follows the latest change, never a lockfile", () => {
    expect(followTarget(all)).toBe("package.json");
  });
});
