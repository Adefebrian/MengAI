// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Provider-agnostic chat port. Two adapters implement it: openai_chat (every
// OpenAI-compatible vendor) and anthropic_messages (native cache_control).
// The context module owns prompt layout; adapters only translate it.
import type { AgentRole, ProviderModel, ProviderProtocol, Tier } from "@mengai/shared";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; dataBase64: string };

export interface ToolCall {
  id: string;
  name: string;
  /** raw JSON string exactly as the model produced it */
  arguments: string;
}

export interface ChatMessage {
  role: Exclude<ChatRole, "system">;
  content: string | ContentPart[];
  /** assistant messages that called tools */
  toolCalls?: ToolCall[];
  /** tool result messages */
  toolCallId?: string;
  /** Place a prompt-cache breakpoint after this message. Anthropic: cache_control;
   * OpenAI-compatible: ignored (prefix caching is automatic). Max 3 per request. */
  cacheBreakpoint?: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema object */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  /** Stable charter text. Adapters put it in the system slot and, when cacheSystem, mark it cacheable. */
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "none" | "required";
  maxOutputTokens?: number;
  temperature?: number;
  /** Stable routing key for vendor prompt caches (OpenAI prompt_cache_key). */
  cacheKey?: string;
  /** Mark system + tools as one cached prefix (breakpoint 1). */
  cacheSystem?: boolean;
  responseFormat?: "text" | "json";
  signal?: AbortSignal;
  /** Streamed text deltas. Adapters stream when this is set. */
  onDelta?: (text: string) => void;
}

export interface Usage {
  /** full prompt size as the vendor reports it (cached part included) */
  inputTokens: number;
  outputTokens: number;
  /** prompt tokens served from the vendor cache */
  cachedTokens: number;
  /** prompt tokens written to the cache (Anthropic) */
  cacheWriteTokens: number;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end" | "tool_use" | "length" | "filter";
  usage: Usage;
  model: string;
  latencyMs: number;
  /** transport retries the adapter's retry wrapper performed */
  retries: number;
}

export type LlmErrorKind =
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "context_length"
  | "bad_request"
  | "not_found"
  | "network"
  | "timeout"
  | "aborted"
  | "server";

export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    message: string,
    public readonly status: number | null = null,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "LlmError";
  }
  get transient(): boolean {
    return ["rate_limit", "overloaded", "network", "timeout", "server"].includes(this.kind);
  }
}

export interface LlmProvider {
  /** providers table row id */
  readonly id: string;
  readonly protocol: ProviderProtocol;
  chat(req: ChatRequest): Promise<ChatResult>;
  listModels(signal?: AbortSignal): Promise<ProviderModel[]>;
}

export interface ResolvedModel {
  provider: LlmProvider;
  model: string;
  /** best known context window in tokens (default 128k when unknown) */
  contextWindow: number;
}

/** Implemented by the providers module: tier (and optional role override) -> concrete model. */
export interface LlmRouter {
  resolve(opts: { tier: Tier; role?: AgentRole }): Promise<ResolvedModel>;
  /** true when at least one chat provider with a usable key exists */
  configured(): Promise<boolean>;
}
