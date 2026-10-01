// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The moments deriver, as data: every row of the catalog (spec 4.1) from a
// real event sequence folded through the island's reducer. The actor is the
// cat the fact is about (the lead when unknown), the prop is what the fact
// is about, ids are stable per fact so a replay never plays twice, an
// inferred moment keeps its task so the director's one hint rule can beat
// it within 2 s, and every sentence is one plain line with no long dash.
import { describe, expect, test } from "bun:test";
import type { ApprovalDTO, Capability, MengaiEvent } from "@mengai/shared";
import { Director, HINT_WINDOW_MS, PRIORITY, type Cue } from "../director";
import { PREVIEW_RUN_ID, Script, agentDTO, askOwner, orderDTO, runDTO, sampleRun, taskDTO } from "../fixture";
import { applyEvent, deriveModel, emptyLive, type IslandLive } from "../live";
import { SHIP_MS } from "../machine";
import { ANSWER_MS, MOMENT_MS, SHIP_STAGGER_MS, STAGE_QUIRKS, TAP_COMBO_MS, answerMoment, askMoments, capabilityProp, deriveMoments, plainSentence, quirkMoment, tapCombo, tapMoment } from "../moments";

const NOW = 1_800_000_000_000;
const LONG_DASH = String.fromCharCode(0x2014);
const RUN = PREVIEW_RUN_ID;

function fold(events: readonly MengaiEvent[], live: IslandLive = emptyLive()): IslandLive {
  let l = live;
  for (const e of events) l = applyEvent(l, e, e.ts + 10).live;
  return l;
}

/** The sample run in review, its script open for more events. */
function setup(): { s: Script; live: IslandLive } {
  const s = sampleRun(NOW - 60_000);
  return { s, live: fold(s.events) };
}

/** Apply one event and derive its moments, the island clock just after the event. */
function step(live: IslandLive, e: MengaiEvent, now = e.ts + 10): { after: IslandLive; moments: Cue[] } {
  const after = applyEvent(live, e, now).live;
  return { after, moments: deriveMoments(live, e, after, now) };
}

function approval(id: string, capability: Capability, agentId: string, at: number, detail: Record<string, unknown> = {}): ApprovalDTO {
  return { id, runId: RUN, agentId, capability, risk: "write", title: `Use ${capability}`, detail, status: "pending", scope: "once", createdAt: at, decidedAt: null, expiresAt: at + 600_000 };
}

function expectPlain(m: Cue): void {
  expect(m.text.includes(LONG_DASH)).toBe(false);
  expect(m.text.length).toBeLessThanOrEqual(80);
  expect(m.text).toMatch(/[.!?…]$/);
}

describe("hire, let go and handoff", () => {
  test("a new cat is hired: it drops out, waves once and climbs back in", () => {
    const { s, live } = setup();
    const e = s.emit("agent.spawned", { agent: agentDTO(RUN, "a-kopi", "Kopi", "engineer", s.now), reason: "work is waiting", hiredBy: "a-oyen" }, "a-kopi");
    const [m, ...rest] = step(live, e).moments;
    expect(rest).toHaveLength(0);
    expect(m!.id).toBe("hire:a-kopi");
    expect(m!.type).toBe("hire");
    expect(m!.cats).toHaveLength(1);
    expect(m!.cats[0]!.cat.name).toBe("Kopi");
    expect(m!.cats[0]!.pose).toBe("ask");
    expect(m!.cats[0]!.move).toBe("visit");
    expect(m!.ms).toBe(2200);
    expect(m!.priority).toBe(40);
    expect(m!.text).toBe("Kopi joined the crew as an engineer.");
    expect(m!.path).toBe(`/app/runs/${RUN}`);
    expectPlain(m!);
  });

  test("the CEO opening the run is not a hire, nor is a cat the island already knows", () => {
    const s = new Script("r-new", NOW - 5000);
    let live = fold([s.emit("run.created", { run: runDTO("r-new", "A goal", s.now) })]);
    const lead = s.emit("agent.spawned", { agent: agentDTO("r-new", "a-ceo", "Oyen", "lead", s.now), hiredBy: null }, "a-ceo");
    const r = step(live, lead);
    expect(r.moments).toHaveLength(0);
    live = r.after;
    const again = s.emit("agent.spawned", { agent: agentDTO("r-new", "a-ceo", "Oyen", "lead", s.now), hiredBy: null }, "a-ceo");
    expect(step(live, again).moments).toHaveLength(0);
  });

  test("a cat let go stops and slides away", () => {
    const { s, live } = setup();
    const e = s.emit("agent.left", { agentId: "a-onde", reason: "no design work left", byAgentId: "a-oyen", requeued: [] }, "a-oyen");
    const [m] = step(live, e).moments;
    expect(m!.id).toBe("let_go:a-onde");
    expect(m!.cats[0]!.cat.name).toBe("Onde");
    expect(m!.cats[0]!.pose).toBe("stopped");
    expect(m!.cats[0]!.move).toBe("leave");
    expect(m!.ms).toBe(1800);
    expect(m!.text).toBe("Onde left the crew.");
  });

  test("a handoff shows both cats side by side: the giver holds the card, the receiver catches into its work", () => {
    const { s, live } = setup();
    const e = s.emit(
      "handoff",
      { handoff: { id: "h-1", runId: RUN, taskId: "t-export", fromAgentId: "a-gembul", toAgentId: "a-klepon", toRole: "reviewer", summary: "Export ready for review", createdAt: s.now } },
      "a-gembul",
      "t-export",
    );
    const [m] = step(live, e).moments;
    expect(m!.id).toBe("handoff:h-1");
    expect(m!.cats.map((c) => c.cat.name)).toEqual(["Gembul", "Klepon"]);
    expect(m!.cats[0]!.pose).toBe("handoff");
    expect(m!.cats[0]!.prop).toBe("card");
    expect(m!.cats[1]!.pose).toBe("review");
    expect(m!.cats[1]!.delayMs).toBe(SHIP_STAGGER_MS);
    expect(m!.ms).toBe(2400);
    expect(m!.taskId).toBe("t-export");
    expect(m!.text).toBe("Gembul handed off to Klepon.");
  });

  test("a handoff to a role with no cat yet shows the giver alone; an unknown giver falls back to the lead", () => {
    const { s, live } = setup();
    const e = s.emit("handoff", { handoff: { id: "h-2", runId: RUN, taskId: "t-export", fromAgentId: "a-ghost", toAgentId: null, toRole: "qa", summary: "Test it", createdAt: s.now } }, "a-ghost", "t-export");
    const [m] = step(live, e).moments;
    expect(m!.cats).toHaveLength(1);
    expect(m!.cats[0]!.cat.name).toBe("Oyen");
    expect(m!.cats[0]!.cat.role).toBe("lead");
    expect(m!.text).toBe("Oyen handed off to the tester.");
  });
});

describe("engine hints", () => {
  function hint(kind: MengaiEvent<"moment">["data"]["kind"], agentId: string | null, text = "") {
    const { s, live } = setup();
    const e = s.emit("moment", { kind, agentId, taskId: "t-review", level: "info", text }, agentId, "t-review");
    const [m, ...rest] = step(live, e).moments;
    expect(rest).toHaveLength(0);
    expect(m!.id).toBe(`${kind}:${e.seq}`);
    expect(m!.type).toBe(kind);
    expect(m!.hint).toBe(true);
    expect(m!.taskId).toBe("t-review");
    expect(m!.priority).toBe(50);
    expectPlain(m!);
    return m!;
  }

  test("review_pass: the reviewer plays its review beat with a cheer hop, proud", () => {
    const m = hint("review_pass", "a-klepon", "Klepon passed the CSV export.");
    expect(m.cats[0]!.cat.name).toBe("Klepon");
    expect(m.cats[0]!.pose).toBe("review");
    expect(m.cats[0]!.move).toBe("hop");
    expect(m.cats[0]!.cat.mood).toBe("proud");
    expect(m.ms).toBe(2200);
    expect(m.text).toBe("Klepon passed the CSV export.");
  });

  test("review_fail: the reviewer holds the bug card, ears back", () => {
    const m = hint("review_fail", "a-klepon");
    expect(m.cats[0]!.pose).toBe("review");
    expect(m.cats[0]!.prop).toBe("bugcard");
    expect(m.cats[0]!.cat.mood).toBe("frustrated");
    expect(m.ms).toBe(2200);
    expect(m.text).toBe("Klepon sent the work back from review.");
  });

  test("ceo_approved and ceo_denied: Oyen reviews the crew, then nods or stops", () => {
    const yes = hint("ceo_approved", "a-oyen");
    expect(yes.cats[0]!.cat.name).toBe("Oyen");
    expect(yes.cats[0]!.pose).toBe("review");
    expect(yes.ms).toBe(1800);
    const no = hint("ceo_denied", "a-oyen");
    expect(no.cats[0]!.pose).toBe("stopped");
    expect(no.ms).toBe(1800);
  });

  test("rethink and stuck: that cat thinks; stuck adds a twitch", () => {
    const re = hint("rethink", "a-gembul");
    expect(re.cats[0]!.cat.name).toBe("Gembul");
    expect(re.cats[0]!.pose).toBe("think");
    expect(re.cats[0]!.quirk).toBeNull();
    const stuck = hint("stuck", "a-gembul");
    expect(stuck.cats[0]!.pose).toBe("think");
    expect(stuck.cats[0]!.quirk).toBe("twitch");
    expect(stuck.ms).toBe(1800);
  });

  test("budget_low: Oyen at the plan board with the clipboard; an unknown cat falls back to the lead", () => {
    const m = hint("budget_low", null);
    expect(m.cats[0]!.cat.name).toBe("Oyen");
    expect(m.cats[0]!.pose).toBe("plan");
    expect(m.cats[0]!.prop).toBe("clipboard");
    expect(m.ms).toBe(2200);
  });

  test("the engine's sentence is kept plain: no long dash, one sentence, clipped", () => {
    const m = hint("review_pass", "a-klepon", `Klepon passed the export ${LONG_DASH} clean diff, tests green. Then it went on to the next card in the long queue of work.`);
    expect(m.text).toBe("Klepon passed the export, clean diff, tests green.");
    const long = plainSentence("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(80);
  });

  test("an inferred moment keeps its task for the director, whose one hint rule beats it within 2 s, not after", () => {
    const { s, live } = setup();
    const h = s.emit("moment", { kind: "review_pass", agentId: "a-klepon", taskId: "t-export", level: "good", text: "" }, "a-klepon", "t-export");
    const hinted = step(live, h);
    const near = s.emit("handoff", { handoff: { id: "h-3", runId: RUN, taskId: "t-export", fromAgentId: "a-klepon", toAgentId: "a-tempe", toRole: "qa", summary: "", createdAt: s.now } }, "a-klepon", "t-export");
    const inferred = step(hinted.after, near);
    // the deriver drops nothing on its own: the handoff comes out with the task it is about
    expect(inferred.moments.map((m) => m.id)).toEqual(["handoff:h-3"]);
    expect(inferred.moments[0]!.taskId).toBe("t-export");
    const hint = hinted.moments[0]!;
    expect(hint.taskId).toBe("t-export");
    const d = new Director({ now: NOW });
    expect(d.offer(hint, NOW)).toBe("play");
    expect(d.offer(inferred.moments[0]!, NOW + 500)).toBe("beaten");
    const late = new Director({ now: NOW });
    late.offer(hint, NOW);
    expect(late.offer(inferred.moments[0]!, NOW + HINT_WINDOW_MS)).toBe("queue");
  });
});

describe("stage done, shipped, failed", () => {
  test("a step forward: the cat that finished the last task celebrates; the sentence names both stages", () => {
    const { s, live } = setup();
    const done = s.emit("task.updated", { task: taskDTO(RUN, "t-export", "Build the CSV export", "engineer", "a-gembul", s.now, { status: "done", endedAt: s.now }) }, "a-gembul", "t-export");
    const l = step(live, done).after;
    const e = s.emit("run.stage", { stage: "testing", previous: "review", reason: "Review passed" });
    const [m] = step(l, e).moments;
    expect(m!.id).toBe(`stage_done:${RUN}:${e.seq}`);
    expect(m!.cats[0]!.cat.name).toBe("Gembul");
    expect(m!.cats[0]!.pose).toBe("celebrate");
    expect(m!.ms).toBe(2400);
    expect(m!.priority).toBe(60);
    expect(m!.taskId).toBe("t-export");
    expect(m!.text).toBe("Gembul finished review, testing is next.");
  });

  test("no task done yet: the lead closes the stage; a loop back or the final stage is not a stage done", () => {
    const { s, live } = setup();
    const back = s.emit("run.stage", { stage: "working", previous: "review", reason: "Review failed" });
    const r = step(live, back);
    expect(r.moments).toHaveLength(0);
    const fwd = s.emit("run.stage", { stage: "review", previous: "working", reason: "Fixed" });
    const r2 = step(r.after, fwd);
    expect(r2.moments[0]!.cats[0]!.cat.name).toBe("Oyen");
    expect(r2.moments[0]!.text).toBe("Oyen finished the build, review is next.");
    const last = s.emit("run.stage", { stage: "shipped", previous: "testing", reason: "Done" });
    expect(step(r2.after, last).moments).toHaveLength(0);
  });

  test("shipped: up to three cats in a row, the lead in the middle, hopping in on an 80 ms stagger", () => {
    const { s, live } = setup();
    s.emit("task.updated", { task: taskDTO(RUN, "t-export", "Build the CSV export", "engineer", "a-gembul", s.now, { status: "done", endedAt: s.now }) }, "a-gembul", "t-export");
    s.emit("task.updated", { task: taskDTO(RUN, "t-review", "Review the export", "reviewer", "a-klepon", s.now, { status: "done", endedAt: s.now }) }, "a-klepon", "t-review");
    const l = fold(s.events.slice(-2), live);
    const e = s.emit("run.status", { status: "done", reason: null });
    const [m] = step(l, e).moments;
    expect(m!.id).toBe(`shipped:${RUN}`);
    expect(m!.cats.map((c) => c.cat.name)).toEqual(["Gembul", "Oyen", "Klepon"]);
    expect(m!.cats.map((c) => c.delayMs)).toEqual([SHIP_STAGGER_MS, 0, SHIP_STAGGER_MS * 2]);
    expect(m!.cats.every((c) => c.pose === "celebrate" && c.move === "hop")).toBe(true);
    expect(m!.ms).toBe(SHIP_MS);
    expect(m!.priority).toBe(80);
    expect(m!.text).toBe("Oyen and the crew shipped the run.");
  });

  test("a finish seen long after it happened (a replay) plays nothing", () => {
    const { s, live } = setup();
    const e = s.emit("run.status", { status: "done", reason: null });
    expect(step(live, e, e.ts + 120_000).moments).toHaveLength(0);
  });

  test("failed: Oyen stopped under the island until the owner acts", () => {
    const { s, live } = setup();
    const e = s.emit("run.status", { status: "failed", reason: "The provider refused the request. Try again later." });
    const [m] = step(live, e).moments;
    expect(m!.id).toBe(`failed:${RUN}`);
    expect(m!.cats[0]!.cat.name).toBe("Oyen");
    expect(m!.cats[0]!.pose).toBe("stopped");
    expect(m!.cats[0]!.move).toBe("emerge");
    expect(m!.ms).toBeNull();
    expect(m!.priority).toBe(90);
    expect(m!.text).toBe("The run failed: the provider refused the request.");
  });
});

describe("asks and answers", () => {
  test("a yes or no question to the owner: the asking cat climbs out with its role object and paw up", () => {
    const { s } = setup();
    askOwner(s);
    const model = deriveModel(fold(s.events));
    const [m] = askMoments(model, NOW);
    expect(m!.id).toBe("ask_approval:request:rq-install");
    expect(m!.askId).toBe("request:rq-install");
    expect(m!.cats[0]!.cat.name).toBe("Klepon");
    expect(m!.cats[0]!.pose).toBe("ask");
    expect(m!.cats[0]!.prop).toBe("magnifier");
    expect(m!.cats[0]!.move).toBe("emerge");
    expect(m!.ms).toBeNull();
    expect(m!.priority).toBe(100);
    expect(m!.text).toBe("Klepon asks: May I run npm install papaparse, a medium risk tool?");
    // stable: the same ask always yields the same id
    expect(askMoments(model, NOW + 5000)[0]!.id).toBe(m!.id);
  });

  test("an approval: the cat holds what the capability is about", () => {
    const cases: Array<[Capability, Record<string, unknown>, string]> = [
      ["shell", {}, "terminal"],
      ["fs", {}, "page"],
      ["network", {}, "spyglass"],
      ["browser", {}, "runbook"],
      ["apps", {}, "runbook"],
      ["shell", { connectorId: "c-github" }, "spyglass"],
    ];
    for (const [cap, detail, prop] of cases) {
      const { s } = setup();
      s.emit("approval.requested", { approval: approval(`ap-${cap}`, cap, "a-gembul", s.now, detail) }, "a-gembul", "t-export");
      const [m] = askMoments(deriveModel(fold(s.events)), NOW);
      expect(m!.type).toBe("ask_approval");
      expect(m!.cats[0]!.cat.name).toBe("Gembul");
      expect(m!.cats[0]!.prop).toBe(prop as never);
    }
    expect(capabilityProp({ capability: "screen", detail: {} }, "designer")).toBe("runbook");
  });

  test("an open question: the cat thinks, holding a page", () => {
    const { s } = setup();
    s.emit("request.raised", { requestId: "rq-q", fromAgentId: "a-onde", toAgentId: null, question: "Which brand colour should the button use?", toOwner: true }, "a-onde", null);
    s.emit("agent.status", { status: "approval", activity: "ask", mood: "focused", statusText: "Which colour?", taskId: null }, "a-onde");
    const [m] = askMoments(deriveModel(fold(s.events)), NOW);
    expect(m!.type).toBe("ask_question");
    expect(m!.cats[0]!.cat.name).toBe("Onde");
    expect(m!.cats[0]!.pose).toBe("think");
    expect(m!.cats[0]!.prop).toBe("page");
  });

  test("a live order: the cat that proposed it holds the card", () => {
    const { s } = setup();
    s.emit("trade.order", { order: orderDTO("o-btc", null, s.now) }, "a-gembul", null, null);
    const [m] = askMoments(deriveModel(fold(s.events)), NOW);
    expect(m!.id).toBe("ask_order:order:o-btc");
    expect(m!.type).toBe("ask_order");
    expect(m!.cats[0]!.cat.name).toBe("Gembul");
    expect(m!.cats[0]!.pose).toBe("ask");
    expect(m!.cats[0]!.prop).toBe("card");
    expect(m!.text).toBe("Gembul asks to buy 0.25 BTCUSDT.");
  });

  test("the owner answers: approve celebrates, deny puts the ears down, each from the asking cat", () => {
    const { s } = setup();
    s.emit("approval.requested", { approval: approval("ap-1", "shell", "a-gembul", s.now) }, "a-gembul", "t-export");
    const live = fold(s.events);
    const yes = step(live, s.emit("approval.resolved", { id: "ap-1", status: "approved" }, "a-gembul")).moments;
    expect(yes.map((m) => m.id)).toEqual(["answer:approval:ap-1"]);
    expect(yes[0]!.type).toBe("ask_approval");
    expect(yes[0]!.askId).toBe("approval:ap-1");
    expect(yes[0]!.cats[0]!.cat.name).toBe("Gembul");
    expect(yes[0]!.cats[0]!.pose).toBe("celebrate");
    expect(yes[0]!.ms).toBe(ANSWER_MS);

    const { s: s2 } = setup();
    askOwner(s2);
    const live2 = fold(s2.events);
    const no = step(live2, s2.emit("request.decided", { requestId: "rq-install", byAgentId: null, byOwner: true, answer: "No", approved: false }, null)).moments;
    expect(no[0]!.cats[0]!.cat.name).toBe("Klepon");
    expect(no[0]!.cats[0]!.pose).toBe("stopped");

    const { s: s3 } = setup();
    s3.emit("trade.order", { order: orderDTO("o-btc", null, s3.now) }, "a-gembul", null, null);
    const live3 = fold(s3.events);
    const rejected = step(live3, s3.emit("trade.order", { order: orderDTO("o-btc", null, s3.now, { status: "rejected" }) }, null, null, null)).moments;
    expect(rejected[0]!.id).toBe("answer:order:o-btc");
    expect(rejected[0]!.cats[0]!.pose).toBe("stopped");
  });

  test("answerMoment builds the same reaction from a shown ask", () => {
    const { s } = setup();
    askOwner(s);
    const [ask] = askMoments(deriveModel(fold(s.events)), NOW);
    const r = answerMoment(ask!, true, NOW + 10);
    expect(r.id).toBe("answer:request:rq-install");
    expect(r.ms).toBe(ANSWER_MS);
    expect(r.priority).toBe(PRIORITY.ask_approval);
    expect(r.cats[0]!.move).toBe("visit");
    expect(r.text).toBe("Klepon got your yes.");
  });
});

describe("replays, quirks and taps", () => {
  test("an event applied twice yields its moment once; the id is the same fact", () => {
    const { s, live } = setup();
    const e = s.emit("agent.left", { agentId: "a-onde", reason: "done", byAgentId: "a-oyen", requeued: [] }, "a-oyen");
    const first = step(live, e);
    expect(first.moments).toHaveLength(1);
    expect(step(first.after, e).moments).toHaveLength(0);
    // a stale event (older than FRESH_MS) plays nothing either
    const { s: s2, live: l2 } = setup();
    const old = s2.emit("agent.left", { agentId: "a-onde", reason: "done", byAgentId: "a-oyen", requeued: [] }, "a-oyen");
    expect(step(l2, old, old.ts + 61_000).moments).toHaveLength(0);
  });

  test("events that are no moment, or of a run the island does not follow, yield none", () => {
    const { s, live } = setup();
    expect(step(live, s.emit("agent.say", { text: "hi", to: null }, "a-gembul")).moments).toHaveLength(0);
    const other = new Script("r-other", NOW - 1000, 900);
    expect(step(live, other.emit("moment", { kind: "stuck", agentId: null, taskId: null, level: "bad", text: "" })).moments).toHaveLength(0);
  });

  test("a quirk: a crew cat at work, picked by the seed, the same seed the same scene", () => {
    const model = deriveModel(setup().live);
    const a = quirkMoment(model, 42, NOW)!;
    const b = quirkMoment(model, 42, NOW)!;
    expect(a).toEqual(b);
    expect(a.id).toBe("quirk:42");
    expect(a.type).toBe("quirk");
    expect(a.ms).toBe(MOMENT_MS.quirk);
    expect(a.priority).toBe(10);
    expect(a.cats[0]!.pose).toBe("rest");
    expect(STAGE_QUIRKS).toContain(a.cats[0]!.quirk!);
    const atWork = new Set(model.active!.crew.filter((c) => c.atWork).map((c) => c.name));
    const picks = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const m = quirkMoment(model, seed, NOW)!;
      expect(atWork.has(m.cats[0]!.cat.name)).toBe(true);
      picks.add(`${m.cats[0]!.cat.name}:${m.cats[0]!.quirk}`);
      expectPlain(m);
    }
    expect(picks.size).toBeGreaterThan(3);
    expect(quirkMoment(deriveModel(emptyLive()), 1, NOW)).toBeNull();
  });

  test("a tap plays the cat's own pose; three taps within 1.5 s call a crew cat out to wave", () => {
    const model = deriveModel(setup().live);
    const lead = model.active!.lead;
    const tap = tapMoment(model, lead, NOW);
    expect(tap.type).toBe("tap");
    expect(tap.ms).toBe(900);
    expect(tap.priority).toBe(30);
    expect(tap.cats[0]!.cat.name).toBe("Oyen");
    expect(tap.cats[0]!.pose).toBe("review");
    expect(tapCombo([NOW - 1000, NOW - 500, NOW], NOW)).toBe(true);
    expect(tapCombo([NOW - TAP_COMBO_MS - 1, NOW - 500, NOW], NOW)).toBe(false);
    const wave = tapMoment(model, lead, NOW, true);
    expect(wave.cats[0]!.cat.name).toBe("Gembul");
    expect(wave.cats[0]!.pose).toBe("ask");
  });
});
