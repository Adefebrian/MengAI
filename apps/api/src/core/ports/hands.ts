// Local automation port, backed by the services/hands Rust helper over
// stdio JSON-RPC (contract in @mengai/shared/hands). Only the automation
// module may call it, and only after its permission gate says yes.
import type { HandsMethod, HandsParams, HandsResults } from "@mengai/shared";

export interface Hands {
  /** false when the helper binary is missing, not macOS, or server mode */
  readonly available: boolean;
  call<M extends HandsMethod>(
    method: M,
    params: HandsParams[M],
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<HandsResults[M]>;
  /** release held input, cancel queued calls; never throws */
  stop(): Promise<void>;
  /** terminate the helper process */
  close(): Promise<void>;
}
