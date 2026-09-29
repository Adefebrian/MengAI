// Port interface for the default LLM. Modules depend on this shape, never on
// the `openai` client directly. See core/adapters/ai.ts for the concrete
// adapter, which is pinned to gpt-4o-mini per jal-standards.
export interface CompletionOptions {
  system?: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface AiPort {
  /** Single-turn chat completion using the JAL default model. */
  complete(prompt: string, options?: CompletionOptions): Promise<string>;
}
