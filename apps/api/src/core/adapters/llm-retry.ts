// Resilience wrapper around any LlmProvider: transient errors (429, 5xx,
// 529, network, timeout) retried up to 3 times with exponential backoff and
// jitter, Retry-After honored; context_length, bad_request, auth and
// not_found never retried; caller abort always wins. Per-provider concurrency
// gate (default 4) and a circuit breaker: after 5 consecutive transient
// failures the circuit opens for 30 s and calls fail fast with kind
// overloaded; then one probe call decides between closed and open again.
import type { ProviderModel } from "@mengai/shared";
import { LlmError } from "../ports/llm";
import type { ChatRequest, ChatResult, LlmProvider } from "../ports/llm";

export interface RetryPolicy {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** a Retry-After longer than this is not waited for: the error is thrown */
  maxRetryAfterMs?: number;
  concurrency?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; error: LlmError }) => void;
}

export type BreakerState = "closed" | "open" | "half_open";

export interface ResilientLlm extends LlmProvider {
  readonly inner: LlmProvider;
  breaker(): { state: BreakerState; failures: number; openUntil: number | null };
  inFlight(): number;
  queued(): number;
}

const retryCounts = new WeakMap<object, number>();

/** Transport retries performed before this error was thrown (0 when unknown). */
export function retriesOf(err: unknown): number {
  return err && typeof err === "object" ? retryCounts.get(err) ?? 0 : 0;
}

function tag<E extends object>(err: E, retries: number): E {
  retryCounts.set(err, retries);
  return err;
}

function aborted(): LlmError {
  return new LlmError("aborted", "request aborted");
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

class Gate {
  active = 0;
  private waiters: Array<{ go: () => void; fail: (e: unknown) => void }> = [];
  constructor(private readonly limit: number) {}

  queued(): number {
    return this.waiters.length;
  }

  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(aborted());
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(aborted());
      };
      const waiter = {
        go: () => {
          signal?.removeEventListener("abort", onAbort);
          this.active++;
          resolve();
        },
        fail: reject,
      };
      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next.go();
  }
}

function asLlmError(e: unknown, signal?: AbortSignal): LlmError {
  if (e instanceof LlmError) return e;
  if (signal?.aborted) return aborted();
  const message = e instanceof Error ? e.message : String(e);
  return new LlmError("network", message);
}

export function withRetry(inner: LlmProvider, policy: RetryPolicy = {}): ResilientLlm {
  const maxRetries = policy.maxRetries ?? 3;
  const baseDelay = policy.baseDelayMs ?? 500;
  const maxDelay = policy.maxDelayMs ?? 20_000;
  const maxRetryAfter = policy.maxRetryAfterMs ?? 60_000;
  const threshold = policy.breakerThreshold ?? 5;
  const cooldown = policy.breakerCooldownMs ?? 30_000;
  const now = policy.now ?? Date.now;
  const random = policy.random ?? Math.random;
  const sleep = policy.sleep ?? abortableSleep;
  const gate = new Gate(Math.max(1, policy.concurrency ?? 4));

  let state: BreakerState = "closed";
  let failures = 0;
  let openUntil = 0;
  let probing = false;

  function breakerError(waitMs: number): LlmError {
    const secs = Math.max(1, Math.ceil(waitMs / 1000));
    return new LlmError("overloaded", `circuit open for provider ${inner.id} after repeated failures, retry in ${secs}s`, null, Math.max(0, waitMs));
  }

  /** returns true when this call is the half-open probe */
  function admit(): boolean {
    if (state === "open") {
      const left = openUntil - now();
      if (left > 0) throw breakerError(left);
      state = "half_open";
    }
    if (state === "half_open") {
      if (probing) throw breakerError(1000);
      probing = true;
      return true;
    }
    return false;
  }

  function onTransient(): void {
    failures++;
    if (state === "half_open" || failures >= threshold) {
      state = "open";
      openUntil = now() + cooldown;
    }
  }

  function onHealthy(): void {
    failures = 0;
    state = "closed";
  }

  function delayFor(attempt: number, err: LlmError): number | null {
    if (err.retryAfterMs !== null && err.retryAfterMs !== undefined) {
      if (err.retryAfterMs > maxRetryAfter) return null;
      return err.retryAfterMs + Math.floor(random() * 250);
    }
    const exp = Math.min(maxDelay, baseDelay * 2 ** attempt);
    return Math.floor(exp / 2 + (random() * exp) / 2);
  }

  async function attemptOnce(req: ChatRequest, attempt: number): Promise<{ ok: true; result: ChatResult } | { ok: false; err: LlmError; streamed: boolean }> {
    let probe: boolean;
    try {
      probe = admit();
    } catch (e) {
      throw tag(e as LlmError, attempt);
    }
    try {
      await gate.acquire(req.signal);
    } catch (e) {
      if (probe) probing = false;
      throw tag(asLlmError(e, req.signal), attempt);
    }
    let streamed = false;
    const onDelta = req.onDelta
      ? (t: string) => {
          streamed = true;
          req.onDelta!(t);
        }
      : undefined;
    try {
      const result = await inner.chat(onDelta ? { ...req, onDelta } : req);
      onHealthy();
      return { ok: true, result };
    } catch (e) {
      const err = asLlmError(e, req.signal);
      if (err.transient) onTransient();
      else if (err.kind !== "aborted") onHealthy();
      else if (probe) state = "half_open";
      return { ok: false, err, streamed };
    } finally {
      if (probe) probing = false;
      gate.release();
    }
  }

  return {
    id: inner.id,
    protocol: inner.protocol,
    inner,
    breaker: () => ({ state: state === "open" && openUntil <= now() ? "half_open" : state, failures, openUntil: state === "open" ? openUntil : null }),
    inFlight: () => gate.active,
    queued: () => gate.queued(),
    async chat(req: ChatRequest): Promise<ChatResult> {
      for (let attempt = 0; ; attempt++) {
        if (req.signal?.aborted) throw tag(aborted(), attempt);
        const out = await attemptOnce(req, attempt);
        if (out.ok) return { ...out.result, retries: attempt };
        const { err } = out;
        // streamed deltas cannot be taken back, so a half-streamed answer is never replayed
        const retryable = err.transient && attempt < maxRetries && !out.streamed && !req.signal?.aborted;
        const delay = retryable ? delayFor(attempt, err) : null;
        if (delay === null) throw tag(err, attempt);
        policy.onRetry?.({ attempt: attempt + 1, delayMs: delay, error: err });
        try {
          await sleep(delay, req.signal);
        } catch {
          throw tag(aborted(), attempt + 1);
        }
      }
    },
    listModels(signal?: AbortSignal): Promise<ProviderModel[]> {
      return inner.listModels(signal);
    },
  };
}
