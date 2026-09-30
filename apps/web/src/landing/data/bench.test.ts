// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, test } from "bun:test";
import { HEADLINE, SCENARIOS } from "./bench";

describe("token benchmark numbers", () => {
  test("the per-scenario rows sum to the published headline", () => {
    expect(SCENARIOS.reduce((a, s) => a + s.legacy, 0)).toBe(HEADLINE.legacyBillable);
    expect(SCENARIOS.reduce((a, s) => a + s.v2, 0)).toBe(HEADLINE.v2Billable);
    expect(SCENARIOS.reduce((a, s) => a + s.steps, 0)).toBe(HEADLINE.steps);
    expect(SCENARIOS.length).toBe(HEADLINE.scenarios);
    expect(new Set(SCENARIOS.map((s) => s.role)).size).toBe(HEADLINE.roles);
  });

  test("each row's saving matches its own tokens to one decimal", () => {
    for (const s of SCENARIOS) expect(Math.round((1 - s.v2 / s.legacy) * 1000) / 10).toBeCloseTo(s.savingsPct, 1);
    expect(Math.round((1 - HEADLINE.v2Billable / HEADLINE.legacyBillable) * 1000) / 10).toBe(HEADLINE.savingsPct);
  });
});
