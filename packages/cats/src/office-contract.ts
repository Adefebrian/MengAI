// Public contract of the Office scene: the living cat company. The web app
// (run page, landing hero, replay) codes against these props; packages/cats
// owns the rendering. Keep this file stable: both sides build in parallel.
//
// The scene is a flat illustrated office floor (JAL law: flat fills, tonal
// depth, hairlines, no gradients, no shadows, no glow). It contains:
// - a CEO office for the lead cat (bigger desk, whiteboard with the plan)
// - team pods: one desk per crew cat, grouped by role
// - a meeting room with a table the crew walks to for meetings
// - a pantry corner where idle cats take a coffee break
// Cats sit and work at their own desk with the per-activity beat from the
// Cat component, stand up and walk (transform along corridor waypoints) for
// handoffs, questions to the CEO, meetings and breaks, then walk back.
import type { Activity, AgentRole, AgentStatus, CatLook, MeetingKind, Mood } from "@mengai/shared";

export interface OfficeAgent {
  id: string;
  name: string;
  role: AgentRole;
  look: CatLook;
  status: AgentStatus;
  activity: Activity;
  mood: Mood;
  /** 0..1 share of the run budget used, shown as energy */
  energy: number;
  parentId: string | null;
  /** title of the task on the desk, shown on the desk card */
  taskTitle: string | null;
  /** short cat-voice line, shown in the speech bubble while it changes */
  statusText: string | null;
  /** latest file the cat touched, shown on its monitor */
  file: string | null;
}

export interface OfficeMeeting {
  id: string;
  kind: MeetingKind;
  title: string;
  agentIds: string[];
  agenda: string[];
  /** null while the meeting is running */
  endedAt: number | null;
  notes: string[];
}

/**
 * One-shot story beats the scene choreographs. The web store appends a beat
 * for each matching event; the scene plays each beat once, in order, and
 * reports it done through onBeatDone so the queue drains.
 */
export type OfficeBeat =
  | { id: string; kind: "handoff"; fromId: string; toId: string; taskTitle: string }
  | { id: string; kind: "ask"; fromId: string; toId: string; question: string }
  | { id: string; kind: "decided"; byId: string; toId: string; approved: boolean; answer: string }
  | { id: string; kind: "review"; reviewerId: string; ownerId: string; passed: boolean; taskTitle: string }
  | { id: string; kind: "deliver"; fromId: string; taskTitle: string }
  | { id: string; kind: "celebrate"; agentIds: string[] };

export interface OfficeProps {
  agents: OfficeAgent[];
  meetings: OfficeMeeting[];
  beats: OfficeBeat[];
  onBeatDone?: (beatId: string) => void;
  /** plan cards shown on the CEO whiteboard, grouped by status */
  plan?: Array<{ id: string; title: string; status: "todo" | "doing" | "review" | "done"; ownerId: string | null }>;
  selectedId?: string | null;
  onSelect?: (agentId: string) => void;
  /** "hero" is the compact landing version, "full" the run page */
  variant?: "full" | "hero";
  /** forces still poses and instant moves (reduced motion is detected automatically too) */
  still?: boolean;
  /** accessible summary of what the crew is doing right now */
  label: string;
}
