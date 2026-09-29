// The company layer of the orchestrator. The lead is the CEO cat: crew
// questions (ask_human) reach the lead first and only what the lead cannot
// settle goes to the owner. The crew meets on its own: a kickoff after the
// plan, a sync after a failed review, a wrap-up before the final report.
// Pure: prompts, parsers, meeting text and the event fold that rebuilds
// meetings. No I/O here; the engine owns timing and state.
import { ROLE_LABEL, type AgentRole, type MeetingDTO, type MeetingKind, type MengaiEvent, type TaskStatus } from "@mengai/shared";
import { bounded } from "./policy";
import { statusLine } from "./voice";

export const COMPANY = {
  /** meeting hold outside the demo crew, ms */
  meetingMs: 3000,
  /** output cap of the CEO decision call */
  ceoOutputTokens: 120,
  agendaItems: 12,
  noteItems: 24,
  lineChars: 160,
  titleChars: 80,
  answerChars: 400,
  /** closed runs whose meetings the service keeps in memory */
  closedRunsCached: 64,
  eventPage: 1000,
  eventPages: 20,
} as const;

/** One bounded line for agendas, notes and decisions. */
export const line = (text: string, max: number = COMPANY.lineChars): string => statusLine(text, max);

const lines = (items: readonly string[], max: number): string[] => items.map((s) => line(s)).filter(Boolean).slice(0, max);

// --------------------------------------------------------------- the CEO
/** System prompt of the CEO decision call (the demo router answers it by exact match). */
export const CEO_SYSTEM = [
  "You are the lead cat of an AI crew and act as its CEO. A crew member asks you a question about its task.",
  "Decide it yourself when the goal and the task give you enough to go on: approve or deny, with a short, concrete answer the crew member can act on.",
  "Choose owner only when the owner must answer: credentials or accounts, money, deleting data, legal matters, or a preference the goal does not settle.",
  'Reply with JSON only: {"decision":"approve"|"deny"|"owner","answer":"at most 40 words"}',
].join("\n");

export interface CeoVerdict {
  decision: "approve" | "deny" | "owner";
  answer: string;
}

/**
 * Questions that always go to the owner, without asking the lead's model:
 * secrets, accounts, money and destructive or legal calls. Tool level
 * approvals (destructive and sensitive actions) stay with the owner anyway;
 * the CEO only answers questions.
 */
const OWNER_ONLY =
  /\b(api[ _-]?keys?|passwords?|passphrases?|secrets?|credentials?|access tokens?|private keys?|log ?in|sign ?in|accounts?|payments?|pay|billing|invoices?|credit cards?|purchases?|buy|subscriptions?|legal|contracts?|licen[cs]es?|delete|drop|wipe|production|deploy)\b/i;

export function ownerOnly(question: string): boolean {
  return OWNER_ONLY.test(question);
}

export function ceoPacket(input: { goal: string; askerName: string; askerRole: AgentRole; taskTitle: string; question: string }): string {
  return [
    `Goal: ${bounded(input.goal, 1200)}`,
    `Crew member: ${input.askerName} (${ROLE_LABEL[input.askerRole]}), task: ${bounded(input.taskTitle, 200)}`,
    `Question: ${bounded(input.question, 1000)}`,
  ].join("\n");
}

/** Reads the question back out of a CEO packet (the demo router uses it). */
export function packetQuestion(packet: string): string {
  const at = packet.indexOf("\nQuestion: ");
  return at < 0 ? "" : packet.slice(at + "\nQuestion: ".length).trim();
}

/** Parses the CEO reply; null when it is not a usable verdict (the owner decides then). */
export function parseCeoReply(text: string): CeoVerdict | null {
  const raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const d = typeof o.decision === "string" ? o.decision.trim().toLowerCase() : "";
  const decision = d === "approve" || d === "approved" || d === "yes" ? "approve" : d === "deny" || d === "denied" || d === "no" ? "deny" : d === "owner" || d === "escalate" ? "owner" : null;
  if (!decision) return null;
  const answer = typeof o.answer === "string" ? bounded(o.answer, COMPANY.answerChars) : "";
  if (!answer && decision !== "owner") return null;
  return { decision, answer };
}

// ------------------------------------------------------------- meetings
/** Meeting hold in ms: the router's pace hint (demo crew, tests) or the real-mode default. */
export function meetingHoldMs(pace: readonly [number, number] | undefined, rand: () => number = Math.random): number {
  if (!pace) return COMPANY.meetingMs;
  const lo = Math.max(0, Math.min(pace[0], pace[1]));
  const hi = Math.max(lo, pace[0], pace[1]);
  return Math.round(lo + rand() * (hi - lo));
}

export const MEETING_TITLE = {
  kickoff: "Kickoff",
  wrapup: "Wrap-up",
  sync: (taskTitle: string) => line(`Sync on ${taskTitle}`, COMPANY.titleChars),
} as const;

const KIND_WORD: Record<MeetingKind, string> = { kickoff: "kickoff", sync: "sync", review: "review", wrapup: "wrap-up" };

/** statusText of every cat sitting in a meeting */
export function meetingLine(kind: MeetingKind): string {
  return `In the ${KIND_WORD[kind]} meeting`;
}

export interface PlanItem {
  title: string;
  role: AgentRole;
  review: boolean;
  after: string[];
}

export function kickoffText(items: readonly PlanItem[], starters: ReadonlyArray<{ name: string; title: string }>) {
  const agenda = lines(items.map((x) => x.title), COMPANY.agendaItems);
  const notes = lines(
    items.map((x) => `${x.title}: ${ROLE_LABEL[x.role]}${x.after.length ? `, after ${x.after.join(", ")}` : ""}${x.review ? ", reviewed" : ""}`),
    COMPANY.noteItems,
  );
  const reviewed = items.filter((x) => x.review).length;
  const decisions = lines(
    [...starters.map((s) => `${s.name} starts on ${s.title}`), ...(reviewed ? [`${reviewed} task${reviewed === 1 ? "" : "s"} go through review`] : [])],
    COMPANY.noteItems,
  );
  const first = starters[0];
  const opening = line(`Kickoff: ${items.length} task${items.length === 1 ? "" : "s"} on the board.${first ? ` ${first.name} starts on ${first.title}.` : ""}`, 280);
  return { agenda, notes, decisions, opening };
}

export type SyncNext = "fix" | "change_approach" | "exit_done" | "escalate";

export function syncText(input: { reviewerName: string; ownerName: string | null; taskTitle: string; notes: readonly string[]; round: number; next: SyncNext }) {
  const who = input.ownerName ?? "The owner cat";
  // a note list the model sent as one block arrives as one multi-line note: one agenda item per line
  const items = input.notes.flatMap((n) => n.split(/\n+/)).map((n) => n.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
  const agenda = lines(items.length ? items : ["The review failed without notes"], COMPANY.agendaItems);
  const notes = lines(items.map((n) => `${input.reviewerName}: ${n}`), COMPANY.noteItems);
  const decision =
    input.next === "fix"
      ? `${who} fixes ${input.taskTitle} (round ${input.round + 1})`
      : input.next === "change_approach"
        ? `${who} tries a new approach on ${input.taskTitle}`
        : input.next === "exit_done"
          ? `Accepted with open notes: ${input.taskTitle}`
          : `Escalated to the owner: ${input.taskTitle}`;
  const n = items.length;
  const opening = line(`${n || "No"} note${n === 1 ? "" : "s"} on ${input.taskTitle}${items[0] ? `: ${items[0]}` : ""}`, 280);
  return { agenda, notes, decisions: [line(decision)], opening };
}

export interface FinishedItem {
  title: string;
  status: TaskStatus;
  by: string | null;
}

export function wrapupText(items: readonly FinishedItem[], leadName: string) {
  const agenda = ["What shipped", "What is still open", "The report to the owner"];
  const notes = lines(items.map((x) => `${x.title}: ${x.status}${x.by ? ` by ${x.by}` : ""}`), COMPANY.noteItems);
  const open = items.filter((x) => x.status === "failed" || x.status === "blocked").length;
  const decisions = lines([`${leadName} writes the report to the owner`, ...(open ? [`${open} open item${open === 1 ? "" : "s"} go in the report`] : [])], COMPANY.noteItems);
  const done = items.filter((x) => x.status === "done").length;
  const opening = line(`Wrap-up: ${done} of ${items.length} task${items.length === 1 ? "" : "s"} done.${open ? ` ${open} still open.` : " Nothing left open."}`, 280);
  return { agenda, notes, decisions, opening };
}

/** Rebuilds meetings from meeting.started / meeting.ended events, oldest first. */
export function meetingsFromEvents(events: readonly MengaiEvent[]): MeetingDTO[] {
  const byId = new Map<string, MeetingDTO>();
  for (const e of events) {
    if (e.type === "meeting.started") {
      const d = (e as MengaiEvent<"meeting.started">).data;
      byId.set(d.meetingId, { id: d.meetingId, kind: d.kind, title: d.title, agentIds: [...d.agentIds], agenda: [...d.agenda], notes: [], startedAt: e.ts, endedAt: null });
    } else if (e.type === "meeting.ended") {
      const d = (e as MengaiEvent<"meeting.ended">).data;
      const m = byId.get(d.meetingId);
      if (m) {
        m.notes = [...d.notes];
        m.endedAt = e.ts;
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}
