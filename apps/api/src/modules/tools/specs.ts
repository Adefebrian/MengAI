// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The tool registry: one compact JSON Schema spec per TOOL_NAMES entry.
// Every schema costs input tokens on every call, so descriptions stay short
// (under 60 words) and parameters carry only what a handler needs.
import { AGENT_ROLES, SEVERITIES, TASK_STATUSES, type ToolName } from "@mengai/shared";
import type { ToolSpec } from "../../core/ports";
import type { JsonSchema } from "./validate";

const str = (description?: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: "string", ...(description ? { description } : {}), ...extra });
const int = (description: string | undefined, minimum?: number, maximum?: number): JsonSchema => ({
  type: "integer",
  ...(description ? { description } : {}),
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {}),
});
const num = (description?: string): JsonSchema => ({ type: "number", ...(description ? { description } : {}) });
const bool = (description?: string): JsonSchema => ({ type: "boolean", ...(description ? { description } : {}) });
const strList = (description?: string, maxItems?: number, maxLength?: number): JsonSchema => ({
  type: "array",
  items: str(undefined, maxLength ? { maxLength } : {}),
  ...(description ? { description } : {}),
  ...(maxItems ? { maxItems } : {}),
});
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});

const PATH = str("Path relative to the workspace root", { maxLength: 1024 });
const ROLE = str(undefined, { enum: AGENT_ROLES });

function spec(name: ToolName, description: string, parameters: JsonSchema): ToolSpec {
  return { name, description, parameters: parameters as Record<string, unknown> };
}

export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
  finish: spec(
    "finish",
    "End your task. Give a short summary of the result and list the files you changed. Use outcome blocked only when you cannot finish.",
    obj({ summary: str(undefined, { maxLength: 2000 }), files: strList(undefined, 50, 1024), outcome: str(undefined, { enum: ["done", "blocked"] }) }, ["summary"]),
  ),
  note: spec("note", "Post a short note to the crew timeline: a decision, a finding or progress. It does not end your task.", obj({ text: str(undefined, { maxLength: 500 }) }, ["text"])),
  ask_human: spec(
    "ask_human",
    "Ask the owner a question only they can answer. Your task pauses until they reply. Offer options when you can.",
    obj({ question: str(undefined, { maxLength: 1000 }), options: strList(undefined, 6, 200) }, ["question"]),
  ),
  recall: spec(
    "recall",
    "Look up lessons and saved skills from earlier work for this project and role. Use it before an unfamiliar or repeated task.",
    obj({ query: str(undefined, { maxLength: 300 }), limit: int(undefined, 1, 5) }, ["query"]),
  ),
  record_lesson: spec(
    "record_lesson",
    "Save one short, reusable lesson from this task: a fix, a pitfall or a convention. One or two sentences, no secrets.",
    obj({ text: str(undefined, { maxLength: 400 }), tags: strList(undefined, 5, 40) }, ["text"]),
  ),
  save_skill: spec(
    "save_skill",
    "Save a multi-step procedure that worked as a named skill: the tool calls in order with their arguments, so the crew can repeat it.",
    obj(
      {
        name: str("lowercase-with-dashes", { maxLength: 48 }),
        description: str(undefined, { maxLength: 300 }),
        steps: { type: "array", maxItems: 20, minItems: 1, items: obj({ tool: str(), args: { type: "object" }, note: str(undefined, { maxLength: 200 }) }, ["tool", "args"]) },
      },
      ["name", "description", "steps"],
    ),
  ),
  handoff: spec(
    "handoff",
    "Hand a sub-problem to a crew mate with another role. Describe the work and how to check it. You wait until they finish, then continue with their summary.",
    obj(
      {
        to_role: ROLE,
        title: str(undefined, { maxLength: 120 }),
        spec: str(undefined, { maxLength: 4000 }),
        acceptance: strList(undefined, 10, 300),
        context: str(undefined, { maxLength: 2000 }),
      },
      ["to_role", "title", "spec", "acceptance"],
    ),
  ),
  create_tasks: spec(
    "create_tasks",
    "Plan the work as tasks (at most 12). Each task has a short key, a role, a clear spec and checkable acceptance criteria. deps lists keys of tasks that must finish first; set review for work that needs a reviewer.",
    obj(
      {
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: obj(
            {
              key: str(undefined, { maxLength: 40 }),
              title: str(undefined, { maxLength: 120 }),
              spec: str(undefined, { maxLength: 4000 }),
              acceptance: strList(undefined, 10, 300),
              role: ROLE,
              deps: strList(undefined, 12, 64),
              review: bool(),
            },
            ["key", "title", "spec", "acceptance", "role"],
          ),
        },
      },
      ["tasks"],
    ),
  ),
  update_task: spec(
    "update_task",
    "Change a task that has not started: cancel it, requeue it, change its priority or add a note for whoever picks it up.",
    obj(
      { task_id: str(undefined, { maxLength: 64 }), status: str(undefined, { enum: ["queued", "cancelled"] }), priority: int(undefined, -100, 100), note: str(undefined, { maxLength: 1000 }) },
      ["task_id"],
    ),
  ),
  list_tasks: spec("list_tasks", "List the tasks of this run with status, role and assignee. Optionally filter by status.", obj({ status: str(undefined, { enum: TASK_STATUSES }) })),
  crew_status: spec("crew_status", "Show every crew mate in this run: role, status, current task and token usage.", obj({})),
  fs_list: spec(
    "fs_list",
    "List files and folders in the workspace. node_modules, .git, dist and target are skipped.",
    obj({ path: PATH, depth: int("Levels to expand, default 2", 1, 4) }),
  ),
  fs_read: spec(
    "fs_read",
    "Read a text file from the workspace, optionally a 1-based inclusive line range. Output is capped at 64 KB; read the next range to continue.",
    obj({ path: PATH, from: int(undefined, 1), to: int(undefined, 1) }, ["path"]),
  ),
  fs_search: spec(
    "fs_search",
    "Search file contents in the workspace. pattern is a regular expression (plain text works too); glob filters files, for example src/**/*.ts. Returns path:line: text.",
    obj({ pattern: str(undefined, { maxLength: 500 }), glob: str(undefined, { maxLength: 200 }), limit: int("default 50", 1, 100) }, ["pattern"]),
  ),
  fs_write: spec(
    "fs_write",
    "Create or overwrite a workspace file with its full content; parent folders are created. Prefer fs_edit for small changes to existing files.",
    obj({ path: PATH, content: str() }, ["path", "content"]),
  ),
  fs_edit: spec(
    "fs_edit",
    "Replace exact text in a workspace file. find must match the file exactly, whitespace included, and be unique unless all is true. Read the file first.",
    obj({ path: PATH, find: str(undefined, { minLength: 1 }), replace: str(), all: bool() }, ["path", "find", "replace"]),
  ),
  fs_delete: spec("fs_delete", "Delete a file or folder (with its contents) in the workspace.", obj({ path: PATH }, ["path"])),
  shell_run: spec(
    "shell_run",
    "Run a shell command (/bin/sh) in the sandboxed workspace. Output is capped and the command is killed at the timeout (max 120 s). Network is off unless the owner allowed it.",
    obj({ command: str(undefined, { maxLength: 4000 }), cwd: str("Folder relative to the workspace root", { maxLength: 1024 }), timeout_s: int(undefined, 1, 120) }, ["command"]),
  ),
  web_fetch: spec(
    "web_fetch",
    "Fetch a public web page or API over HTTP(S) and return readable text. Works only when the owner allowed network tools; private and local addresses are blocked.",
    obj({ url: str(undefined, { maxLength: 2048 }), max_chars: int("default 20000", 1000, 50000) }, ["url"]),
  ),
  web_search: spec("web_search", "Search the web and return titles, links and snippets.", obj({ query: str(undefined, { maxLength: 300 }), limit: int(undefined, 1, 10) }, ["query"])),
  generate_image: spec(
    "generate_image",
    "Generate an image from a detailed prompt with the owner's image model. The file is saved to the workspace assets folder and the gallery.",
    obj({ prompt: str(undefined, { maxLength: 4000 }), size: str(undefined, { enum: ["1024x1024", "1536x1024", "1024x1536"] }) }, ["prompt"]),
  ),
  generate_video: spec(
    "generate_video",
    "Start a short video clip from a prompt. It renders in the background and appears in the gallery when done.",
    obj({ prompt: str(undefined, { maxLength: 4000 }), duration_s: int(undefined, 1, 20) }, ["prompt"]),
  ),
  scan_deps: spec("scan_deps", "Audit the workspace lockfiles for known vulnerable dependencies (OSV lookups need the owner's network consent).", obj({})),
  scan_secrets: spec("scan_secrets", "Scan the workspace for committed secrets such as API keys and private keys. Values are masked.", obj({})),
  scan_config: spec("scan_config", "Review Dockerfile, compose, CORS, cookie and debug settings and committed .env files for security problems.", obj({})),
  submit_review: spec(
    "submit_review",
    "Submit your verdict for the work under review. On fail, list each problem as a concrete, fixable note.",
    obj({ verdict: str(undefined, { enum: ["pass", "fail"] }), summary: str(undefined, { maxLength: 2000 }), notes: strList(undefined, 20, 500) }, ["verdict", "summary"]),
  ),
  report_issue: spec(
    "report_issue",
    "Report a bug or security issue you found: severity, where it is and how to fix it.",
    obj(
      {
        title: str(undefined, { maxLength: 200 }),
        severity: str(undefined, { enum: SEVERITIES }),
        detail: str(undefined, { maxLength: 4000 }),
        file: PATH,
        line: int(undefined, 1),
        fix: str(undefined, { maxLength: 2000 }),
      },
      ["title", "severity", "detail"],
    ),
  ),
  screen_capture: spec("screen_capture", "Take a screenshot of the Mac screen (needs the owner's permission). Use ui_tree to locate elements.", obj({ max_width: int(undefined, 320, 2560) })),
  ui_tree: spec(
    "ui_tree",
    "Read the accessibility tree of the frontmost app or a given app: roles, titles and screen frames. Secure fields are never read.",
    obj({ bundle_id: str(undefined, { maxLength: 200 }), depth: int(undefined, 1, 10), max_nodes: int(undefined, 10, 400) }),
  ),
  pointer: spec(
    "pointer",
    "Move, click or scroll the mouse at screen coordinates (points, top-left origin). Actions may need the owner's approval.",
    obj({ action: str(undefined, { enum: ["move", "click", "double_click", "right_click", "scroll"] }), x: num(), y: num(), dx: int(undefined, -5000, 5000), dy: int(undefined, -5000, 5000) }, ["action"]),
  ),
  keyboard: spec(
    "keyboard",
    "Type text, or press a key combo such as cmd+s, enter or shift+tab, in the focused app. Give text or combo. Typing into password fields is refused.",
    obj({ text: str(undefined, { maxLength: 2000 }), combo: str(undefined, { maxLength: 40 }) }),
  ),
  app_open: spec("app_open", "Open a Mac app, or bring it to the front, by name or bundle id.", obj({ name: str(undefined, { maxLength: 200 }), bundle_id: str(undefined, { maxLength: 200 }) })),
  browser_open: spec("browser_open", "Open a URL in the default browser.", obj({ url: str(undefined, { maxLength: 2048 }) }, ["url"])),
};

/** executed by the runs module (it checks isControl() first) */
export const CONTROL_TOOLS: ReadonlySet<string> = new Set<ToolName>([
  "finish",
  "note",
  "ask_human",
  "handoff",
  "create_tasks",
  "update_task",
  "list_tasks",
  "crew_status",
  "submit_review",
  "report_issue",
]);

/** tools that only read: safe to run in parallel within one step */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set<ToolName>(["fs_list", "fs_read", "fs_search", "recall", "list_tasks", "crew_status"]);

/** local automation tools: need the automation service */
export const OPERATOR_TOOLS: ReadonlySet<string> = new Set<ToolName>(["screen_capture", "ui_tree", "pointer", "keyboard", "app_open", "browser_open"]);

/** registered but not executable in this build, so never offered to a model */
export const UNAVAILABLE_TOOLS: ReadonlyMap<string, string> = new Map<ToolName, string>([
  ["web_search", "search provider not configured"],
  ["browser_open", "browser_open is not available: the automation helper has no browser method yet"],
]);
