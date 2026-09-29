import { describe, expect, test } from "bun:test";
import { ACTIVITY_MIN_DWELL_MS, isEvent, type Activity } from "@mengai/shared";
import { SAMPLE_CREW_TOKENS, SAMPLE_RUN } from "./fixture";
import { eventCountAt, foldEvents, toolTarget } from "./reduce";
import { replayCaption } from "./Replay";
import {
  clock,
  durationFrames,
  frameToMs,
  msToFrame,
  replayMsToTs,
  speedup,
  stageAtMs,
  stageStartFrame,
  stillFrame,
  tsToReplayMs,
} from "./timemap";

const f = SAMPLE_RUN;
const EMDASH = String.fromCharCode(0x2014);

describe("sample run fixture", () => {
  test("events are in seq and ts order", () => {
    for (let i = 1; i < f.events.length; i++) {
      expect(f.events[i]!.seq).toBe(f.events[i - 1]!.seq + 1);
      expect(f.events[i]!.ts).toBeGreaterThanOrEqual(f.events[i - 1]!.ts);
    }
  });

  test("stays small and carries no secrets, absolute paths, em-dash or emoji", () => {
    const text = JSON.stringify(f.events);
    expect(text.length).toBeLessThan(60_000);
    expect(text).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\\\/);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8,}|api[_-]?key/i);
    expect(text.includes(EMDASH)).toBe(false);
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });

  test("is labelled as scripted until a recording replaces it", () => {
    expect(f.scripted).toBe(true);
    expect(replayCaption(f).startsWith("Sample run, scripted for this page")).toBe(true);
  });

  test("the crew token split sums to the run total", () => {
    const total = Object.values(SAMPLE_CREW_TOKENS).reduce((a, b) => a + b, 0);
    expect(total).toBe(foldEvents(f.events).tokens);
  });
});

describe("time map", () => {
  test("plays about 28 seconds at 30 fps in four stages", () => {
    expect(durationFrames(f)).toBe(840);
    expect(f.stages.map((s) => s.id)).toEqual(["plan", "build", "review", "handoff"]);
    expect(f.stages.map((s) => s.replayEndMs)).toEqual([4_000, 13_000, 22_000, 28_000]);
  });

  test("replay time and run time invert each other", () => {
    for (const ms of [0, 1_000, 3_999, 4_000, 8_500, 13_000, 17_000, 21_999, 22_000, 27_999]) {
      expect(Math.abs(tsToReplayMs(f.stages, replayMsToTs(f.stages, ms)) - ms)).toBeLessThan(1);
    }
  });

  test("stage lookup, stills and starts land inside their stage", () => {
    for (const s of f.stages) {
      expect(stageAtMs(f.stages, frameToMs(stillFrame(f, s.id))).id).toBe(s.id);
      expect(stageAtMs(f.stages, frameToMs(stageStartFrame(f, s.id))).id).toBe(s.id);
    }
    expect(stageAtMs(f.stages, 99_999).id).toBe("handoff");
  });

  test("frames, speed and the clock format", () => {
    expect(msToFrame(frameToMs(123))).toBe(123);
    expect(speedup(f)).toBe(21);
    expect(clock(0)).toBe("0:00");
    expect(clock(426_000)).toBe("7:06");
  });

  test("no cat shows a behaviour for less than the minimum dwell of replay time", () => {
    const spans = new Map<string, { activity: Activity; from: number }[]>();
    for (const e of f.events) {
      let activity: Activity | null = null;
      if (isEvent(e, "agent.spawned")) activity = e.data.agent.activity;
      else if (isEvent(e, "agent.status")) activity = e.data.activity;
      else if (isEvent(e, "tool.call")) activity = e.data.activity;
      if (!activity || !e.agentId) continue;
      const list = spans.get(e.agentId) ?? [];
      const last = list[list.length - 1];
      if (!last || last.activity !== activity) list.push({ activity, from: tsToReplayMs(f.stages, e.ts) });
      spans.set(e.agentId, list);
    }
    for (const [agent, list] of spans) {
      for (let i = 0; i < list.length - 1; i++) {
        const shown = list[i + 1]!.from - list[i]!.from;
        if (shown < ACTIVITY_MIN_DWELL_MS - 1) throw new Error(`${agent} shows ${list[i]!.activity} for ${Math.round(shown)}ms`);
      }
    }
  });
});

describe("fold", () => {
  test("the Build still has every cat in a working pose", () => {
    const ts = replayMsToTs(f.stages, frameToMs(stillFrame(f, "build")));
    const s = foldEvents(f.events, eventCountAt(f.events, ts));
    const acts = f.crew.map((id) => s.agents[id]!.activity);
    // Kopi checks on the crew (the lead's review beat), the makers code, Tempe reads ahead.
    expect(acts).toEqual(["review", "code", "code", "read"]);
    expect(s.runStatus).toBe("running");
  });

  test("plan creates the task rows one by one", () => {
    const plan = f.stages[0]!;
    const early = foldEvents(f.events, eventCountAt(f.events, plan.startTs + 27_000));
    const late = foldEvents(f.events, eventCountAt(f.events, plan.stillTs));
    expect(Object.keys(early.tasks)).toHaveLength(0);
    expect(Object.keys(late.tasks)).toHaveLength(3);
    expect(late.timeline.filter((t) => t.action === "new task")).toHaveLength(3);
  });

  test("the review sends the encoder back once, then passes it in round 2", () => {
    const verdicts = f.events.filter((e) => isEvent(e, "tool.result") && e.data.tool === "submit_review").map((e) => (isEvent(e, "tool.result") ? e.data.summary : ""));
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]!.startsWith("Changes requested")).toBe(true);
    expect(verdicts[1]!.startsWith("Passed")).toBe(true);
    const review = f.stages.find((s) => s.id === "review")!;
    const still = foldEvents(f.events, eventCountAt(f.events, review.stillTs));
    expect(still.agents[f.crew[3]!]!.verdict).toBe("changes");
    expect(still.timeline.some((t) => t.action === "Changes requested")).toBe(true);
  });

  test("the review passes and the handoff reaches the designer", () => {
    const s = foldEvents(f.events);
    const tempe = s.agents[f.crew[3]!]!;
    const mochi = s.agents[f.crew[2]!]!;
    expect(tempe.verdict).toBe("passed");
    expect(s.handoffs).toHaveLength(1);
    expect(s.handoffs[0]!.toAgentId).toBe(mochi.id);
    expect(s.tasks[s.handoffs[0]!.taskId]!.status).toBe("done");
    expect(s.runStatus).toBe("done");
    expect(s.tokens).toBe(182_400);
    expect(s.budgetTokens).toBe(400_000);
    expect(Object.values(s.tasks).every((t) => t.status === "done")).toBe(true);
  });

  test("tool targets are paths and commands, or the tool name", () => {
    expect(toolTarget("fs_edit", "src/a.ts")).toBe("src/a.ts");
    expect(toolTarget("shell_run", "bun test")).toBe("bun test");
    expect(toolTarget("create_tasks", "3 tasks")).toBe("create_tasks");
    expect(toolTarget("finish", "done")).toBeNull();
  });

  test("eventCountAt is a binary search over ts", () => {
    expect(eventCountAt(f.events, f.startedAt - 1)).toBe(0);
    expect(eventCountAt(f.events, f.endedAt)).toBe(f.events.length);
  });
});
