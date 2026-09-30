// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Vendor refusal self-heals with a fake fetch: every known refusal gets one
// precise change, remembered per provider and model once accepted; the
// official OpenAI host moves reasoning models to the Responses API; a model
// that cannot call tools fails with one plain sentence; anything unknown
// stays a bad_request with the vendor text. The owner's per-tier reasoning
// effort maps to each vendor family and heals away when refused; vendor
// reasoning state (thinking blocks, reasoning_content, thought signatures)
// goes back with the tool calls it belongs to.
import { describe, expect, test } from "bun:test";
import { LlmError, type ChatRequest, type LlmProvider } from "../../core/ports/llm";
import { createAnthropicChat } from "../../core/adapters/llm-anthropic";
import { createOpenAiChat, type FetchFn } from "../../core/adapters/llm-openai";
import { buildResponsesBody, createResponsesStream, parseResponsesResult } from "../../core/adapters/llm-openai-responses";
import { cloneQuirks, createQuirkStore, diagnose, KNOWN_REFUSALS, refusalContext, type QuirkStore, type Wire } from "../../core/adapters/llm-quirks";

type Body = Record<string, any>;
interface Sent {
  url: string;
  path: string;
  body: Body;
}

const KEY = "sk-test-quirks-KEY-1234567890abcdef";
const BRIAN =
  "Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const refuse = (message: string, extra: Record<string, unknown> = {}, status = 400) =>
  json({ error: { message, type: "invalid_request_error", param: null, code: null, ...extra } }, status);
const okChat = (content = "ok") => json({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } });

function sse(events: unknown[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function fake(handler: (s: Sent, i: number) => Response) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    const s = { url: String(url), path: new URL(String(url)).pathname, body: init?.body ? (JSON.parse(String(init.body)) as Body) : {} };
    sent.push(s);
    return handler(s, sent.length - 1);
  }) as unknown as FetchFn;
  return { sent, fetch };
}

function openai(handler: (s: Sent, i: number) => Response, baseUrl = "https://gateway.example.com/v1", quirks?: QuirkStore) {
  const f = fake(handler);
  const p = createOpenAiChat({ id: "p1", baseUrl, apiKey: KEY, guard: { mode: "local" }, label: "vendor", fetch: f.fetch, quirks });
  return { p, sent: f.sent };
}

function anthropic(handler: (s: Sent, i: number) => Response) {
  const f = fake(handler);
  const p = createAnthropicChat({ id: "a1", baseUrl: "https://api.anthropic.com", apiKey: KEY, guard: { mode: "local" }, label: "anthropic", fetch: f.fetch });
  return { p, sent: f.sent };
}

const tool = { name: "fs_read", description: "read a file", parameters: { type: "object", properties: { path: { type: "string" } } } };

const req: ChatRequest = {
  model: "m-1",
  system: "You are the engineer cat.",
  messages: [
    { role: "user", content: [{ type: "text", text: "look" }, { type: "image", mime: "image/png", dataBase64: "AAAA" }] },
    { role: "assistant", content: "reading", toolCalls: [{ id: "call_1", name: "fs_read", arguments: '{"path":"a.ts"}' }] },
    { role: "tool", content: "file body", toolCallId: "call_1" },
  ],
  tools: [tool],
  toolChoice: "auto",
  maxOutputTokens: 512,
  temperature: 0,
  cacheKey: "run-1:engineer",
};

async function fails(p: LlmProvider, r: ChatRequest): Promise<LlmError> {
  const e = await p.chat(r).catch((x) => x);
  expect(e).toBeInstanceOf(LlmError);
  return e as LlmError;
}

// ------------------------------------------------------------ the table itself

describe("known refusal table", () => {
  const sentFor: Record<string, Body> = {
    "openai.reasoning_tools_responses": { tools: [{}] },
    reasoning_tools_effort_none: { tools: [{}] },
    reasoning_effort_value: { tools: [{}], reasoning_effort: "none" },
    reasoning_effort_owner_value: { reasoning_effort: "none" },
    reasoning_effort_unsupported: { tools: [{}], reasoning_effort: "none" },
    stream_refused: { stream: true },
    tools_unsupported: { tools: [{}] },
    system_role: { messages: [{ role: "system", content: "s" }] },
    temperature_one: { temperature: 0 },
    temperature_unsupported: { temperature: 0 },
    top_p: { temperature: 0, top_p: 0.9 },
    tool_choice: { tools: [{}], tool_choice: { type: "any" } },
    parallel_tool_calls: { tools: [{}], parallel_tool_calls: true },
    assistant_prefill: { messages: [] },
    echo_refused: { messages: [{ role: "assistant", content: null, reasoning_content: "thinking", tool_calls: [{ id: "c1" }] }] },
    "anthropic.thinking_block_missing": { thinking: { type: "enabled", budget_tokens: 2048 } },
    "anthropic.thinking_budget": { thinking: { type: "enabled", budget_tokens: 2048 } },
    "anthropic.thinking_adaptive": { thinking: { type: "enabled", budget_tokens: 2048 } },
    "anthropic.thinking_unsupported": { thinking: { type: "enabled", budget_tokens: 2048 } },
  };

  test("every rule answers the real vendor message it was written against", () => {
    for (const rule of KNOWN_REFUSALS) {
      const wire: Wire = rule.wires[0]!;
      const q = cloneQuirks(undefined);
      if (rule.id.startsWith("reasoning_effort_")) q.reasoningEffort = "none";
      // the official-host rule would claim Brian's message first; the gateway rule is checked off that host
      const official = rule.id !== "reasoning_tools_effort_none";
      const sent = sentFor[rule.id] ?? {};
      const out = diagnose(refusalContext({ status: 400, text: rule.example, sent, wire, hasTools: "tools" in sent, official }), q);
      if (rule.id === "tools_unsupported") expect(out).toBe("tools_unsupported");
      else expect(out as string[]).toContain(rule.id);
    }
  });

  test("the JSON-word requirement and value errors match nothing", () => {
    const sent = { temperature: 0, tools: [{}], tool_choice: "auto", response_format: {}, messages: [{ role: "system" }] };
    for (const text of [
      "'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'.",
      "temperature must be between 0 and 2",
      "max_tokens is too large",
      "Invalid 'messages[2].tool_calls[0].id': string too long. Expected a string with maximum length 40.",
    ]) {
      expect(diagnose(refusalContext({ status: 400, text, sent, wire: "chat", hasTools: true, official: false }), cloneQuirks(undefined))).toEqual([]);
    }
  });

  test("the quirk store keeps only the sticky part and stays bounded", () => {
    const store = createQuirkStore(2);
    const q = cloneQuirks(undefined);
    q.jsonOff = true;
    q.fieldSwapped = true;
    q.drop.add("temperature");
    store.set("a", q);
    expect(store.get("a")).toEqual({ drop: new Set(["temperature"]) });
    store.set("b", q);
    store.set("c", q);
    expect(store.get("a")).toBeUndefined();
    expect(store.get("c")).toBeDefined();
  });
});

// ------------------------------------------------------------ OpenAI official: Responses path

describe("OpenAI official host: Responses API for reasoning models that refuse tools", () => {
  const OFFICIAL = "https://api.openai.com/v1";
  const luna: ChatRequest = { ...req, model: "gpt-6-luna", responseFormat: "json" };
  const responsesOk = () =>
    json({
      id: "resp_1",
      model: "gpt-6-luna-2026-08-01",
      status: "completed",
      output: [
        { type: "reasoning", id: "rs_1", summary: [] },
        { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Reading the next file.", annotations: [] }] },
        { type: "function_call", id: "fc_1", call_id: "call_2", name: "fs_read", arguments: '{"path":"b.ts"}', status: "completed" },
      ],
      usage: { input_tokens: 2000, input_tokens_details: { cached_tokens: 1536 }, output_tokens: 90, output_tokens_details: { reasoning_tokens: 64 } },
    });

  test("Brian's exact refusal moves the call to /v1/responses with reasoning on; messages, tools, results, cap and usage map; remembered per model", async () => {
    const { p, sent } = openai((s) => {
      if (s.path.endsWith("/chat/completions")) return s.body.tools ? refuse(BRIAN) : okChat();
      // reasoning models refuse temperature on the Responses API too: healed on that path
      if ("temperature" in s.body) return refuse("Unsupported parameter: 'temperature' is not supported with this model.", { param: "temperature", code: "unsupported_parameter" });
      return responsesOk();
    }, OFFICIAL);
    const r = await p.chat(luna);
    expect(sent.map((s) => s.path)).toEqual(["/v1/chat/completions", "/v1/responses", "/v1/responses"]);
    const b = sent[2]!.body;
    expect(b.model).toBe("gpt-6-luna");
    expect(b.instructions).toBe("You are the engineer cat.");
    expect(b.store).toBe(false);
    expect(b.reasoning).toBeUndefined();
    expect(b.reasoning_effort).toBeUndefined();
    expect(b.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "look" }, { type: "input_image", image_url: "data:image/png;base64,AAAA" }] },
      { role: "assistant", content: "reading" },
      { type: "function_call", call_id: "call_1", name: "fs_read", arguments: '{"path":"a.ts"}' },
      { type: "function_call_output", call_id: "call_1", output: "file body" },
    ]);
    expect(b.tools).toEqual([{ type: "function", name: "fs_read", description: "read a file", parameters: tool.parameters, strict: false }]);
    expect(b.tool_choice).toBe("auto");
    expect(b.max_output_tokens).toBe(512);
    expect(b.max_completion_tokens).toBeUndefined();
    expect(b.text).toEqual({ format: { type: "json_object" } });
    expect(b.prompt_cache_key).toBe("run-1:engineer");
    expect(b.temperature).toBeUndefined();
    expect(r.text).toBe("Reading the next file.");
    expect(r.toolCalls).toEqual([{ id: "call_2", name: "fs_read", arguments: '{"path":"b.ts"}' }]);
    expect(r.stopReason).toBe("tool_use");
    expect(r.model).toBe("gpt-6-luna-2026-08-01");
    expect(r.usage).toEqual({ inputTokens: 2000, outputTokens: 90, cachedTokens: 1536, cacheWriteTokens: 0 });

    // remembered: the next tool call goes straight to the Responses API, temperature already off
    await p.chat(luna);
    expect(sent.slice(3).map((s) => s.path)).toEqual(["/v1/responses"]);
    expect(sent[3]!.body.temperature).toBeUndefined();
    // a call without tools stays on Chat Completions, and another model is untouched
    await p.chat({ ...luna, tools: undefined });
    expect(sent[4]!.path).toBe("/v1/chat/completions");
    await p.chat({ ...req, model: "gpt-4o-mini", tools: undefined });
    expect(sent[5]!.path).toBe("/v1/chat/completions");
  });

  test("streaming on the Responses API: text deltas, function call argument deltas, usage with cached tokens", async () => {
    const events = [
      { type: "response.created", response: { id: "resp_2", model: "gpt-6-luna", status: "in_progress" } },
      { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_1" } },
      { type: "response.output_item.added", output_index: 1, item: { type: "message", id: "msg_1", role: "assistant", content: [] } },
      { type: "response.output_text.delta", item_id: "msg_1", output_index: 1, content_index: 0, delta: "Hel" },
      { type: "response.output_text.delta", item_id: "msg_1", output_index: 1, content_index: 0, delta: "lo" },
      { type: "response.output_item.added", output_index: 2, item: { type: "function_call", id: "fc_9", call_id: "call_9", name: "fs_read", arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_9", output_index: 2, delta: '{"path":' },
      { type: "response.function_call_arguments.delta", item_id: "fc_9", output_index: 2, delta: '"c.ts"}' },
      { type: "response.function_call_arguments.done", item_id: "fc_9", output_index: 2, arguments: '{"path":"c.ts"}' },
      {
        type: "response.completed",
        response: { id: "resp_2", model: "gpt-6-luna", status: "completed", output: [], usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 512 }, output_tokens: 40 } },
      },
    ];
    const store = createQuirkStore();
    store.set("gpt-6-luna", { drop: new Set(["temperature"]), responses: true });
    const { p, sent } = openai((s) => (s.path.endsWith("/responses") ? sse(events) : refuse(BRIAN)), OFFICIAL, store);
    const deltas: string[] = [];
    const r = await p.chat({ ...luna, onDelta: (t) => deltas.push(t) });
    expect(sent.map((s) => s.path)).toEqual(["/v1/responses"]);
    expect(sent[0]!.body.stream).toBe(true);
    expect(sent[0]!.body.stream_options).toBeUndefined();
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(r.text).toBe("Hello");
    expect(r.toolCalls).toEqual([{ id: "call_9", name: "fs_read", arguments: '{"path":"c.ts"}' }]);
    expect(r.stopReason).toBe("tool_use");
    expect(r.usage).toEqual({ inputTokens: 900, outputTokens: 40, cachedTokens: 512, cacheWriteTokens: 0 });
  });

  test("an output cap hit on the Responses API is a length stop; a failed stream is a mapped error", async () => {
    const out = parseResponsesResult({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }, "m");
    expect(out.stopReason).toBe("length");
    const acc = createResponsesStream("m");
    const step = acc.push("response.failed", { response: { error: { code: "rate_limit_exceeded", message: "Rate limit reached" } } });
    expect(step && step !== "done" ? step.error.status : 0).toBe(429);
    const body = buildResponsesBody({ ...req, parallelToolCalls: false, topP: 0.5 }, { stream: false, quirks: cloneQuirks({ drop: new Set(["top_p"]), temperatureOne: true }) });
    expect(body).toMatchObject({ parallel_tool_calls: false, temperature: 1 });
    expect(body.top_p).toBeUndefined();
  });

  test("when the Responses path fails, the call falls back to reasoning_effort none on Chat Completions, remembered", async () => {
    const { p, sent } = openai((s) => {
      if (s.path.endsWith("/responses")) return refuse("The model `gpt-6-luna` does not exist or you do not have access to it.", { code: "model_not_found" }, 404);
      return s.body.reasoning_effort === "none" ? okChat("fallback") : refuse(BRIAN);
    }, OFFICIAL);
    expect((await p.chat(luna)).text).toBe("fallback");
    expect(sent.map((s) => s.path)).toEqual(["/v1/chat/completions", "/v1/responses", "/v1/chat/completions"]);
    expect(sent[2]!.body.reasoning_effort).toBe("none");
    await p.chat(luna);
    expect(sent.slice(3).map((s) => [s.path, s.body.reasoning_effort])).toEqual([["/v1/chat/completions", "none"]]);
  });

  test("a rate limit on the Responses path is thrown as is and nothing is remembered", async () => {
    let limited = true;
    const { p, sent } = openai((s) => {
      if (s.path.endsWith("/responses")) return limited ? json({ error: { message: "Rate limit reached", code: "rate_limit_exceeded" } }, 429) : responsesOk();
      return refuse(BRIAN);
    }, OFFICIAL);
    expect((await fails(p, luna)).kind).toBe("rate_limit");
    limited = false;
    await p.chat(luna);
    // started from Chat Completions again: the switch was never confirmed
    expect(sent.map((s) => s.path)).toEqual(["/v1/chat/completions", "/v1/responses", "/v1/chat/completions", "/v1/responses"]);
  });
});

// ------------------------------------------------------------ OpenAI-compatible heals

describe("OpenAI-compatible vendors: one precise heal per known refusal", () => {
  test("temperature: only the default (1) allowed pins it to 1, remembered", async () => {
    const { p, sent } = openai((s) =>
      s.body.temperature === 1
        ? okChat()
        : refuse("Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.", { param: "temperature", code: "unsupported_value" }),
    );
    await p.chat(req);
    expect(sent.map((s) => s.body.temperature)).toEqual([0, 1]);
    await p.chat(req);
    expect(sent[2]!.body.temperature).toBe(1);
  });

  test("temperature: Moonshot's 'only 1 is allowed' shape pins it to 1", async () => {
    const { p, sent } = openai((s) => (s.body.temperature === 1 ? okChat() : refuse("invalid temperature: only 1 is allowed for this model")), "https://api.moonshot.ai/v1");
    await p.chat({ ...req, model: "kimi-k2-thinking" });
    expect(sent.map((s) => s.body.temperature)).toEqual([0, 1]);
  });

  test("temperature and top_p refused as parameters are dropped, remembered", async () => {
    const { p, sent } = openai((s) => {
      if ("temperature" in s.body) return refuse("Unsupported parameter: 'temperature' is not supported with this model.", { param: "temperature", code: "unsupported_parameter" });
      if ("top_p" in s.body) return refuse("Unsupported parameter: 'top_p' is not supported with this model.", { param: "top_p", code: "unsupported_parameter" });
      return okChat();
    });
    await p.chat({ ...req, topP: 0.9 });
    expect(sent).toHaveLength(3);
    await p.chat({ ...req, topP: 0.9 });
    expect(sent).toHaveLength(4);
    expect(sent[3]!.body.temperature).toBeUndefined();
    expect(sent[3]!.body.top_p).toBeUndefined();
  });

  test("system role: developer on the official host, then folded into the first user turn when developer is refused too", async () => {
    const { p, sent } = openai((s) => {
      const role = s.body.messages[0].role;
      if (role === "system") return refuse("Unsupported value: 'messages[0].role' does not support 'system' with this model.", { param: "messages[0].role", code: "unsupported_value" });
      if (role === "developer") return refuse("Unsupported value: 'messages[0].role' does not support 'developer' with this model.", { param: "messages[0].role", code: "unsupported_value" });
      return okChat();
    }, "https://api.openai.com/v1");
    await p.chat({ ...req, tools: undefined, messages: [{ role: "user", content: "hi" }] });
    expect(sent.map((s) => s.body.messages[0].role)).toEqual(["system", "developer", "user"]);
    expect(sent[2]!.body.messages[0].content).toBe("You are the engineer cat.\n\nhi");
    expect(sent[2]!.body.messages).toHaveLength(1);
    await p.chat({ ...req, tools: undefined, messages: [{ role: "user", content: "again" }] });
    expect(sent[3]!.body.messages[0]).toEqual({ role: "user", content: "You are the engineer cat.\n\nagain" });
  });

  test("system role: Gemini's gemma refusal folds the system prompt into the first user turn, keeping image parts", async () => {
    const { p, sent } = openai(
      (s) => (s.body.messages[0].role === "user" ? okChat() : json([{ error: { code: 400, message: "Developer instruction is not enabled for models/gemma-3-27b-it", status: "INVALID_ARGUMENT" } }], 400)),
      "https://generativelanguage.googleapis.com/v1beta/openai",
    );
    await p.chat({ ...req, model: "gemma-3-27b-it", tools: undefined });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.messages[0].content[0]).toEqual({ type: "text", text: "You are the engineer cat." });
    expect(sent[1]!.body.messages[0].content[1]).toEqual({ type: "text", text: "look" });
  });

  test("tool_choice and parallel_tool_calls refused are dropped, remembered", async () => {
    const { p, sent } = openai((s) => {
      if ("tool_choice" in s.body) return refuse("Unsupported parameter: 'tool_choice' is not supported with this model.", { param: "tool_choice", code: "unsupported_parameter" });
      if ("parallel_tool_calls" in s.body) return refuse("Unsupported parameter: 'parallel_tool_calls' is not supported with this model.", { param: "parallel_tool_calls", code: "unsupported_parameter" });
      return okChat();
    });
    const r = { ...req, toolChoice: "required" as const, parallelToolCalls: false };
    await p.chat(r);
    expect(sent).toHaveLength(3);
    expect(sent[2]!.body.tools).toHaveLength(1);
    await p.chat(r);
    expect(sent).toHaveLength(4);
    expect(sent[3]!.body.tool_choice).toBeUndefined();
    expect(sent[3]!.body.parallel_tool_calls).toBeUndefined();
  });

  test("reasoning_effort 'none' refused as a value falls to the lowest effort the vendor lists", async () => {
    const { p, sent } = openai((s) => {
      if (!s.body.reasoning_effort) return refuse(BRIAN);
      if (s.body.reasoning_effort === "none") {
        return refuse("Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: 'minimal', 'low', 'medium', and 'high'.", {
          param: "reasoning_effort",
          code: "unsupported_value",
        });
      }
      return okChat();
    });
    await p.chat({ ...req, model: "gpt-6-luna" });
    expect(sent.map((s) => s.body.reasoning_effort)).toEqual([undefined, "none", "minimal"]);
    await p.chat({ ...req, model: "gpt-6-luna" });
    expect(sent[3]!.body.reasoning_effort).toBe("minimal");
  });

  test("a model that refuses tools while reasoning and refuses reasoning_effort too cannot run a cat", async () => {
    const { p, sent } = openai((s) => ("reasoning_effort" in s.body ? refuse("Unrecognized request argument supplied: reasoning_effort") : refuse(BRIAN)));
    const e = await fails(p, { ...req, model: "odd-model" });
    expect(e.code).toBe("tools_unsupported");
    expect(e.message).toBe("vendor: odd-model cannot call tools; pick another model for the crew");
    expect(sent).toHaveLength(3);
  });

  test("streaming refused for an unverified organization: one answer, delivered whole, remembered", async () => {
    const { p, sent } = openai(
      (s) =>
        s.body.stream
          ? refuse(
              "Your organization must be verified to stream this model. Please go to: https://platform.openai.com/settings/organization/general and click on Verify Organization. If you just verified, it can take up to 15 minutes for access to propagate.",
              { param: "stream", code: "unsupported_value" },
            )
          : okChat("whole answer"),
      "https://api.openai.com/v1",
    );
    const deltas: string[] = [];
    const r = await p.chat({ ...req, model: "o3", tools: undefined, onDelta: (t) => deltas.push(t) });
    expect(r.text).toBe("whole answer");
    expect(deltas).toEqual(["whole answer"]);
    expect(sent[1]!.body.stream).toBeUndefined();
    expect(sent[1]!.body.stream_options).toBeUndefined();
    await p.chat({ ...req, model: "o3", tools: undefined, onDelta: () => {} });
    expect(sent).toHaveLength(3);
    expect(sent[2]!.body.stream).toBeUndefined();
  });

  test("a model that cannot call tools fails with the plain sentence in every vendor's words, then fails fast", async () => {
    const shapes: Array<[string, () => Response]> = [
      ["ollama", () => json({ error: { message: "registry.ollama.ai/library/gemma2:latest does not support tools", type: "api_error", param: null, code: null } }, 400)],
      ["openrouter", () => json({ error: { message: "No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing", code: 404 } }, 404)],
      ["gemini", () => json([{ error: { code: 400, message: "Function calling is not enabled for models/gemma-3-27b-it", status: "INVALID_ARGUMENT" } }], 400)],
      ["vllm", () => json({ object: "error", message: '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set', type: "BadRequestError", param: null, code: 400 }, 400)],
      ["openai-legacy", () => refuse("Unsupported parameter: 'tools' is not supported with this model.", { param: "tools", code: "unsupported_parameter" })],
      ["deepseek", () => refuse("deepseek-reasoner does not support Function Calling")],
      ["mistral", () => refuse("Function calling is not enabled for this model")],
    ];
    for (const [name, res] of shapes) {
      const { p, sent } = openai((s) => (s.body.tools ? res() : okChat("plain")));
      const e = await fails(p, { ...req, model: `${name}-model` });
      expect(e.kind).toBe("bad_request");
      expect(e.code).toBe("tools_unsupported");
      expect(e.message).toBe(`vendor: ${name}-model cannot call tools; pick another model for the crew`);
      expect(sent).toHaveLength(1);
      // remembered: no request is spent on the next tool call, plain chat still works
      expect((await fails(p, { ...req, model: `${name}-model` })).code).toBe("tools_unsupported");
      expect(sent).toHaveLength(1);
      expect((await p.chat({ ...req, model: `${name}-model`, tools: undefined })).text).toBe("plain");
    }
  });

  test("an unknown refusal stays a bad_request carrying the vendor text, and nothing is remembered", async () => {
    const text = "Invalid 'messages[2].tool_calls[0].id': string too long. Expected a string with maximum length 40, but got a string with length 64 instead.";
    const { p, sent } = openai((_s, i) => (i === 0 ? refuse(text, { param: "messages[2].tool_calls[0].id", code: "string_above_max_length" }) : okChat()));
    const e = await fails(p, req);
    expect(e.kind).toBe("bad_request");
    expect(e.code).toBeNull();
    expect(e.message).toContain("string too long");
    expect(sent).toHaveLength(1);
    await p.chat(req);
    expect(sent[1]!.body).toMatchObject({ temperature: 0, tool_choice: "auto", prompt_cache_key: "run-1:engineer" });
  });

  test("heals are remembered per provider: a shared store carries them to another adapter for the same row", async () => {
    const store = createQuirkStore();
    const handler = (s: Sent) =>
      "tool_choice" in s.body ? refuse("Unsupported parameter: 'tool_choice' is not supported with this model.", { param: "tool_choice", code: "unsupported_parameter" }) : okChat();
    const a = openai(handler, "https://gateway.example.com/v1", store);
    await a.p.chat(req);
    expect(a.sent).toHaveLength(2);
    const b = openai(handler, "https://gateway.example.com/v1", store);
    await b.p.chat(req);
    expect(b.sent).toHaveLength(1);
    // a separate provider (its own store) learns on its own
    const c = openai(handler);
    await c.p.chat(req);
    expect(c.sent).toHaveLength(2);
  });
});

// ------------------------------------------------------------ Anthropic heals

describe("Anthropic Messages: thinking rules and other known refusals", () => {
  const areq: ChatRequest = { ...req, model: "claude-x", messages: [{ role: "user", content: "hi" }], toolChoice: "required" };
  const okMsg = () => json({ model: "claude-x", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 1 } });
  const anthErr = (message: string, status = 400) => json({ type: "error", error: { type: "invalid_request_error", message } }, status);

  test("temperature must be 1 with thinking: pinned to 1, remembered", async () => {
    const { p, sent } = anthropic((s) => (s.body.temperature === 1 ? okMsg() : anthErr("`temperature` may only be set to 1 when thinking is enabled or in adaptive mode.")));
    await p.chat(areq);
    expect(sent.map((s) => s.body.temperature)).toEqual([0, 1]);
    await p.chat(areq);
    expect(sent[2]!.body.temperature).toBe(1);
  });

  test("temperature and top_p together: top_p dropped", async () => {
    const { p, sent } = anthropic((s) => ("top_p" in s.body ? anthErr("`temperature` and `top_p` cannot both be specified for this model. Please use only one.") : okMsg()));
    await p.chat({ ...areq, topP: 0.9 });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.temperature).toBe(0);
    expect(sent[1]!.body.top_p).toBeUndefined();
  });

  test("a forced tool_choice with thinking: tool_choice dropped, tools kept", async () => {
    const { p, sent } = anthropic((s) => ("tool_choice" in s.body ? anthErr("Thinking may not be enabled when tool_choice forces tool use.") : okMsg()));
    await p.chat(areq);
    expect(sent[0]!.body.tool_choice).toEqual({ type: "any" });
    expect(sent[1]!.body.tool_choice).toBeUndefined();
    expect(sent[1]!.body.tools).toHaveLength(1);
  });

  test("no assistant prefill: the conversation ends on a user turn", async () => {
    const { p, sent } = anthropic((s) =>
      s.body.messages.at(-1).role === "assistant" ? anthErr("This model does not support assistant message prefill. The conversation must end with a user message.") : okMsg(),
    );
    await p.chat({ ...areq, tools: undefined, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "Sure," }] });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.messages.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: "Continue." }] });
  });

  test("a proxy model without tools fails with the plain sentence; unknown errors keep the vendor text", async () => {
    const { p } = anthropic((s) => (s.body.tools ? anthErr("tools are not supported for this model") : anthErr("messages: roles must alternate")));
    const e = await fails(p, areq);
    expect(e.code).toBe("tools_unsupported");
    expect(e.message).toBe("anthropic: claude-x cannot call tools; pick another model for the crew");
    const u = await fails(p, { ...areq, tools: undefined });
    expect(u.kind).toBe("bad_request");
    expect(u.message).toContain("roles must alternate");
  });
});

// ------------------------------------------------------------ per-tier reasoning effort

describe("reasoning effort per tier: OpenAI and compatible vendors", () => {
  const plain: ChatRequest = { model: "r-1", system: "s", messages: [{ role: "user", content: "go" }], maxOutputTokens: 256 };

  test("default and missing send nothing; none, low, medium and high become reasoning_effort", async () => {
    const { p, sent } = openai(() => okChat());
    for (const reasoning of [undefined, "default", "none", "low", "medium", "high"] as const) await p.chat({ ...plain, ...(reasoning ? { reasoning } : {}) });
    expect(sent.map((s) => s.body.reasoning_effort)).toEqual([undefined, undefined, "none", "low", "medium", "high"]);
    expect(sent.every((s) => !("reasoning" in s.body))).toBe(true);
  });

  test("a model without a reasoning setting refuses the field: dropped, remembered, never a failed run", async () => {
    const { p, sent } = openai((s) =>
      "reasoning_effort" in s.body
        ? refuse("Unsupported parameter: 'reasoning_effort' is not supported with this model.", { param: "reasoning_effort", code: "unsupported_parameter" })
        : okChat(),
    );
    expect((await p.chat({ ...plain, reasoning: "high" })).text).toBe("ok");
    expect(sent.map((s) => s.body.reasoning_effort)).toEqual(["high", undefined]);
    await p.chat({ ...plain, reasoning: "low" });
    expect(sent).toHaveLength(3);
    expect(sent[2]!.body.reasoning_effort).toBeUndefined();
  });

  test("xAI's camelCase refusal of the field is the same heal", async () => {
    const { p, sent } = openai((s) =>
      "reasoning_effort" in s.body ? json({ code: "Client specified an invalid argument", error: "Argument not supported on this model: reasoningEffort" }, 400) : okChat(),
    );
    await p.chat({ ...plain, reasoning: "medium" });
    expect(sent.map((s) => s.body.reasoning_effort)).toEqual(["medium", undefined]);
  });

  test("Mistral's extra_forbidden shape for the field is the same heal", async () => {
    const mistral = {
      object: "error",
      message: { detail: [{ type: "extra_forbidden", loc: ["body", "reasoning_effort"], msg: "Extra inputs are not permitted", input: "high" }] },
      type: "invalid_request_message_error",
      param: null,
      code: null,
    };
    const { p, sent } = openai((s) => ("reasoning_effort" in s.body ? json(mistral, 422) : okChat()));
    await p.chat({ ...plain, reasoning: "high" });
    expect(sent.map((s) => s.body.reasoning_effort)).toEqual(["high", undefined]);
  });

  test("a refused value becomes the nearest one the vendor lists, per owner effort, remembered", async () => {
    const { p, sent } = openai((s) =>
      s.body.reasoning_effort === "none"
        ? refuse("Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: 'minimal', 'low', 'medium', and 'high'.", {
            param: "reasoning_effort",
            code: "unsupported_value",
          })
        : okChat(),
    );
    await p.chat({ ...plain, reasoning: "none" });
    expect(sent.map((s) => s.body.reasoning_effort)).toEqual(["none", "minimal"]);
    await p.chat({ ...plain, reasoning: "none" });
    await p.chat({ ...plain, reasoning: "high" });
    expect(sent.slice(2).map((s) => s.body.reasoning_effort)).toEqual(["minimal", "high"]);
  });

  test("a value between two listed ones goes to the cheaper side", async () => {
    const { p, sent } = openai((s) => (s.body.reasoning_effort === "medium" ? refuse("Invalid reasoning effort: reasoning_effort must be one of: low, high") : okChat()));
    await p.chat({ ...plain, reasoning: "medium" });
    expect(sent.map((s) => s.body.reasoning_effort)).toEqual(["medium", "low"]);
  });

  test("Gemini's thinking-only models refuse none: the lowest effort instead", async () => {
    const { p, sent } = openai((s) =>
      s.body.reasoning_effort === "none"
        ? json([{ error: { code: 400, message: "Budget 0 is invalid. This model only works in thinking mode.", status: "INVALID_ARGUMENT" } }], 400)
        : okChat(),
    );
    await p.chat({ ...plain, reasoning: "none" });
    expect(sent.map((s) => s.body.reasoning_effort)).toEqual(["none", "low"]);
  });

  test("a value refused with nothing usable listed is dropped", async () => {
    const { p, sent } = openai((s) =>
      "reasoning_effort" in s.body ? refuse("Unsupported value: 'reasoning_effort' does not support 'low' with this model.", { param: "reasoning_effort" }) : okChat(),
    );
    await p.chat({ ...plain, reasoning: "low" });
    expect(sent.map((s) => s.body.reasoning_effort)).toEqual(["low", undefined]);
  });

  test("off the official host, a tool call that needs reasoning down uses none while other calls keep the owner's effort", async () => {
    const { p, sent } = openai((s) => (s.body.tools && s.body.reasoning_effort !== "none" ? refuse(BRIAN) : okChat()));
    await p.chat({ ...req, model: "gpt-6-luna", reasoning: "high" });
    expect(sent.map((s) => s.body.reasoning_effort)).toEqual(["high", "none"]);
    await p.chat({ ...plain, model: "gpt-6-luna", reasoning: "high" });
    expect(sent[2]!.body.reasoning_effort).toBe("high");
  });

  test("on the official host the Responses path carries the owner's effort as reasoning.effort, healed there too", async () => {
    const { p, sent } = openai((s) => {
      if (s.path.endsWith("/chat/completions")) return refuse(BRIAN);
      if (s.body.reasoning?.effort === "low") {
        return refuse("Unsupported value: 'reasoning.effort' does not support 'low' with this model. Supported values are: 'medium' and 'high'.", {
          param: "reasoning.effort",
          code: "unsupported_value",
        });
      }
      return json({ model: "gpt-6-luna", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }], usage: { input_tokens: 5, output_tokens: 2 } });
    }, "https://api.openai.com/v1");
    const r = { ...req, model: "gpt-6-luna", reasoning: "low" as const, temperature: undefined };
    expect((await p.chat(r)).text).toBe("done");
    expect(sent.map((s) => [s.path, s.body.reasoning_effort ?? s.body.reasoning?.effort])).toEqual([
      ["/v1/chat/completions", "low"],
      ["/v1/responses", "low"],
      ["/v1/responses", "medium"],
    ]);
    expect("reasoning_effort" in sent[1]!.body).toBe(false);
    await p.chat(r);
    expect(sent.slice(3).map((s) => [s.path, s.body.reasoning?.effort])).toEqual([["/v1/responses", "medium"]]);
  });

  test("the Responses body: default sends no reasoning object", () => {
    const q = cloneQuirks(undefined);
    expect(buildResponsesBody({ ...req, reasoning: "default" }, { stream: false, quirks: q }).reasoning).toBeUndefined();
    expect(buildResponsesBody({ ...req, reasoning: "none" }, { stream: false, quirks: q }).reasoning).toEqual({ effort: "none" });
  });
});

// ------------------------------------------------------------ vendor reasoning state echoed with tool calls

describe("reasoning state a vendor attaches to its tool calls goes back with them", () => {
  const first: ChatRequest = { model: "deepseek-reasoner", system: "s", messages: [{ role: "user", content: "read a.ts" }], tools: [tool] };
  const next = (id: string, extra: ChatRequest["messages"] = []): ChatRequest => ({
    ...first,
    messages: [
      ...first.messages,
      { role: "assistant", content: "", toolCalls: [{ id, name: "fs_read", arguments: '{"path":"a.ts"}' }] },
      { role: "tool", content: "body", toolCallId: id },
      ...extra,
    ],
  });

  test("DeepSeek and Kimi reasoning_content, Gemini thought signatures: kept per tool call id and sent back", async () => {
    const { p, sent } = openai((_, i) =>
      i === 0
        ? json({
            choices: [
              {
                message: {
                  content: null,
                  reasoning_content: "I should read the file first.",
                  tool_calls: [{ id: "call_ds1", type: "function", function: { name: "fs_read", arguments: '{"path":"a.ts"}' }, extra_content: { google: { thought_signature: "sig-1" } } }],
                },
                finish_reason: "tool_calls",
              },
            ],
          })
        : okChat("done"),
    );
    await p.chat(first);
    await p.chat(next("call_ds1"));
    const assistant = sent[1]!.body.messages.find((m: Body) => m.role === "assistant");
    expect(assistant.reasoning_content).toBe("I should read the file first.");
    expect(assistant.tool_calls[0].extra_content).toEqual({ google: { thought_signature: "sig-1" } });
    // a tool call the adapter never saw carries nothing extra
    await p.chat(next("call_other"));
    const other = sent[2]!.body.messages.find((m: Body) => m.role === "assistant");
    expect("reasoning_content" in other).toBe(false);
    expect("extra_content" in other.tool_calls[0]).toBe(false);
  });

  test("streamed reasoning_content, reasoning_details and signatures are kept the same way", async () => {
    const { p, sent } = openai((_, i) =>
      i === 0
        ? sse([
            { choices: [{ delta: { reasoning_content: "Read ", reasoning_details: [{ type: "reasoning.text", text: "Read ", index: 0 }] } }] },
            { choices: [{ delta: { reasoning_content: "it.", reasoning_details: [{ type: "reasoning.text", text: "it.", signature: "s1", index: 0 }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_s1", function: { name: "fs_read", arguments: '{"path":' }, extra_content: { google: { thought_signature: "sig-2" } } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] }, finish_reason: "tool_calls" }] },
          ])
        : okChat(),
    );
    const out = await p.chat({ ...first, onDelta: () => {} });
    expect(out.toolCalls).toEqual([{ id: "call_s1", name: "fs_read", arguments: '{"path":"a.ts"}' }]);
    await p.chat(next("call_s1"));
    const assistant = sent[1]!.body.messages.find((m: Body) => m.role === "assistant");
    expect(assistant.reasoning_content).toBe("Read it.");
    expect(assistant.reasoning_details).toEqual([{ type: "reasoning.text", text: "Read it.", signature: "s1", index: 0 }]);
    expect(assistant.tool_calls[0].extra_content).toEqual({ google: { thought_signature: "sig-2" } });
  });

  test("a vendor that refuses the echoed fields gets the turn without them, remembered", async () => {
    const { p, sent } = openai((s, i) => {
      if (i === 0) {
        return json({
          choices: [{ message: { content: null, reasoning_content: "hm", tool_calls: [{ id: "call_e1", type: "function", function: { name: "fs_read", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
        });
      }
      const echoed = s.body.messages.some((m: Body) => "reasoning_content" in m);
      return echoed ? json({ detail: [{ type: "extra_forbidden", loc: ["body", "messages", 1, "reasoning_content"], msg: "Extra inputs are not permitted" }] }, 422) : okChat();
    });
    await p.chat(first);
    expect((await p.chat(next("call_e1"))).text).toBe("ok");
    await p.chat(next("call_e1"));
    expect(sent).toHaveLength(4);
    expect(sent[3]!.body.messages.some((m: Body) => "reasoning_content" in m)).toBe(false);
  });
});

// ------------------------------------------------------------ Anthropic thinking from the owner's effort

describe("reasoning effort per tier: Anthropic extended thinking", () => {
  const areq: ChatRequest = { ...req, model: "claude-x", messages: [{ role: "user", content: "hi" }], toolChoice: "required", topP: 0.9, maxOutputTokens: 16_000, temperature: 0.2 };
  const okMsg = (content: unknown[] = [{ type: "text", text: "ok" }]) =>
    json({ model: "claude-x", content, stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 1 } });
  const anthErr = (message: string) => json({ type: "error", error: { type: "invalid_request_error", message } }, 400);

  test("none and default send no thinking; the request's own temperature, top_p and forced tool choice stand", async () => {
    const { p, sent } = anthropic(() => okMsg());
    await p.chat({ ...areq, reasoning: "none" });
    await p.chat({ ...areq, reasoning: "default" });
    for (const s of sent) {
      expect(s.body.thinking).toBeUndefined();
      expect(s.body).toMatchObject({ temperature: 0.2, top_p: 0.9, tool_choice: { type: "any" } });
    }
  });

  test("low, medium and high become a thinking budget under the output cap, at temperature 1, no top_p, tool choice auto", async () => {
    const { p, sent } = anthropic(() => okMsg());
    for (const reasoning of ["low", "medium", "high"] as const) await p.chat({ ...areq, reasoning });
    expect(sent.map((s) => s.body.thinking)).toEqual([
      { type: "enabled", budget_tokens: 2048 },
      { type: "enabled", budget_tokens: 8192 },
      { type: "enabled", budget_tokens: 12_000 },
    ]);
    for (const s of sent) {
      expect(s.body.thinking.budget_tokens).toBeLessThan(s.body.max_tokens);
      expect(s.body).toMatchObject({ temperature: 1, tool_choice: { type: "auto" } });
      expect("top_p" in s.body).toBe(false);
      expect(s.body.tools).toHaveLength(1);
    }
  });

  test("a cap too small for the smallest budget means no thinking for that call", async () => {
    const { p, sent } = anthropic(() => okMsg());
    await p.chat({ ...areq, reasoning: "high", maxOutputTokens: 1500 });
    await p.chat({ ...areq, reasoning: "high", maxOutputTokens: 4096 });
    expect(sent[0]!.body.thinking).toBeUndefined();
    expect(sent[1]!.body.thinking).toEqual({ type: "enabled", budget_tokens: 3072 });
  });

  test("the tool turn being continued starts with the thinking blocks the model wrote for it", async () => {
    const thinkingBlock = { type: "thinking", thinking: "Read a.ts first.", signature: "sig-abc" };
    const { p, sent } = anthropic((_, i) =>
      i === 0 ? okMsg([thinkingBlock, { type: "text", text: "Reading." }, { type: "tool_use", id: "toolu_1", name: "fs_read", input: { path: "a.ts" } }]) : okMsg(),
    );
    const think = { ...areq, reasoning: "medium" as const, toolChoice: "auto" as const };
    await p.chat(think);
    const loop: ChatRequest = {
      ...think,
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "Reading.", toolCalls: [{ id: "toolu_1", name: "fs_read", arguments: '{"path":"a.ts"}' }] },
        { role: "tool", content: "body", toolCallId: "toolu_1" },
      ],
    };
    await p.chat(loop);
    expect(sent[1]!.body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(sent[1]!.body.messages[1].content[0]).toEqual(thinkingBlock);
    expect(sent[1]!.body.messages[1].content.map((b: Body) => b.type)).toEqual(["thinking", "text", "tool_use"]);
  });

  test("streamed thinking (deltas and signature) and redacted thinking are kept too", async () => {
    const { p, sent } = anthropic((_, i) =>
      i === 0
        ? sse([
            { type: "message_start", message: { model: "claude-x", usage: { input_tokens: 5 } } },
            { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Plan: " } },
            { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "read." } },
            { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-s" } },
            { type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "enc-1" } },
            { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_s", name: "fs_read", input: {} } },
            { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"path":"a.ts"}' } },
            { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
            { type: "message_stop" },
          ])
        : okMsg(),
    );
    const think = { ...areq, reasoning: "low" as const, onDelta: () => {} };
    const out = await p.chat(think);
    expect(out.toolCalls).toEqual([{ id: "toolu_s", name: "fs_read", arguments: '{"path":"a.ts"}' }]);
    expect(out.text).toBe("");
    await p.chat({
      ...think,
      onDelta: undefined,
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "", toolCalls: out.toolCalls },
        { role: "tool", content: "body", toolCallId: "toolu_s" },
      ],
    });
    expect(sent[1]!.body.messages[1].content.slice(0, 2)).toEqual([
      { type: "thinking", thinking: "Plan: read.", signature: "sig-s" },
      { type: "redacted_thinking", data: "enc-1" },
    ]);
  });

  test("a tool turn whose thinking was not kept runs without thinking; a fresh turn thinks again", async () => {
    const { p, sent } = anthropic(() => okMsg());
    const history: ChatRequest["messages"] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [{ id: "toolu_lost", name: "fs_read", arguments: "{}" }] },
      { role: "tool", content: "body", toolCallId: "toolu_lost" },
    ];
    await p.chat({ ...areq, reasoning: "high", messages: history });
    expect(sent[0]!.body.thinking).toBeUndefined();
    expect(sent[0]!.body.temperature).toBe(0.2);
    await p.chat({ ...areq, reasoning: "high", messages: [...history, { role: "assistant", content: "Done." }, { role: "user", content: "next" }] });
    expect(sent[1]!.body.thinking).toEqual({ type: "enabled", budget_tokens: 12_000 });
  });

  test("the vendor's thinking refusals: budget over the cap shrinks it, a model without thinking has it dropped and remembered, a missing block drops it for one call", async () => {
    const budget = anthropic((s) =>
      s.body.thinking?.budget_tokens > 1024
        ? anthErr("`max_tokens` must be greater than `thinking.budget_tokens`. Please consult our documentation at https://docs.claude.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size")
        : okMsg(),
    );
    await budget.p.chat({ ...areq, reasoning: "high" });
    expect(budget.sent.map((s) => s.body.thinking?.budget_tokens)).toEqual([12_000, 1024]);

    const none = anthropic((s) => (s.body.thinking ? anthErr("claude-3-5-haiku-20241022 does not support thinking.") : okMsg()));
    await none.p.chat({ ...areq, reasoning: "medium" });
    await none.p.chat({ ...areq, reasoning: "medium" });
    expect(none.sent.map((s) => Boolean(s.body.thinking))).toEqual([true, false, false]);
    expect(none.sent[2]!.body.temperature).toBe(0.2);

    const missing = anthropic((s, i) =>
      s.body.thinking && i === 0
        ? anthErr(
            "messages.1.content.0.type: Expected `thinking` or `redacted_thinking`, but found `tool_use`. When `thinking` is enabled, a final `assistant` message must start with a thinking block (preceeding the lastmost set of `tool_use` and `tool_result` blocks). We recommend you include thinking blocks from previous turns. To avoid this requirement, disable `thinking`.",
          )
        : okMsg(),
    );
    await missing.p.chat({ ...areq, reasoning: "low" });
    await missing.p.chat({ ...areq, reasoning: "low" });
    expect(missing.sent.map((s) => Boolean(s.body.thinking))).toEqual([true, false, true]);
  });

  test("a model that moved to adaptive thinking gets it, remembered", async () => {
    const { p, sent } = anthropic((s) =>
      s.body.thinking?.type === "enabled" ? anthErr("thinking.type.enabled is not supported for this model. Use thinking.type.adaptive instead.") : okMsg(),
    );
    await p.chat({ ...areq, reasoning: "high" });
    await p.chat({ ...areq, reasoning: "high" });
    expect(sent.map((s) => s.body.thinking)).toEqual([{ type: "enabled", budget_tokens: 12_000 }, { type: "adaptive" }, { type: "adaptive" }]);
  });
});

describe("output cap field: max_tokens and max_completion_tokens", () => {
  const plain: ChatRequest = { model: "o-9", system: "s", messages: [{ role: "user", content: "go" }], maxOutputTokens: 300 };

  test("a reasoning model behind a gateway asks for max_completion_tokens: renamed, remembered, never dropped", async () => {
    const { p, sent } = openai((s) =>
      "max_tokens" in s.body
        ? refuse("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", { param: "max_tokens", code: "unsupported_parameter" })
        : okChat(),
    );
    await p.chat(plain);
    await p.chat(plain);
    expect(sent.map((s) => [s.body.max_tokens, s.body.max_completion_tokens])).toEqual([
      [300, undefined],
      [undefined, 300],
      [undefined, 300],
    ]);
  });

  test("an older compatible server refuses max_completion_tokens on the official default: max_tokens instead", async () => {
    const { p, sent } = openai(
      (s) => ("max_completion_tokens" in s.body ? refuse("Unrecognized request argument supplied: max_completion_tokens") : okChat()),
      "https://api.openai.com/v1",
    );
    await p.chat(plain);
    expect(sent.map((s) => [s.body.max_completion_tokens, s.body.max_tokens])).toEqual([
      [300, undefined],
      [undefined, 300],
    ]);
  });
});

describe("Anthropic thinking and assistant prefill", () => {
  test("a conversation ending on an assistant turn runs without thinking", async () => {
    const { p, sent } = anthropic(() => json({ model: "claude-x", content: [{ type: "text", text: " done" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 1 } }));
    const base: ChatRequest = { model: "claude-x", system: "s", maxOutputTokens: 16_000, reasoning: "high", messages: [{ role: "user", content: "hi" }] };
    await p.chat({ ...base, messages: [...base.messages, { role: "assistant", content: "Sure," }] });
    await p.chat(base);
    expect(sent.map((s) => Boolean(s.body.thinking))).toEqual([false, true]);
  });
});
