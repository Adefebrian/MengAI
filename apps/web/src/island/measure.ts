// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Measures the ear text in the island's own face, so the ears are exactly
// as wide as their words: a 2D canvas with the page's --font-sans at the
// ear's weight and size (500, --text-n1). Without a canvas (tests) the
// machine's per-character estimate stands in.
import { estimateText, type Measure } from "./machine";

export function earFont(): string {
  let family = "";
  try {
    family = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
  } catch {
    family = "";
  }
  return `500 13px ${family || "system-ui, sans-serif"}`;
}

export function canvasMeasure(font: string = earFont()): Measure {
  try {
    const canvas = document.createElement("canvas");
    const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!ctx || typeof ctx.measureText !== "function") return estimateText;
    ctx.font = font;
    const probe = ctx.measureText("Review 5 of 7").width;
    if (!(probe > 0)) return estimateText;
    // one point of room so a rounding difference never pushes a word into the notch
    return (text) => Math.ceil(ctx.measureText(text).width) + 1;
  } catch {
    return estimateText;
  }
}
