// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Dev server output: a redacted ring buffer of the last lines, and the
// "Local: http://localhost:5173/" style URL the server prints. Only
// 127.0.0.1 and localhost count, never a LAN address, never a port the
// engine itself listens on.
import { redact } from "../../lib/redact";

export const LOG_LINES = 40;
const MAX_LINE = 400;
const MAX_PARTIAL = 8192;

// CSI sequences, OSC sequences (terminal links, titles) and lone escapes
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/** Keeps the last `max` lines of every stream pushed into it, redacted and clipped. */
export class LogRing {
  private lines: string[] = [];
  private partial = new Map<string, string>();

  constructor(
    private readonly max = LOG_LINES,
    private readonly onLine?: (line: string) => void,
  ) {}

  /** a chunk of one stream; lines are split per stream so stdout and stderr never mix mid-line */
  push(stream: string, chunk: string): void {
    const text = (this.partial.get(stream) ?? "") + chunk;
    const parts = text.split("\n");
    const rest = parts.pop() ?? "";
    this.partial.set(stream, rest.length > MAX_PARTIAL ? rest.slice(-MAX_PARTIAL) : rest);
    for (const raw of parts) this.add(raw);
  }

  /** a line the engine writes itself ("$ bun run dev") */
  note(line: string): void {
    this.add(line);
  }

  /** the unterminated last line of one stream (or of every stream) */
  flush(stream?: string): void {
    for (const [name, rest] of this.partial) {
      if (stream !== undefined && name !== stream) continue;
      this.partial.set(name, "");
      if (rest) this.add(rest);
    }
  }

  tail(): string[] {
    return [...this.lines];
  }

  private add(raw: string): void {
    // progress bars redraw with \r: keep what the terminal would show
    const shown = stripAnsi(raw.slice(raw.lastIndexOf("\r") + 1)).trimEnd();
    if (!shown.trim()) return;
    this.onLine?.(shown);
    const line = redact(shown);
    this.lines.push(line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)} [clipped]` : line);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }
}

const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}(?:\/[^\s"'<>`]*)?/gi;

/**
 * The first local URL in a line, normalized (scheme, host, port, path).
 * Ports below 1024 and the engine's own ports are ignored.
 */
export function parseLocalUrl(line: string, blockedPorts: ReadonlySet<number> = new Set()): string | null {
  for (const match of stripAnsi(line).matchAll(URL_RE)) {
    let url: URL;
    try {
      url = new URL(match[0].replace(/[.,;:)\]]+$/, ""));
    } catch {
      continue;
    }
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || blockedPorts.has(port)) continue;
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") continue;
    return `${url.protocol}//${url.hostname}:${port}${url.pathname}${url.search}`;
  }
  return null;
}
