// Structured logger. Implementations MUST pass every string through the
// redactor (known key fingerprints + secret patterns) before writing.
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}
