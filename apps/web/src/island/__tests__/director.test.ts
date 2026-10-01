// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The director, as data, on an injected clock: one moment at a time; a
// higher priority cuts in and the one it sends away exits fast; lower ones
// queue, at most three, the oldest that may end on its own dropped first;
// asks and failures stay until resolved and come back after an ask cuts
// in; the same type at most once per 8 s and four moments a minute the
// island starts on its own; quirks only on a quiet stage, on a seeded gap
// that replays the same; a replayed id never plays twice; an engine hint
// beats an inferred moment on the same task within 2 s, either way round;
// and the owner's answer ends its ask with the cat's reaction.
import { describe, expect, test } from "bun:test";
import type { MomentType } from "../moment-types";
import {
  ANSWER_WINDOW_MS,
  Director,
  EXIT_FAST_MS,
  HINT_WINDOW_MS,
  PRIORITY,
  QUEUE_MAX,
  QUIRK_GAP_MAX_MS,
  QUIRK_GAP_MIN_MS,
  QUIRK_QUIET_MS,
  RATE_MAX,
  RATE_WINDOW_MS,
  SAME_TYPE_MS,
  type Cue,
} from "../director";
import { ANSWER_MS, MOMENT_MS } from "../moments";

const T = 1_800_000_000_000;

function cue(type: MomentType, id: string, over: Partial<Cue> = {}): Cue {
  return { id, type, runId: "r1", cats: [], ms: MOMENT_MS[type], priority: PRIORITY[type], text: "Something happened.", path: "/app/runs/r1", at: T, ...over };
}

function ask(n: number, type: MomentType = "ask_approval"): Cue {
  return cue(type, `${type}:approval:a${n}`, { askId: `approval:a${n}` });
}

function answer(n: number): Cue {
  return cue("ask_approval", `answer:approval:a${n}`, { askId: `approval:a${n}`, ms: ANSWER_MS });
}

function ids(d: Director): string[] {
  return d.queued.map((m) => m.id);
}

describe("one moment at a time", () => {
  test("it plays for its length, then the next in line starts where it ended", () => {
    const d = new Director({ now: T });
    expect(d.offer(cue("hire", "hire:a"), T)).toBe("play");
    expect(d.offer(cue("handoff", "handoff:h"), T + 100)).toBe("queue");
    expect(d.tick(T + 2199).current?.id).toBe("hire:a");
    const t = d.tick(T + 2200);
    expect(t.current?.id).toBe("handoff:h");
    expect(t.startedAt).toBe(T + 2200);
    expect(t.expiresAt).toBe(T + 2200 + 2400);
    expect(d.tick(T + 4600).current).toBeNull();
  });

  test("a higher priority cuts in; the one sent away exits fast; a lower one queues", () => {
    const d = new Director({ now: T });
    d.offer(cue("hire", "hire:a"), T);
    expect(d.offer(cue("stage_done", "stage_done:1"), T + 500)).toBe("play");
    const t = d.tick(T + 500);
    expect(t.current?.id).toBe("stage_done:1");
    expect(t.exiting?.id).toBe("hire:a");
    expect(d.tick(T + 500 + EXIT_FAST_MS).exiting).toBeNull();
    expect(d.offer(cue("tap", "tap:1"), T + 700)).toBe("queue");
    expect(ids(d)).toEqual(["tap:1"]);
  });

  test("the queue keeps three, priority first, dropping the oldest that may end on its own", () => {
    const d = new Director({ now: T });
    d.offer(cue("shipped", "shipped:r1"), T);
    expect(d.offer(cue("let_go", "let_go:a"), T + 1)).toBe("queue");
    expect(d.offer(cue("handoff", "handoff:h"), T + 2)).toBe("queue");
    expect(d.offer(cue("hire", "hire:b"), T + 3)).toBe("queue");
    expect(d.offer(cue("review_pass", "review_pass:9"), T + 4)).toBe("queue");
    expect(ids(d)).toEqual(["review_pass:9", "handoff:h", "hire:b"]);
    expect(d.offer(cue("tap", "tap:1"), T + 5)).toBe("queue");
    expect(ids(d)).toHaveLength(QUEUE_MAX);
    expect(ids(d)).toEqual(["review_pass:9", "hire:b", "tap:1"]);
  });

  test("a tap restarts a tap: three quick taps never pile up", () => {
    const d = new Director({ now: T });
    d.offer(cue("tap", "tap:1"), T);
    expect(d.offer(cue("tap", "tap:2"), T + 300)).toBe("play");
    expect(d.offer(cue("tap", "tap:3"), T + 600)).toBe("play");
    expect(d.tick(T + 600).current?.id).toBe("tap:3");
    expect(ids(d)).toEqual([]);
  });
});

describe("asks and failures stay until resolved", () => {
  test("an ask holds the stage; only asks queue behind it; resolving brings the next", () => {
    const d = new Director({ now: T });
    expect(d.offer(ask(1), T)).toBe("play");
    const t = d.tick(T + 10 * 60_000);
    expect(t.current?.id).toBe(ask(1).id);
    expect(t.expiresAt).toBeNull();
    expect(d.offer(cue("hire", "hire:a"), T + 1000)).toBe("busy");
    expect(d.offer(ask(2, "ask_order"), T + 1000)).toBe("queue");
    expect(d.offer(ask(3, "ask_question"), T + 1100)).toBe("queue");
    expect(d.resolve("approval:a1", T + 2000)).toBe(true);
    expect(d.tick(T + 2000).current?.id).toBe(ask(2, "ask_order").id);
  });

  test("asks are never dropped from the queue, however many wait", () => {
    const d = new Director({ now: T });
    for (let n = 1; n <= 6; n++) d.offer(ask(n), T + n);
    expect(d.tick(T + 10).current?.id).toBe(ask(1).id);
    expect(d.queued).toHaveLength(5);
  });

  test("an ask cuts in over a failure, which waits at the front and comes back", () => {
    const d = new Director({ now: T });
    expect(d.offer(cue("failed", "failed:r1"), T)).toBe("play");
    expect(d.offer(ask(1), T + 1000)).toBe("play");
    expect(ids(d)).toEqual(["failed:r1"]);
    d.resolve("approval:a1", T + 5000);
    expect(d.tick(T + 5000).current?.id).toBe("failed:r1");
    expect(d.resolve("failed:r1", T + 9000)).toBe(true);
    expect(d.tick(T + 9000).current).toBeNull();
  });

  test("an ask cuts in over a moment that ends on its own; that one exits fast and the queue behind it goes", () => {
    const d = new Director({ now: T });
    d.offer(cue("stage_done", "stage_done:1"), T);
    d.offer(cue("hire", "hire:a"), T + 100);
    expect(ids(d)).toEqual(["hire:a"]);
    expect(d.offer(ask(1), T + 300)).toBe("play");
    expect(d.tick(T + 300).exiting?.id).toBe("stage_done:1");
    expect(ids(d)).toEqual([]);
  });

  test("syncAsks adds new asks once and ends the ones that are gone", () => {
    const d = new Director({ now: T });
    d.syncAsks([ask(1), ask(2)], T);
    d.syncAsks([ask(1), ask(2)], T + 100);
    expect(d.tick(T + 100).current?.id).toBe(ask(1).id);
    expect(ids(d)).toEqual([ask(2).id]);
    d.syncAsks([ask(2)], T + 200);
    expect(d.tick(T + 200).current?.id).toBe(ask(2).id);
    // answered here before the model caught up: it is not added back
    d.resolve("approval:a2", T + 300);
    d.syncAsks([ask(2)], T + 350);
    expect(d.tick(T + 350).current).toBeNull();
  });
});

describe("the owner's answer", () => {
  test("an answer ends the ask on the stage and plays the cat's reaction", () => {
    const d = new Director({ now: T });
    d.offer(ask(1), T);
    expect(d.offer(answer(1), T + 4000)).toBe("play");
    const t = d.tick(T + 4000);
    expect(t.current?.id).toBe(answer(1).id);
    expect(t.expiresAt).toBe(T + 4000 + ANSWER_MS);
    expect(d.tick(T + 4000 + ANSWER_MS).current).toBeNull();
  });

  test("the answer may come just after the ask left (the model updated first), not later", () => {
    const d = new Director({ now: T });
    d.syncAsks([ask(1), ask(2)], T);
    d.syncAsks([ask(2)], T + 100);
    expect(d.tick(T + 100).current?.id).toBe(ask(2).id);
    expect(d.offer(answer(1), T + 200)).toBe("play");
    expect(ids(d)).toEqual([ask(2).id]);
    expect(d.tick(T + 200 + ANSWER_MS).current?.id).toBe(ask(2).id);

    const late = new Director({ now: T });
    late.offer(ask(1), T);
    late.resolve("approval:a1", T + 100);
    expect(late.offer(answer(1), T + 100 + ANSWER_WINDOW_MS + 1)).toBe("stale");
  });

  test("an ask answered while it only waited in the queue leaves without a reaction", () => {
    const d = new Director({ now: T });
    d.offer(ask(1), T);
    d.offer(ask(2), T + 1);
    expect(d.offer(answer(2), T + 500)).toBe("stale");
    expect(ids(d)).toEqual([]);
    expect(d.tick(T + 500).current?.id).toBe(ask(1).id);
  });
});

describe("cooldowns", () => {
  test("the same type at most once per 8 s; asks are exempt", () => {
    const d = new Director({ now: T });
    expect(d.offer(cue("hire", "hire:a"), T)).toBe("play");
    expect(d.offer(cue("hire", "hire:b"), T + SAME_TYPE_MS - 1)).toBe("cooldown");
    expect(d.offer(cue("hire", "hire:c"), T + SAME_TYPE_MS)).toBe("play");
    const a = new Director({ now: T });
    expect(a.offer(ask(1), T)).toBe("play");
    expect(a.offer(ask(2), T + 10)).toBe("queue");
  });

  test("at most four moments a minute the island starts on its own; a run's end and taps never count", () => {
    const d = new Director({ now: T });
    const types: MomentType[] = ["hire", "let_go", "handoff", "review_pass"];
    types.forEach((type, i) => expect(d.offer(cue(type, `${type}:1`), T + i * 3000)).toBe("play"));
    expect(RATE_MAX).toBe(4);
    expect(d.offer(cue("stage_done", "stage_done:1"), T + 20_000)).toBe("rate");
    expect(d.offer(cue("shipped", "shipped:r1"), T + 21_000)).toBe("play");
    expect(d.offer(cue("tap", "tap:1"), T + 30_000)).toBe("play");
    expect(d.offer(cue("stage_done", "stage_done:2"), T + RATE_WINDOW_MS + 1)).toBe("play");
  });

  test("a replayed id never plays twice, even long after", () => {
    const d = new Director({ now: T });
    expect(d.offer(cue("hire", "hire:a"), T)).toBe("play");
    expect(d.offer(cue("hire", "hire:a"), T + 60_000)).toBe("seen");
  });
});

describe("engine hints beat inferred moments on the same task", () => {
  test("hint first: an inferred moment about that task within 2 s is beaten, not after", () => {
    const d = new Director({ now: T });
    expect(d.offer(cue("review_pass", "review_pass:1", { taskId: "t1", hint: true }), T)).toBe("play");
    expect(d.offer(cue("handoff", "handoff:h1", { taskId: "t1" }), T + 1000)).toBe("beaten");
    expect(d.offer(cue("handoff", "handoff:h2", { taskId: "t2" }), T + 1000)).toBe("queue");
    const late = new Director({ now: T });
    late.offer(cue("review_pass", "review_pass:1", { taskId: "t1", hint: true }), T);
    expect(late.offer(cue("handoff", "handoff:h1", { taskId: "t1" }), T + HINT_WINDOW_MS)).toBe("queue");
  });

  test("inferred first: the hint takes over, even from a higher rank, and a queued one leaves", () => {
    const d = new Director({ now: T });
    d.offer(cue("stage_done", "stage_done:1", { taskId: "t1" }), T);
    expect(d.offer(cue("review_pass", "review_pass:1", { taskId: "t1", hint: true }), T + 500)).toBe("play");
    const t = d.tick(T + 500);
    expect(t.current?.id).toBe("review_pass:1");
    expect(t.exiting?.id).toBe("stage_done:1");

    const q = new Director({ now: T });
    q.offer(cue("let_go", "let_go:a"), T);
    q.offer(cue("handoff", "handoff:h1", { taskId: "t1" }), T + 100);
    expect(ids(q)).toEqual(["handoff:h1"]);
    expect(q.offer(cue("review_fail", "review_fail:2", { taskId: "t1", hint: true }), T + 200)).toBe("play");
    expect(ids(q)).toEqual([]);
  });
});

describe("quirks", () => {
  test("never within 30 s of another moment, never on a busy stage", () => {
    const d = new Director({ now: T });
    expect(d.offer(cue("quirk", "quirk:1"), T + QUIRK_QUIET_MS - 1)).toBe("quiet");
    expect(d.offer(cue("quirk", "quirk:2"), T + QUIRK_QUIET_MS)).toBe("play");
    const b = new Director({ now: T });
    b.offer(cue("hire", "hire:a"), T + 40_000);
    expect(b.offer(cue("quirk", "quirk:3"), T + 41_000)).toBe("busy");
    expect(b.offer(cue("quirk", "quirk:4"), T + 42_200 + QUIRK_QUIET_MS - 1)).toBe("quiet");
    expect(b.offer(cue("quirk", "quirk:5"), T + 42_200 + QUIRK_QUIET_MS)).toBe("play");
  });

  test("any moment cuts a quirk short", () => {
    const d = new Director({ now: T });
    d.offer(cue("quirk", "quirk:1"), T + QUIRK_QUIET_MS);
    expect(d.offer(cue("tap", "tap:1"), T + QUIRK_QUIET_MS + 100)).toBe("play");
  });

  /** Steps a director second by second, offering a quirk whenever one is due. */
  function schedule(seed: number, minutes: number): Array<[number, number]> {
    const d = new Director({ now: T, seed });
    const out: Array<[number, number]> = [];
    for (let t = T; t <= T + minutes * 60_000; t += 1000) {
      const s = d.quirkDue(t);
      if (s === null) continue;
      out.push([t - T, s]);
      d.offer(cue("quirk", `quirk:${s}`), t);
    }
    return out;
  }

  test("the seeded gap replays the same: same seed, same times and seeds; another seed differs", () => {
    const a = schedule(7, 30);
    const b = schedule(7, 30);
    expect(a.length).toBeGreaterThan(5);
    expect(a).toEqual(b);
    expect(schedule(8, 30)).not.toEqual(a);
  });

  test("each wait is 45 to 120 s after the stage last moved", () => {
    const run = schedule(3, 60);
    let last = 0;
    for (const [at] of run) {
      const gap = at - last;
      expect(gap).toBeGreaterThanOrEqual(QUIRK_GAP_MIN_MS);
      // one second of slack: the loop steps a second at a time
      expect(gap).toBeLessThanOrEqual(QUIRK_GAP_MAX_MS + 1000);
      last = at + MOMENT_MS.quirk!;
    }
  });

  test("no quirk is due while something plays, and quirkAt says when the next may come", () => {
    const d = new Director({ now: T, seed: 5 });
    const at = d.quirkAt;
    expect(at - T).toBeGreaterThanOrEqual(QUIRK_GAP_MIN_MS);
    expect(at - T).toBeLessThanOrEqual(QUIRK_GAP_MAX_MS);
    expect(d.quirkDue(at - 1)).toBeNull();
    d.offer(ask(1), at - 10);
    expect(d.quirkDue(at + 1)).toBeNull();
  });
});
