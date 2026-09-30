// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// providers service: BYOK registry, tier routing (LlmRouter), media routing
// (MediaRouter), the JEV judge binding and connection tests. Keys live in
// the vault under "provider:<id>" and are registered with redact() the
// moment they are seen; no DTO, log line or error message ever carries one.
// Each chat provider row owns one quirk store (llm-quirks): what the
// connection test learns about a model (a renamed field, the Responses
// path, no tools at all) is where the crew's calls start. Each tier carries
// the owner's reasoning effort; the router puts it on every chat request of
// that tier, and the adapters heal it away for a model that refuses it.
import {
  AGENT_ROLES,
  PROVIDER_PRESETS,
  REASONING_EFFORTS,
  TIERS,
  findPreset,
  type AgentRole,
  type CreateProviderBody,
  type ModelRouting,
  type ProviderDTO,
  type ProviderModel,
  type ProviderPreset,
  type ProviderProtocol,
  type ProviderTestResult,
  type ReasoningEffort,
  type Tier,
  type TierMapping,
  type UpdateProviderBody,
} from "@mengai/shared";
import { createJevJudge } from "../../core/adapters/judge-jev";
import { createAnthropicChat } from "../../core/adapters/llm-anthropic";
import { assertSafeUrl, createOpenAiChat, UnsafeUrlError, type FetchFn, type LookupFn } from "../../core/adapters/llm-openai";
import { createQuirkStore, TOOLS_ADVICE, TOOLS_PROBE_FAIL, type QuirkStore } from "../../core/adapters/llm-quirks";
import { withRetry, type ResilientLlm, type RetryPolicy } from "../../core/adapters/llm-retry";
import { createFalMedia } from "../../core/adapters/media-fal";
import { createGeminiMedia } from "../../core/adapters/media-gemini";
import { createOpenAiMedia, type MediaAdapterConfig } from "../../core/adapters/media-openai";
import { createReplicateMedia } from "../../core/adapters/media-replicate";
import type { ModuleContext } from "../../core/module";
import type { Judge } from "../../core/ports/judge";
import { LlmError, type ChatRequest, type LlmProvider, type LlmRouter, type ResolvedModel } from "../../core/ports/llm";
import type { MediaProvider, MediaRouter } from "../../core/ports/media";
import type { ProvidersService, UsageService } from "../../core/services";
import { HttpError, notFound } from "../../lib/http";
import { keyHint, redact, registerSecret } from "../../lib/redact";
import { createProvidersRepo, type ProviderRow } from "./repo";

export interface ProvidersDeps {
  /** usage service from the usage module (section 17 dependency table) */
  usage: UsageService;
  /** test and wiring hooks: DNS resolver for the SSRF guard, fetch, retry policy */
  lookup?: LookupFn;
  fetch?: FetchFn;
  retry?: RetryPolicy;
}

export interface ProvidersModuleService extends ProvidersService {
  presets(): ProviderPreset[];
  get(id: string): Promise<ProviderDTO>;
  create(body: CreateProviderBody): Promise<ProviderDTO>;
  update(id: string, body: UpdateProviderBody): Promise<ProviderDTO>;
  remove(id: string): Promise<void>;
  test(id: string, signal?: AbortSignal): Promise<ProviderTestResult>;
  routing(): Promise<ModelRouting>;
  setRouting(input: ModelRouting): Promise<ModelRouting>;
  /** loads every stored key once so redact() masks them from the first log line; returns how many */
  warm(): Promise<number>;
}

interface ProbeResult {
  models: ProviderModel[];
  /** ok, with something the owner should know */
  note?: string;
  /** not ok, but the models are still worth showing (the owner picks another one) */
  fail?: string;
}

const CHAT_PROTOCOLS: ReadonlySet<ProviderProtocol> = new Set(["openai_chat", "anthropic_messages"]);
const MEDIA_PROTOCOLS: ReadonlySet<ProviderProtocol> = new Set(["openai_images", "gemini_media", "fal_queue", "replicate"]);

/**
 * Tier resolution, provider agnostic (Brian: no built-in default model).
 * A tier's own mapping wins; an unmapped tier borrows the nearest mapped
 * tier, cheaper first, so cost never escalates silently; with nothing mapped
 * at all it uses the first usable chat provider the owner added, with that
 * provider's first model. This table is the borrowing order.
 */
export const TIER_FALLBACK: Record<Tier, Tier[]> = {
  fast: ["balanced", "deep"],
  balanced: ["fast", "deep"],
  deep: ["balanced", "fast"],
};

const DEFAULT_WINDOW = 128_000;
const KNOWN_WINDOWS: Array<[RegExp, number]> = [
  [/(^|\/)gpt-4\.1/, 1_047_576],
  [/(^|\/)gpt-5/, 400_000],
  [/(^|\/)gpt-4o/, 128_000],
  [/claude/, 200_000],
  [/gemini-(2|3)/, 1_048_576],
  [/deepseek/, 128_000],
];

const VIDEO_MODEL = /sora|veo|video|kling|(^|\/)wan|hunyuan|ltx|seedance|luma|runway|hailuo/i;

export function keyRefFor(id: string): string {
  return `provider:${id}`;
}

function toDto(r: ProviderRow): ProviderDTO {
  return {
    id: r.id,
    preset: r.preset,
    label: r.label,
    protocol: r.protocol,
    baseUrl: r.baseUrl,
    hasKey: r.keyRef !== null,
    keyHint: r.keyHint,
    // JEV has no models to pick; older rows stored the wire version as one
    models: r.protocol === "jev" ? [] : r.models,
    caps: r.caps,
    lastTestAt: r.lastTestAt,
    lastTestOk: r.lastTestOk,
    lastTestError: r.lastTestError,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Endpoint paths the adapters add themselves. Owners often paste the full
 * endpoint from a vendor's docs (".../v1/chat/completions", ".../v1/responses",
 * ".../v1/messages"); the adapter would then call ".../chat/completions/chat/completions"
 * and get a 404, so the tail is cut back to the base URL.
 */
const ENDPOINT_TAILS = [
  "/chat/completions",
  "/completions",
  "/responses",
  "/embeddings",
  "/images/generations",
  "/models",
  "/messages",
];

export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  for (let changed = true; changed; ) {
    changed = false;
    for (const tail of ENDPOINT_TAILS) {
      if (url.toLowerCase().endsWith(tail) && url.length > tail.length + "https://x".length) {
        url = url.slice(0, -tail.length).replace(/\/+$/, "");
        changed = true;
      }
    }
  }
  return url;
}

function dedupeModels(models: ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>();
  const out: ProviderModel[] = [];
  for (const m of models) {
    const id = m.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...m, id });
  }
  return out;
}

/**
 * The connection test's tool probe: one tiny tool the model is asked to call.
 * The cap leaves room for a reasoning model to think briefly before calling.
 */
const PROBE_TOOL = {
  name: "connection_check",
  description: "Confirms the connection test. Call it once with ok set to true.",
  parameters: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
};
const PROBE_MAX_TOKENS = 512;

/** Room to think before the tool call when the tier asks for reasoning (still a tiny request). */
const PROBE_THINKING_MAX_TOKENS = 4096;

/** The probe runs at the tier's own effort, so what it learns (a refused effort, the Responses path) is what the crew meets. */
function toolProbe(model: string, reasoning: ReasoningEffort | undefined, signal?: AbortSignal): ChatRequest {
  const thinks = reasoning === "low" || reasoning === "medium" || reasoning === "high";
  return {
    model,
    system: "",
    messages: [{ role: "user", content: "Connection test: call the connection_check tool with ok set to true." }],
    tools: [PROBE_TOOL],
    toolChoice: "required",
    maxOutputTokens: thinks ? PROBE_THINKING_MAX_TOKENS : PROBE_MAX_TOKENS,
    temperature: 0,
    ...(reasoning ? { reasoning } : {}),
    signal,
  };
}

/** The tier's effort as stored: a known value other than default, else nothing (missing means default). */
function effortOf(m: Partial<TierMapping> | undefined): ReasoningEffort | undefined {
  const r = m?.reasoning;
  return r && r !== "default" && (REASONING_EFFORTS as readonly string[]).includes(r) ? r : undefined;
}

/**
 * The resolved provider with the tier's effort on every chat request that
 * does not set its own. The wrapper inherits everything else (id, breaker,
 * listModels) from the cached adapter, so no state is duplicated.
 */
const reasoningWrappers = new WeakMap<LlmProvider, Map<ReasoningEffort, LlmProvider>>();

export function withReasoning<P extends LlmProvider>(provider: P, reasoning: ReasoningEffort | undefined): P {
  if (!reasoning) return provider;
  let byEffort = reasoningWrappers.get(provider);
  if (!byEffort) {
    byEffort = new Map();
    reasoningWrappers.set(provider, byEffort);
  }
  const hit = byEffort.get(reasoning);
  if (hit) return hit as P;
  const wrapped = Object.create(provider) as P;
  Object.defineProperty(wrapped, "chat", {
    value: (req: ChatRequest) => provider.chat(req.reasoning ? req : { ...req, reasoning }),
    enumerable: true,
  });
  byEffort.set(reasoning, wrapped);
  return wrapped;
}

function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const clean = redact(msg).replace(/\s+/g, " ").trim();
  return clean.length > 300 ? `${clean.slice(0, 297)}...` : clean || "request failed";
}

export function defaultRouting(): ModelRouting {
  return {
    tiers: TIERS.map((tier) => ({ tier, providerId: null, model: null })),
    roleTiers: {},
    image: { providerId: null, model: null },
    video: { providerId: null, model: null },
  };
}

/** Coerces any stored or submitted routing into the full canonical shape. */
export function normalizeRouting(r: Partial<ModelRouting> | null | undefined): ModelRouting {
  if (!r) return defaultRouting();
  const tiers = TIERS.map((tier): TierMapping => {
    const m = Array.isArray(r.tiers) ? r.tiers.find((x) => x && x.tier === tier) : undefined;
    const providerId = m?.providerId ?? null;
    // kept on a tier without its own provider too: a borrowed model still thinks at this tier's effort
    const reasoning = effortOf(m);
    return { tier, providerId, model: providerId ? m?.model ?? null : null, ...(reasoning ? { reasoning } : {}) };
  });
  const roleTiers: Partial<Record<AgentRole, Tier>> = {};
  for (const [role, tier] of Object.entries(r.roleTiers ?? {})) {
    if ((AGENT_ROLES as readonly string[]).includes(role) && (TIERS as readonly string[]).includes(String(tier))) roleTiers[role as AgentRole] = tier as Tier;
  }
  const media = (m: { providerId: string | null; model: string | null } | undefined) => {
    const providerId = m?.providerId ?? null;
    return { providerId, model: providerId ? m?.model ?? null : null };
  };
  return { tiers, roleTiers, image: media(r.image), video: media(r.video) };
}

export function createProvidersService(ctx: ModuleContext, deps: ProvidersDeps): ProvidersModuleService {
  const repo = createProvidersRepo(ctx.db);
  const log = ctx.logger.child({ module: "providers" });
  const mode = ctx.config.mode;
  const llmCache = new Map<string, { stamp: number; llm: Promise<ResilientLlm> }>();
  const quirkStores = new Map<string, QuirkStore>();
  const mediaCache = new Map<string, { stamp: number; media: Promise<MediaProvider> }>();

  const presetOf = (row: ProviderRow): ProviderPreset | undefined => findPreset(row.preset);
  const keyRequired = (row: ProviderRow) => presetOf(row)?.keyRequired ?? false;

  async function mustGet(id: string): Promise<ProviderRow> {
    const row = await repo.get(id);
    if (!row) throw notFound("provider");
    return row;
  }

  async function guardOrThrow(url: string, preset: ProviderPreset | undefined): Promise<void> {
    try {
      await assertSafeUrl(url, { mode, localPreset: !!preset?.local, lookup: deps.lookup });
    } catch (e) {
      if (e instanceof UnsafeUrlError) throw new HttpError(422, "unsafe_base_url", e.message);
      throw e;
    }
  }

  async function keyFor(row: ProviderRow): Promise<string | null> {
    if (!row.keyRef) return null;
    const key = await ctx.vault.get(row.keyRef);
    if (key) registerSecret(key);
    return key;
  }

  function usableChat(row: ProviderRow): boolean {
    if (!CHAT_PROTOCOLS.has(row.protocol)) return false;
    if (presetOf(row)?.local && mode !== "local") return false;
    return row.keyRef !== null || !keyRequired(row);
  }

  function usableMedia(row: ProviderRow, kind: "image" | "video"): boolean {
    return MEDIA_PROTOCOLS.has(row.protocol) && row.caps.includes(kind) && (row.keyRef !== null || !keyRequired(row));
  }

  /** One store per provider row, shared by the routed adapter and the connection test. */
  function quirksFor(id: string): QuirkStore {
    let q = quirkStores.get(id);
    if (!q) {
      q = createQuirkStore();
      quirkStores.set(id, q);
    }
    return q;
  }

  async function rawLlm(row: ProviderRow): Promise<LlmProvider> {
    const apiKey = await keyFor(row);
    const cfg = {
      id: row.id,
      baseUrl: row.baseUrl,
      apiKey,
      guard: { mode, localPreset: !!presetOf(row)?.local, lookup: deps.lookup },
      label: row.label,
      fetch: deps.fetch,
      quirks: quirksFor(row.id),
    };
    return row.protocol === "anthropic_messages" ? createAnthropicChat(cfg) : createOpenAiChat(cfg);
  }

  function llmFor(row: ProviderRow): Promise<ResilientLlm> {
    const hit = llmCache.get(row.id);
    if (hit && hit.stamp === row.updatedAt) return hit.llm;
    const llm = rawLlm(row).then((p) => withRetry(p, deps.retry));
    llm.catch(() => llmCache.delete(row.id));
    llmCache.set(row.id, { stamp: row.updatedAt, llm });
    return llm;
  }

  async function mediaCfg(row: ProviderRow): Promise<MediaAdapterConfig> {
    return { id: row.id, baseUrl: row.baseUrl, apiKey: await keyFor(row), mode, lookup: deps.lookup, fetch: deps.fetch, label: row.label };
  }

  async function buildMedia(row: ProviderRow): Promise<MediaProvider> {
    const cfg = await mediaCfg(row);
    switch (row.protocol) {
      case "openai_images":
        return createOpenAiMedia(cfg);
      case "gemini_media":
        return createGeminiMedia(cfg);
      case "fal_queue":
        return createFalMedia(cfg);
      case "replicate":
        return createReplicateMedia(cfg);
      default:
        throw new HttpError(422, "wrong_capability", `${row.label} is not a media provider`);
    }
  }

  function mediaFor(row: ProviderRow): Promise<MediaProvider> {
    const hit = mediaCache.get(row.id);
    if (hit && hit.stamp === row.updatedAt) return hit.media;
    const media = buildMedia(row);
    media.catch(() => mediaCache.delete(row.id));
    mediaCache.set(row.id, { stamp: row.updatedAt, media });
    return media;
  }

  function forget(id: string): void {
    llmCache.delete(id);
    mediaCache.delete(id);
    // a new URL or key may be another vendor: nothing learned about the old one carries over
    quirkStores.delete(id);
  }

  function windowFor(row: ProviderRow, model: string): number {
    const known = row.models.find((m) => m.id === model)?.contextWindow;
    if (known) return known;
    for (const [re, w] of KNOWN_WINDOWS) if (re.test(model)) return w;
    return DEFAULT_WINDOW;
  }

  function mediaModel(row: ProviderRow, kind: "image" | "video"): string | null {
    const models = row.models.length ? row.models : (presetOf(row)?.suggestedModels ?? []).map((id) => ({ id }) as ProviderModel);
    const tagged = models.find((m) => m.caps?.includes(kind));
    if (tagged) return tagged.id;
    const named = models.find((m) => (kind === "video" ? VIDEO_MODEL.test(m.id) : !VIDEO_MODEL.test(m.id)));
    return named?.id ?? null;
  }

  /** The model a provider row serves by default: its first listed chat model, else its preset's first suggestion. */
  function firstChatModel(row: ProviderRow): string | null {
    const listed = row.models.find((m) => !m.caps || m.caps.includes("chat") || m.caps.includes("tools"));
    if (listed) return listed.id;
    return presetOf(row)?.suggestedModels[0] ?? null;
  }

  async function loadRouting(): Promise<ModelRouting> {
    return normalizeRouting(await repo.getRouting());
  }

  /** The row and model a tier resolves to (see TIER_FALLBACK), or null when nothing can serve it. */
  function pickChat(tier: Tier, routing: ModelRouting, rows: ProviderRow[]): { row: ProviderRow; model: string } | null {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const mapped = (t: Tier) => {
      const m = routing.tiers.find((x) => x.tier === t);
      if (!m?.providerId || !m.model) return null;
      const row = byId.get(m.providerId);
      return row && usableChat(row) ? { row, model: m.model } : null;
    };
    const own = mapped(tier);
    if (own) return own;
    for (const t of TIER_FALLBACK[tier]) {
      const hit = mapped(t);
      if (hit) return hit;
    }
    // Nothing mapped: the first usable chat provider the owner added, with its first model.
    for (const row of rows) {
      if (!usableChat(row)) continue;
      const model = firstChatModel(row);
      if (model) return { row, model };
    }
    return null;
  }

  const llm: LlmRouter = {
    async resolve({ tier, role }): Promise<ResolvedModel> {
      const routing = await loadRouting();
      const effective = (role && routing.roleTiers[role]) || tier;
      const hit = pickChat(effective, routing, await repo.list());
      if (hit) {
        const reasoning = effortOf(routing.tiers.find((t) => t.tier === effective));
        return {
          provider: withReasoning(await llmFor(hit.row), reasoning),
          model: hit.model,
          contextWindow: windowFor(hit.row, hit.model),
          ...(reasoning ? { reasoning } : {}),
        };
      }
      throw new LlmError(
        "not_found",
        `No chat model is configured for the ${effective} tier. Add any provider with a model, or map a model to a tier, in Providers.`,
      );
    },
    /**
     * true when resolve({ tier: "balanced" }) would pick a provider. Answered from the
     * database only: health runs on every page load, and reading the keychain there
     * can wait on a macOS permission prompt. A key that went missing from the vault
     * surfaces as a clear error on the call that needs it.
     */
    async configured(): Promise<boolean> {
      return pickChat("balanced", await loadRouting(), await repo.list()) !== null;
    },
  };

  const media: MediaRouter = {
    async resolve(kind, override) {
      const routing = await loadRouting();
      const route = routing[kind];
      const pick = override?.providerId ?? route.providerId ?? null;
      const rows = await repo.list();
      let row = pick ? rows.find((r) => r.id === pick) ?? null : null;
      if (pick && !row) throw notFound("provider");
      if (!row) row = rows.find((r) => usableMedia(r, kind)) ?? null;
      if (!row) throw new HttpError(422, "media_not_configured", `No ${kind} provider is configured. Add OpenAI, Gemini, fal or Replicate in Providers.`);
      if (!usableMedia(row, kind)) throw new HttpError(422, "wrong_capability", `${row.label} cannot generate ${kind}`);
      const model = override?.model ?? (route.providerId === row.id ? route.model : null) ?? mediaModel(row, kind);
      if (!model) throw new HttpError(422, "model_required", `Pick a ${kind} model for ${row.label}`);
      const provider = await mediaFor(row);
      const supported = kind === "image" ? typeof provider.generateImage === "function" : typeof provider.startVideo === "function" && typeof provider.pollVideo === "function";
      if (!supported) throw new HttpError(422, "wrong_capability", `${row.label} cannot generate ${kind}`);
      return { provider, model };
    },
  };

  const judgeFor = (target: () => Promise<{ baseUrl: string; apiKey: string } | null>): Judge =>
    createJevJudge({ target, mode, lookup: deps.lookup, fetch: deps.fetch });

  const jevJudge: Judge = judgeFor(async () => {
    const row = (await repo.list()).find((r) => r.protocol === "jev" && r.keyRef !== null);
    if (!row) return null;
    const apiKey = await keyFor(row);
    return apiKey ? { baseUrl: row.baseUrl, apiKey } : null;
  });
  // configured() is asked by health on every page load: answer it from the database,
  // never the keychain (a macOS prompt there would hold every page)
  const judge: Judge = {
    ...jevJudge,
    configured: async () => (await repo.list()).some((r) => r.protocol === "jev" && r.keyRef !== null),
  };

  /** The model the crew would use from this row (a tier mapped to it, else its first chat model, else the first listed) and that tier's effort. */
  async function crewModel(row: ProviderRow, listed: ProviderModel[]): Promise<{ model: string; reasoning?: ReasoningEffort } | null> {
    const routing = await loadRouting();
    for (const tier of ["balanced", "fast", "deep"] as const) {
      const m = routing.tiers.find((t) => t.tier === tier);
      if (m?.providerId === row.id && m.model) return { model: m.model, reasoning: effortOf(m) };
    }
    const model = firstChatModel(row) ?? listed[0]?.id ?? null;
    return model ? { model } : null;
  }

  /**
   * A chat provider's test: the model list when the vendor has one, then one
   * tiny tool call with the model the crew would use, because a model that
   * cannot call tools cannot run a cat. JEV be.connection_test_tools: a model
   * that refuses tools fails the test (the key works, the crew would not);
   * a model that answers without calling the tool passes with a note.
   */
  async function probeChat(row: ProviderRow, signal?: AbortSignal): Promise<ProbeResult> {
    const chat = await rawLlm(row);
    let models: ProviderModel[] = [];
    try {
      models = await chat.listModels(signal);
    } catch (e) {
      if (!(e instanceof LlmError) || (e.kind !== "not_found" && e.kind !== "bad_request")) throw e;
    }
    const crew = await crewModel(row, models);
    if (!crew) {
      if (models.length === 0) throw new Error("this endpoint has no model list; add a model id and test again");
      return { models, note: "no model to test tool calls with; pick a model and test again" };
    }
    const { model } = crew;
    try {
      const r = await chat.chat(toolProbe(model, crew.reasoning, signal));
      if (r.toolCalls.length > 0) return { models };
      return { models, note: `${model} answered without calling the test tool; if cats stall, ${TOOLS_ADVICE}` };
    } catch (e) {
      if (!(e instanceof LlmError) || e.code !== "tools_unsupported") throw e;
    }
    // the vendor refused tools for this model: a plain ping tells a working key from a dead one
    await chat.chat({ model, system: "", messages: [{ role: "user", content: "ping" }], maxOutputTokens: 16, signal });
    return { models, fail: `${TOOLS_PROBE_FAIL} (model ${model})` };
  }

  /** Throws on failure; `note` is an ok result the vendor cannot confirm up front; `fail` is a failed test that still lists models. */
  async function probe(row: ProviderRow, signal?: AbortSignal): Promise<ProbeResult> {
    if (keyRequired(row) && !row.keyRef) throw new Error("no API key is stored for this provider");
    switch (row.protocol) {
      case "openai_chat":
      case "anthropic_messages":
        return probeChat(row, signal);
      case "openai_images": {
        const cfg = await mediaCfg(row);
        return { models: await createOpenAiChat({ id: row.id, baseUrl: row.baseUrl, apiKey: cfg.apiKey, guard: { mode, lookup: deps.lookup }, label: row.label, fetch: deps.fetch }).listModels(signal) };
      }
      case "gemini_media":
        return { models: await createGeminiMedia(await mediaCfg(row)).listModels(signal) };
      case "replicate":
        await createReplicateMedia(await mediaCfg(row)).account(signal);
        return { models: [] };
      case "jev": {
        const apiKey = await keyFor(row);
        const r = await judgeFor(async () => (apiKey ? { baseUrl: row.baseUrl, apiKey } : null)).decide({
          decisionId: "providers.connection_test",
          state: { probe: "connection test" },
          questions: { ok: { type: "noul", instructions: "Yes means this request arrived. Answer yes." } },
          signal,
        });
        if (!r.verified) throw new Error(r.error);
        return { models: [] };
      }
      case "fal_queue":
        // JEV be.fal_connection_test: ok_with_note (no documented key check endpoint)
        return { models: [], note: "key stored; fal.ai has no key check endpoint, so the key is verified on the first generation" };
      default:
        throw new Error(`no connection test for protocol ${row.protocol}`);
    }
  }

  const service: ProvidersModuleService = {
    llm,
    media,
    judge,

    presets: () => PROVIDER_PRESETS,

    async list(): Promise<ProviderDTO[]> {
      return (await repo.list()).map(toDto);
    },

    async get(id: string): Promise<ProviderDTO> {
      return toDto(await mustGet(id));
    },

    async create(body: CreateProviderBody): Promise<ProviderDTO> {
      const preset = findPreset(body.preset);
      if (!preset) throw new HttpError(422, "unknown_preset", `unknown preset ${body.preset}`);
      const jev = preset.protocol === "jev";
      if (jev) {
        // one JEV key per runtime: adding it again replaces the key on the same row
        const existing = (await repo.list()).find((r) => r.protocol === "jev");
        if (existing) {
          if (!body.apiKey?.trim()) throw new HttpError(422, "key_required", `${preset.label} needs an API key`);
          return service.update(existing.id, { apiKey: body.apiKey });
        }
      }
      // JEV only talks to its official endpoint, whatever the body says
      const baseUrl = normalizeBaseUrl(jev ? preset.baseUrl : body.baseUrl || preset.baseUrl);
      if (!baseUrl) throw new HttpError(422, "base_url_required", `${preset.label} needs a base URL`);
      await guardOrThrow(baseUrl, preset);
      const apiKey = body.apiKey?.trim() || null;
      if (preset.keyRequired && !apiKey) throw new HttpError(422, "key_required", `${preset.label} needs an API key`);
      const id = ctx.clock.id();
      const now = ctx.clock.now();
      const keyRef = apiKey ? keyRefFor(id) : null;
      if (apiKey && keyRef) {
        registerSecret(apiKey);
        await ctx.vault.set(keyRef, apiKey);
      }
      const row: ProviderRow = {
        id,
        preset: preset.id,
        label: body.label?.trim() || preset.label,
        protocol: preset.protocol,
        baseUrl,
        keyRef,
        keyHint: apiKey ? keyHint(apiKey) || null : null,
        models: jev ? [] : dedupeModels(body.models ?? preset.suggestedModels.map((m) => ({ id: m }))),
        caps: [...preset.caps],
        lastTestAt: null,
        lastTestOk: null,
        lastTestError: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await repo.insert(row);
      } catch (e) {
        if (keyRef) await ctx.vault.delete(keyRef).catch(() => {});
        throw e;
      }
      log.log("info", "provider added", { providerId: id, preset: preset.id, hasKey: keyRef !== null });
      return toDto(row);
    },

    async update(id: string, body: UpdateProviderBody): Promise<ProviderDTO> {
      const row = await mustGet(id);
      const preset = presetOf(row);
      const next: ProviderRow = { ...row };
      if (body.label !== undefined) next.label = body.label.trim() || row.label;
      if (row.protocol === "jev" && body.baseUrl !== undefined && normalizeBaseUrl(body.baseUrl) !== row.baseUrl) {
        throw new HttpError(422, "jev_official_only", "JEV uses its official endpoint; only the API key can change");
      }
      if (body.baseUrl !== undefined) {
        const url = normalizeBaseUrl(body.baseUrl);
        if (!url) throw new HttpError(422, "base_url_required", "base URL must not be empty");
        await guardOrThrow(url, preset);
        next.baseUrl = url;
      }
      // The stored key was entered for the old endpoint and must never follow the URL to a new
      // host (or path: gateways put tenants in the path). JEV be.base_url_key_policy: clear_on_change.
      // A changed URL without a new key deletes the stored key; the row stays unusable (routing and
      // the connection test skip keyless rows of key-required presets) until the owner re-enters it.
      const moved = next.baseUrl !== row.baseUrl;
      if (moved) {
        next.lastTestAt = null;
        next.lastTestOk = null;
        next.lastTestError = null;
      }
      if (body.models !== undefined && row.protocol !== "jev") next.models = dedupeModels(body.models);
      const key = body.apiKey?.trim() ?? "";
      const dropKey = !key && (moved || body.apiKey !== undefined);
      // an explicit empty key on an unchanged URL cannot drop a required key
      if (dropKey && !moved && keyRequired(row)) throw new HttpError(422, "key_required", `${row.label} needs an API key`);
      const ref = row.keyRef ?? keyRefFor(row.id);
      if (key) {
        next.keyRef = ref;
        next.keyHint = keyHint(key) || null;
      } else if (dropKey) {
        next.keyRef = null;
        next.keyHint = null;
      }
      const cleared = dropKey && row.keyRef !== null;
      // strictly increasing so cached adapters are rebuilt even with a frozen clock
      next.updatedAt = Math.max(ctx.clock.now(), row.updatedAt + 1);
      // vault first, then the row; a failed row write puts the vault back, so a stored
      // row never pairs its URL with a key the owner entered for another endpoint
      const touchesVault = key !== "" || cleared;
      const prev = touchesVault && row.keyRef ? await ctx.vault.get(row.keyRef) : null;
      if (key) {
        registerSecret(key);
        await ctx.vault.set(ref, key);
      } else if (cleared) {
        await ctx.vault.delete(row.keyRef!);
      }
      try {
        await repo.update(next);
      } catch (e) {
        if (touchesVault) await (prev ? ctx.vault.set(ref, prev) : ctx.vault.delete(ref)).catch(() => {});
        throw e;
      }
      forget(id);
      log.log("info", "provider updated", { providerId: id, keyChanged: key !== "" || cleared, keyCleared: cleared, baseUrlChanged: moved });
      return toDto(next);
    },

    async remove(id: string): Promise<void> {
      const row = await mustGet(id);
      await repo.remove(id);
      if (row.keyRef) await ctx.vault.delete(row.keyRef);
      forget(id);
      const stored = await repo.getRouting();
      if (stored) {
        const r = normalizeRouting(stored);
        const clear = <T extends { providerId: string | null; model: string | null }>(m: T): T => (m.providerId === id ? { ...m, providerId: null, model: null } : m);
        await repo.putRouting({ ...r, tiers: r.tiers.map(clear), image: clear(r.image), video: clear(r.video) }, ctx.clock.now());
      }
      log.log("info", "provider removed", { providerId: id });
    },

    async test(id: string, signal?: AbortSignal): Promise<ProviderTestResult> {
      const row = await mustGet(id);
      const t0 = performance.now();
      let ok = false;
      let error: string | null = null;
      let models: ProviderModel[] = [];
      try {
        const r = await probe(row, signal);
        models = r.models;
        error = r.fail ?? r.note ?? null;
        ok = !r.fail;
      } catch (e) {
        error = describe(e);
      }
      const latencyMs = Math.max(0, Math.round(performance.now() - t0));
      await repo.setTest(row.id, ctx.clock.now(), ok, error);
      log.log(ok ? "info" : "warn", "provider test", { providerId: id, ok, latencyMs, error });
      return { ok, latencyMs, error, models };
    },

    routing: loadRouting,

    async setRouting(input: ModelRouting): Promise<ModelRouting> {
      const r = normalizeRouting(input);
      const byId = new Map((await repo.list()).map((p) => [p.id, p]));
      for (const t of r.tiers) {
        if (!t.providerId) continue;
        const row = byId.get(t.providerId);
        if (!row) throw new HttpError(422, "unknown_provider", `tier ${t.tier}: provider not found`);
        if (!CHAT_PROTOCOLS.has(row.protocol)) throw new HttpError(422, "wrong_capability", `tier ${t.tier}: ${row.label} is not a chat provider`);
        if (!t.model) throw new HttpError(422, "model_required", `tier ${t.tier}: pick a model`);
      }
      for (const kind of ["image", "video"] as const) {
        const m = r[kind];
        if (!m.providerId) continue;
        const row = byId.get(m.providerId);
        if (!row) throw new HttpError(422, "unknown_provider", `${kind}: provider not found`);
        if (!MEDIA_PROTOCOLS.has(row.protocol) || !row.caps.includes(kind)) throw new HttpError(422, "wrong_capability", `${kind}: ${row.label} cannot generate ${kind}`);
      }
      await repo.putRouting(r, ctx.clock.now());
      return r;
    },

    async warm(): Promise<number> {
      let n = 0;
      for (const row of await repo.list()) {
        if (row.keyRef && (await keyFor(row))) n++;
      }
      return n;
    },
  };
  return service;
}
