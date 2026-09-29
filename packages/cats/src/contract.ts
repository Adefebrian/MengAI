// Public contract of @mengai/cats. The web app codes against these props;
// packages/cats owns the rendering (flat SVG rig, CSS keyframes, reduced
// motion stills). Keep this file stable: both sides build in parallel.
import type { Activity, AgentRole, AgentStatus, CatLook, Mood } from "@mengai/shared";

export type CatSize = 48 | 64 | 96 | 160;

export interface CatProps {
  look: CatLook;
  role: AgentRole;
  status: AgentStatus;
  activity: Activity;
  mood: Mood;
  /** accessible name, e.g. "Kopi, Lead, writing code" */
  label: string;
  size?: CatSize;
  /** pointer follow, tap reaction, focus reaction */
  interactive?: boolean;
  onSelect?: () => void;
  /** forces the still pose even when the OS allows motion */
  still?: boolean;
  /** one-shot celebration trigger: change the value to play it once */
  celebrateKey?: number;
}

export interface CatCardProps extends CatProps {
  name: string;
  statusText: string | null;
  taskTitle: string | null;
  /** 0..1 share of the run budget this agent used, shown as its energy */
  energy: number;
  selected?: boolean;
}

/** Shared-layout id for the task card a cat carries during a handoff (Framer Motion layoutId). */
export function handoffLayoutId(taskId: string): string {
  return `handoff-${taskId}`;
}
