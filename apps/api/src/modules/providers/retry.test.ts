// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// llm-retry wrapper: backoff, Retry-After, non-retryable kinds, abort,
// concurrency gate and circuit breaker, driven by fake timers.
import { afterEach, describe, expect, jest, test } from "bun:test";
import { retriesOf, withRetry } from "../../core/adapters/llm-retry";
import { LlmError, type ChatRequest, type ChatResult, type LlmProvider } from "../../core/ports/llm";

const req: ChatRequest = { model: "gpt-4o-mini", system: "s", messages: [{ role: "user", content: "hi" }] };

const ok = (text = "ok"): ChatResult => ({
  text,
  toolCalls: [],
  stopReason: "end",
  usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, cacheWriteTokens: 0 },
  model: "gpt-4o-mini",
  latencyMs: 1,
  retries: 0,
});

function scripted(steps: Array<LlmError | ChatResult | ((r: ChatRequest) => Promise<ChatResult>)>): LlmProvider & { calls: number } {
  const p = {
    id: "prov-1",
    protocol: "openai_chat" as const,
    calls: 0,
    async chat(r: ChatRequest): Promise<ChatResult> {
      const step = steps[Math.min(p.calls, steps.length - 1)]!;
      p.calls++;
      if (step instanceof LlmError) throw step;
      if (typeof step === "function") return step(r);
      return step;
    },
    async listModels() {
      return [];
    },
  };
  return p;
}

/** lets queued promise callbacks run between fake timer jumps */
async function flush(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

afterEach(() => {
  jest.useRealTimers();
});

describe("llm-retry", () => {
  test("retries transient errors with exponential backoff and jitter on fake timers", async () => {
    jest.useFakeTimers();
    const inner = scripted([new LlmError("server", "500", 500), new LlmError("network", "reset"), ok("third")]);
    const delays: number[] = [];
    const p = withRetry(inner, { baseDelayMs: 1000, random: () => 0, onRetry: (i) => delays.push(i.delayMs) });
    let result: ChatResult | null = null;
    const run = p.chat(req).then((r) => (result = r));
    await flush();
    expect(inner.calls).toBe(1);
    jest.advanceTimersByTime(499);
    await flush();
    expect(inner.calls).toBe(1);
    jest.advanceTimersByTime(1);
    await flush();
    expect(inner.calls).toBe(2);
    jest.advanceTimersByTime(1000);
    await flush();
    await run;
    expect(inner.calls).toBe(3);
    expect(delays).toEqual([500, 1000]);
    expect(result!.text).toBe("third");
    expect(result!.retries).toBe(2);
  });

  test("jitter stays within [exp/2, exp]", async () => {
    const delays: number[] = [];
    const p = withRetry(scripted([new LlmError("timeout", "t"), new LlmError("timeout", "t"), ok()]), {
      baseDelayMs: 400,
      random: () => 0.999,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await p.chat(req);
    expect(delays[0]).toBeGreaterThanOrEqual(200);
    expect(delays[0]).toBeLessThanOrEqual(400);
    expect(delays[1]).toBeGreaterThanOrEqual(400);
    expect(delays[1]).toBeLessThanOrEqual(800);
  });

  test("honors Retry-After and gives up after 3 retries with the count on the error", async () => {
    const delays: number[] = [];
    const inner = scripted([new LlmError("rate_limit", "429", 429, 2500)]);
    const p = withRetry(inner, {
      random: () => 0,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    const err = (await p.chat(req).catch((e) => e)) as LlmError;
    expect(err.kind).toBe("rate_limit");
    expect(inner.calls).toBe(4);
    expect(delays).toEqual([2500, 2500, 2500]);
    expect(retriesOf(err)).toBe(3);
  });

  test("a Retry-After beyond the cap is not waited for", async () => {
    const inner = scripted([new LlmError("rate_limit", "429", 429, 120_000), ok()]);
    const err = (await withRetry(inner, { sleep: async () => {} }).chat(req).catch((e) => e)) as LlmError;
    expect(err.kind).toBe("rate_limit");
    expect(inner.calls).toBe(1);
  });

  for (const kind of ["context_length", "bad_request", "auth", "not_found"] as const) {
    test(`${kind} is never retried`, async () => {
      const inner = scripted([new LlmError(kind, kind, 400), ok()]);
      const err = (await withRetry(inner, { sleep: async () => {} }).chat(req).catch((e) => e)) as LlmError;
      expect(err.kind).toBe(kind);
      expect(inner.calls).toBe(1);
      expect(retriesOf(err)).toBe(0);
    });
  }

  test("abort during backoff stops immediately", async () => {
    jest.useFakeTimers();
    const ctl = new AbortController();
    const inner = scripted([new LlmError("server", "500", 500), ok()]);
    const run = withRetry(inner, { baseDelayMs: 10_000, random: () => 0 }).chat({ ...req, signal: ctl.signal }).catch((e) => e);
    await flush();
    ctl.abort();
    const err = (await run) as LlmError;
    expect(err.kind).toBe("aborted");
    expect(inner.calls).toBe(1);
  });

  test("a half-streamed answer is not replayed", async () => {
    const inner = scripted([
      async (r) => {
        r.onDelta?.("partial");
        throw new LlmError("network", "reset");
      },
      ok(),
    ]);
    const seen: string[] = [];
    const err = (await withRetry(inner, { sleep: async () => {} }).chat({ ...req, onDelta: (t) => seen.push(t) }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe("network");
    expect(inner.calls).toBe(1);
    expect(seen).toEqual(["partial"]);
  });

  test("circuit opens after 5 consecutive transient failures, fails fast, then a probe closes it after 30 s", async () => {
    jest.useFakeTimers();
    const inner = scripted([
      new LlmError("overloaded", "529", 529),
      new LlmError("overloaded", "529", 529),
      new LlmError("overloaded", "529", 529),
      new LlmError("overloaded", "529", 529),
      new LlmError("overloaded", "529", 529),
      ok("recovered"),
    ]);
    const p = withRetry(inner, { maxRetries: 0 });
    for (let i = 0; i < 5; i++) await p.chat(req).catch(() => {});
    expect(inner.calls).toBe(5);
    expect(p.breaker().state).toBe("open");

    const fast = (await p.chat(req).catch((e) => e)) as LlmError;
    expect(fast.kind).toBe("overloaded");
    expect(fast.message).toContain("circuit open");
    expect(fast.retryAfterMs).toBe(30_000);
    expect(inner.calls).toBe(5);

    jest.advanceTimersByTime(29_999);
    expect(((await p.chat(req).catch((e) => e)) as LlmError).message).toContain("circuit open");
    expect(inner.calls).toBe(5);

    jest.advanceTimersByTime(1);
    expect(p.breaker().state).toBe("half_open");
    const r = await p.chat(req);
    expect(r.text).toBe("recovered");
    expect(inner.calls).toBe(6);
    expect(p.breaker()).toEqual({ state: "closed", failures: 0, openUntil: null });
  });

  test("a failed half-open probe reopens the circuit; a success in between resets the count", async () => {
    jest.useFakeTimers();
    const e = new LlmError("server", "500", 500);
    const inner = scripted([e, e, e, e, ok(), e, e, e, e, e, e]);
    const p = withRetry(inner, { maxRetries: 0 });
    for (let i = 0; i < 5; i++) await p.chat(req).catch(() => {});
    expect(p.breaker().state).toBe("closed");
    for (let i = 0; i < 5; i++) await p.chat(req).catch(() => {});
    expect(p.breaker().state).toBe("open");
    jest.advanceTimersByTime(30_000);
    await p.chat(req).catch(() => {});
    expect(inner.calls).toBe(11);
    expect(p.breaker().state).toBe("open");
  });

  test("per-provider concurrency gate (default 4)", async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const inner = scripted([
      () =>
        new Promise<ChatResult>((resolve) => {
          active++;
          peak = Math.max(peak, active);
          releases.push(() => {
            active--;
            resolve(ok());
          });
        }),
    ]);
    const p = withRetry(inner);
    const runs = Array.from({ length: 7 }, () => p.chat(req));
    await flush();
    expect(p.inFlight()).toBe(4);
    expect(p.queued()).toBe(3);
    while (releases.length) {
      releases.shift()!();
      await flush();
    }
    await Promise.all(runs);
    expect(peak).toBe(4);
    expect(inner.calls).toBe(7);

    const ctl = new AbortController();
    const one = withRetry(scripted([() => new Promise<ChatResult>(() => {})]), { concurrency: 1 });
    void one.chat(req);
    const waiting = one.chat({ ...req, signal: ctl.signal }).catch((e) => e);
    await flush();
    expect(one.queued()).toBe(1);
    ctl.abort();
    expect(((await waiting) as LlmError).kind).toBe("aborted");
    expect(one.queued()).toBe(0);
  });
});
