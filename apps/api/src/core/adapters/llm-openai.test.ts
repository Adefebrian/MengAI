// OpenAI-compatible chat adapter: the self-heal that retries without an
// optional field only fires for allowlisted fields the vendor clearly calls
// unsupported, and only remembers drops the vendor then accepted.
import { describe, expect, test } from "bun:test";
import { LlmError, type ChatRequest } from "../ports/llm";
import { createOpenAiChat, unsupportedParams, type FetchFn } from "./llm-openai";

const KEY = "sk-test-openai-KEY-1234567890abcdef";

const req: ChatRequest = {
  model: "gpt-4o-mini",
  system: "You are the engineer cat.",
  messages: [{ role: "user", content: "Reply with a short lesson." }],
  maxOutputTokens: 150,
  temperature: 0,
  responseFormat: "json",
  cacheKey: "run-1:engineer",
};

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const okChat = () => json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

function chat(handler: (body: Record<string, unknown>, i: number) => Response, baseUrl = "https://gateway.example.com/v1") {
  const bodies: Array<Record<string, unknown>> = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return handler(body, bodies.length - 1);
  }) as unknown as FetchFn;
  const p = createOpenAiChat({ id: "p1", baseUrl, apiKey: KEY, guard: { mode: "local" }, label: "gateway", fetch });
  return { p, bodies };
}

describe("self-heal allowlist", () => {
  test("a structured error naming a required field never drops an optional one", async () => {
    // mentions response_format next to "not supported", but the vendor names `messages` as the problem
    const { p, bodies } = chat((_b, i) =>
      i === 0
        ? json({ error: { message: "response_format json_object is not supported unless messages ask for it", type: "invalid_request_error", param: "messages", code: null } }, 400)
        : okChat(),
    );
    const err = (await p.chat(req).catch((e) => e)) as LlmError;
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe("bad_request");
    expect(bodies).toHaveLength(1);
    await p.chat(req);
    expect(bodies[1]).toMatchObject({ response_format: { type: "json_object" }, prompt_cache_key: "run-1:engineer", temperature: 0 });
  });

  test("the json-word requirement is a prompt problem in any shape, never a drop", async () => {
    const texts = [
      "'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'.",
      "response_format json_object is not supported: the prompt must contain the word json",
      JSON.stringify({ error: { message: "Unsupported: response_format needs the word \"json\" in messages", param: "response_format", code: "unsupported_value" } }),
    ];
    for (const text of texts) {
      expect(unsupportedParams(text, { response_format: {}, prompt_cache_key: "k" })).toEqual([]);
      const { p, bodies } = chat((_b, i) => (i === 0 ? new Response(text, { status: 400 }) : okChat()));
      expect(((await p.chat(req).catch((e) => e)) as LlmError).kind).toBe("bad_request");
      expect(bodies).toHaveLength(1);
      await p.chat(req);
      expect(bodies[1]!.response_format).toEqual({ type: "json_object" });
    }
  });

  test("fields outside the allowlist are never dropped, even when called unsupported", () => {
    const sent = { model: "m", messages: [], tools: [], tool_choice: "auto", stream: true, response_format: {}, prompt_cache_key: "k" };
    for (const field of ["model", "messages", "tools", "tool_choice", "stream"]) {
      expect(unsupportedParams(`Unrecognized request argument supplied: ${field}`, sent)).toEqual([]);
      expect(unsupportedParams(JSON.stringify({ error: { message: `Unsupported parameter: '${field}'`, param: field, code: "unsupported_parameter" } }), sent)).toEqual([]);
    }
    // an allowlisted field the request did not carry is not reported either
    expect(unsupportedParams("Unrecognized request argument supplied: stream_options", { prompt_cache_key: "k" })).toEqual([]);
    // the allowlisted field still heals when the vendor clearly calls it unsupported
    expect(unsupportedParams(JSON.stringify({ error: { message: "Unsupported parameter: 'prompt_cache_key'", param: "prompt_cache_key", code: "unsupported_parameter" } }), sent)).toEqual(["prompt_cache_key"]);
  });

  test("a drop is remembered only when the vendor then accepts the request", async () => {
    // prompt_cache_key is called unsupported, then the retry fails for another reason
    const { p, bodies } = chat((b, i) => {
      if (i === 0) return json({ error: { message: "Unrecognized request argument supplied: prompt_cache_key" } }, 400);
      if (i === 1) return json({ error: { message: "temperature must be between 0 and 2" } }, 400);
      return okChat();
    });
    expect(((await p.chat(req).catch((e) => e)) as LlmError).kind).toBe("bad_request");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.prompt_cache_key).toBeUndefined();
    await p.chat(req);
    // nothing was remembered: the next call sends the full request again
    expect(bodies[2]).toMatchObject({ prompt_cache_key: "run-1:engineer", temperature: 0, response_format: { type: "json_object" } });
  });

  test("the output cap is never dropped and JSON mode is never remembered as a drop", async () => {
    const { p, bodies } = chat((b) => {
      if ("response_format" in b && "prompt_cache_key" in b) {
        return json({ error: { message: "Unrecognized request arguments supplied: prompt_cache_key, response_format" } }, 400);
      }
      return okChat();
    });
    await p.chat(req);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ max_tokens: 150 });
    expect(bodies[1]!.response_format).toBeUndefined();
    await p.chat(req);
    // prompt_cache_key stays dropped for this model, JSON mode is asked for again, the cap is always sent
    expect(bodies[2]!.prompt_cache_key).toBeUndefined();
    expect(bodies[2]).toMatchObject({ max_tokens: 150, response_format: { type: "json_object" } });
  });
});
