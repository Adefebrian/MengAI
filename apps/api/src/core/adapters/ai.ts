// Concrete AiPort adapter, wrapping the lazily-constructed OpenAI client in
// ../../lib/ai. Importing this module never throws, even with no
// OPENAI_API_KEY configured; the clear error only fires when a caller
// actually invokes `complete`.
import { complete } from "../../lib/ai";
import type { AiPort, CompletionOptions } from "../ports/ai";

export function createAiAdapter(): AiPort {
  return {
    complete(prompt: string, options?: CompletionOptions): Promise<string> {
      return complete(prompt, options);
    },
  };
}
