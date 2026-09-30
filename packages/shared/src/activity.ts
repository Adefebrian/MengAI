// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Tool vocabulary and the tool -> cat activity map. The API emits the
// activity with every tool.call event, the web app picks the cat pose from
// it. One table, so the cat always shows what the agent is really doing.
import type { Activity, AgentRole, AgentStatus } from "./enums";

export const TOOL_NAMES = [
  // every role
  "finish",
  "note",
  "ask_human",
  "recall",
  "record_lesson",
  "save_skill",
  "handoff",
  // planning (lead)
  "create_tasks",
  "update_task",
  "list_tasks",
  "crew_status",
  // workspace
  "fs_list",
  "fs_read",
  "fs_search",
  "fs_write",
  "fs_edit",
  "fs_delete",
  "shell_run",
  // research
  "web_fetch",
  "web_search",
  // assets
  "generate_image",
  "generate_video",
  // security
  "scan_deps",
  "scan_secrets",
  "scan_config",
  // review and qa
  "submit_review",
  "report_issue",
  // local automation (operator, desktop only)
  "screen_capture",
  "ui_tree",
  "pointer",
  "keyboard",
  "app_open",
  "browser_open",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_ACTIVITY: Record<ToolName, Activity> = {
  finish: "celebrate",
  note: "think",
  ask_human: "ask",
  recall: "read",
  record_lesson: "think",
  save_skill: "think",
  handoff: "handoff",
  create_tasks: "plan",
  update_task: "plan",
  list_tasks: "plan",
  crew_status: "review",
  fs_list: "read",
  fs_read: "read",
  fs_search: "read",
  fs_write: "code",
  fs_edit: "code",
  fs_delete: "code",
  shell_run: "run",
  web_fetch: "research",
  web_search: "research",
  generate_image: "design",
  generate_video: "design",
  scan_deps: "scan",
  scan_secrets: "scan",
  scan_config: "scan",
  submit_review: "review",
  report_issue: "review",
  screen_capture: "automate",
  ui_tree: "automate",
  pointer: "automate",
  keyboard: "automate",
  app_open: "automate",
  browser_open: "automate",
};

/** Unknown tools (for example from a future MCP bridge) fall back to "code". */
export function activityForTool(tool: string): Activity {
  return (TOOL_ACTIVITY as Record<string, Activity>)[tool] ?? "code";
}

/** Activity shown when an agent is in a status without a tool in flight. */
export function activityForStatus(status: AgentStatus): Activity {
  switch (status) {
    case "thinking":
      return "think";
    case "waiting":
      return "wait";
    case "approval":
      return "ask";
    case "done":
      return "celebrate";
    case "working":
      return "code";
    default:
      return "rest";
  }
}

const COMMON: ToolName[] = ["finish", "note", "recall", "record_lesson"];

/**
 * Tools each role is given. Small sets on purpose: every schema costs input
 * tokens on every call (legacy sent all 20 schemas, about 1,800 tokens).
 */
export const ROLE_TOOLS: Record<AgentRole, ToolName[]> = {
  lead: [...COMMON, "ask_human", "create_tasks", "update_task", "list_tasks", "crew_status", "fs_list", "fs_read", "fs_search"],
  engineer: [...COMMON, "ask_human", "handoff", "save_skill", "fs_list", "fs_read", "fs_search", "fs_write", "fs_edit", "fs_delete", "shell_run"],
  designer: [...COMMON, "ask_human", "handoff", "fs_list", "fs_read", "fs_write", "fs_edit", "generate_image", "generate_video"],
  reviewer: [...COMMON, "fs_list", "fs_read", "fs_search", "shell_run", "submit_review"],
  qa: [...COMMON, "handoff", "fs_list", "fs_read", "fs_search", "fs_write", "fs_edit", "shell_run", "report_issue"],
  security: [...COMMON, "fs_list", "fs_read", "fs_search", "scan_deps", "scan_secrets", "scan_config", "report_issue"],
  researcher: [...COMMON, "web_fetch", "web_search", "fs_write"],
  operator: [...COMMON, "ask_human", "save_skill", "screen_capture", "ui_tree", "pointer", "keyboard", "app_open", "browser_open", "fs_list", "fs_read"],
};

/** Short human label for each activity, shown next to the cat and in reduced motion. */
export const ACTIVITY_LABEL: Record<Activity, string> = {
  rest: "Resting",
  think: "Thinking",
  plan: "Planning",
  code: "Writing code",
  run: "Running commands",
  read: "Reading",
  review: "Reviewing",
  research: "Researching",
  design: "Designing",
  scan: "Scanning",
  automate: "Running a runbook",
  handoff: "Handing off",
  ask: "Needs you",
  wait: "Waiting",
  celebrate: "Done",
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  thinking: "Thinking",
  working: "Working",
  waiting: "Waiting",
  approval: "Needs approval",
  done: "Done",
  error: "Error",
  stopped: "Stopped",
};

/** Minimum time an activity stays on screen so fast tool bursts never jitter the cat. */
export const ACTIVITY_MIN_DWELL_MS = 1200;
