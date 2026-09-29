// JEV decision port (POST https://api.typesafe.ai/v1/systemone). The jev
// module owns the catalog, prechecks, thresholds and fallback; this port is
// only the transport. Answer shapes follow the JEV API: choice answers carry
// { type, choice, confidence, probabilities }, noul answers { type, noul }
// (probability of yes), score answers { type, score, confidence }.
export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string };

export type JevAnswer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence?: number; probabilities?: Record<string, number> }
  | { type: "noul"; noul: number; confidence?: number };

export type JudgeResult =
  | { verified: true; model: string; answers: Record<string, JevAnswer>; latencyMs: number }
  | { verified: false; stamp: "UNVERIFIED BY JEV"; error: string; latencyMs: number };

export interface Judge {
  /** false when no JEV key is configured */
  configured(): Promise<boolean>;
  decide(req: {
    decisionId: string;
    state: Record<string, unknown>;
    questions: Record<string, JevQuestion>;
    signal?: AbortSignal;
  }): Promise<JudgeResult>;
}
