import { describe, expect, test } from "bun:test";
import type { MengaiEvent, TaskDTO } from "@mengai/shared";
import { CEO_SYSTEM, COMPANY, meetingHoldMs, meetingsFromEvents, ownerOnly, parseCeoReply, syncText, wrapupText } from "./company";
import { harness, type HarnessOptions } from "./testkit";
import { VOICE } from "./voice";

type Ev<T extends MengaiEvent["type"]> = MengaiEvent<T>;
const byTitle = (tasks: TaskDTO[], title: string) => tasks.find((t) => t.title === title)!;
const at = (events: MengaiEvent[], pred: (e: MengaiEvent) => boolean) => events.findIndex(pred);

const plan = (tasks: unknown[]) => ({ calls: [{ name: "create_tasks", args: { tasks } }, { name: "finish", args: { summary: "planned" } }] });
const finish = (summary: string) => ({ calls: [{ name: "finish", args: { summary } }] });

/** lead plans build (engineer, reviewed) + test (qa, after build); the reviewer fails once, then passes */
function crewScript(): HarnessOptions["script"] {
  return {
    lead: [
      plan([
        { key: "build", title: "Build feature", spec: "Implement it", acceptance: ["works"], role: "engineer", review: true },
        { key: "test", title: "Test feature", spec: "Test it", role: "qa", deps: ["build"] },
      ]),
      finish("Final: shipped"),
    ],
    engineer: [finish("Feature built"), finish("Added the missing tests")],
    reviewer: [
      { calls: [{ name: "submit_review", args: { verdict: "fail", notes: ["Missing tests", "No error state"] } }] },
      { calls: [{ name: "submit_review", args: { verdict: "pass", notes: ["Looks good"] } }] },
    ],
    qa: [finish("Tests pass")],
  };
}

describe("company: pure rules", () => {
  test("parseCeoReply reads approve, deny and owner and rejects noise", () => {
    expect(parseCeoReply('{"decision":"approve","answer":"Go ahead."}')).toEqual({ decision: "approve", answer: "Go ahead." });
    expect(parseCeoReply('```json\n{"decision":"Denied","answer":"Keep the scope."}\n```')).toEqual({ decision: "deny", answer: "Keep the scope." });
    expect(parseCeoReply('Sure: {"decision":"escalate"}')).toEqual({ decision: "owner", answer: "" });
    expect(parseCeoReply('{"decision":"approve"}')).toBeNull();
    expect(parseCeoReply('{"decision":"maybe","answer":"x"}')).toBeNull();
    expect(parseCeoReply("not json")).toBeNull();
  });

  test("owner-only topics skip the CEO", () => {
    expect(ownerOnly("Can I use your OpenAI API key for this?")).toBe(true);
    expect(ownerOnly("Should I delete the old folder?")).toBe(true);
    expect(ownerOnly("Is burnt orange fine as the accent color?")).toBe(false);
  });

  test("meeting hold: pace hint range, real-mode default", () => {
    expect(meetingHoldMs(undefined)).toBe(COMPANY.meetingMs);
    expect(COMPANY.meetingMs).toBe(3000);
    expect(meetingHoldMs([6000, 10_000], () => 0)).toBe(6000);
    expect(meetingHoldMs([6000, 10_000], () => 1)).toBe(10_000);
    expect(meetingHoldMs([10, 2], () => 0.5)).toBe(6);
  });

  test("meeting text: sync decisions and one wrap-up note per finished task", () => {
    const sync = syncText({ reviewerName: "Miso", ownerName: "Mochi", taskTitle: "Build", notes: ["No tests"], round: 1, next: "fix" });
    expect(sync.agenda).toEqual(["No tests"]);
    expect(sync.notes).toEqual(["Miso: No tests"]);
    expect(sync.decisions).toEqual(["Mochi fixes Build (round 2)"]);
    const wrap = wrapupText(
      [
        { title: "Build", status: "done", by: "Mochi" },
        { title: "Test", status: "blocked", by: null },
      ],
      "Kopi",
    );
    expect(wrap.notes).toEqual(["Build: done by Mochi", "Test: blocked"]);
    expect(wrap.decisions).toEqual(["Kopi writes the report to the owner", "1 open item go in the report"]);
  });

  test("meetingsFromEvents folds started and ended, oldest first", () => {
    const ev = (seq: number, ts: number, type: MengaiEvent["type"], data: unknown) => ({ seq, ts, type, runId: "r", agentId: null, taskId: null, data }) as MengaiEvent;
    const out = meetingsFromEvents([
      ev(1, 10, "meeting.started", { meetingId: "m1", kind: "kickoff", title: "Kickoff", agentIds: ["a", "b"], agenda: ["x"] }),
      ev(2, 20, "meeting.ended", { meetingId: "m1", kind: "kickoff", notes: ["n"], decisions: ["d"] }),
      ev(3, 30, "meeting.started", { meetingId: "m2", kind: "sync", title: "Sync", agentIds: ["a"], agenda: [] }),
    ]);
    expect(out).toEqual([
      { id: "m1", kind: "kickoff", title: "Kickoff", agentIds: ["a", "b"], agenda: ["x"], notes: ["n"], startedAt: 10, endedAt: 20 },
      { id: "m2", kind: "sync", title: "Sync", agentIds: ["a"], agenda: [], notes: [], startedAt: 30, endedAt: null },
    ]);
  });
});

describe("company: meetings", () => {
  test("kickoff after the plan: lead plus the crew, agenda = task titles, nobody starts before it ends", async () => {
    const h = await harness({ script: crewScript() });
    const run = await h.svc.create({ projectId: "p1", goal: "Ship the feature" });
    await h.untilStatus(run.id, "done");
    const ev = h.events.events;
    const started = h.events.ofType("meeting.started");
    expect(started.map((e) => e.data.kind)).toEqual(["kickoff", "sync", "wrapup"]);

    const kick = started[0]!;
    const snap = await h.svc.snapshot(run.id);
    const role = (id: string) => snap.agents.find((a) => a.id === id)!.role;
    expect(kick.data.title).toBe("Kickoff");
    expect(kick.data.agenda).toEqual(["Build feature", "Test feature"]);
    expect(kick.data.agentIds.map(role).sort()).toEqual(["engineer", "lead", "qa"]);
    const kickEnd = at(ev, (e) => e.type === "meeting.ended" && (e as Ev<"meeting.ended">).data.meetingId === kick.data.meetingId);
    const kickStart = at(ev, (e) => e === kick);
    // the crew cats were hired before the kickoff and sat in it
    const qaSpawn = at(ev, (e) => e.type === "agent.spawned" && (e as Ev<"agent.spawned">).data.agent.role === "qa");
    expect(qaSpawn).toBeLessThan(kickStart);
    const firstRun = at(ev, (e) => e.type === "task.updated" && (e as Ev<"task.updated">).data.task.role !== "lead" && (e as Ev<"task.updated">).data.task.status === "running");
    expect(firstRun).toBeGreaterThan(kickEnd);
    const ended = (ev[kickEnd] as Ev<"meeting.ended">).data;
    expect(ended.notes).toEqual(["Build feature: Engineer, reviewed", "Test feature: QA, after Build feature"]);
    const engineer = snap.agents.find((a) => a.role === "engineer")!;
    expect(ended.decisions).toEqual([`${engineer.name} starts on Build feature`, "1 task go through review"]);
    // seated cats: the lead presents, the crew listens
    const during = ev.slice(kickStart, kickEnd).filter((e): e is Ev<"agent.status"> => e.type === "agent.status");
    const lead = snap.agents.find((a) => a.role === "lead")!;
    expect(during.find((e) => e.agentId === lead.id)!.data).toMatchObject({ activity: "review", statusText: "In the kickoff meeting" });
    expect(during.find((e) => e.agentId === engineer.id)!.data).toMatchObject({ status: "waiting", activity: "wait", statusText: "In the kickoff meeting" });
    // the lead deals the task to the cat that takes it
    expect(h.events.ofType("agent.say").some((e) => e.agentId === lead.id && e.data.to === engineer.id && e.data.text === `${engineer.name}, Build feature is yours.`)).toBe(true);
    expect(h.llm.calls).toHaveLength(7);
  });

  test("a failed review holds a sync (reviewer, owner, lead) on the notes before the fix", async () => {
    const h = await harness({ script: crewScript() });
    const run = await h.svc.create({ projectId: "p1", goal: "Ship the feature" });
    await h.untilStatus(run.id, "done");
    const ev = h.events.events;
    const snap = await h.svc.snapshot(run.id);
    const sync = h.events.ofType("meeting.started").find((e) => e.data.kind === "sync")!;
    const reviewer = snap.agents.find((a) => a.role === "reviewer")!;
    const engineer = snap.agents.find((a) => a.role === "engineer")!;
    const lead = snap.agents.find((a) => a.role === "lead")!;
    expect(sync.agentId).toBe(reviewer.id);
    expect(sync.data.title).toBe("Sync on Build feature");
    expect(sync.data.agenda).toEqual(["Missing tests", "No error state"]);
    expect([...sync.data.agentIds].sort()).toEqual([reviewer.id, engineer.id, lead.id].sort());
    const end = h.events.ofType("meeting.ended").find((e) => e.data.meetingId === sync.data.meetingId)!;
    expect(end.data.notes).toEqual([`${reviewer.name}: Missing tests`, `${reviewer.name}: No error state`]);
    expect(end.data.decisions).toEqual([`${engineer.name} fixes Build feature (round 2)`]);
    const fixCreated = at(ev, (e) => e.type === "task.created" && (e as Ev<"task.created">).data.task.title === "Fix: Build feature");
    expect(fixCreated).toBeGreaterThan(at(ev, (e) => e === end));
    expect(byTitle(snap.tasks, "Fix: Build feature").assigneeId).toBe(engineer.id);
    // the CEO signs off the passed review and the plain delivery
    expect(h.events.ofType("agent.say").some((e) => e.agentId === lead.id && e.data.to === engineer.id && e.data.text === `Approved: Build feature. Nice work, ${engineer.name}.`)).toBe(true);
    expect(h.events.ofType("agent.say").some((e) => e.agentId === lead.id && e.data.text.startsWith("Signed off: Test feature."))).toBe(true);
  });

  test("wrap-up before the final report: everyone, one note per finished task", async () => {
    const h = await harness({ script: crewScript() });
    const run = await h.svc.create({ projectId: "p1", goal: "Ship the feature" });
    await h.untilStatus(run.id, "done");
    const ev = h.events.events;
    const snap = await h.svc.snapshot(run.id);
    const wrap = h.events.ofType("meeting.started").find((e) => e.data.kind === "wrapup")!;
    expect(wrap.data.agentIds).toHaveLength(snap.agents.length);
    const end = h.events.ofType("meeting.ended").find((e) => e.data.meetingId === wrap.data.meetingId)!;
    const engineer = snap.agents.find((a) => a.role === "engineer")!;
    const qa = snap.agents.find((a) => a.role === "qa")!;
    expect(end.data.notes).toEqual([`Build feature: done by ${engineer.name}`, `Test feature: done by ${qa.name}`]);
    expect(end.data.decisions).toEqual(["Kopi writes the report to the owner"]);
    const report = at(ev, (e) => e.type === "task.created" && (e as Ev<"task.created">).data.task.title === "Report to the owner");
    expect(report).toBeGreaterThan(at(ev, (e) => e === end));
    // a cat with nothing queued took a coffee break before the wrap-up
    expect(h.events.ofType("agent.status").some((e) => e.agentId === qa.id && e.data.activity === "rest" && e.data.statusText === VOICE.coffee)).toBe(true);
  });

  test("a trivial goal (no crew) holds no meetings", async () => {
    const h = await harness({ script: { lead: [finish("did it myself")] } });
    const run = await h.svc.create({ projectId: "p1", goal: "Say hi" });
    await h.untilStatus(run.id, "done");
    expect(h.events.ofType("meeting.started")).toHaveLength(0);
    expect((await h.svc.snapshot(run.id)).meetings).toEqual([]);
  });

  test("the snapshot shows a running meeting, then every meeting after the run ends", async () => {
    const h = await harness({ script: crewScript(), meetingMs: [150, 150] });
    const run = await h.svc.create({ projectId: "p1", goal: "Ship the feature" });
    await h.until(async () => ((await h.svc.snapshot(run.id)).meetings ?? []).some((m) => m.kind === "kickoff" && m.endedAt === null), "kickoff running");
    const live = (await h.svc.snapshot(run.id)).meetings!;
    expect(live).toHaveLength(1);
    expect(live[0]!.agenda).toEqual(["Build feature", "Test feature"]);
    expect(live[0]!.notes).toEqual([]);
    await h.untilStatus(run.id, "done");
    const done = (await h.svc.snapshot(run.id)).meetings!;
    expect(done.map((m) => m.kind)).toEqual(["kickoff", "sync", "wrapup"]);
    expect(done.every((m) => m.endedAt !== null && m.notes.length > 0)).toBe(true);
    expect(done[0]!.id).toBe(h.events.ofType("meeting.started")[0]!.data.meetingId);
  });

  test("after a restart the snapshot rebuilds meetings from the event log", async () => {
    const first = await harness({ script: crewScript() });
    const run = await first.svc.create({ projectId: "p1", goal: "Ship the feature" });
    await first.untilStatus(run.id, "done");
    const log = first.events.events;
    await first.mod.close?.();
    const second = await harness({
      db: first.db,
      script: {},
      eventLog: { after: async (seq, runId, limit) => log.filter((e) => e.seq > seq && e.runId === runId).slice(0, limit) },
    });
    const meetings = (await second.svc.snapshot(run.id)).meetings!;
    expect(meetings.map((m) => m.kind)).toEqual(["kickoff", "sync", "wrapup"]);
    expect(meetings[2]!.notes).toHaveLength(2);
    // without a reader the snapshot of a run from an earlier process has no meetings (SSE replays them)
    const third = await harness({ db: first.db, script: {} });
    expect((await third.svc.snapshot(run.id)).meetings).toEqual([]);
  });

  test("a stop during a meeting still closes the room", async () => {
    const h = await harness({ script: crewScript(), meetingMs: [5000, 5000] });
    const run = await h.svc.create({ projectId: "p1", goal: "Ship the feature" });
    await h.until(() => h.events.ofType("meeting.started").length === 1, "kickoff");
    await h.svc.stop(run.id);
    const ended = h.events.ofType("meeting.ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]!.data.decisions).toEqual(["Cut short"]);
    expect((await h.svc.snapshot(run.id)).run.status).toBe("stopped");
  });
});

describe("company: the lead is the CEO", () => {
  const askScript = (question: string): HarnessOptions["script"] => ({
    lead: [plan([{ key: "copy", title: "Draft copy", spec: "Write it", role: "designer" }]), finish("Final: copy drafted")],
    designer: [{ calls: [{ name: "ask_human", args: { question } }] }, finish("copy.md written")],
  });

  test("a crew question goes to the lead, who approves it with one capped fast call", async () => {
    const h = await harness({ script: askScript("Can I lead with the tagline Slow coffee?"), ceo: () => ({ text: '{"decision":"approve","answer":"Yes, lead with it."}' }) });
    const run = await h.svc.create({ projectId: "p1", goal: "Write the copy" });
    await h.untilStatus(run.id, "done");
    const snap = await h.svc.snapshot(run.id);
    const lead = snap.agents.find((a) => a.role === "lead")!;
    const designer = snap.agents.find((a) => a.role === "designer")!;
    const raised = h.events.ofType("request.raised");
    expect(raised).toHaveLength(1);
    expect(raised[0]!.data).toMatchObject({ fromAgentId: designer.id, toAgentId: lead.id, question: "Can I lead with the tagline Slow coffee?", toOwner: false });
    const decided = h.events.ofType("request.decided");
    expect(decided).toHaveLength(1);
    expect(decided[0]!.data).toEqual({ requestId: raised[0]!.data.requestId, byAgentId: lead.id, byOwner: false, answer: "Yes, lead with it.", approved: true });
    // one fast-tier call, capped at 120 output tokens, JSON only
    expect(h.llm.ceoCalls).toHaveLength(1);
    expect(h.llm.ceoCalls[0]!.maxOutputTokens).toBe(120);
    expect(h.llm.ceoCalls[0]!.responseFormat).toBe("json");
    expect(h.llm.resolved.some((r) => r.tier === "fast" && r.role === "lead")).toBe(true);
    // the answer reaches the asking cat; the owner is never asked
    const second = h.context.builds.filter((b) => b.role === "designer")[1]!;
    expect(second.steps[0]!.results[0]!.output).toBe(`${lead.name} (the lead) approved: Yes, lead with it.`);
    expect(h.events.ofType("agent.say").some((e) => e.data.to === "human")).toBe(false);
    expect(h.events.ofType("agent.status").some((e) => e.data.status === "approval")).toBe(false);
    expect(h.events.ofType("agent.status").some((e) => e.agentId === designer.id && e.data.activity === "ask" && e.data.statusText === `Asking ${lead.name}: Can I lead with the tagline Slow coffee?`)).toBe(true);
    expect(h.events.ofType("agent.say").some((e) => e.agentId === lead.id && e.data.to === designer.id && e.data.text === "Yes, lead with it.")).toBe(true);
    // the CEO call is metered on the lead
    expect(h.usage.calls.filter((c) => c.agentId === lead.id)).toHaveLength(3);
  });

  test("the CEO can decline", async () => {
    const h = await harness({ script: askScript("Can I add a second page?"), ceo: () => ({ text: '{"decision":"deny","answer":"No. One page is the goal."}' }) });
    const run = await h.svc.create({ projectId: "p1", goal: "Write the copy" });
    await h.untilStatus(run.id, "done");
    expect(h.events.ofType("request.decided")[0]!.data).toMatchObject({ approved: false, answer: "No. One page is the goal.", byOwner: false });
    const out = h.context.builds.filter((b) => b.role === "designer")[1]!.steps[0]!.results[0]!.output;
    expect(out).toBe("Kopi (the lead) declined: No. One page is the goal.");
  });

  test("the CEO escalates to the owner; the answer closes both requests and reaches the asking cat", async () => {
    const h = await harness({ script: askScript("Which of your two brand colors is primary?"), ceo: () => ({ text: '{"decision":"owner","answer":""}' }) });
    const run = await h.svc.create({ projectId: "p1", goal: "Write the copy" });
    await h.until(() => h.events.ofType("request.raised").length === 2, "escalated");
    const snap = await h.svc.snapshot(run.id);
    const lead = snap.agents.find((a) => a.role === "lead")!;
    const designer = snap.agents.find((a) => a.role === "designer")!;
    const [toLead, toOwner] = h.events.ofType("request.raised");
    expect(toLead!.data.toOwner).toBe(false);
    expect(toOwner!.data).toMatchObject({ fromAgentId: lead.id, toAgentId: null, toOwner: true, question: `${designer.name} asks: Which of your two brand colors is primary?` });
    await h.until(() => h.events.ofType("agent.status").some((e) => e.agentId === designer.id && e.data.status === "approval"), "waiting on the owner");
    expect(h.events.ofType("agent.say").find((e) => e.data.to === "human")!.agentId).toBe(lead.id);
    await h.svc.message(run.id, { text: "Teal is primary" });
    await h.untilStatus(run.id, "done");
    const decided = h.events.ofType("request.decided");
    expect(decided.map((e) => e.data.requestId)).toEqual([toOwner!.data.requestId, toLead!.data.requestId]);
    expect(decided[0]!.data).toMatchObject({ byOwner: true, byAgentId: null, answer: "Teal is primary" });
    expect(decided[1]!.data).toMatchObject({ byOwner: false, byAgentId: lead.id, answer: "The owner says: Teal is primary" });
    expect(h.context.builds.filter((b) => b.role === "designer")[1]!.steps[0]!.results[0]!.output).toBe("The human replied: Teal is primary");
  });

  test("owner-only questions skip the CEO call; a failed CEO call falls back to the owner", async () => {
    const h = await harness({ script: askScript("Can I use the owner's API key for the map embed?") });
    const run = await h.svc.create({ projectId: "p1", goal: "Write the copy" });
    await h.until(() => h.events.ofType("request.raised").some((e) => e.data.toOwner), "to the owner");
    expect(h.llm.ceoCalls).toHaveLength(0);
    await h.svc.message(run.id, { text: "No key, skip the map" });
    await h.untilStatus(run.id, "done");

    const f = await harness({ script: askScript("Is teal fine?"), ceo: () => ({ error: new Error("provider down") }) });
    const r2 = await f.svc.create({ projectId: "p1", goal: "Write the copy" });
    await f.until(() => f.events.ofType("request.raised").some((e) => e.data.toOwner), "fallback to the owner");
    expect(f.llm.ceoCalls).toHaveLength(1);
    await f.svc.message(r2.id, { text: "Teal is fine" });
    await f.untilStatus(r2.id, "done");
  });

  test("the lead's own question goes straight to the owner", async () => {
    const h = await harness({ script: { lead: [{ calls: [{ name: "ask_human", args: { question: "Which color?" } }] }, finish("Using blue")] } });
    const run = await h.svc.create({ projectId: "p1", goal: "Ask the human" });
    await h.until(() => h.events.ofType("request.raised").length === 1, "raised");
    const lead = (await h.svc.snapshot(run.id)).agents[0]!;
    expect(h.events.ofType("request.raised")[0]!.data).toMatchObject({ fromAgentId: lead.id, toAgentId: null, toOwner: true, question: "Which color?" });
    await h.svc.message(run.id, { text: "Blue please" });
    await h.untilStatus(run.id, "done");
    expect(h.events.ofType("request.decided")[0]!.data).toMatchObject({ byOwner: true, answer: "Blue please", approved: true });
    expect(h.llm.ceoCalls).toHaveLength(0);
  });

  test("CEO_SYSTEM asks for JSON only", () => {
    expect(CEO_SYSTEM).toContain('{"decision":"approve"|"deny"|"owner"');
  });
});
