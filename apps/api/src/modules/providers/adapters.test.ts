// Adapter contract tests with a mocked global fetch (no network, no DNS).
import { afterEach, describe, expect, test } from "bun:test";
import { createJevJudge } from "../../core/adapters/judge-jev";
import { buildAnthropicBody, createAnthropicChat, normalizeAnthropicUsage } from "../../core/adapters/llm-anthropic";
import { assertSafeUrl, createOpenAiChat, isBlockedAddress, normalizeOpenAiUsage, readSse, UnsafeUrlError, unsupportedParams, type LookupFn } from "../../core/adapters/llm-openai";
import { createFalMedia } from "../../core/adapters/media-fal";
import { createGeminiMedia } from "../../core/adapters/media-gemini";
import { createOpenAiMedia } from "../../core/adapters/media-openai";
import { createReplicateMedia } from "../../core/adapters/media-replicate";
import { LlmError, type ChatRequest } from "../../core/ports/llm";
import { REDACTED, registerSecret } from "../../lib/redact";

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
  form: FormData | null;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];

function mockFetch(handler: (c: Call, i: number) => Response | Promise<Response>): Call[] {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const c: Call = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
      form: init?.body instanceof FormData ? init.body : null,
    };
    calls.push(c);
    if (init?.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return handler(c, calls.length - 1);
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function sse(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

const local = { mode: "local" as const };
const KEY = "sk-test-openai-KEY-1234567890abcdef";

function openai(baseUrl = "https://api.openai.com/v1") {
  return createOpenAiChat({ id: "p1", baseUrl, apiKey: KEY, guard: local, label: "openai" });
}

const baseReq: ChatRequest = {
  model: "gpt-4o-mini",
  system: "You are the engineer cat.",
  messages: [
    { role: "user", content: [{ type: "text", text: "look" }, { type: "image", mime: "image/png", dataBase64: "AAAA" }] },
    { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "fs_read", arguments: '{"path":"a.ts"}' }] },
    { role: "tool", content: "file body", toolCallId: "call_1" },
  ],
  tools: [{ name: "fs_read", description: "read a file", parameters: { type: "object", properties: { path: { type: "string" } } } }],
  toolChoice: "auto",
  maxOutputTokens: 512,
  temperature: 0,
  cacheKey: "engineer:run1",
  responseFormat: "json",
};

describe("llm-openai", () => {
  test("request shape: system first, tools, tool calls, json mode, prompt_cache_key, max_completion_tokens", async () => {
    mockFetch(() =>
      json({
        model: "gpt-4o-mini-2024-07-18",
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 2000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 1536 } },
      }),
    );
    const r = await openai().chat(baseReq);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(c.method).toBe("POST");
    expect(c.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(c.body!);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0]).toEqual({ role: "system", content: "You are the engineer cat." });
    expect(body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
    expect(body.messages[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "fs_read", arguments: '{"path":"a.ts"}' } }],
    });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "file body" });
    expect(body.tools[0]).toEqual({ type: "function", function: { name: "fs_read", description: "read a file", parameters: baseReq.tools![0]!.parameters } });
    expect(body.tool_choice).toBe("auto");
    expect(body.max_completion_tokens).toBe(512);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.prompt_cache_key).toBe("engineer:run1");
    expect(body.stream).toBeUndefined();
    expect(r.text).toBe('{"ok":true}');
    expect(r.stopReason).toBe("end");
    expect(r.model).toBe("gpt-4o-mini-2024-07-18");
    expect(r.usage).toEqual({ inputTokens: 2000, outputTokens: 10, cachedTokens: 1536, cacheWriteTokens: 0 });
    expect(r.retries).toBe(0);
  });

  test("other vendors get max_tokens; tool call responses map to tool_use", async () => {
    mockFetch(() =>
      json({
        choices: [{ message: { content: null, tool_calls: [{ id: "c9", type: "function", function: { name: "fs_read", arguments: '{"path":"x"}' } }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 900, completion_tokens: 20, prompt_cache_hit_tokens: 640, prompt_cache_miss_tokens: 260 },
      }),
    );
    const r = await openai("https://api.deepseek.com/v1").chat({ ...baseReq, model: "deepseek-chat" });
    const body = JSON.parse(calls[0]!.body!);
    expect(body.max_tokens).toBe(512);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(r.stopReason).toBe("tool_use");
    expect(r.toolCalls).toEqual([{ id: "c9", name: "fs_read", arguments: '{"path":"x"}' }]);
    expect(r.usage.cachedTokens).toBe(640);
    expect(r.usage.inputTokens).toBe(900);
  });

  test("usage normalization covers OpenAI and DeepSeek shapes", () => {
    expect(normalizeOpenAiUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 64 } })).toEqual({
      inputTokens: 100,
      outputTokens: 5,
      cachedTokens: 64,
      cacheWriteTokens: 0,
    });
    expect(normalizeOpenAiUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 80 }).cachedTokens).toBe(80);
    expect(normalizeOpenAiUsage(null)).toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 });
  });

  test("streaming SSE: split chunks, text deltas, tool call deltas, final usage chunk", async () => {
    mockFetch(() =>
      sse([
        'data: {"model":"gpt-4o-mini","choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\r\n\r\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"fs_read","arguments":"{\\"pa"}}]}}]}\n',
        '\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":1}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        ': keep-alive\n\ndata: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":32}}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const deltas: string[] = [];
    const r = await openai().chat({ ...baseReq, responseFormat: "text", onDelta: (t) => deltas.push(t) });
    const body = JSON.parse(calls[0]!.body!);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(r.text).toBe("Hello");
    expect(r.toolCalls).toEqual([{ id: "call_a", name: "fs_read", arguments: '{"path":1}' }]);
    expect(r.stopReason).toBe("tool_use");
    expect(r.usage).toEqual({ inputTokens: 50, outputTokens: 7, cachedTokens: 32, cacheWriteTokens: 0 });
  });

  test("SSE reader keeps multi-line data and CR handling", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode("event: a\ndata: one\r"));
        c.enqueue(enc.encode("\ndata: two\n\nevent: b\ndata: x"));
        c.close();
      },
    });
    const out = [];
    for await (const ev of readSse(body)) out.push(ev);
    expect(out).toEqual([
      { event: "a", data: "one\ntwo" },
      { event: "b", data: "x" },
    ]);
  });

  const cases: Array<[string, number, unknown, Record<string, string>, string, number | null]> = [
    ["auth", 401, { error: { message: "Incorrect API key provided" } }, {}, "auth", null],
    ["quota", 429, { error: { message: "You exceeded your current quota", code: "insufficient_quota" } }, {}, "auth", null],
    ["rate limit", 429, { error: { message: "Rate limit reached" } }, { "retry-after": "2" }, "rate_limit", 2000],
    ["rate limit ms", 429, { error: { message: "slow" } }, { "retry-after-ms": "750" }, "rate_limit", 750],
    ["overloaded", 529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, {}, "overloaded", null],
    ["503", 503, "upstream unavailable", {}, "overloaded", null],
    ["context", 400, { error: { message: "This model's maximum context length is 128000 tokens", code: "context_length_exceeded" } }, {}, "context_length", null],
    ["bad request", 400, { error: { message: "Invalid value for 'messages'" } }, {}, "bad_request", null],
    ["not found", 404, { error: { message: "model not found" } }, {}, "not_found", null],
    ["server", 500, { error: { message: "boom" } }, {}, "server", null],
  ];
  for (const [name, status, body, headers, kind, retryAfter] of cases) {
    test(`error mapping: ${name} -> ${kind}`, async () => {
      mockFetch(() => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers }));
      const err = (await openai().chat({ ...baseReq, cacheKey: undefined }).catch((e) => e)) as LlmError;
      expect(err).toBeInstanceOf(LlmError);
      expect(err.kind).toBe(kind as LlmError["kind"]);
      expect(err.status).toBe(status);
      expect(err.retryAfterMs).toBe(retryAfter);
      expect(err.message).not.toContain(KEY);
    });
  }

  test("network, timeout and abort mapping", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
    expect(((await openai().chat(baseReq).catch((e) => e)) as LlmError).kind).toBe("network");
    const ctl = new AbortController();
    ctl.abort();
    mockFetch(() => json({}));
    expect(((await openai().chat({ ...baseReq, signal: ctl.signal }).catch((e) => e)) as LlmError).kind).toBe("aborted");
    globalThis.fetch = ((_u: string, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as typeof fetch;
    const slow = createOpenAiChat({ id: "p1", baseUrl: "https://api.openai.com/v1", apiKey: KEY, guard: local, timeoutMs: 20 });
    expect(((await slow.chat(baseReq).catch((e) => e)) as LlmError).kind).toBe("timeout");
  });

  test("self-heals once when a compatible vendor rejects prompt_cache_key, and remembers it", async () => {
    mockFetch((c) => {
      const body = JSON.parse(c.body!);
      if ("prompt_cache_key" in body) return json({ error: { message: "Unrecognized request argument supplied: prompt_cache_key" } }, 400);
      return json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    });
    const p = openai("https://api.mistral.ai/v1");
    expect((await p.chat(baseReq)).text).toBe("ok");
    expect(calls).toHaveLength(2);
    await p.chat(baseReq);
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[2]!.body!).prompt_cache_key).toBeUndefined();
  });

  const okChat = () => json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

  test("a JSON-mode value error is a bad_request and never turns JSON mode off", async () => {
    let first = true;
    mockFetch(() => {
      if (!first) return okChat();
      first = false;
      return json(
        {
          error: {
            message: "'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'.",
            type: "invalid_request_error",
            param: "messages",
            code: null,
          },
        },
        400,
      );
    });
    const p = openai();
    const err = (await p.chat(baseReq).catch((e) => e)) as LlmError;
    expect(err.kind).toBe("bad_request");
    expect(calls).toHaveLength(1);
    await p.chat(baseReq);
    expect(JSON.parse(calls[1]!.body!).response_format).toEqual({ type: "json_object" });
  });

  test("a max-tokens value error keeps the output cap on later calls", async () => {
    let first = true;
    mockFetch(() => {
      if (!first) return okChat();
      first = false;
      return json(
        {
          error: {
            message: "max_completion_tokens is too large: 200000. This model supports at most 16384 completion tokens, whereas you provided 200000.",
            type: "invalid_request_error",
            param: "max_completion_tokens",
            code: "invalid_value",
          },
        },
        400,
      );
    });
    const p = openai();
    expect(((await p.chat({ ...baseReq, maxOutputTokens: 200_000 }).catch((e) => e)) as LlmError).kind).toBe("bad_request");
    expect(calls).toHaveLength(1);
    await p.chat({ ...baseReq, maxOutputTokens: 150 });
    const body = JSON.parse(calls[1]!.body!);
    expect(body.max_completion_tokens).toBe(150);
  });

  test("an unsupported max-tokens field is renamed, never removed, and the rename is remembered", async () => {
    mockFetch((c) => {
      const body = JSON.parse(c.body!);
      if ("max_tokens" in body) {
        return json(
          {
            error: {
              message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
              type: "invalid_request_error",
              param: "max_tokens",
              code: "unsupported_parameter",
            },
          },
          400,
        );
      }
      return okChat();
    });
    const p = openai("https://gateway.example.com/v1");
    await p.chat({ ...baseReq, maxOutputTokens: 150 });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.body!).max_completion_tokens).toBe(150);
    await p.chat({ ...baseReq, maxOutputTokens: 150 });
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[2]!.body!)).toMatchObject({ max_completion_tokens: 150, response_format: { type: "json_object" } });
  });

  test("a vendor rejecting both max-tokens names fails instead of sending an uncapped request", async () => {
    mockFetch((c) => {
      const field = "max_tokens" in JSON.parse(c.body!) ? "max_tokens" : "max_completion_tokens";
      return json({ error: { message: `Unrecognized request argument supplied: ${field}` } }, 400);
    });
    const p = openai("https://gateway.example.com/v1");
    const err = (await p.chat({ ...baseReq, maxOutputTokens: 150 }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe("bad_request");
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const b = JSON.parse(c.body!);
      expect((b.max_tokens ?? b.max_completion_tokens) as number).toBe(150);
    }
  });

  test("an unsupported response_format is dropped for that call only", async () => {
    mockFetch((c) =>
      "response_format" in JSON.parse(c.body!) && calls.length === 1 ? json({ error: { message: "response_format is not supported by this model" } }, 400) : okChat(),
    );
    const p = openai("https://gateway.example.com/v1");
    await p.chat(baseReq);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.body!).response_format).toBeUndefined();
    await p.chat(baseReq);
    expect(JSON.parse(calls[2]!.body!).response_format).toEqual({ type: "json_object" });
  });

  test("unsupportedParams ignores fields listed as alternatives or named in value errors", () => {
    const sent = { prompt_cache_key: "k", temperature: 0, max_tokens: 5, response_format: {} };
    expect(unsupportedParams("unknown field `prompt_cache_key`, expected one of `model`, `messages`, `temperature`, `max_tokens`", sent)).toEqual(["prompt_cache_key"]);
    expect(unsupportedParams(JSON.stringify({ detail: [{ type: "extra_forbidden", loc: ["body", "prompt_cache_key"], msg: "Extra inputs are not permitted" }] }), sent)).toEqual(["prompt_cache_key"]);
    expect(unsupportedParams("temperature must be between 0 and 2", sent)).toEqual([]);
    expect(unsupportedParams("max_tokens is too large", sent)).toEqual([]);
    expect(unsupportedParams(JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0 with this model.", param: "temperature", code: "unsupported_value" } }), sent)).toEqual(["temperature"]);
    expect(unsupportedParams("Unsupported parameter: 'stream_options'", sent)).toEqual([]);
  });

  test("listModels reads data[] with context windows", async () => {
    mockFetch(() => json({ data: [{ id: "gpt-4o-mini" }, { id: "or/model", name: "Nice", context_length: 32000 }, { object: "x" }] }));
    const models = await openai().listModels();
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/models");
    expect(models).toEqual([{ id: "gpt-4o-mini" }, { id: "or/model", label: "Nice", contextWindow: 32000 }]);
  });
});

describe("base URL guard", () => {
  const publicDns: LookupFn = async () => [{ address: "104.18.6.192", family: 4 }];
  const privateDns: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.1.2.3", family: 4 }];
  const server = (lookup: LookupFn = publicDns) => ({ mode: "server" as const, lookup });

  test("classifies addresses", () => {
    for (const a of ["127.0.0.1", "10.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "2002:0a00:0001::1", "64:ff9b::a00:1"]) {
      expect([a, isBlockedAddress(a)]).toEqual([a, true]);
    }
    for (const a of ["8.8.8.8", "104.18.6.192", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect([a, isBlockedAddress(a)]).toEqual([a, false]);
    }
  });

  test("server mode blocks private targets, local presets, bad schemes and credentials", async () => {
    const bad: Array<[string, Parameters<typeof assertSafeUrl>[1]]> = [
      ["http://127.0.0.1:11434/v1", server()],
      ["http://[::1]:8080/v1", server()],
      ["http://169.254.169.254/latest", server()],
      ["http://localhost:1234/v1", server()],
      ["https://evil.example/v1", server(privateDns)],
      ["ftp://api.example.com", server()],
      ["https://user:pass@api.example.com/v1", server()],
      ["https://api.openai.com/v1", { mode: "server", localPreset: true, lookup: publicDns }],
      ["not a url", server()],
    ];
    for (const [url, opts] of bad) {
      const e = await assertSafeUrl(url, opts).then(() => null, (x) => x);
      expect([url, e instanceof UnsafeUrlError]).toEqual([url, true]);
    }
    expect((await assertSafeUrl("https://api.openai.com/v1", server())).host).toBe("api.openai.com");
  });

  test("server mode requires https even for public hosts; local mode publicOnly checks addresses", async () => {
    await expect(assertSafeUrl("http://api.example.com/v1", server())).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeUrl("http://127.0.0.1:8080/x.png", { mode: "local", publicOnly: true })).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeUrl("https://cdn.example.com/x.png", { mode: "local", publicOnly: true, lookup: privateDns })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect((await assertSafeUrl("http://cdn.example.com/x.png", { mode: "local", publicOnly: true, lookup: publicDns })).host).toBe("cdn.example.com");
  });

  test("local mode allows localhost (Ollama, LM Studio) but still only http(s)", async () => {
    expect((await assertSafeUrl("http://localhost:11434/v1", { mode: "local", localPreset: true })).port).toBe("11434");
    await expect(assertSafeUrl("file:///etc/passwd", { mode: "local" })).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  test("adapter refuses to send to a blocked host before any fetch", async () => {
    mockFetch(() => json({}));
    const p = createOpenAiChat({ id: "p", baseUrl: "http://10.0.0.8/v1", apiKey: KEY, guard: server() });
    const err = (await p.chat(baseReq).catch((e) => e)) as LlmError;
    expect(err.kind).toBe("bad_request");
    expect(calls).toHaveLength(0);
  });
});

describe("llm-anthropic", () => {
  const tools = [
    { name: "a", description: "a", parameters: { type: "object" } },
    { name: "b", description: "b", parameters: { type: "object" } },
  ];
  const countMarks = (body: unknown) => (JSON.stringify(body).match(/"cache_control"/g) ?? []).length;

  test("cache_control on system, last tool and flagged messages", () => {
    const { body, breakpoints } = buildAnthropicBody(
      {
        model: "claude-sonnet-5-5",
        system: "charter",
        cacheSystem: true,
        tools,
        messages: [
          { role: "user", content: "brief", cacheBreakpoint: true },
          { role: "assistant", content: "ok" },
          { role: "user", content: "task" },
        ],
      },
      false,
    );
    const b = body as any;
    expect(b.system).toEqual([{ type: "text", text: "charter", cache_control: { type: "ephemeral" } }]);
    expect(b.tools[0].cache_control).toBeUndefined();
    expect(b.tools[1].cache_control).toEqual({ type: "ephemeral" });
    expect(b.tools[1].input_schema).toEqual({ type: "object" });
    expect(b.messages[0].content[0]).toEqual({ type: "text", text: "brief", cache_control: { type: "ephemeral" } });
    expect(b.messages[2].content[0].cache_control).toBeUndefined();
    expect(b.max_tokens).toBe(8192);
    expect(breakpoints).toBe(3);
    expect(countMarks(body)).toBe(3);
  });

  test("never more than 4 breakpoints: keeps system and the latest message marks, drops the redundant tool mark", () => {
    const messages = [1, 2, 3, 4].flatMap((i) => [
      { role: "user" as const, content: `u${i}`, cacheBreakpoint: true },
      { role: "assistant" as const, content: `a${i}` },
    ]);
    const { body, breakpoints } = buildAnthropicBody({ model: "claude-haiku-4-5", system: "s", cacheSystem: true, tools, messages }, false);
    const b = body as any;
    expect(breakpoints).toBe(4);
    expect(countMarks(body)).toBe(4);
    expect(b.system[0].cache_control).toBeDefined();
    expect(b.tools[1].cache_control).toBeUndefined();
    expect(b.messages[0].content[0].cache_control).toBeUndefined();
    for (const i of [2, 4, 6]) expect(b.messages[i].content[0].cache_control).toEqual({ type: "ephemeral" });
    const noSystem = buildAnthropicBody({ model: "m", system: "", messages }, false);
    expect(noSystem.breakpoints).toBe(4);
  });

  test("tool calls and results translate to tool_use and merged tool_result blocks", () => {
    const { body } = buildAnthropicBody(
      {
        model: "m",
        system: "",
        messages: [
          { role: "user", content: "go" },
          { role: "assistant", content: "reading", toolCalls: [{ id: "t1", name: "a", arguments: '{"x":1}' }, { id: "t2", name: "b", arguments: "{}" }] },
          { role: "tool", content: "r1", toolCallId: "t1" },
          { role: "tool", content: "r2", toolCallId: "t2" },
        ],
        toolChoice: "required",
        tools,
      },
      false,
    );
    const b = body as any;
    expect(b.messages).toHaveLength(3);
    expect(b.messages[1].content).toEqual([
      { type: "text", text: "reading" },
      { type: "tool_use", id: "t1", name: "a", input: { x: 1 } },
      { type: "tool_use", id: "t2", name: "b", input: {} },
    ]);
    expect(b.messages[2].role).toBe("user");
    expect(b.messages[2].content.map((x: any) => x.tool_use_id)).toEqual(["t1", "t2"]);
    expect(b.tool_choice).toEqual({ type: "any" });
    expect(b.system).toBeUndefined();
  });

  test("usage: inputTokens is input + cache writes + cache reads", () => {
    expect(normalizeAnthropicUsage({ input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 200, cache_read_input_tokens: 1000 })).toEqual({
      inputTokens: 1300,
      outputTokens: 40,
      cachedTokens: 1000,
      cacheWriteTokens: 200,
    });
  });

  test("messages call: URL, headers, response parsing", async () => {
    mockFetch(() =>
      json({
        model: "claude-sonnet-5-5",
        content: [
          { type: "text", text: "Let me read." },
          { type: "tool_use", id: "toolu_1", name: "a", input: { x: 1 } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 2048 },
      }),
    );
    const p = createAnthropicChat({ id: "a1", baseUrl: "https://api.anthropic.com", apiKey: "sk-ant-api03-secretsecret", guard: local });
    const r = await p.chat({ model: "claude-sonnet-5-5", system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]!.headers.get("x-api-key")).toBe("sk-ant-api03-secretsecret");
    expect(calls[0]!.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(calls[0]!.headers.get("authorization")).toBeNull();
    expect(r.text).toBe("Let me read.");
    expect(r.toolCalls).toEqual([{ id: "toolu_1", name: "a", arguments: '{"x":1}' }]);
    expect(r.stopReason).toBe("tool_use");
    expect(r.usage).toEqual({ inputTokens: 2058, outputTokens: 5, cachedTokens: 2048, cacheWriteTokens: 0 });
  });

  test("streaming events and stream errors", async () => {
    mockFetch(() =>
      sse([
        'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-haiku-4-5","usage":{"input_tokens":12,"cache_read_input_tokens":3000,"cache_creation_input_tokens":0,"output_tokens":1}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi "}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"there"}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_9","name":"a","input":{}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"x\\":"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"2}"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":33}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    );
    const p = createAnthropicChat({ id: "a1", baseUrl: "https://api.anthropic.com/v1", apiKey: "k", guard: local });
    const deltas: string[] = [];
    const r = await p.chat({ model: "claude-haiku-4-5", system: "s", messages: [{ role: "user", content: "hi" }], onDelta: (t) => deltas.push(t) });
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(calls[0]!.body!).stream).toBe(true);
    expect(deltas.join("")).toBe("Hi there");
    expect(r.toolCalls).toEqual([{ id: "toolu_9", name: "a", arguments: '{"x":2}' }]);
    expect(r.usage).toEqual({ inputTokens: 3012, outputTokens: 33, cachedTokens: 3000, cacheWriteTokens: 0 });

    mockFetch(() => sse(['event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n']));
    const err = (await p.chat({ model: "m", system: "", messages: [{ role: "user", content: "x" }], onDelta: () => {} }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe("overloaded");
  });

  test("context overflow maps to context_length", async () => {
    mockFetch(() => json({ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 210000 tokens > 200000 maximum" } }, 400));
    const p = createAnthropicChat({ id: "a1", baseUrl: "https://api.anthropic.com", apiKey: "k", guard: local });
    expect(((await p.chat({ model: "m", system: "", messages: [{ role: "user", content: "x" }] }).catch((e) => e)) as LlmError).kind).toBe("context_length");
  });
});

describe("judge-jev", () => {
  const JEV_KEY = "jev-key-abcdefghijklmnop";
  const target = async () => ({ baseUrl: "https://api.typesafe.ai/v1", apiKey: JEV_KEY });
  const questions = {
    owner: { type: "choice" as const, instructions: "pick", criteria: { a: "A", b: "B" } },
    ok: { type: "noul" as const, instructions: "yes?" },
  };

  test("posts redacted state with the Bearer key and parses answers", async () => {
    const leaked = "sk-proj-abcdefghijklmnopqrstuvwxyz0123";
    registerSecret("super-secret-value-123");
    mockFetch(() => json({ verified: true, model: "jev-1.13.0", answers: { owner: { type: "choice", choice: "b", confidence: 0.8, probabilities: { a: 0.2, b: 0.8 } }, ok: { type: "noul", noul: 0.9 } } }));
    const judge = createJevJudge({ target, mode: "local" });
    const r = await judge.decide({ decisionId: "orch.route", state: { task: `use ${leaked}`, nested: { note: "super-secret-value-123", apiKey: "plain" } }, questions });
    const c = calls[0]!;
    expect(c.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(c.headers.get("authorization")).toBe(`Bearer ${JEV_KEY}`);
    const body = JSON.parse(c.body!);
    expect(body.model).toBe("jev-latest");
    expect(body.questions).toEqual(questions);
    expect(body.state.task).toBe(`use ${REDACTED}`);
    expect(body.state.nested).toEqual({ note: REDACTED, apiKey: REDACTED });
    expect(c.body).not.toContain(leaked);
    expect(r.verified).toBe(true);
    if (r.verified) {
      expect(r.model).toBe("jev-1.13.0");
      expect(r.answers.owner).toEqual({ type: "choice", choice: "b", confidence: 0.8, probabilities: { a: 0.2, b: 0.8 } });
      expect(r.answers.ok).toEqual({ type: "noul", noul: 0.9 });
    }
  });

  test("retries 429 and 529 only, then gives an unverified stamp on other failures", async () => {
    const slept: number[] = [];
    const sleep = async (ms: number) => {
      slept.push(ms);
    };
    mockFetch((_c, i) => (i === 0 ? json({}, 529) : i === 1 ? json({}, 429, { "retry-after": "1" }) : json({ answers: { ok: { noul: 0.7 } } })));
    const judge = createJevJudge({ target, mode: "local", sleep });
    const r = await judge.decide({ decisionId: "x", state: {}, questions });
    expect(calls).toHaveLength(3);
    expect(slept).toEqual([500, 1000]);
    expect(r.verified && r.answers.ok).toEqual({ type: "noul", noul: 0.7 });

    mockFetch(() => json({ error: { message: "boom" } }, 500));
    const bad = await createJevJudge({ target, mode: "local", sleep }).decide({ decisionId: "x", state: {}, questions });
    expect(calls).toHaveLength(1);
    expect(bad.verified).toBe(false);
    if (!bad.verified) {
      expect(bad.stamp).toBe("UNVERIFIED BY JEV");
      expect(bad.error).toContain("500");
    }
  });

  test("missing key, network failure and timeout never throw", async () => {
    const none = await createJevJudge({ target: async () => null, mode: "local" }).decide({ decisionId: "x", state: {}, questions });
    expect(none.verified).toBe(false);
    if (!none.verified) expect(none.error).toContain("not connected");
    expect(await createJevJudge({ target: async () => null, mode: "local" }).configured()).toBe(false);

    mockFetch(() => {
      throw new TypeError("connect ECONNREFUSED");
    });
    const net = await createJevJudge({ target, mode: "local" }).decide({ decisionId: "x", state: {}, questions });
    expect(net.verified).toBe(false);

    globalThis.fetch = ((_u: string, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as typeof fetch;
    const slow = await createJevJudge({ target, mode: "local", timeoutMs: 20 }).decide({ decisionId: "x", state: {}, questions });
    expect(slow.verified).toBe(false);
    if (!slow.verified) expect(slow.error).toContain("timed out");
  });
});

describe("media adapters", () => {
  // vendor-returned download URLs are DNS-checked in local mode too: resolve them to a public address, no network
  const publicDns: LookupFn = async () => [{ address: "104.18.6.192", family: 4 }];
  const cfg = { id: "m1", apiKey: "media-key-1234567890", mode: "local" as const, sleep: async () => {}, pollIntervalMs: 1, lookup: publicDns };

  test("openai images: b64_json output, gpt-image omits response_format", async () => {
    mockFetch(() => json({ data: [{ b64_json: b64(PNG) }], output_format: "png" }));
    const p = createOpenAiMedia({ ...cfg, baseUrl: "https://api.openai.com/v1" });
    const r = await p.generateImage!({ model: "gpt-image-1.5", prompt: "a cat", size: "1536x1024" });
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/generations");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer media-key-1234567890");
    const body = JSON.parse(calls[0]!.body!);
    expect(body).toEqual({ model: "gpt-image-1.5", prompt: "a cat", n: 1, size: "1536x1024" });
    expect(r.images[0]!.mime).toBe("image/png");
    expect(Array.from(r.images[0]!.data)).toEqual(Array.from(PNG));
    expect([r.images[0]!.width, r.images[0]!.height]).toEqual([1536, 1024]);

    mockFetch(() => json({ data: [{ b64_json: b64(PNG) }] }));
    await p.generateImage!({ model: "dall-e-3", prompt: "x" });
    expect(JSON.parse(calls[0]!.body!).response_format).toBe("b64_json");
  });

  test("openai video (sora): multipart job, poll, content download with key on the same host only", async () => {
    mockFetch((c) => {
      if (c.method === "POST") return json({ id: "video_abc", status: "queued" });
      if (c.url.endsWith("/videos/video_abc")) return json({ id: "video_abc", status: "completed", progress: 100, seconds: "8" });
      return new Response(MP4, { headers: { "content-type": "video/mp4" } });
    });
    const p = createOpenAiMedia({ ...cfg, baseUrl: "https://api.openai.com/v1" });
    const { jobId } = await p.startVideo!({ model: "sora-2", prompt: "cat", durationSec: 7, aspect: "9:16" });
    expect(jobId).toBe("video_abc");
    expect(calls[0]!.form!.get("seconds")).toBe("8");
    expect(calls[0]!.form!.get("size")).toBe("720x1280");
    const poll = await p.pollVideo!(jobId);
    expect(poll.status).toBe("done");
    expect(poll.video!.mime).toBe("video/mp4");
    expect(poll.video!.durationMs).toBe(8000);
    expect(calls[2]!.url).toBe("https://api.openai.com/v1/videos/video_abc/content");
    expect(calls[2]!.headers.get("authorization")).toBe("Bearer media-key-1234567890");
    await expect(p.pollVideo!("../../etc")).rejects.toBeInstanceOf(LlmError);
  });

  test("gemini: generateContent inlineData image, Veo long-running op with scoped key on download", async () => {
    mockFetch((c) => {
      if (c.url.endsWith(":generateContent")) return json({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: b64(PNG) } }] } }] });
      if (c.url.endsWith(":predictLongRunning")) return json({ name: "models/veo-3.1-generate-preview/operations/op123" });
      if (c.url.includes("/operations/op123")) return json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media" } }] } } });
      if (c.url.startsWith("https://generativelanguage.googleapis.com/v1beta/files/")) return new Response(null, { status: 302, headers: { location: "https://storage.example-cdn.com/v.mp4" } });
      return new Response(MP4, { headers: { "content-type": "video/mp4" } });
    });
    const p = createGeminiMedia({ ...cfg, baseUrl: "https://generativelanguage.googleapis.com/v1beta" });
    const img = await p.generateImage!({ model: "gemini-3.1-flash-image", prompt: "cat" });
    expect(calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect(calls[0]!.headers.get("x-goog-api-key")).toBe("media-key-1234567890");
    expect(JSON.parse(calls[0]!.body!).generationConfig.responseModalities).toContain("IMAGE");
    expect(img.images[0]!.mime).toBe("image/png");

    const { jobId } = await p.startVideo!({ model: "veo-3.1-generate-preview", prompt: "cat", aspect: "1:1", durationSec: 8 });
    expect(JSON.parse(calls[1]!.body!).parameters).toEqual({ aspectRatio: "16:9", durationSeconds: 8 });
    const poll = await p.pollVideo!(jobId);
    expect(poll.status).toBe("done");
    expect(Array.from(poll.video!.data)).toEqual(Array.from(MP4));
    const fileHop = calls.find((c) => c.url.includes("/files/f1"))!;
    const cdnHop = calls.find((c) => c.url.startsWith("https://storage.example-cdn.com"))!;
    expect(fileHop.headers.get("x-goog-api-key")).toBe("media-key-1234567890");
    expect(cdnHop.headers.get("x-goog-api-key")).toBeNull();
  });

  test("fal queue: submit, status, result, CDN download without the key", async () => {
    let polls = 0;
    mockFetch((c) => {
      if (c.method === "POST") return json({ request_id: "req-1" });
      if (c.url.endsWith("/status")) return json({ status: ++polls < 2 ? "IN_PROGRESS" : "COMPLETED" });
      if (c.url.endsWith("/requests/req-1")) return json({ images: [{ url: "https://v3.fal.media/files/cat.png", width: 1024, height: 1024 }] });
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    });
    const p = createFalMedia({ ...cfg, baseUrl: "https://queue.fal.run" });
    const r = await p.generateImage!({ model: "fal-ai/flux/dev", prompt: "cat" });
    expect(calls[0]!.url).toBe("https://queue.fal.run/fal-ai/flux/dev");
    expect(calls[0]!.headers.get("authorization")).toBe("Key media-key-1234567890");
    expect(calls[1]!.url).toBe("https://queue.fal.run/fal-ai/flux/requests/req-1/status");
    const cdn = calls.find((c) => c.url.startsWith("https://v3.fal.media"))!;
    expect(cdn.headers.get("authorization")).toBeNull();
    expect(r.images[0]!.mime).toBe("image/png");
    await expect(p.generateImage!({ model: "../x", prompt: "c" })).rejects.toBeInstanceOf(LlmError);
  });

  test("replicate: model predictions with Prefer wait, then polling to success", async () => {
    mockFetch((c) => {
      if (c.method === "POST") return json({ id: "abc123", status: "processing" });
      if (c.url.endsWith("/predictions/abc123")) return json({ id: "abc123", status: "succeeded", output: ["https://replicate.delivery/x/out.png"] });
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    });
    const p = createReplicateMedia({ ...cfg, baseUrl: "https://api.replicate.com/v1" });
    const r = await p.generateImage!({ model: "black-forest-labs/flux-schnell", prompt: "cat", size: "1024x1536" });
    expect(calls[0]!.url).toBe("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions");
    expect(calls[0]!.headers.get("prefer")).toBe("wait=60");
    expect(JSON.parse(calls[0]!.body!).input).toEqual({ prompt: "cat", aspect_ratio: "2:3", num_outputs: 1 });
    expect(r.images).toHaveLength(1);
    const dl = calls.find((c) => c.url.startsWith("https://replicate.delivery"))!;
    expect(dl.headers.get("authorization")).toBeNull();

    mockFetch(() => json({ id: "vid1", status: "starting" }));
    const v = await p.startVideo!({ model: "owner/video-model:abcdef1234567890", prompt: "cat" });
    expect(calls[0]!.url).toBe("https://api.replicate.com/v1/predictions");
    expect(JSON.parse(calls[0]!.body!).version).toBe("abcdef1234567890");
    mockFetch(() => json({ id: "vid1", status: "failed", error: "nsfw" }));
    expect(await p.pollVideo!(v.jobId)).toEqual({ status: "failed", error: "nsfw" });
  });

  test("local mode refuses vendor-returned loopback URLs but allows the provider's own local origin", async () => {
    mockFetch((c) => (c.method === "POST" ? json({ data: [{ url: "http://127.0.0.1:5000/admin/export.png" }] }) : new Response(PNG)));
    const vendor = createOpenAiMedia({ ...cfg, baseUrl: "https://api.example-images.com/v1" });
    const err = (await vendor.generateImage!({ model: "img-1", prompt: "x" }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe("bad_request");
    expect(calls.some((c) => c.url.includes("127.0.0.1"))).toBe(false);

    mockFetch((c) => (c.method === "POST" ? json({ data: [{ url: "http://localhost:8080/files/cat.png" }] }) : new Response(PNG)));
    const localServer = createOpenAiMedia({ ...cfg, baseUrl: "http://localhost:8080/v1" });
    const r = await localServer.generateImage!({ model: "img-1", prompt: "x" });
    expect(r.images[0]!.mime).toBe("image/png");
    expect(calls[1]!.url).toBe("http://localhost:8080/files/cat.png");
  });

  test("server mode refuses media downloads from private addresses", async () => {
    mockFetch((c) => (c.method === "POST" ? json({ id: "abc", status: "succeeded", output: ["http://169.254.169.254/latest/meta-data"] }) : new Response(PNG)));
    const p = createReplicateMedia({ ...cfg, mode: "server", lookup: async () => [{ address: "54.0.0.1", family: 4 }], baseUrl: "https://api.replicate.com/v1" });
    const err = (await p.generateImage!({ model: "a/b", prompt: "x" }).catch((e) => e)) as LlmError;
    expect(err.kind).toBe("bad_request");
    expect(calls.some((c) => c.url.includes("169.254"))).toBe(false);
  });
});
