// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The owner's answer to a cat that waits on them, as the note the engine
// hands to the waiting cat (POST /api/runs/:id/message resolves the cat
// that is waiting on you). One source for the run screen and the Mac
// island, so both answer in the same words. The engine reads a reply that
// starts with yes as an approval (OWNER_YES in the runs engine).
import type { ApprovalDTO } from "@mengai/shared";

/** The answer to an approval card (the sample run and older engines). */
export function askAnswer(a: ApprovalDTO, decision: "approve" | "deny", scope: "once" | "session"): { text: string; agentId?: string } {
  const what = a.title.trim().replace(/[.\s]+$/, "");
  const text =
    decision === "deny"
      ? `No, do not do this: ${what}.`
      : scope === "session"
        ? `Yes, go ahead: ${what}. You may do this again for the rest of this run without asking.`
        : `Yes, go ahead this once: ${what}.`;
  return a.agentId ? { text, agentId: a.agentId } : { text };
}

/** The answer to a question a cat raised to the owner (request.raised with toOwner). */
export function requestAnswer(decision: "approve" | "deny", agentId: string | null): { text: string; agentId?: string } {
  const text = decision === "approve" ? "Yes, go ahead this once." : "No, do not do this.";
  return agentId ? { text, agentId } : { text };
}
