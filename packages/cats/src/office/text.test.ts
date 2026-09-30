// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Text in the art: chips and plates never end in an ellipsis mid-word.
// A task's short title keeps two or three content words, a chip falls back
// to the verb and its head noun, a meeting's title to its kind.
import { describe, expect, test } from "bun:test";
import { chipTitle, chipTitleSized, headingTitle, measure, screenTitle, shortTitle, tabTitle } from "./text";

const MICRO = { size: 11 };
const BODY = { size: 13 };

describe("short titles", () => {
  test("the first three content words", () => {
    expect(shortTitle("Build the settings form")).toBe("Build settings form");
    expect(shortTitle("Review the settings form")).toBe("Review settings form");
    expect(shortTitle("Hedge the rate risk")).toBe("Hedge rate risk");
    expect(shortTitle("Test the router")).toBe("Test router");
    expect(shortTitle("Settings API")).toBe("Settings API");
  });

  test("a chip keeps the whole title when it fits, else two or three words, never a cut word", () => {
    expect(chipTitle("Test the router", 400, MICRO)).toBe("Test the router");
    const narrow = measure("Review form", MICRO) + 1;
    expect(chipTitle("Review the settings form", narrow, MICRO)).toBe("Review form");
    expect(chipTitle("Hedge the rate risk", measure("Hedge risk", MICRO) + 1, MICRO)).toBe("Hedge risk");
    for (const title of ["Review the settings form", "Backtest the momentum signal", "Hedge the rate risk", "Execute the rebalance"]) {
      for (const w of [40, 60, 80, 100]) expect(chipTitle(title, w, MICRO).includes("\u2026") && chipTitle(title, w, MICRO).includes(" ")).toBe(false);
    }
  });

  test("a plate's task line drops to the small size before it drops words", () => {
    const w = measure("Audit dependencies", MICRO) + 1;
    expect(measure("Audit dependencies", BODY)).toBeGreaterThan(w);
    expect(chipTitleSized("Audit dependencies", w, BODY, MICRO)).toEqual({ text: "Audit dependencies", small: true });
  });

  test("a single-word fallback is in sentence case", () => {
    const w = measure("Validation", MICRO) + 1;
    expect(chipTitle("Model validation", w, MICRO)).toBe("Validation");
  });

  test("a meeting title falls back to its kind and short title, then its kind", () => {
    const title = "Standup: the settings page";
    expect(headingTitle(title, 1000, BODY)).toBe(title);
    expect(headingTitle(title, measure("Standup: settings page", BODY) + 1, BODY)).toBe("Standup: settings page");
    expect(headingTitle(title, measure("Standup", BODY) + 2, BODY)).toBe("Standup");
  });
});

describe("screen titles", () => {
  test("a file name in 12 characters or fewer keeps its extension, cut on whole words", () => {
    expect(screenTitle("apps/web/src/empty-state.tsx")).toBe("empty.tsx");
    expect(screenTitle("settings.tsx")).toBe("settings.tsx");
    expect(screenTitle("dashboard-risk.svg")).toBe("risk.svg");
    expect(screenTitle(null)).toBeNull();
    for (const f of ["signals/momentum-long-short.py", "exposure-by-desk.csv", "router.test.ts"]) expect((screenTitle(f) ?? "").length).toBeLessThanOrEqual(12);
  });

  test("a tab never shows a cut word: the title, a shorter title, else the screen's label", () => {
    const style = { size: 11, mono: true };
    const w = (t: string) => measure(t, style);
    expect(tabTitle("limits.md", w("limits.md"), style, "risk")).toBe("limits.md");
    expect(tabTitle("empty-state.tsx", w("empty.tsx") + 1, style, "editor")).toBe("empty.tsx");
    expect(tabTitle("momentum.py", w("momentum") , style, "risk")).toBe("risk");
    expect(tabTitle("nav.test.ts", w("nav.ts") + 1, style, "editor")).toBe("editor");
    expect(tabTitle("rates.md", 4, style, "risk")).toBe("");
  });
});
