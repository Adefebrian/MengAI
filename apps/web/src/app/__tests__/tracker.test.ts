// The run tracker, the crew that leaves, the trading desk and the version
// diff, as data: the tracker follows run.stage (studio or fund stages), a
// failed review loops back and marks the stage that sent it, a run from an
// older server is placed from its tasks, the replay folds the same moves,
// and the DeliveryTracker reads its stops, loop and estimate from them;
// a cat that is let go leaves the crew and the office but keeps its name
// for old events; orders and positions land from their events.
import { describe, expect, test } from "bun:test";
import type { AgentDTO, MengaiEvent, OrderDTO, RunDTO, RunSnapshotDTO } from "@mengai/shared";
import { DEMO_EVENTS, DEMO_WARM_SEQ } from "../../demo/fixture";
import { crewOrder, departedOrder, emptyRunState, reduceRun, replay, stateFromSnapshot, type RunState } from "../../store/runStore";
import { diffCounts, wordDiff } from "../run/diff";
import { officeAgents } from "../run/office";
import { activeLabel, compactTokens, deliveryLooping, deliveryStages, derivedIndex, etaShort, tokensToGo, trackerLine, trackerModel } from "../run/stages";

const LONG_DASH = String.fromCharCode(0x2014);
let seq = 10_000;
function ev(type: MengaiEvent["type"], data: unknown, agentId: string | null = null, ts = 1_000): MengaiEvent {
  seq += 1;
  return { seq, ts, type, runId: "demo", agentId, taskId: null, data } as MengaiEvent;
}

const warm = replay(
  DEMO_EVENTS.filter((e) => e.seq <= DEMO_WARM_SEQ),
  emptyRunState("demo"),
);
const all = replay(DEMO_EVENTS, emptyRunState("demo"));

describe("the run tracker", () => {
  test("the demo walks every studio stage in order, and a failed review loops back once", () => {
    const moves = all.stageMoves.map((m) => m.stage);
    expect(moves).toEqual(["goal", "planned", "hired", "working", "review", "working", "review", "testing", "shipped"]);
    const m = trackerModel(all);
    expect(m.company).toBe("studio");
    expect(m.loops).toBe(1);
    expect(m.stages.every((s) => s.state === "done")).toBe(true);
    expect(activeLabel(m)).toBe("Shipped");
  });

  test("at the approval the run is testing: earlier stages ticked, later ones waiting", () => {
    const m = trackerModel(warm);
    expect(m.stages.map((s) => s.state)).toEqual(["done", "done", "done", "done", "done", "active", "todo"]);
    expect(m.index).toBe(5);
    expect(m.stages[1]!.label).toBe("Oyen plans");
  });

  test("while the fix is on, the review stage says it sent the work back and the stage shows its round", () => {
    const at = DEMO_EVENTS.findIndex((e) => e.type === "run.stage" && (e as MengaiEvent<"run.stage">).data.previous === "review");
    const s = replay(DEMO_EVENTS.slice(0, at + 1), emptyRunState("demo"));
    const m = trackerModel(s);
    expect(m.stages[3]!.state).toBe("active");
    expect(m.stages[4]!.state).toBe("returned");
    expect(activeLabel(m)).toBe("Working, round 2");
    const line = trackerLine(s, m, DEMO_EVENTS[at]!.ts);
    expect(line).toContain("Review sent the work back");
    expect(line.includes(LONG_DASH)).toBe(false);
  });

  test("the replay scrubber drives it: every prefix of the log gives a model, and the stage only goes back on a move back", () => {
    let prev = -1;
    let backs = 0;
    for (let n = 0; n <= DEMO_EVENTS.length; n += 5) {
      const s = replay(DEMO_EVENTS.slice(0, n), emptyRunState("demo"));
      const m = trackerModel(s);
      expect(m.stages).toHaveLength(7);
      if (s.stageMoves.length === 0) continue;
      const nowBacks = s.stageMoves.filter((mv) => mv.stage === "working" && mv.previous === "review").length;
      if (m.index < prev) expect(nowBacks).toBeGreaterThan(backs);
      backs = nowBacks;
      prev = m.index;
    }
  });

  test("a hedge fund run reads the fund stages", () => {
    const run = { ...all.run!, company: "fund", status: "running" } as RunDTO;
    const s: RunState = { ...all, run, stage: "risk_review", stageMoves: [] };
    const m = trackerModel(s);
    expect(m.company).toBe("fund");
    expect(m.stages.map((x) => x.label)).toEqual(["Thesis", "Data research", "Backtest", "Risk review", "Paper trade", "Live trade", "P&L report"]);
    expect(m.index).toBe(3);
  });

  test("a run from an older server without stage events is placed from its tasks", () => {
    const noStages = DEMO_EVENTS.filter((e) => e.type !== "run.stage" && e.seq <= DEMO_WARM_SEQ);
    const s = replay(noStages, emptyRunState("demo"));
    expect(s.stage).toBeNull();
    expect(derivedIndex(s)).toBeGreaterThanOrEqual(3);
    expect(trackerModel(s).stages.filter((x) => x.state === "active")).toHaveLength(1);
  });

  test("tokens to go: estimated from the share of tasks done, capped by the budget, and plain when unknown", () => {
    const run = warm.run!;
    const t = tokensToGo({ ...run, status: "running", progress: 0.5, usage: { ...run.usage, inputTokens: 40_000, outputTokens: 2_000 } });
    expect(t.value).toBe("42,000");
    expect(t.text).toBe("tokens to go");
    expect(tokensToGo({ ...run, status: "running", progress: 0 }).value).toBeNull();
    const capped = tokensToGo({ ...run, status: "running", budgetTokens: 50_000, progress: 0.2, usage: { ...run.usage, inputTokens: 40_000, outputTokens: 0 } });
    expect(capped.value).toBe("10,000");
    expect(tokensToGo({ ...run, budgetTokens: 0 }).detail).toContain("no token cap");
  });
});

describe("the DeliveryTracker props", () => {
  const backAt = DEMO_EVENTS.findIndex((e) => e.type === "run.stage" && (e as MengaiEvent<"run.stage">).data.previous === "review");

  test("every stop reads the real reason of the latest move into it; stops not reached have none", () => {
    const m = trackerModel(warm);
    const stops = deliveryStages(warm, m);
    expect(stops.map((x) => x.id)).toEqual(["goal", "planned", "hired", "working", "review", "testing", "shipped"]);
    expect(stops[0]!.detail).toBe("The goal landed on Oyen's desk");
    expect(stops[1]!.detail).toBe("Oyen planned 5 tasks");
    expect(stops[2]!.detail).toBe("Gembul and Klepon joined the crew");
    // back to working after the review, the latest reason wins
    expect(stops[3]!.detail).toBe("The review asked for doubled quotes and quoted newlines");
    expect(stops[4]!.detail).toBe("The fix went back to Tempe");
    expect(stops[6]!.detail).toBeNull();
    expect(stops.map((x) => x.label)).toEqual(m.stages.map((x) => x.label));
    for (const x of stops) expect((x.detail ?? "").includes(LONG_DASH)).toBe(false);
  });

  test("the loop is open from the move back until the run reaches review again", () => {
    const open = replay(DEMO_EVENTS.slice(0, backAt + 1), emptyRunState("demo"));
    const mo = trackerModel(open);
    expect(deliveryLooping(mo)).toBe(true);
    expect(mo.index).toBe(3);
    expect(mo.loops).toBe(1);
    expect(deliveryLooping(trackerModel(warm))).toBe(false);
    expect(trackerModel(warm).loops).toBe(1);
    const paused = { ...open, run: { ...open.run!, status: "paused" } } as RunState;
    expect(deliveryLooping(trackerModel(paused))).toBe(false);
  });

  test("the estimate is short enough for the driver line", () => {
    const run = warm.run!;
    expect(etaShort({ ...run, status: "running", progress: 0.5, usage: { ...run.usage, inputTokens: 40_000, outputTokens: 2_000 } })).toBe("42k tokens to go");
    expect(etaShort({ ...run, status: "running", progress: 0 })).toBe("Estimating");
    expect(etaShort({ ...run, status: "done", usage: { ...run.usage, inputTokens: 180_000, outputTokens: 4_400 } })).toBe("184k tokens used");
    expect(compactTokens(950)).toBe("950");
    expect(compactTokens(41_600)).toBe("42k");
    expect(compactTokens(1_260_000)).toBe("1.3M");
    expect(compactTokens(12_600_000)).toBe("13M");
    expect(compactTokens(Number.NaN)).toBe("0");
  });
});

describe("a cat that is let go", () => {
  const cemplon: AgentDTO = { ...all.agents["agent-onde"]!, id: "agent-x", name: "Cemplon", role: "engineer", roleTitle: "Engineer", roleId: null };
  const base = reduceRun(warm, ev("agent.spawned", { agent: cemplon }, "agent-x"));
  const left = reduceRun(base, ev("agent.left", { agentId: "agent-x", reason: "Three failed checks in a row", byAgentId: "agent-kopi", requeued: ["t-wire"] }, "agent-x"));

  test("leaves the crew and the office, keeps its name, and is listed with the reason", () => {
    expect(crewOrder(base).some((a) => a.id === "agent-x")).toBe(true);
    expect(crewOrder(left).some((a) => a.id === "agent-x")).toBe(false);
    expect(officeAgents(left, {}).some((a) => a.id === "agent-x")).toBe(false);
    expect(left.agents["agent-x"]?.name).toBe("Cemplon");
    expect(departedOrder(left).map((a) => a.id)).toEqual(["agent-x"]);
    expect(left.departed["agent-x"]).toMatchObject({ reason: "Three failed checks in a row", byAgentId: "agent-kopi", requeued: ["t-wire"] });
  });

  test("a snapshot's departed list paints the same way before the stream", () => {
    const snap: RunSnapshotDTO = {
      run: warm.run!,
      agents: warm.agentOrder.map((id) => warm.agents[id]!),
      tasks: [],
      handoffs: [],
      decisions: [],
      approvals: [],
      departed: [{ ...cemplon, leftReason: "Budget ran thin" }],
      stage: "working",
      lastSeq: 1,
    };
    const s = stateFromSnapshot(snap);
    expect(s.stage).toBe("working");
    expect(crewOrder(s).some((a) => a.id === "agent-x")).toBe(false);
    expect(s.departed["agent-x"]?.reason).toBe("Budget ran thin");
    expect(s.agents["agent-x"]?.name).toBe("Cemplon");
  });

  test("dynamic role titles reach the desk plates", () => {
    const onde = officeAgents(all, {}).find((a) => a.id === "agent-onde");
    expect(onde?.roleTitle).toBe("Export tester");
    expect(officeAgents(all, {}).find((a) => a.role === "lead")?.roleTitle).toBe("CEO");
    expect(Object.values(all.roles).map((r) => r.title)).toEqual(["Export tester"]);
  });
});

describe("the trading desk of a run", () => {
  const order: OrderDTO = {
    id: "o-1",
    runId: "demo",
    agentId: "agent-mochi",
    symbol: "AAPL",
    side: "buy",
    qty: 10,
    type: "market",
    limitPrice: null,
    mode: "live",
    status: "proposed",
    venue: null,
    reason: "Thesis held in the backtest",
    riskNote: null,
    fillPrice: null,
    createdAt: 1,
    decidedAt: null,
    filledAt: null,
  };
  test("orders and positions land from their events, the latest version of an order wins", () => {
    let s = reduceRun(warm, ev("trade.order", { order }));
    s = reduceRun(s, ev("trade.order", { order: { ...order, status: "filled", fillPrice: 181.2 } }));
    s = reduceRun(s, ev("trade.positions", { positions: [{ symbol: "AAPL", mode: "live", qty: 10, avgPrice: 181.2, lastPrice: 182, unrealizedUsd: 8, realizedUsd: 0 }] }));
    expect(s.orderOrder).toEqual(["o-1"]);
    expect(s.orders["o-1"]?.status).toBe("filled");
    expect(s.positions?.[0]?.unrealizedUsd).toBe(8);
  });
});

describe("the version diff", () => {
  test("marks added and removed words and keeps the rest", () => {
    const parts = wordDiff("Run the tests before a handoff.", "Run the tests that cover the file before a handoff.");
    expect(parts.filter((p) => p.kind === "add").map((p) => p.text.trim())).toEqual(["that cover the file"]);
    expect(parts.some((p) => p.kind === "del")).toBe(false);
    expect(parts.map((p) => p.text).join("")).toBe("Run the tests that cover the file before a handoff.");
    expect(diffCounts(wordDiff("a b c", "a x c"))).toEqual({ added: 1, removed: 1 });
  });
});
