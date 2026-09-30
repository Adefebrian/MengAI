// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Text inside the office art: the art is one aria-hidden SVG, so every
// label is fitted to its box here (an ellipsis when it would not fit, the
// full value stays in the desk button's accessible name). Widths come from a
// canvas measure with the page's own font when there is one, else from a
// per-character estimate that errs wide.

let ctx: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
    const c = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    ctx = c && typeof c.measureText === "function" ? c : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

const SANS = '"Geist", "Geist Fallback", system-ui, sans-serif';
const MONO = '"Geist Mono", "Geist Mono Fallback", ui-monospace, monospace';

export interface TextStyle {
  size: number;
  weight?: 400 | 500 | 600;
  mono?: boolean;
}

/** Width of a string in px at a style. */
export function measure(text: string, style: TextStyle): number {
  const c = context();
  if (c) {
    c.font = `${style.weight ?? 400} ${style.size}px ${style.mono ? MONO : SANS}`;
    const w = c.measureText(text).width;
    if (Number.isFinite(w) && w > 0) return w;
  }
  const per = style.mono ? 0.62 : (style.weight ?? 400) >= 500 ? 0.6 : 0.56;
  return text.length * style.size * per;
}

/** The string, cut with an ellipsis so it fits maxWidth; empty when not even one letter fits. */
export function fit(text: string, maxWidth: number, style: TextStyle): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || maxWidth <= 0) return "";
  if (measure(clean, style) <= maxWidth) return clean;
  const ell = "…";
  let lo = 0;
  let hi = clean.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(clean.slice(0, mid).trimEnd() + ell, style) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : clean.slice(0, lo).trimEnd() + ell;
}

/** The last path segment of a file, for the monitor tab. */
export function baseName(file: string | null): string | null {
  if (!file) return null;
  const parts = file.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/** The longest screen title a monitor tab takes: the file's own name when it fits, else a shorter one that keeps the extension. */
export const SCREEN_TITLE_MAX = 12;

/**
 * A file name cut to at most `max` characters on whole words, keeping its
 * extension ("empty-state.tsx" is "empty.tsx"), or null when not even the
 * first word fits beside the extension.
 */
export function shortFile(base: string, max: number): string | null {
  if (base.length <= max) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 6 ? base.slice(dot) : "";
  const stem = ext ? base.slice(0, dot) : base;
  const words = stem.split(/[-_.\s]+/).filter(Boolean);
  let out = "";
  let n = 0;
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length + ext.length > max) break;
    out = next;
    n++;
  }
  // a test file never loses its test word: "nav.test.ts" is never shown as "nav.ts"
  if (words.slice(n).some((w) => /^(test|tests|spec|stories)$/i.test(w))) return null;
  if (out) return out + ext;
  // no leading words fit: the first single word that does ("dashboard-risk.svg" is "risk.svg")
  const one = words.find((w) => w.length + ext.length <= max);
  return one ? one + ext : null;
}

/** A monitor's screen title: the file's last segment in 12 characters or fewer with its extension kept; null without a file or when no whole word fits (the screen's label stands in). */
export function screenTitle(file: string | null, max = SCREEN_TITLE_MAX): string | null {
  const base = baseName(file);
  return base ? shortFile(base, max) : null;
}

/**
 * The tab text that fits a monitor whole: the title, else a shorter title on
 * whole words with the extension kept, else the screen's own label, else
 * nothing. A tab never ends in a cut word or an ellipsis.
 */
export function tabTitle(title: string, maxWidth: number, style: TextStyle, alt = ""): string {
  if (maxWidth <= 0) return "";
  const tries = [title];
  for (let k = title.length - 1; k >= 4; k--) {
    const s = shortFile(title, k);
    if (s && !tries.includes(s)) tries.push(s);
  }
  if (alt && !tries.includes(alt)) tries.push(alt);
  return tries.find((t) => t && measure(t, style) <= maxWidth) ?? "";
}

const STOP = new Set(["the", "a", "an", "of", "for", "to", "and", "with", "on", "in", "our", "my", "your", "its", "this", "that", "at", "by", "from", "into"]);

/** A task's short title: its first three content words ("Build the settings form" is "Build settings form"). */
export function shortTitle(title: string): string {
  const words = title.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const content = words.filter((w) => !STOP.has(w.toLowerCase()));
  return (content.length ? content : words).slice(0, 3).join(" ");
}

/**
 * A title for a small chip or plate: the whole title when it fits, else its
 * short title of two or three words, else the verb and its head noun
 * ("Review form"), each tried at the style and then at the smaller one when
 * given, so a chip never ends in an ellipsis mid-word; only a single word
 * too long for the chip is cut.
 */
export function chipTitle(title: string, maxWidth: number, style: TextStyle, small?: TextStyle): string {
  return chipTitleSized(title, maxWidth, style, small).text;
}

/** chipTitle, and whether it had to use the smaller style. */
export function chipTitleSized(title: string, maxWidth: number, style: TextStyle, small?: TextStyle): { text: string; small: boolean } {
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean || maxWidth <= 0) return { text: "", small: false };
  const words = shortTitle(clean).split(" ");
  // the whole title, the short one, the verb and its head noun, all at the style first so plates side by side keep one size; then the smaller size
  const tries = [clean, words.join(" ")];
  if (words.length >= 3) tries.push(`${words[0]} ${words[words.length - 1]}`);
  for (const t of tries) if (measure(t, style) <= maxWidth) return { text: t, small: false };
  if (small) for (const t of tries) if (measure(t, small) <= maxWidth) return { text: t, small: true };
  // the head noun, in sentence case: "Signal", "Validation"
  const last = [words.slice(-2).join(" "), words[words.length - 1]!, words[0]!].map(sentence);
  for (const t of last) if (measure(t, style) <= maxWidth) return { text: t, small: false };
  return { text: fit(sentence(words[0]!), maxWidth, style), small: false };
}

function sentence(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/** A meeting's title for a board: whole, else "Kind: short title", else the kind alone. */
export function headingTitle(title: string, maxWidth: number, style: TextStyle): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (measure(clean, style) <= maxWidth) return clean;
  const at = clean.indexOf(":");
  if (at > 0) {
    const head = clean.slice(0, at).trim();
    const short = `${head}: ${shortTitle(clean.slice(at + 1))}`;
    if (measure(short, style) <= maxWidth) return short;
    if (measure(head, style) <= maxWidth) return head;
  }
  return chipTitle(clean, maxWidth, style);
}
