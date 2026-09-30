// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Cat-voice status lines for agent.status. Every line is built from the tool
// name and a few safe argument fields (a file name, a command word, a host,
// a short query), never from tool output, then redacted and clipped to
// STATUS_MAX. Pure: no I/O, deterministic for a given seed.
import type { AgentRole } from "@mengai/shared";
import { bounded, withArticle } from "./policy";

export const STATUS_MAX = 80;

const LOCKFILES = new Set(["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "cargo.lock", "poetry.lock", "gemfile.lock", "go.sum"]);
const PAGE_DIRS = new Set(["pages", "page", "routes", "views", "screens", "app"]);
const PAGE_EXT = /\.(tsx|jsx|vue|svelte|astro|html)$/i;

/** Redacted, single line, at most `max` characters. */
export function statusLine(text: string, max: number = STATUS_MAX): string {
  return bounded(String(text ?? "").replace(/\s+/g, " "), max);
}

const pick = (options: readonly string[], seed: number) => options[Math.abs(Math.floor(seed)) % options.length]!;

function parse(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = statusLine(v, max);
  return s || null;
};

/** A friendly name for a workspace path: "the lockfile", "the settings page" or the file name. */
export function pathNoun(path: unknown): string {
  if (typeof path !== "string") return "the workspace";
  const parts = path.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (parts.length === 0) return "the workspace";
  const base = parts[parts.length - 1]!;
  if (LOCKFILES.has(base.toLowerCase())) return "the lockfile";
  const dirs = parts.slice(0, -1).map((d) => d.toLowerCase());
  if (PAGE_EXT.test(base) && dirs.some((d) => PAGE_DIRS.has(d))) {
    let stem = base.replace(/\.[^.]+$/, "");
    if (/^(index|page|\+page)$/i.test(stem) && parts.length > 1) stem = parts[parts.length - 2]!;
    const words = stem.replace(/[[\]()+]/g, "").replace(/[-_.]+/g, " ").trim().toLowerCase();
    if (words && !PAGE_DIRS.has(words)) return statusLine(`the ${words} page`, 40);
  }
  return statusLine(base, 40);
}

/** First words of a shell command, skipping env assignments (they can carry secrets). */
export function commandNoun(command: unknown): string {
  if (typeof command !== "string") return "a command";
  const words = command
    .trim()
    .split(/\s+/)
    .filter((w) => w && !w.includes("="));
  const head = words[0];
  if (!head) return "a command";
  const second = words[1];
  const phrase = second && !second.startsWith("-") && /^[\w:./@-]+$/.test(second) ? `${head} ${second}` : head;
  return statusLine(phrase, 28);
}

function host(url: unknown): string {
  if (typeof url !== "string") return "the web";
  try {
    return statusLine(new URL(url).hostname, 40) || "the web";
  } catch {
    return "the web";
  }
}

/** Status line for one tool call, from its name and raw JSON arguments. */
export function toolLine(tool: string, rawArgs: string, seed = 0): string {
  const a = parse(rawArgs);
  const file = () => pathNoun(a.path);
  const query = () => {
    const q = text(a.query ?? a.pattern, 32);
    return q ? `"${q}"` : "clues";
  };
  switch (tool) {
    case "fs_read":
      return statusLine(pick([`Sniffing through ${file()}`, `Pawing through ${file()}`, `Reading ${file()} with both ears up`], seed));
    case "fs_list":
      return statusLine(pick([`Prowling around ${file()}`, `Scouting the corners of ${file()}`], seed));
    case "fs_search":
      return statusLine(pick([`Hunting for ${query()}`, `Nose to the ground for ${query()}`], seed));
    case "fs_write":
      return statusLine(pick([`Kneading ${file()}`, `Shaping ${file()} with careful paws`], seed));
    case "fs_edit":
      return statusLine(pick([`Grooming ${file()}`, `Tidying up ${file()}`], seed));
    case "fs_delete":
      return statusLine(`Batting ${file()} off the table`);
    case "shell_run": {
      const cmd = commandNoun(a.command);
      if (/\b(test|vitest|jest|pytest|check|lint|typecheck|tsc)\b/i.test(cmd)) return statusLine(`Watching ${cmd} like a bird at the window`);
      return statusLine(pick([`Pouncing on ${cmd}`, `Running ${cmd}, tail held high`], seed));
    }
    case "web_fetch":
      return statusLine(`Peeking out the window at ${host(a.url)}`);
    case "web_search":
      return statusLine(`Stalking the web for ${query()}`);
    case "recall":
      return statusLine(`Digging up old lessons on ${query()}`);
    case "record_lesson":
      return "Tucking a lesson away for later";
    case "save_skill": {
      const name = text(a.name, 32);
      return statusLine(name ? `Learning a new trick: ${name}` : "Learning a new trick");
    }
    case "generate_image":
      return "Painting with one careful paw";
    case "generate_video":
      return "Filming a little cat movie";
    case "scan_deps":
      return "Sniffing the lockfile for trouble";
    case "scan_secrets":
      return "Checking under the rug for secrets";
    case "scan_config":
      return "Inspecting the config for loose threads";
    case "create_tasks":
      return "Laying out the plan, one paw at a time";
    case "update_task":
      return "Nudging the plan into shape";
    case "list_tasks":
      return "Counting the crew's tasks";
    case "crew_status":
      return "Checking in on the crew";
    case "submit_review":
      return a.verdict === "pass" ? "Giving the work a happy purr" : "Sending the work back with notes";
    case "report_issue": {
      const title = text(a.title, 40);
      return statusLine(title ? `Flagging an issue: ${title}` : "Flagging an issue for the crew");
    }
    case "finish":
      return "Wrapping up with a content purr";
    case "handoff":
      return "Passing part of the work along";
    case "note":
      return text(a.text, STATUS_MAX) ?? "Jotting down a note";
    case "ask_human":
      return "Meowing for the owner";
    default:
      return statusLine(`Busy with ${statusLine(tool, 32)}`);
  }
}

/** One line for a batch of read-only calls that run together. */
export function batchLine(calls: ReadonlyArray<{ name: string; arguments: string }>, seed = 0): string {
  const first = calls[0];
  if (!first) return "Poking around";
  if (calls.length === 1) return toolLine(first.name, first.arguments, seed);
  if (calls.every((c) => c.name === "fs_read")) return statusLine(`Sniffing through ${calls.length} files`);
  return statusLine(`${toolLine(first.name, first.arguments, seed)} and ${calls.length - 1} more`);
}

/** Status line before a model call. */
export function thinkingLine(role: AgentRole, title: string, step: number, lastStepFailed: boolean): string {
  const t = text(title.replace(/^(Review|Fix): /, ""), 48) ?? "the task";
  if (step === 0) {
    if (role === "reviewer") return statusLine(`Eyeing ${t} closely`);
    return statusLine(`Sizing up ${t}`);
  }
  if (lastStepFailed) return pick(["Shaking it off and rethinking", "Licking a paw and trying another way"], step);
  return statusLine(pick(["Whiskers twitching over the next move", `Mulling over ${t}`, "Tail swishing, thinking it through", `Chewing on ${t}`], step));
}

export const VOICE = {
  paused: "Curled up while the run is paused",
  compacting: "Tucking older notes away",
  idle: "Napping until the next task",
  /** idle with nothing queued for its role: the cat heads to the pantry */
  coffee: "Coffee break in the pantry",
  /** the lead between its own tasks: the CEO keeps watch */
  ceoIdle: "Keeping an eye on the board",
  backAtDesk: "Back at my desk",
  dealing: "Dealing the tasks to the crew",
  done: "All done, purring",
  resumed: (title: string) => statusLine(`Back on ${text(title, 60) ?? "the task"}`),
  asking: (question: string) => statusLine(`Meowing for you: ${question}`),
  waitingOn: (roleLabel: string, title: string) => statusLine(`Waiting by the door for ${roleLabel}: ${title}`),
  askingLead: (leadName: string, question: string) => statusLine(`Asking ${leadName}: ${question}`),
  weighing: (askerName: string) => statusLine(`Weighing ${askerName}'s question`),
  answered: (askerName: string) => statusLine(`Answered ${askerName}`),
  escalating: (askerName: string) => statusLine(`Taking ${askerName}'s question to the owner`),
  signedOff: (title: string) => statusLine(`Signed off on ${text(title, 60) ?? "the task"}`),
  /** the self-check before a finish */
  selfCheck: "Double-checking the work before handing it in",
  anotherRound: (critique: string) => statusLine(`One more round: ${critique}`),
  /** a cat that was let go packs its desk */
  leaving: "Packing up the desk",
  hiring: (role: string) => statusLine(`Hiring ${withArticle(role)}`),
  playbook: (role: string, version: number) => statusLine(`New ${role} playbook v${version}`),
  /** the CEO writes a charter for a new role */
  definingRole: (title: string) => statusLine(`Writing a charter for ${withArticle(title)}`),
  /** the CEO reads the evaluation of a candidate strategy */
  tuning: (who: string) => statusLine(`Rethinking how ${who} works`),
  coaching: (name: string) => statusLine(`Coaching ${name}`),
  /** a cat handed a sub-problem back: it does that part itself */
  selfServe: (title: string) => statusLine(`Doing ${text(title, 50) ?? "it"} myself`),
} as const;
