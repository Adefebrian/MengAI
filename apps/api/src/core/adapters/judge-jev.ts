// JEV transport (TypeSafe System One) behind the Judge port. POST
// <baseUrl>/systemone with the owner's Bearer key and body
// { state, model: "jev-latest", questions }. State is deep-redacted before
// it leaves the process. 15 s total deadline, retries on 429 and 529 only.
// Never throws: every failure is { verified: false, stamp: "UNVERIFIED BY JEV" }.
import type { Mode } from "@mengai/shared";
import { redact, redactDeep } from "../../lib/redact";
import type { JevAnswer, JevQuestion, Judge, JudgeResult } from "../ports/judge";
import { abortableSleep } from "./llm-retry";
import { assertSafeUrl, errorDetails, joinUrl, parseRetryAfter, UnsafeUrlError, type FetchFn, type LookupFn } from "./llm-openai";

export const JEV_MODEL = "jev-latest";
export const JEV_STAMP = "UNVERIFIED BY JEV" as const;

export interface JevTarget {
  baseUrl: string;
  apiKey: string;
}

export interface JevJudgeConfig {
  /** resolves the owner's JEV provider and key; null when not configured */
  target: () => Promise<JevTarget | null>;
  mode: Mode;
  lookup?: LookupFn;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: FetchFn;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

type Json = Record<string, unknown>;

function num(v: unknown): number | undefined {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : undefined;
}

function probs(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, p] of Object.entries(v as Json)) {
    const x = num(p);
    if (x !== undefined) out[k] = x;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Normalizes one answer to the port shape, using the question type when the answer omits it. */
export function normalizeAnswer(raw: unknown, question: JevQuestion | undefined): JevAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Json;
  const type = (typeof a.type === "string" ? a.type : question?.type) as JevQuestion["type"] | undefined;
  if (type === "choice") {
    const probabilities = probs(a.probabilities) ?? {};
    const choice = typeof a.choice === "string" ? a.choice : Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0]?.[0];
    if (!choice) return null;
    const confidence = num(a.confidence) ?? probabilities[choice] ?? 0;
    return { type: "choice", choice, confidence, probabilities };
  }
  if (type === "score") {
    const score = num(a.score);
    if (score === undefined) return null;
    const confidence = num(a.confidence);
    const probabilities = probs(a.probabilities);
    return { type: "score", score, ...(confidence !== undefined ? { confidence } : {}), ...(probabilities ? { probabilities } : {}) };
  }
  if (type === "noul") {
    const noul = num(a.noul);
    if (noul === undefined) return null;
    const confidence = num(a.confidence);
    return { type: "noul", noul, ...(confidence !== undefined ? { confidence } : {}) };
  }
  return null;
}

export function createJevJudge(cfg: JevJudgeConfig): Judge {
  const now = cfg.now ?? Date.now;
  const sleep = cfg.sleep ?? abortableSleep;
  const maxRetries = cfg.maxRetries ?? 2;
  const timeoutMs = cfg.timeoutMs ?? 15_000;

  const unverified = (error: string, started: number): JudgeResult => ({
    verified: false,
    stamp: JEV_STAMP,
    error: redact(error),
    latencyMs: Math.max(0, now() - started),
  });

  return {
    async configured(): Promise<boolean> {
      try {
        return (await cfg.target()) !== null;
      } catch {
        return false;
      }
    },
    async decide(req): Promise<JudgeResult> {
      const started = now();
      let target: JevTarget | null;
      try {
        target = await cfg.target();
      } catch {
        target = null;
      }
      if (!target) return unverified("JEV is not configured: add a provider with the jev preset and its API key", started);
      const url = joinUrl(target.baseUrl, "/systemone");
      try {
        await assertSafeUrl(url, { mode: cfg.mode, lookup: cfg.lookup });
      } catch (e) {
        return unverified(`JEV base URL rejected: ${e instanceof UnsafeUrlError ? e.message : "invalid"}`, started);
      }
      const body = JSON.stringify({ state: redactDeep(req.state), model: JEV_MODEL, questions: req.questions });
      const deadline = AbortSignal.timeout(timeoutMs);
      const signal = req.signal ? AbortSignal.any([req.signal, deadline]) : deadline;
      for (let attempt = 0; ; attempt++) {
        if (req.signal?.aborted) return unverified("JEV call aborted", started);
        let res: Response;
        try {
          res = await (cfg.fetch ?? globalThis.fetch)(url, {
            method: "POST",
            headers: { authorization: `Bearer ${target.apiKey}`, "content-type": "application/json", accept: "application/json" },
            body,
            signal,
            redirect: "manual",
          });
        } catch (e) {
          if (req.signal?.aborted) return unverified("JEV call aborted", started);
          const name = (e as { name?: string } | null)?.name;
          return unverified(name === "TimeoutError" || name === "AbortError" ? `JEV timed out after ${timeoutMs} ms` : "JEV unreachable (network error)", started);
        }
        if ((res.status === 429 || res.status === 529) && attempt < maxRetries) {
          await res.body?.cancel().catch(() => {});
          const wait = Math.min(parseRetryAfter(res.headers) ?? 500 * 2 ** attempt, 4_000);
          try {
            await sleep(wait, signal);
          } catch {
            return unverified(req.signal?.aborted ? "JEV call aborted" : `JEV timed out after ${timeoutMs} ms`, started);
          }
          continue;
        }
        if (!res.ok) {
          const d = errorDetails(await res.text().catch(() => ""));
          return unverified(`JEV ${res.status}: ${d.message || "request failed"}`, started);
        }
        let j: Json;
        try {
          j = (await res.json()) as Json;
        } catch {
          return unverified("JEV returned a non JSON body", started);
        }
        if (j.verified === false) return unverified(String(j.error ?? "JEV could not verify this decision"), started);
        const rawAnswers = (j.answers && typeof j.answers === "object" ? j.answers : {}) as Json;
        const answers: Record<string, JevAnswer> = {};
        for (const [key, raw] of Object.entries(rawAnswers)) {
          const a = normalizeAnswer(raw, req.questions[key]);
          if (a) answers[key] = a;
        }
        if (Object.keys(answers).length === 0) return unverified("JEV returned no usable answers", started);
        return {
          verified: true,
          model: typeof j.model === "string" && j.model ? j.model : JEV_MODEL,
          answers,
          latencyMs: Math.max(0, now() - started),
        };
      }
    },
  };
}
