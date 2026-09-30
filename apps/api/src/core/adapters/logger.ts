// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Structured JSON-lines logger. One line per record on stderr (stdout is
// reserved for the sidecar ready line). Every string, in the message and in
// every nested field, goes through redact(); keys that name secrets are
// masked by redactDeep. Errors are reduced to name + message.
import { redact, redactDeep } from "../../lib/redact";
import type { LogLevel, Logger } from "../ports/logger";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface JsonLoggerOptions {
  level?: LogLevel;
  /** sink for one serialized line (no trailing newline); default stderr */
  write?: (line: string) => void;
  now?: () => number;
  fields?: Record<string, unknown>;
}

function plain(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `[${value.byteLength} bytes]`;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => plain(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "function") continue;
      out[k] = plain(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function createJsonLogger(opts: JsonLoggerOptions = {}): Logger {
  const min = ORDER[opts.level ?? "info"];
  const write = opts.write ?? ((line: string) => void process.stderr.write(line + "\n"));
  const now = opts.now ?? Date.now;
  const base = opts.fields ?? {};

  const make = (bound: Record<string, unknown>): Logger => ({
    log(level, msg, fields) {
      if (ORDER[level] < min) return;
      const extra = redactDeep(plain({ ...bound, ...(fields ?? {}) }) as Record<string, unknown>);
      const record = { ...extra, ts: new Date(now()).toISOString(), level, msg: redact(String(msg)) };
      let line: string;
      try {
        line = JSON.stringify(record);
      } catch {
        line = JSON.stringify({ ts: record.ts, level, msg: record.msg, note: "fields not serializable" });
      }
      write(line);
    },
    child(fields) {
      return make({ ...bound, ...fields });
    },
  });

  return make(base);
}
