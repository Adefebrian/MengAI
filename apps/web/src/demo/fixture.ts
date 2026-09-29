// The bundled demo run: a scripted event log in the exact wire shape of
// /api/events, for /app/runs/demo?demo=1, the ui_audit pass and the
// landing replay. Six cats, two handoffs to the reviewer, one review round
// that fails and is fixed, one approval, a security scan and a lesson.
// It is a sample, scripted for the page, never a recording: every surface
// that shows it says so (DEMO_LABEL).
//
// Deterministic: fixed clock, fixed ids, token counts from a seeded
// generator, so the same build always plays the same run.
import type {
  Activity,
  AgentDTO,
  AgentRole,
  AgentStatus,
  ApprovalDTO,
  DecisionDTO,
  EventMap,
  EventType,
  FileContent,
  FileNodeDTO,
  LlmCallDTO,
  MeetingKind,
  MengaiEvent,
  Mood,
  ProjectDTO,
  RunDTO,
  TaskDTO,
  TaskStatus,
  Tier,
  UsageTotals,
} from "@mengai/shared";
import { TOOL_ACTIVITY, type ToolName } from "@mengai/shared";

export const DEMO_RUN_ID = "demo";
export const DEMO_PROJECT_ID = "demo-project";
export const DEMO_LABEL = "Sample run, scripted for this page";
/** 2026-09-29 09:00:00 UTC */
export const DEMO_T0 = Date.UTC(2026, 8, 29, 9, 0, 0);
export const DEMO_BUDGET_TOKENS = 400_000;
export const DEMO_BUDGET_USD = 5;

export const DEMO_PROJECT: ProjectDTO = {
  id: DEMO_PROJECT_ID,
  name: "warung-kas",
  workspacePath: "/Users/you/code/warung-kas",
  createdAt: DEMO_T0 - 6 * 86_400_000,
  updatedAt: DEMO_T0,
  lastRunId: DEMO_RUN_ID,
};

const zeroUsage = (): UsageTotals => ({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0, calls: 0 });

const MODEL_BY_TIER: Record<Tier, string> = { fast: "gpt-4o-mini", balanced: "gpt-4o-mini", deep: "gpt-4.1" };
const PRICE: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, cached: 0.075, output: 0.6 },
  "gpt-4.1": { input: 2, cached: 0.5, output: 8 },
};

interface CatSpec {
  id: string;
  name: string;
  role: AgentRole;
  coat: string;
  seed: number;
  tier: Tier;
}

export const DEMO_CATS: CatSpec[] = [
  { id: "agent-kopi", name: "Kopi", role: "lead", coat: "ginger", seed: 1204, tier: "deep" },
  { id: "agent-mochi", name: "Mochi", role: "engineer", coat: "tuxedo", seed: 88213, tier: "balanced" },
  { id: "agent-klepon", name: "Klepon", role: "designer", coat: "calico", seed: 5530, tier: "balanced" },
  { id: "agent-tempe", name: "Tempe", role: "reviewer", coat: "gray", seed: 71002, tier: "balanced" },
  { id: "agent-onde", name: "Onde", role: "qa", coat: "black", seed: 3319, tier: "fast" },
  { id: "agent-cilok", name: "Cilok", role: "security", coat: "siamese", seed: 90417, tier: "fast" },
];

const GOAL = "Add a CSV export to the daily sales report, with tests";

/** mulberry32, the same seeded generator the cats use. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Script {
  events: MengaiEvent[] = [];
  calls: LlmCallDTO[] = [];
  seq = 0;
  t = DEMO_T0;
  totals = zeroUsage();
  agents = new Map<string, AgentDTO>();
  tasks = new Map<string, TaskDTO>();
  rand = rng(20260929);
  callN = 0;
  /** every version the crew wrote, per path, oldest first: the demo editor shows the one at the player's clock */
  versions = new Map<string, Array<{ ts: number; content: string | null; by: string; deleted: boolean }>>();

  wait(ms: number) {
    this.t += ms;
    return this;
  }

  emit<T extends EventType>(type: T, data: EventMap[T], agentId: string | null = null, taskId: string | null = null) {
    this.seq += 1;
    this.events.push({ seq: this.seq, ts: this.t, type, runId: DEMO_RUN_ID, agentId, taskId, data } as MengaiEvent);
    return this;
  }

  run(status: RunDTO["status"]): RunDTO {
    return {
      id: DEMO_RUN_ID,
      projectId: DEMO_PROJECT_ID,
      goal: GOAL,
      status,
      statusReason: null,
      budgetTokens: DEMO_BUDGET_TOKENS,
      budgetUsd: DEMO_BUDGET_USD,
      usage: { ...this.totals },
      progress: this.progress(),
      startedAt: null,
      endedAt: null,
      createdAt: DEMO_T0,
    };
  }

  progress(): number {
    const live = [...this.tasks.values()].filter((t) => t.status !== "cancelled");
    if (live.length === 0) return 0;
    return live.filter((t) => t.status === "done").length / live.length;
  }

  spawn(cat: CatSpec) {
    const agent: AgentDTO = {
      id: cat.id,
      runId: DEMO_RUN_ID,
      parentId: cat.role === "lead" ? null : "agent-kopi",
      role: cat.role,
      name: cat.name,
      look: { coat: cat.coat, seed: cat.seed },
      tier: cat.tier,
      status: "idle",
      activity: "rest",
      mood: "calm",
      statusText: null,
      currentTaskId: null,
      steps: 0,
      usage: zeroUsage(),
      createdAt: this.t,
      updatedAt: this.t,
    };
    this.agents.set(cat.id, agent);
    return this.emit("agent.spawned", { agent }, cat.id);
  }

  status(agentId: string, status: AgentStatus, activity: Activity, statusText: string | null, taskId: string | null, mood: Mood = "focused") {
    return this.emit("agent.status", { status, activity, mood, statusText, taskId }, agentId, taskId);
  }

  task(id: string, partial: Partial<TaskDTO> & { title: string; role: AgentRole }) {
    const task: TaskDTO = {
      id,
      runId: DEMO_RUN_ID,
      parentId: null,
      spec: "",
      acceptance: [],
      assigneeId: null,
      status: "queued",
      priority: 1,
      deps: [],
      review: false,
      attempts: 0,
      resultSummary: null,
      createdBy: "agent-kopi",
      createdAt: this.t,
      updatedAt: this.t,
      startedAt: null,
      endedAt: null,
      ...partial,
    };
    this.tasks.set(id, task);
    return this.emit("task.created", { task }, "agent-kopi", id);
  }

  update(id: string, patch: Partial<TaskDTO> & { status?: TaskStatus }) {
    const prev = this.tasks.get(id);
    if (!prev) throw new Error(`unknown task ${id}`);
    const next: TaskDTO = { ...prev, ...patch, updatedAt: this.t };
    if (patch.status === "running" && !prev.startedAt) next.startedAt = this.t;
    if (patch.status === "done" || patch.status === "failed") next.endedAt = this.t;
    this.tasks.set(id, next);
    return this.emit("task.updated", { task: next }, next.assigneeId, id);
  }

  /** One agent step: the LLM call that chose the tool, then the tool call and its result. */
  tool(agentId: string, tool: ToolName, argsPreview: string, summary: string, opts: { taskId?: string | null; ms?: number; ok?: boolean; input?: number } = {}) {
    const agent = this.agents.get(agentId)!;
    const model = MODEL_BY_TIER[agent.tier];
    const input = opts.input ?? Math.round(2600 + this.rand() * 3400);
    // Stable prefixes cache well after each agent's first call.
    const cachedShare = agent.steps === 0 ? 0 : 0.55 + this.rand() * 0.25;
    const cached = Math.round(input * cachedShare);
    const output = Math.round(120 + this.rand() * 420);
    const p = PRICE[model]!;
    const cost = ((input - cached) * p.input + cached * p.cached + output * p.output) / 1_000_000;
    this.callN += 1;
    const callId = `call-${String(this.callN).padStart(3, "0")}`;
    this.calls.push({
      id: callId,
      runId: DEMO_RUN_ID,
      agentId,
      taskId: opts.taskId ?? null,
      providerId: model.startsWith("gpt") ? "prov-openai" : "prov-anthropic",
      model,
      purpose: tool === "create_tasks" ? "plan" : tool === "submit_review" ? "review" : "step",
      inputTokens: input,
      outputTokens: output,
      cachedTokens: cached,
      cacheWriteTokens: 0,
      costUsd: cost,
      latencyMs: Math.round(700 + this.rand() * 1600),
      retries: 0,
      ok: true,
      error: null,
      createdAt: this.t,
    });
    agent.steps += 1;
    agent.usage = {
      inputTokens: agent.usage.inputTokens + input,
      outputTokens: agent.usage.outputTokens + output,
      cachedTokens: agent.usage.cachedTokens + cached,
      cacheWriteTokens: 0,
      costUsd: agent.usage.costUsd + cost,
      calls: agent.usage.calls + 1,
    };
    this.totals = {
      inputTokens: this.totals.inputTokens + input,
      outputTokens: this.totals.outputTokens + output,
      cachedTokens: this.totals.cachedTokens + cached,
      cacheWriteTokens: 0,
      costUsd: this.totals.costUsd + cost,
      calls: this.totals.calls + 1,
    };
    const activity = TOOL_ACTIVITY[tool];
    this.emit("tool.call", { callId, tool, activity, argsPreview }, agentId, opts.taskId ?? null);
    this.wait(opts.ms ?? 1400);
    this.emit("tool.result", { callId, tool, ok: opts.ok ?? true, summary, durationMs: opts.ms ?? 1400 }, agentId, opts.taskId ?? null);
    this.emit("run.usage", { usage: { ...this.totals }, budgetTokens: DEMO_BUDGET_TOKENS, budgetUsd: DEMO_BUDGET_USD, progress: this.progress() });
    return this;
  }

  say(agentId: string, text: string, to: string | null = null) {
    return this.emit("agent.say", { text, to }, agentId);
  }

  decision(decisionId: string, answers: Record<string, unknown>, action: string, confidence: number | null, verified = true, latencyMs = 640) {
    const decision: DecisionDTO = {
      id: `dec-${this.events.length + 1}`,
      runId: DEMO_RUN_ID,
      decisionId,
      answers,
      action,
      confidence,
      verified,
      stamp: verified ? null : "UNVERIFIED BY JEV",
      latencyMs,
      createdAt: this.t,
    };
    return this.emit("decision", { decision });
  }

  handoff(id: string, taskId: string, from: string, to: string, toRole: AgentRole, summary: string) {
    return this.emit("handoff", { handoff: { id, runId: DEMO_RUN_ID, taskId, fromAgentId: from, toAgentId: to, toRole, summary, createdAt: this.t } }, from, taskId);
  }

  /** A file the crew wrote. `content` is the new text (null for a binary or a delete). */
  file(path: string, op: "create" | "update" | "delete", bytes: number, agentId: string, content: string | null = null) {
    const list = this.versions.get(path) ?? [];
    list.push({ ts: this.t, content: op === "delete" ? null : content, by: agentId, deleted: op === "delete" });
    this.versions.set(path, list);
    return this.emit("file.changed", { path, op, bytes: content !== null ? content.length : bytes }, agentId);
  }

  meeting(id: string, kind: MeetingKind, title: string, agentIds: string[], agenda: string[]) {
    return this.emit("meeting.started", { meetingId: id, kind, title, agentIds, agenda }, agentIds[0] ?? null);
  }

  endMeeting(id: string, kind: MeetingKind, notes: string[], decisions: string[], by: string) {
    return this.emit("meeting.ended", { meetingId: id, kind, notes, decisions }, by);
  }

  ask(id: string, from: string, to: string | null, question: string, taskId: string | null, toOwner = false) {
    return this.emit("request.raised", { requestId: id, fromAgentId: from, toAgentId: to, question, toOwner }, from, taskId);
  }

  decide(id: string, by: string, answer: string, approved: boolean, taskId: string | null) {
    return this.emit("request.decided", { requestId: id, byAgentId: by, byOwner: false, answer, approved }, by, taskId);
  }
}

// ------------------------------------------------------------ file contents
// What the crew writes, version by version, so the demo editor shows the
// code change while you watch: csv.ts is written, reviewed, sent back and
// fixed; the tests grow; the page gets its Export button.

const DAILY_TS = `export interface DailySalesRow {
  time: string;
  item: string;
  qty: number;
  unitCents: number;
  totalCents: number;
  cashier: string;
}

/** Sum of the day in cents. */
export function dayTotal(rows: DailySalesRow[]): number {
  return rows.reduce((sum, r) => sum + r.totalCents, 0);
}
`;

const CSV_TS_V1 = `// RFC 4180 CSV for the daily sales report. Money stays in cents in the
// data and is formatted only here, at the edge.
import type { DailySalesRow } from "./daily";

const HEADER = ["time", "item", "qty", "unit_price", "total", "cashier"];

/** Quote a field that holds a comma. */
export function quoteField(value: string): string {
  if (!value.includes(",")) return value;
  return \`"\${value}"\`;
}

function rupiah(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function toCsv(rows: DailySalesRow[]): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [r.time, r.item, String(r.qty), rupiah(r.unitCents), rupiah(r.totalCents), r.cashier]
        .map(quoteField)
        .join(","),
    );
  }
  return lines.join("\\r\\n") + "\\r\\n";
}
`;

const CSV_TS = `// RFC 4180 CSV for the daily sales report. Money stays in cents in the
// data and is formatted only here, at the edge.
import type { DailySalesRow } from "./daily";

const HEADER = ["time", "item", "qty", "unit_price", "total", "cashier"];

/** Quote a field that holds a comma, a quote, CR or LF; double inner quotes. */
export function quoteField(value: string): string {
  if (!/[",\\r\\n]/.test(value)) return value;
  return \`"\${value.replaceAll('"', '""')}"\`;
}

function rupiah(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function toCsv(rows: DailySalesRow[]): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [r.time, r.item, String(r.qty), rupiah(r.unitCents), rupiah(r.totalCents), r.cashier]
        .map(quoteField)
        .join(","),
    );
  }
  return lines.join("\\r\\n") + "\\r\\n";
}
`;

const CSV_TEST_V1 = `import { describe, expect, test } from "bun:test";
import { quoteField, toCsv } from "./csv";

const ROW = { time: "09:12", item: "Kopi susu", qty: 2, unitCents: 1800, totalCents: 3600, cashier: "Sari" };

describe("toCsv", () => {
  test("empty day is a header row only", () => {
    expect(toCsv([])).toBe("time,item,qty,unit_price,total,cashier\\r\\n");
  });

  test("writes one line per row", () => {
    expect(toCsv([ROW, ROW, ROW]).split("\\r\\n").length).toBe(5);
  });

  test("formats cents at the edge", () => {
    expect(toCsv([ROW])).toContain("18.00,36.00");
  });

  test("quotes a comma", () => {
    expect(quoteField("Teh, manis")).toBe('"Teh, manis"');
  });
});
`;

const CSV_TEST = `import { describe, expect, test } from "bun:test";
import { quoteField, toCsv } from "./csv";

const ROW = { time: "09:12", item: "Kopi susu", qty: 2, unitCents: 1800, totalCents: 3600, cashier: "Sari" };

describe("toCsv", () => {
  test("empty day is a header row only", () => {
    expect(toCsv([])).toBe("time,item,qty,unit_price,total,cashier\\r\\n");
  });

  test("writes one line per row", () => {
    expect(toCsv([ROW, ROW, ROW]).split("\\r\\n").length).toBe(5);
  });

  test("formats cents at the edge", () => {
    expect(toCsv([ROW])).toContain("18.00,36.00");
  });

  test("quotes a comma", () => {
    expect(quoteField("Teh, manis")).toBe('"Teh, manis"');
  });

  test('doubles quotes in Kopi "Tubruk"', () => {
    expect(quoteField('Kopi "Tubruk"')).toBe('"Kopi ""Tubruk"""');
  });

  test("quotes a newline in a note", () => {
    expect(quoteField("no sugar\\nextra ice")).toBe('"no sugar\\nextra ice"');
  });
});
`;

const REPORT_TSX_V0 = `import type { DailySalesRow } from "../report/daily";
import { dayTotal } from "../report/daily";

export function ReportToolbar({ day, rows }: { day: Date; rows: DailySalesRow[] }) {
  return (
    <div className="toolbar">
      <h1>Sales for {day.toDateString()}</h1>
      <span>{rows.length} sales, {(dayTotal(rows) / 100).toFixed(2)} total</span>
    </div>
  );
}
`;

const REPORT_TSX = `import { format } from "date-fns";
import type { DailySalesRow } from "../report/daily";
import { dayTotal } from "../report/daily";
import { toCsv } from "../report/csv";

export function exportDay(day: Date, rows: DailySalesRow[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = \`sales-\${format(day, "yyyy-MM-dd")}.csv\`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ReportToolbar({ day, rows }: { day: Date; rows: DailySalesRow[] }) {
  const empty = rows.length === 0;
  return (
    <div className="toolbar">
      <h1>Sales for {day.toDateString()}</h1>
      <span>{rows.length} sales, {(dayTotal(rows) / 100).toFixed(2)} total</span>
      <button type="button" className="secondary" disabled={empty} onClick={() => exportDay(day, rows)}>
        Export CSV
      </button>
      {empty ? <p className="hint">No sales on this day, so there is nothing to export.</p> : null}
    </div>
  );
}
`;

const PACKAGE_JSON_V0 = `{
  "name": "warung-kas",
  "private": true,
  "dependencies": {
    "react": "19.3.0"
  }
}
`;

const PACKAGE_JSON = `{
  "name": "warung-kas",
  "private": true,
  "dependencies": {
    "date-fns": "4.1.0",
    "react": "19.3.0"
  }
}
`;

const BUTTON_MD = `# Export button

One secondary button in the report toolbar.

## States

- Default: Export CSV
- Hover and pressed: the state layer only
- Focus: the 2px ink outline
- Disabled: a day with no sales, with the reason beside it
- Busy: while the file is written
- Done: the download itself, no toast

File name: \`sales-YYYY-MM-DD.csv\`, the report date.
`;

const FIXTURE_EMPTY = `[]
`;

const FIXTURE_NORMAL = `[
  { "time": "08:05", "item": "Kopi tubruk", "qty": 1, "unitCents": 1500, "totalCents": 1500, "cashier": "Sari" },
  { "time": "08:40", "item": "Teh manis", "qty": 2, "unitCents": 800, "totalCents": 1600, "cashier": "Sari" },
  { "time": "12:15", "item": "Nasi goreng", "qty": 1, "unitCents": 2800, "totalCents": 2800, "cashier": "Budi" }
]
`;

const FIXTURE_QUOTED = `[
  { "time": "09:30", "item": "Kopi \\"Tubruk\\"", "qty": 1, "unitCents": 1500, "totalCents": 1500, "cashier": "Sari" },
  { "time": "10:02", "item": "Teh, manis", "qty": 3, "unitCents": 800, "totalCents": 2400, "cashier": "Budi" },
  { "time": "10:45", "item": "Roti bakar", "qty": 1, "unitCents": 2000, "totalCents": 2000, "cashier": "Budi\\nshift 2" }
]
`;

/** Files the workspace held before the run started. */
const BASE_FILES: Record<string, string | null> = {
  "src/report/daily.ts": DAILY_TS,
  "src/pages/report.tsx": REPORT_TSX_V0,
  "package.json": PACKAGE_JSON_V0,
  "bun.lock": null,
  "README.md": "# warung-kas\n\nThe till and the daily sales report for a small warung.\n",
};

export const DEMO_APPROVAL_ID = "appr-install-date-fns";

function build(): { events: MengaiEvent[]; calls: LlmCallDTO[]; approval: ApprovalDTO; versions: Script["versions"] } {
  const s = new Script();
  const [kopi, mochi, klepon, tempe, onde, cilok] = DEMO_CATS.map((c) => c.id) as [string, string, string, string, string, string];

  s.emit("run.created", { run: s.run("queued") });
  s.wait(400).emit("run.status", { status: "running", reason: null });
  s.spawn(DEMO_CATS[0]!);
  s.wait(300).status(kopi, "thinking", "think", "Reading the goal", null, "calm");
  s.wait(900).tool(kopi, "fs_list", "src/report", "7 files, 2 folders");
  s.tool(kopi, "fs_read", "src/report/daily.ts lines 1 to 80", "DailySalesRow has 6 fields, totals in cents");
  s.status(kopi, "working", "plan", "Planning 5 tasks", null);
  s.tool(kopi, "create_tasks", "5 tasks for the CSV export", "5 tasks created", { ms: 2200, input: 6200 });
  s.task("t-csv", {
    title: "Add a CSV serializer for daily sales rows",
    role: "engineer",
    spec: "Serialize DailySalesRow[] to RFC 4180 CSV with a header row. Money stays in cents in the data and is formatted at the edge.",
    acceptance: ["Header row matches the report columns", "Fields with commas, quotes or newlines are quoted", "Unit tests cover empty and 3-row inputs"],
    review: true,
    priority: 3,
  });
  s.task("t-button", {
    title: "Design the Export button and its empty state",
    role: "designer",
    spec: "One secondary button in the report toolbar, a disabled state when the day has no sales, and the file name pattern.",
    acceptance: ["Button in 8 states", "Empty day explains why export is off"],
    priority: 2,
  });
  s.task("t-wire", {
    title: "Wire Export to the report page",
    role: "engineer",
    spec: "Call the serializer, name the file sales-YYYY-MM-DD.csv and trigger a download.",
    acceptance: ["Download works in Safari and Chrome", "File name uses the report date"],
    deps: ["t-csv", "t-button"],
    priority: 2,
  });
  s.task("t-test", {
    title: "Test the export against 3 fixture days",
    role: "qa",
    spec: "An empty day, a normal day and a day with commas and quotes in item names.",
    acceptance: ["3 fixtures", "bun test green"],
    deps: ["t-csv"],
    priority: 1,
  });
  s.task("t-scan", {
    title: "Scan the change for secrets and unsafe dependencies",
    role: "security",
    spec: "Secret scan on the diff, dependency audit on bun.lock.",
    acceptance: ["No secrets", "No high or critical advisories"],
    deps: ["t-csv"],
    priority: 1,
  });
  s.decision("orch.route", { owner: "engineer", split: false }, "Route t-csv to an engineer, no split", 0.86);
  s.decision("orch.model", { tier: "balanced" }, "Balanced tier for the engineer tasks", 0.74);
  s.wait(600).spawn(DEMO_CATS[1]!);
  s.wait(200).spawn(DEMO_CATS[2]!);

  // Kickoff: Kopi walks the new hires through the plan at the meeting table.
  s.wait(300).meeting("m-kickoff", "kickoff", "Kickoff: CSV export", [kopi, mochi, klepon], [
    "Walk through the 5 tasks and their order",
    "Agree the CSV columns with the report",
    "Who reviews and who tests",
  ]);
  s.status(kopi, "working", "plan", "Running the kickoff", null, "calm");
  s.status(mochi, "thinking", "think", "In the kickoff", null, "calm");
  s.status(klepon, "thinking", "think", "In the kickoff", null, "calm");
  s.say(kopi, "Mochi takes the serializer, Klepon the button. Tempe reviews, Onde tests, Cilok scans.");
  s.wait(3200).endMeeting("m-kickoff", "kickoff", [
    "Columns follow the report: time, item, qty, unit price, total, cashier",
    "Money stays in cents in the data, formatted only in the file",
  ], [
    "Mochi owns the serializer, Klepon the Export button",
    "Tempe reviews the serializer before anything is wired",
  ], kopi);

  s.wait(300).handoff("h-1", "t-csv", kopi, mochi, "engineer", "Serializer only; keep cents as integers, format at the edge.");
  s.update("t-csv", { status: "running", assigneeId: mochi });
  s.status(mochi, "working", "read", "Reading the report types", "t-csv");
  s.update("t-button", { status: "running", assigneeId: klepon });
  s.status(klepon, "working", "design", "Sketching the Export button", "t-button");
  s.status(kopi, "waiting", "wait", "Watching 2 tasks", null, "calm");
  s.wait(500).tool(mochi, "fs_read", "src/report/daily.ts lines 1 to 120", "Types and the totals helper", { taskId: "t-csv" });
  s.say(mochi, "Rows carry cents as integers. I will format them only when writing the file.");
  s.tool(klepon, "generate_image", "Export button, 8 states, 1024x1024", "1 image, $0.04", { taskId: "t-button", ms: 3200 });
  s.ask("rq-empty-day", klepon, kopi, "On a day with no sales, should Export be hidden or shown disabled?", "t-button");
  s.status(klepon, "waiting", "ask", "Asking Kopi about the empty day", "t-button", "calm");
  s.status(mochi, "working", "code", "Writing csv.ts", "t-csv");
  s.tool(mochi, "fs_write", "src/report/csv.ts (31 lines)", "Created src/report/csv.ts", { taskId: "t-csv" });
  s.file("src/report/csv.ts", "create", 0, mochi, CSV_TS_V1);
  s.decide("rq-empty-day", kopi, "Shown and disabled, with the reason beside it. A hidden control makes people hunt for it.", true, "t-button");
  s.status(klepon, "working", "design", "Sketching the Export button", "t-button");
  s.tool(mochi, "fs_write", "src/report/csv.test.ts (24 lines)", "Created src/report/csv.test.ts", { taskId: "t-csv" });
  s.file("src/report/csv.test.ts", "create", 0, mochi, CSV_TEST_V1);
  s.status(mochi, "working", "run", "Running the report tests", "t-csv");
  s.tool(mochi, "shell_run", "bun test src/report", "4 pass, 0 fail", { taskId: "t-csv", ms: 2600 });
  s.file("assets/export-button.png", "create", 184_320, klepon);
  s.tool(klepon, "fs_write", "docs/export-button.md", "States and copy written", { taskId: "t-button" });
  s.file("docs/export-button.md", "create", 0, klepon, BUTTON_MD);
  s.update("t-button", { status: "done", resultSummary: "8 states, empty day copy, file name sales-YYYY-MM-DD.csv" });
  s.status(klepon, "done", "celebrate", "Export button designed", null, "proud");

  // Review round 1: fails on quoting.
  s.wait(400).spawn(DEMO_CATS[3]!);
  s.update("t-csv", { status: "review" });
  s.handoff("h-2", "t-csv", mochi, tempe, "reviewer", "csv.ts added, 4 tests pass. Check quoting of commas in item names.");
  s.status(mochi, "waiting", "handoff", "Waiting on review", "t-csv", "calm");
  // The engine opens a review task under the reviewed one; the reviewer works it.
  s.task("t-rev-1", {
    title: "Review: Add a CSV serializer for daily sales rows",
    role: "reviewer",
    parentId: "t-csv",
    spec: "Check the serializer against its acceptance checks and run the report tests.",
    acceptance: ["Header row matches the report columns", "Fields with commas, quotes or newlines are quoted"],
    createdBy: mochi,
    priority: 4,
  });
  s.update("t-rev-1", { status: "running", assigneeId: tempe });
  s.status(tempe, "working", "review", "Reviewing csv.ts", "t-rev-1");
  s.tool(tempe, "fs_read", "src/report/csv.ts lines 1 to 31", "Quote only wraps fields with commas", { taskId: "t-rev-1" });
  s.tool(tempe, "shell_run", "bun test src/report", "4 pass, 0 fail", { taskId: "t-rev-1", ms: 2400 });
  s.tool(tempe, "submit_review", "fail: 2 notes", "Review failed: quotes inside fields are not doubled; a newline breaks the row", { taskId: "t-rev-1", ok: true });
  s.update("t-rev-1", { status: "done", resultSummary: "fail: quotes inside fields are not doubled; a newline breaks the row" });
  s.say(tempe, "A name like Kopi \"Tubruk\" comes out as three columns. Double the quotes and quote newlines too.", mochi);
  s.decision("orch.loop_exit", { exit: "another_round", meets_ask: false }, "Second review round, fix task to Mochi", 0.71);
  // A failed review calls a short sync at the table before the fix.
  s.meeting("m-sync", "sync", "Sync: the review sent csv.ts back", [kopi, mochi, tempe], [
    "What round 1 found",
    "The fix, and who checks it",
  ]);
  s.status(kopi, "working", "plan", "Running the sync", null, "calm");
  s.wait(2600).endMeeting("m-sync", "sync", [
    "Embedded quotes are not doubled, and a newline splits a row",
  ], [
    "Mochi writes the failing tests first, then fixes quoteField",
    "Tempe reviews round 2 as soon as the tests pass",
  ], kopi);
  s.status(kopi, "waiting", "wait", "Watching the fix", null, "calm");
  s.task("t-fix", {
    title: "Fix quoting of quotes and newlines in CSV fields",
    role: "engineer",
    parentId: "t-csv",
    spec: "Double embedded quotes and quote any field with a quote, comma, CR or LF. Add a failing test first.",
    acceptance: ["Test for Kopi \"Tubruk\"", "Test for a newline in a note"],
    assigneeId: mochi,
    createdBy: tempe,
    attempts: 1,
    priority: 3,
  });
  s.update("t-fix", { status: "running", assigneeId: mochi });
  s.status(tempe, "waiting", "wait", "Waiting on the fix", "t-csv", "calm");
  s.status(mochi, "working", "code", "Fixing field quoting", "t-fix", "focused");
  s.tool(mochi, "fs_edit", "src/report/csv.test.ts +8 lines", "2 failing tests added", { taskId: "t-fix" });
  s.file("src/report/csv.test.ts", "update", 0, mochi, CSV_TEST);
  s.tool(mochi, "fs_edit", "src/report/csv.ts quoteField()", "Quotes doubled, CR and LF quoted", { taskId: "t-fix" });
  s.file("src/report/csv.ts", "update", 0, mochi, CSV_TS);
  s.status(mochi, "working", "run", "Running the report tests", "t-fix");
  s.tool(mochi, "shell_run", "bun test src/report", "6 pass, 0 fail", { taskId: "t-fix", ms: 2400 });
  s.update("t-fix", { status: "done", resultSummary: "Quotes doubled, CR and LF quoted, 2 tests added" });
  s.handoff("h-3", "t-csv", mochi, tempe, "reviewer", "Quoting fixed, 6 tests pass.");
  s.task("t-rev-2", {
    title: "Review: Add a CSV serializer for daily sales rows, round 2",
    role: "reviewer",
    parentId: "t-csv",
    spec: "Re-check quoting after the fix and run the report tests.",
    acceptance: ["Quotes doubled", "CR and LF quoted"],
    createdBy: mochi,
    priority: 4,
  });
  s.update("t-rev-2", { status: "running", assigneeId: tempe });
  s.status(tempe, "working", "review", "Second review of csv.ts", "t-rev-2");
  s.tool(tempe, "fs_read", "src/report/csv.ts lines 6 to 12", "quoteField handles all four cases", { taskId: "t-rev-2" });
  s.tool(tempe, "submit_review", "pass", "Review passed", { taskId: "t-rev-2" });
  s.update("t-rev-2", { status: "done", resultSummary: "pass: quoteField handles commas, quotes, CR and LF" });
  s.decision("orch.loop_exit", { exit: "exit_done", meets_ask: true }, "Review loop closed after round 2", 0.9);
  s.update("t-csv", { status: "done", attempts: 2, resultSummary: "RFC 4180 serializer, 6 tests, passed review in round 2" });
  s.status(tempe, "done", "celebrate", "Review passed", null, "proud");
  s.emit("lesson.recorded", {
    lesson: {
      id: "lesson-csv-quote",
      scope: "role",
      role: "engineer",
      projectId: DEMO_PROJECT_ID,
      text: "Quote CSV fields that contain a comma, a quote, CR or LF, and double embedded quotes.",
      tags: ["csv", "export"],
      status: "candidate",
      uses: 0,
      wins: 0,
      losses: 0,
      score: 0.5,
      createdAt: s.t,
      lastUsedAt: null,
    },
  }, tempe);

  // Wiring, tests and the scan run in parallel; one approval for an install.
  s.update("t-wire", { status: "running", assigneeId: mochi });
  s.status(mochi, "working", "code", "Wiring Export to the page", "t-wire");
  s.wait(300).spawn(DEMO_CATS[4]!);
  s.wait(150).spawn(DEMO_CATS[5]!);
  s.update("t-test", { status: "running", assigneeId: onde });
  s.update("t-scan", { status: "running", assigneeId: cilok });
  s.status(onde, "working", "code", "Writing 3 fixture days", "t-test");
  s.status(cilok, "working", "scan", "Scanning the diff", "t-scan");
  s.tool(mochi, "fs_edit", "src/pages/report.tsx +18 lines", "Export button added to the toolbar", { taskId: "t-wire" });
  s.file("src/pages/report.tsx", "update", 0, mochi, REPORT_TSX);
  s.tool(onde, "fs_write", "src/report/fixtures/*.json (3 files)", "3 fixtures created", { taskId: "t-test" });
  s.file("src/report/fixtures/empty-day.json", "create", 0, onde, FIXTURE_EMPTY);
  s.file("src/report/fixtures/normal-day.json", "create", 0, onde, FIXTURE_NORMAL);
  s.file("src/report/fixtures/quoted-names.json", "create", 0, onde, FIXTURE_QUOTED);
  s.tool(cilok, "scan_secrets", "diff of 6 files", "0 secrets found", { taskId: "t-scan" });
  s.ask("rq-install", mochi, kopi, "May I add date-fns 4.1.0 to format the export file name?", "t-wire");
  s.status(mochi, "waiting", "ask", "Asking Kopi about date-fns", "t-wire", "calm");
  s.wait(1200).decide("rq-install", kopi, "Yes, pin 4.1.0. The install itself still needs the owner's yes.", true, "t-wire");
  const approval: ApprovalDTO = {
    id: DEMO_APPROVAL_ID,
    runId: DEMO_RUN_ID,
    agentId: mochi,
    capability: "shell",
    risk: "destructive",
    title: "Install date-fns 4.1.0 with bun add",
    detail: { command: "bun add date-fns@4.1.0", cwd: "/Users/you/code/warung-kas", reason: "Format the export file name with the report date" },
    status: "pending",
    scope: "once",
    createdAt: s.t,
    decidedAt: null,
    expiresAt: s.t + 10 * 60_000,
  };
  s.status(mochi, "approval", "ask", "Needs you: install date-fns", "t-wire", "calm");
  s.emit("approval.requested", { approval }, mochi, "t-wire");
  s.status(onde, "working", "run", "Running bun test", "t-test");
  s.tool(onde, "shell_run", "bun test src/report", "6 pass, 0 fail", { taskId: "t-test", ms: 3400 });
  s.tool(cilok, "scan_deps", "bun.lock, 212 packages", "1 low advisory in a dev dependency", { taskId: "t-scan", ms: 2800 });
  s.emit("finding", {
    finding: {
      id: "finding-1",
      scanId: "scan-demo",
      kind: "deps",
      severity: "low",
      rule: "OSV GHSA-demo-0001",
      title: "Prototype pollution in a test-only helper",
      file: "bun.lock",
      line: null,
      detail: "dev dependency only, not shipped in the bundle",
      fix: "Upgrade when a patched version lands",
      status: "open",
    },
    severity: "low",
  }, cilok);
  s.decision("sec.severity", { severity: "low" }, "Low: dev dependency, not in the shipped bundle", null, false, 12);
  s.ask("rq-block", cilok, kopi, "Should the low advisory block the run?", "t-scan");
  s.status(cilok, "waiting", "ask", "Asking Kopi about the advisory", "t-scan", "calm");
  s.wait(1400).decide("rq-block", kopi, "No. It is a dev dependency and never ships. Log it and move on.", false, "t-scan");
  s.update("t-scan", { status: "done", resultSummary: "No secrets; 1 low advisory in a dev dependency" });
  s.status(cilok, "done", "celebrate", "Scan clean", null, "calm");
  s.wait(4000).emit("approval.resolved", { id: DEMO_APPROVAL_ID, status: "approved" });
  s.emit("automation.action", { capability: "shell", action: "run", target: "bun add date-fns@4.1.0", risk: "destructive", outcome: "ok" }, mochi);
  s.status(mochi, "working", "run", "Installing date-fns", "t-wire");
  s.tool(mochi, "shell_run", "bun add date-fns@4.1.0", "Installed date-fns 4.1.0", { taskId: "t-wire", ms: 3000 });
  s.file("package.json", "update", 0, mochi, PACKAGE_JSON);
  s.file("bun.lock", "update", 48_210, mochi);
  s.ask("rq-suite", onde, kopi, "Run the full suite now, or after Mochi's install lands?", "t-test");
  s.wait(900).decide("rq-suite", kopi, "After the install. One full run on the final lockfile.", true, "t-test");
  s.tool(mochi, "shell_run", "bun run typecheck", "0 errors", { taskId: "t-wire", ms: 2600 });
  s.update("t-wire", { status: "done", resultSummary: "Export downloads sales-YYYY-MM-DD.csv" });
  s.status(mochi, "done", "celebrate", "Export wired", null, "proud");
  s.status(onde, "working", "run", "Running the full suite", "t-test");
  s.tool(onde, "shell_run", "bun test", "31 pass, 0 fail", { taskId: "t-test", ms: 3400 });
  s.update("t-test", { status: "done", resultSummary: "3 fixtures, 31 tests pass" });
  s.status(onde, "done", "celebrate", "Tests pass", null, "proud");

  // Wrap-up at the table, then Kopi closes the run.
  s.meeting("m-wrapup", "wrapup", "Wrap-up: CSV export", [kopi, mochi, klepon, tempe, onde, cilok], [
    "What shipped",
    "What to watch",
  ]);
  s.status(kopi, "working", "plan", "Running the wrap-up", null, "calm");
  s.wait(3000).endMeeting("m-wrapup", "wrapup", [
    "Export downloads sales-YYYY-MM-DD.csv, 31 tests pass",
    "One review round was needed for quoting",
  ], [
    "Keep the quoting lesson for the engineer role",
    "Watch the low advisory in the dev dependency",
  ], kopi);
  s.status(kopi, "working", "plan", "Writing the report", null, "calm");
  s.tool(kopi, "list_tasks", "run tasks", "6 of 6 done", { input: 5200 });
  s.say(kopi, "Export ships: 6 tasks done, one review round, one install you approved, one low advisory to watch.");
  s.tool(kopi, "finish", "final report", "Run report saved", { input: 4800 });
  s.status(kopi, "done", "celebrate", "Run complete", null, "proud");
  s.emit("run.status", { status: "done", reason: null });

  return { events: s.events, calls: s.calls, approval, versions: s.versions };
}

const built = build();

/** The full scripted log, in seq order. */
export const DEMO_EVENTS: readonly MengaiEvent[] = built.events;
/** The LLM calls behind the log, one per agent step. */
export const DEMO_CALLS: readonly LlmCallDTO[] = built.calls;
export const DEMO_APPROVAL: ApprovalDTO = built.approval;

/** How many events play instantly before the live part starts: the whole crew is on the board. */
export const DEMO_WARM_SEQ = (() => {
  const hit = DEMO_EVENTS.find((e) => e.type === "approval.requested");
  return hit ? hit.seq : 1;
})();

/** Every version of every file the crew wrote, oldest first. */
const VERSIONS: ReadonlyMap<string, ReadonlyArray<{ ts: number; content: string | null; by: string; deleted: boolean }>> = built.versions;

/** The final text of each file, for tests and the landing. */
export const DEMO_FILE_CONTENT: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(BASE_FILES)) if (content !== null) out[path] = content;
  for (const [path, list] of VERSIONS) {
    const last = list[list.length - 1];
    if (last && last.content !== null) out[path] = last.content;
  }
  return out;
})();

/** One file as the workspace held it at `at` (fixture time); null when it did not exist yet. */
function fileAt(path: string, at: number): { content: string | null; size: number } | null {
  const list = VERSIONS.get(path) ?? [];
  let hit: { ts: number; content: string | null; deleted: boolean } | null = null;
  for (const v of list) if (v.ts <= at) hit = v;
  if (hit?.deleted) return null;
  if (hit) return { content: hit.content, size: hit.content?.length ?? sizeOf(path) };
  if (path in BASE_FILES) {
    const base = BASE_FILES[path] ?? null;
    return { content: base, size: base?.length ?? sizeOf(path) };
  }
  return null;
}

function sizeOf(path: string): number {
  let bytes = 0;
  for (const e of DEMO_EVENTS) if (e.type === "file.changed" && (e as MengaiEvent<"file.changed">).data.path === path) bytes = (e as MengaiEvent<"file.changed">).data.bytes;
  return bytes || 4096;
}

/** The workspace tree at `at`, folders first, then files, each by name. */
export function demoFiles(at: number = Number.POSITIVE_INFINITY): FileNodeDTO[] {
  const paths = new Set<string>([...Object.keys(BASE_FILES), ...VERSIONS.keys()]);
  const root: FileNodeDTO[] = [];
  const dirs = new Map<string, FileNodeDTO>();
  const dirOf = (path: string): FileNodeDTO[] => {
    const cut = path.lastIndexOf("/");
    if (cut < 0) return root;
    const dirPath = path.slice(0, cut);
    let dir = dirs.get(dirPath);
    if (!dir) {
      dir = { path: dirPath, name: dirPath.slice(dirPath.lastIndexOf("/") + 1), dir: true, size: 0, mtime: DEMO_T0, children: [] };
      dirs.set(dirPath, dir);
      dirOf(dirPath).push(dir);
    }
    return dir.children!;
  };
  for (const path of [...paths].sort()) {
    const f = fileAt(path, at);
    if (!f) continue;
    dirOf(path).push({ path, name: path.slice(path.lastIndexOf("/") + 1), dir: false, size: f.size, mtime: DEMO_T0 });
  }
  const sort = (list: FileNodeDTO[]) => {
    list.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    for (const n of list) if (n.children) sort(n.children);
  };
  sort(root);
  return root;
}

/** The final tree, for tests. */
export const DEMO_FILES: FileNodeDTO[] = demoFiles();

export function demoFile(path: string, at: number = Number.POSITIVE_INFINITY): FileContent {
  const f = fileAt(path, at);
  if (!f) return { path, content: "", truncated: false, size: 0, binary: false };
  if (f.content === null) return { path, content: "", truncated: false, size: f.size, binary: true };
  return { path, content: f.content, truncated: false, size: f.content.length, binary: false };
}
