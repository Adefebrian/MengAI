// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// ui_check: a static scan of UI source for design law violations, with a
// file:line finding each. Pure text in, findings out: no shell, no browser,
// no dependency, so it runs the same on macOS, Windows and Linux. The tools
// service gathers the files through the jailed workspace port.
//
// What it flags (each rule errs toward silence: an obvious violation only):
//   gradient        linear, radial and conic gradients; Tailwind gradient classes
//   shadow          box-shadow or drop-shadow with a blur (a spread-only focus ring passes)
//   glow            blurred text-shadow, big or colored shadows, glow or neon class names
//   side-line       a 2 px or wider border on one side, or an inset stripe shadow
//   emoji, em-dash  in copy (comments are skipped)
//   reduced-motion  keyframe, GSAP or motion animation with no prefers-reduced-motion anywhere
//   tap-target      buttons, links and inputs sized under 44 px
//   too-wide        fixed widths wider than a 320 px phone, and 100vw
//   small-text      font sizes under 12 px
//   alt-text        img without alt

export const UI_CHECK = "ui_check";

/** HTML, CSS and component files the scan reads. */
export const UI_FILE_RE = /\.(html?|css|scss|less|jsx|tsx|vue|svelte|astro)$/i;
/** Minified and generated files are never the crew's copy. */
const SKIP_FILE_RE = /\.min\.(css|js)$|(^|\/)(vendor|coverage|build|\.next|\.output)\//i;

export const UI_CHECK_LIMITS = {
  /** files per call (sorted by path, the rest reported as not checked) */
  maxFiles: 300,
  /** a larger file is skipped (generated or vendored) */
  maxFileBytes: 512 * 1024,
  /** finding lines in the tool output; the header counts every finding */
  maxShown: 60,
} as const;

export type UiRule =
  | "gradient"
  | "shadow"
  | "glow"
  | "side-line"
  | "emoji"
  | "em-dash"
  | "reduced-motion"
  | "tap-target"
  | "too-wide"
  | "small-text"
  | "alt-text";

export interface UiFinding {
  file: string;
  line: number;
  rule: UiRule;
  message: string;
}

export interface UiFile {
  path: string;
  text: string;
}

/** The tool schema (a core ports ToolSpec, structurally). */
export const UI_CHECK_SPEC: { name: string; description: string; parameters: Record<string, unknown> } = {
  name: UI_CHECK,
  description:
    "Check UI files (HTML, CSS, JSX, TSX, Vue, Svelte) against the design law: gradients, shadows, glow, side stripes, emoji, em-dashes, motion without reduced motion, targets under 44 px, over-wide widths, text under 12 px, missing alt. Returns file:line findings.",
  parameters: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string", maxLength: 1024 }, maxItems: 40, description: "Files or folders; default all" },
    },
  },
};

export const isUiFile = (path: string): boolean => UI_FILE_RE.test(path) && !SKIP_FILE_RE.test(path.replace(/\\/g, "/"));

type Kind = "css" | "markup" | "jsx";
function kindOf(path: string): Kind {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "css" || ext === "scss" || ext === "less") return "css";
  if (ext === "jsx" || ext === "tsx") return "jsx";
  return "markup";
}

// ------------------------------------------------------------ text helpers
/** Replaces a match with spaces, keeping every line break, so indexes and line numbers stay true. */
const blank = (m: string) => m.replace(/[^\n]/g, " ");

function stripComments(text: string, kind: Kind): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (kind === "markup") out = out.replace(/<!--[\s\S]*?-->/g, blank);
  // whole-line // comments (scss, less, jsx, script blocks); never a url or a string on a code line
  out = out.replace(/^[ \t]*\/\/[^\n]*/gm, blank);
  return out;
}

class Lines {
  private readonly starts: number[] = [0];
  constructor(text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }
  /** 1-based line of an index */
  at(index: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
}

/** A CSS length in px: px, rem and em (at 16 px) and pt; null for anything relative or unknown. */
export function toPx(value: string): number | null {
  const m = /^(-?\d*\.?\d+)(px|rem|em|pt)?$/i.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "px") return n;
  if (unit === "rem" || unit === "em") return n * 16;
  if (unit === "pt") return (n * 4) / 3;
  return n === 0 ? 0 : null;
}

/** Splits on a separator at parenthesis depth 0 and outside quotes. */
function splitTop(value: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// ------------------------------------------------------------- CSS parser
interface Decl {
  prop: string;
  value: string;
  /** index of the property in the file text */
  at: number;
  /** the rule's selector (the tag name for inline styles) */
  selector: string;
  /** inside a min-width media query: a wider-screen rule */
  wide: boolean;
  /** inside a print media query */
  print: boolean;
}

interface CssScan {
  decls: Decl[];
  /** indexes of @keyframes rules */
  keyframes: number[];
  /** selectors with their index (for class name checks) */
  selectors: Array<{ selector: string; at: number }>;
}

/**
 * A forgiving CSS reader: nested rules (scss, CSS nesting), at-rule groups,
 * strings and parentheses (a data URL's ";" never splits a declaration).
 * offset shifts every index when the CSS sits inside a bigger file; root
 * names the element a CSS-in-JS template styles (its top-level declarations
 * belong to it), null for a stylesheet.
 */
function parseCss(css: string, offset = 0, root: string | null = null): CssScan {
  const decls: Decl[] = [];
  const keyframes: number[] = [];
  const selectors: CssScan["selectors"] = [];
  type Frame = { selector: string; wide: boolean; print: boolean; group: boolean };
  const stack: Frame[] = [{ selector: root ?? "", wide: false, print: false, group: root === null }];
  let start = 0;
  let depth = 0;
  let quote = "";
  const top = () => stack[stack.length - 1]!;
  const flushDecl = (end: number) => {
    const raw = css.slice(start, end);
    const colon = raw.indexOf(":");
    const frame = top();
    if (colon > 0 && !frame.group) {
      const prop = raw.slice(0, colon).trim().toLowerCase();
      const lead = raw.length - raw.trimStart().length;
      if (/^-?[a-z-]+$/.test(prop)) decls.push({ prop, value: raw.slice(colon + 1).trim(), at: offset + start + lead, selector: frame.selector, wide: frame.wide, print: frame.print });
    }
  };
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    if (ch === ";") {
      flushDecl(i);
      start = i + 1;
    } else if (ch === "{") {
      const head = css.slice(start, i);
      const prelude = head.trim();
      const at = offset + start + (head.length - head.trimStart().length);
      const parent = top();
      if (/^@(-webkit-)?keyframes\b/i.test(prelude)) {
        keyframes.push(at);
        // skip the whole block: from and to steps are not rules
        let d = 1;
        let j = i + 1;
        for (; j < css.length && d > 0; j++) {
          if (css[j] === "{") d++;
          else if (css[j] === "}") d--;
        }
        i = j - 1;
        start = j;
        continue;
      }
      if (prelude.startsWith("@")) {
        const media = /^@media\b/i.test(prelude);
        const group = /^@(media|supports|container|layer|document|scope)\b/i.test(prelude);
        stack.push({
          selector: group ? parent.selector : prelude,
          wide: parent.wide || (media && /min-width/i.test(prelude) && !/max-width/i.test(prelude)),
          print: parent.print || (media && /\bprint\b/i.test(prelude)),
          group: group && parent.group,
        });
      } else {
        const selector = parent.selector && !parent.group ? (prelude.includes("&") ? prelude.replace(/&/g, parent.selector) : `${parent.selector} ${prelude}`) : prelude;
        selectors.push({ selector: prelude, at });
        stack.push({ selector, wide: parent.wide, print: parent.print, group: false });
      }
      start = i + 1;
    } else if (ch === "}") {
      flushDecl(i);
      if (stack.length > 1) stack.pop();
      start = i + 1;
    }
  }
  return { decls, keyframes, selectors };
}

/** Inline declarations (style="a: b; c: d") as declarations of the tag. */
function inlineDecls(style: string, at: number, tag: string): Decl[] {
  const out: Decl[] = [];
  let pos = 0;
  for (const part of splitTop(style, ";")) {
    const colon = part.indexOf(":");
    if (colon > 0) {
      const prop = part.slice(0, colon).trim().toLowerCase();
      if (/^-?[a-z-]+$/.test(prop)) out.push({ prop, value: part.slice(colon + 1).trim(), at: at + pos, selector: tag, wide: false, print: false });
    }
    pos += part.length + 1;
  }
  return out;
}

const PX_PROPS = new Set(["font-size", "width", "min-width", "height", "min-height"]);

/** A JSX style object ({ fontSize: 10, boxShadow: "..." }) as declarations; numbers are px where React reads them so. */
function jsxStyleDecls(body: string, at: number, tag: string): Decl[] {
  const out: Decl[] = [];
  const re = /([A-Za-z]+)\s*:\s*("[^"\n]*"|'[^'\n]*'|`[^`\n]*`|-?\d*\.?\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const prop = m[1]!.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    let value = m[2]!;
    if (/^["'`]/.test(value)) value = value.slice(1, -1);
    else if (PX_PROPS.has(prop)) value = `${value}px`;
    out.push({ prop, value, at: at + m.index, selector: tag, wide: false, print: false });
  }
  return out;
}

// ------------------------------------------------------------ value checks
const NEUTRAL_NAMES = new Set(["black", "white", "gray", "grey", "transparent", "currentcolor", "silver", "inset"]);

/** A color that is clearly not a neutral gray (the glow tell). */
function colored(layer: string): boolean {
  const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(layer);
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    return Math.max(r, g, b) - Math.min(r, g, b) > 40;
  }
  const hex = /#([0-9a-f]{3,8})\b/i.exec(layer);
  if (hex) {
    let h = hex[1]!;
    if (h.length <= 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    return Math.max(r, g, b) - Math.min(r, g, b) > 40;
  }
  const hsl = /hsla?\(\s*[\d.]+(?:deg)?[\s,]+([\d.]+)%/i.exec(layer);
  if (hsl) return Number(hsl[1]) > 25;
  const words = layer.match(/\b[a-z]{3,}\b/gi) ?? [];
  return words.some((w) => !NEUTRAL_NAMES.has(w.toLowerCase()) && !/^(px|rem|em)$/i.test(w));
}

export interface ShadowLayer {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  colored: boolean;
}

/** Shadow layers of a box-shadow or text-shadow value; [] for none, variables and anything unreadable. */
export function shadowLayers(value: string): ShadowLayer[] {
  const v = value.replace(/!important/i, "").trim();
  if (!v || /^(none|0|initial|inherit|unset|revert)$/i.test(v) || v.includes("var(")) return [];
  const out: ShadowLayer[] = [];
  for (const raw of splitTop(v, ",")) {
    const layer = raw.trim();
    if (!layer) continue;
    const noColor = layer.replace(/(rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)/gi, " ").replace(/#[0-9a-f]{3,8}\b/gi, " ");
    const lengths = noColor
      .split(/\s+/)
      .map((t) => toPx(t))
      .filter((n): n is number => n !== null);
    if (lengths.length < 2) continue;
    out.push({ inset: /\binset\b/i.test(layer), x: lengths[0]!, y: lengths[1]!, blur: lengths[2] ?? 0, spread: lengths[3] ?? 0, colored: colored(layer) });
  }
  return out;
}

const GRADIENT_RE = /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i;
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;
const EM_DASH_RE = /\u2014|&mdash;|&#8212;|&#x2014;|\\u2014/i;
/** The last compound of a selector names a control: a tag, a control role or a button-like class. */
const INTERACTIVE_RE = /^(button|a|input|select|textarea|summary)(?=$|[.:#[])|\[role=["']?(button|link|tab|menuitem|switch)\b|\.(btn|button|icon-btn|icon-button|chip)[\w-]*|\.(nav-link|menu-item|close)(?=$|[.:#[])/i;
/** The element a selector part styles: its last compound. */
const lastCompound = (part: string) => part.trim().split(/\s*[\s>+~]\s*/).pop() ?? "";
const NOT_A_TARGET_RE = /::?(before|after|placeholder|marker|selection)|\b(checkbox|radio|range|hidden)\b|-webkit-|-moz-/i;
const SIDES = new Set([
  "border-left",
  "border-right",
  "border-inline-start",
  "border-inline-end",
  "border-left-width",
  "border-right-width",
  "border-inline-start-width",
  "border-inline-end-width",
]);
const REDUCED_RE = /prefers-reduced-motion|useReducedMotion|reducedMotion|reduced-motion/i;
const JS_ANIMATION_RE = /\bgsap\.(?:to|from|fromTo|timeline)\s*\(|\.animate\s*\(\s*[[{]|<motion\.[a-z]/;
const CLASS_ATTR_RE = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*[`"']([^`"']*)[`"']\s*\})/;

// ------------------------------------------------------------------ scan
interface FileScan {
  findings: UiFinding[];
  /** index of the first CSS animation, when the file animates */
  animation: number | null;
  /** index of the first scripted animation */
  jsAnimation: number | null;
  /** the file handles reduced motion itself */
  reduced: boolean;
  lines: Lines;
}

/** Declarations of every kind of style a file can carry: stylesheet, style blocks, CSS-in-JS, inline styles. */
function stylesOf(text: string, kind: Kind): CssScan {
  const all: CssScan = { decls: [], keyframes: [], selectors: [] };
  const take = (r: CssScan) => {
    all.decls.push(...r.decls);
    all.keyframes.push(...r.keyframes);
    all.selectors.push(...r.selectors);
  };
  if (kind === "css") {
    take(parseCss(text, 0));
    return all;
  }
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    take(parseCss(m[1]!.replace(/^\s*\{`|`\}\s*$/g, blank), m.index! + m[0].indexOf(">") + 1));
  }
  for (const m of text.matchAll(/<([a-zA-Z][\w-]*)\b[^<>]*?\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const style = m[2] ?? m[3] ?? "";
    all.decls.push(...inlineDecls(style, m.index! + m[0].length - style.length - 1, m[1]!.toLowerCase()));
  }
  if (kind === "jsx") {
    for (const m of text.matchAll(/(?:styled(?:\.([A-Za-z]+)|\([^)]*\))(?:\.attrs\([^)]*\))?|\bcss|createGlobalStyle|injectGlobal)\s*`([\s\S]*?)`/g)) {
      const css = m[2]!.replace(/\$\{[^}]*\}/g, (s) => "0".padEnd(s.length, " "));
      const global = /^(createGlobalStyle|injectGlobal)/.test(m[0]);
      take(parseCss(css, m.index! + m[0].indexOf("`") + 1, global ? null : (m[1] ?? "styled").toLowerCase()));
    }
    for (const m of text.matchAll(/<([a-zA-Z][\w.-]*)\b[^<>]*?\sstyle=\{\{([\s\S]*?)\}\}/g)) {
      all.decls.push(...jsxStyleDecls(m[2]!, m.index! + m[0].length - m[2]!.length - 2, m[1]!.toLowerCase()));
    }
  }
  return all;
}

function scanFile(file: UiFile): FileScan {
  const kind = kindOf(file.path);
  const text = stripComments(file.text.replace(/\r\n?/g, "\n"), kind);
  const lines = new Lines(text);
  const findings: UiFinding[] = [];
  const seen = new Set<string>();
  const add = (at: number, rule: UiRule, message: string) => {
    const line = lines.at(at);
    const key = `${line}:${rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file: file.path, line, rule, message });
  };

  const { decls, keyframes, selectors } = stylesOf(text, kind);
  // per rule block: a min-height lifts a small height; a relative max-width tames a fixed width
  const heights = new Map<string, { height: number | null; min: number | null; at: number; selector: string }>();
  const tamed = new Set<string>();
  for (const d of decls) if (d.prop === "max-width" && /%|vw|min\(|calc\(|clamp\(/i.test(d.value)) tamed.add(`${d.selector}|${d.wide}`);

  for (const d of decls) {
    const value = d.value.replace(/\s*!important\s*$/i, "");
    if (GRADIENT_RE.test(value)) add(d.at, "gradient", "gradient: use a flat surface (a tonal step and a 1 px hairline)");
    if (d.prop === "box-shadow" || d.prop === "-webkit-box-shadow") {
      for (const l of shadowLayers(value)) {
        if (l.blur > 0 && (l.colored || l.blur >= 24)) add(d.at, "glow", `glowing shadow (${l.blur}px blur${l.colored ? ", colored" : ""}): remove it, depth is a tonal step and a hairline`);
        else if (l.blur > 0) add(d.at, "shadow", `box-shadow with a ${l.blur}px blur: flat surfaces only, a tonal step and a 1 px hairline give depth`);
        else if (l.inset && Math.abs(l.x) >= 2 && l.y === 0 && l.spread === 0) add(d.at, "side-line", "inset side stripe: no side lines, show state with an icon and a tonal surface");
      }
    }
    if (d.prop === "text-shadow" && shadowLayers(value).some((l) => l.blur > 0)) add(d.at, "glow", "blurred text-shadow reads as glow: remove it");
    if ((d.prop === "filter" || d.prop === "-webkit-filter") && /drop-shadow\s*\(/i.test(value)) add(d.at, "shadow", "drop-shadow filter: flat surfaces only");
    if (SIDES.has(d.prop) && !/^(none|0|hidden)\b/i.test(value)) {
      const w = value
        .split(/\s+/)
        .map(toPx)
        .find((n) => n !== null) ?? (/\b(medium|thick)\b/i.test(value) ? 3 : null);
      if (w != null && w >= 2) add(d.at, "side-line", `${d.prop} ${w}px: no side stripes on cards or panels, use a full 1 px hairline or a tonal fill`);
    }
    if (d.prop === "font-size" && !d.print) {
      const px = toPx(value);
      if (px !== null && px > 0 && px < 12) add(d.at, "small-text", `font-size ${value}: text is 12 px at least (inputs 16 px)`);
    }
    if (d.prop === "font" && !d.print) {
      const m = /(?:^|\s)(\d*\.?\d+(?:px|rem|pt))(?=\s*\/|\s)/i.exec(value);
      const px = m ? toPx(m[1]!) : null;
      if (px !== null && px > 0 && px < 12) add(d.at, "small-text", `font size ${m![1]}: text is 12 px at least`);
    }
    if ((d.prop === "width" || d.prop === "min-width") && !d.wide) {
      if (/^100vw$/i.test(value)) add(d.at, "too-wide", `${d.prop}: 100vw is wider than the page when a scrollbar shows; use 100%`);
      else {
        const px = toPx(value);
        if (px !== null && px > 320 && !tamed.has(`${d.selector}|${d.wide}`))
          add(d.at, "too-wide", `${d.prop} ${value} is wider than a 320 px phone: use max-width with width 100%, or set it inside a min-width media query`);
      }
    }
    if ((d.prop === "height" || d.prop === "min-height") && d.selector && !NOT_A_TARGET_RE.test(d.selector)) {
      const target = splitTop(d.selector, ",").some((part) => INTERACTIVE_RE.test(lastCompound(part)));
      const px = toPx(value);
      if (target && px !== null && px > 0) {
        const key = `${d.selector}|${d.wide}`;
        const h = heights.get(key) ?? { height: null, min: null, at: d.at, selector: d.selector };
        if (d.prop === "height") {
          h.height = px;
          h.at = d.at;
        } else h.min = px;
        heights.set(key, h);
      }
    }
  }
  for (const h of heights.values()) {
    const size = Math.max(h.height ?? 0, h.min ?? 0);
    if (size > 0 && size < 44) add(h.at, "tap-target", `${h.selector.trim().slice(0, 60)} is ${size}px tall: controls and tap targets are 44 px at least`);
  }
  for (const s of selectors) if (/[.#][\w-]*(glow|neon)[\w-]*/i.test(s.selector)) add(s.at, "glow", `${s.selector.slice(0, 60)}: glow and neon styles are out`);

  if (kind !== "css") {
    // class names (Tailwind and friends)
    for (const m of text.matchAll(new RegExp(CLASS_ATTR_RE.source, "g"))) {
      const at = m.index!;
      const tokens = (m[1] ?? m[2] ?? m[3] ?? "").split(/\s+/).filter(Boolean).map((t) => t.replace(/^!/, ""));
      const plain = tokens.filter((t) => !t.includes(":"));
      const base = tokens.map((t) => t.slice(t.lastIndexOf(":") + 1));
      if (base.some((t) => /^bg-(gradient|linear|radial|conic)-/.test(t))) add(at, "gradient", "gradient class: use a flat surface");
      if (base.some((t) => /^(shadow(-(sm|md|lg|xl|2xl|inner))?|drop-shadow(-(sm|md|lg|xl|2xl))?)$/.test(t)))
        add(at, "shadow", "shadow class: flat surfaces only, a tonal step and a 1 px hairline give depth");
      if (base.some((t) => /(^|-)(glow|neon)(-|$)/.test(t))) add(at, "glow", "glow or neon class: remove it");
      if (base.some((t) => /^border-[lrse]-(2|4|8|\[\d+px\])$/.test(t))) add(at, "side-line", "one-sided thick border class: no side stripes, use a full hairline or a tonal fill");
      const small = base.find((t) => /^text-\[(\d*\.?\d+)(px|rem)\]$/.test(t));
      if (small) {
        const px = toPx(small.slice(6, -1));
        if (px !== null && px < 12) add(at, "small-text", `${small}: text is 12 px at least`);
      }
      if (plain.some((t) => /^(min-)?w-screen$/.test(t))) add(at, "too-wide", "w-screen is 100vw, wider than the page when a scrollbar shows: use w-full");
      const capped = tokens.some((t) => /^max-w-/.test(t));
      const wide = plain.find((t) => {
        const arb = /^(min-)?w-\[(\d*\.?\d+(?:px|rem))\]$/.exec(t);
        if (arb) return (toPx(arb[2]!) ?? 0) > 320;
        const scale = /^(min-)?w-(\d+)$/.exec(t);
        return !!scale && Number(scale[2]) * 4 > 320;
      });
      if (wide && !capped) add(at, "too-wide", `${wide} is wider than a 320 px phone: add max-w-full or set it at a breakpoint (md:)`);
    }
    // small tap targets: sized buttons, links and inputs
    for (const m of text.matchAll(/<(button|a|input|select|summary)\b([^<>]*)>/g)) {
      const attrs = m[2]!;
      if (/type\s*=\s*["'](checkbox|radio|hidden|range)["']/i.test(attrs)) continue;
      const cls = CLASS_ATTR_RE.exec(attrs);
      if (!cls) continue;
      const tokens = (cls[1] ?? cls[2] ?? cls[3] ?? "").split(/\s+/).filter((t) => t && !t.includes(":"));
      const lifted = tokens.some((t) => /^min-h-(1[1-9]|[2-9]\d|\[(4[4-9]|[5-9]\d|\d{3,})px\]|full|screen)$/.test(t));
      const sized = tokens.map((t) => /^(h|size)-(\d+(?:\.5)?)$/.exec(t)).find((x) => x && Number(x[2]) < 11);
      if (sized && !lifted) add(m.index!, "tap-target", `<${m[1]}> with ${sized[0]} is ${Number(sized[2]) * 4}px: tap targets are 44 px at least (h-11)`);
    }
    // images without alt
    for (const m of text.matchAll(kind === "jsx" ? /<img\b/g : /<img\b/gi)) {
      const tag = tagText(text, m.index!);
      if (/\{\s*\.\.\./.test(tag)) continue;
      if (!/\salt\s*=/i.test(tag)) add(m.index!, "alt-text", `img without alt: describe it, or alt="" when it is decoration`);
    }
  }

  // gradients anywhere else (JSX strings, scripts), emoji and em-dashes in copy
  let lineStart = 0;
  for (const line of text.split("\n")) {
    if (GRADIENT_RE.test(line)) add(lineStart + line.search(GRADIENT_RE), "gradient", "gradient: use a flat surface (a tonal step and a 1 px hairline)");
    if (EMOJI_RE.test(line)) add(lineStart + line.search(EMOJI_RE), "emoji", "emoji in the UI: use an SVG icon or words");
    if (EM_DASH_RE.test(line)) add(lineStart + line.search(EM_DASH_RE), "em-dash", "em-dash in copy: use a comma, a colon or a period");
    lineStart += line.length + 1;
  }

  const animated = [
    ...keyframes,
    ...decls.filter((d) => (d.prop === "animation" || d.prop === "animation-name") && !/^(none|initial|inherit|unset)\b/i.test(d.value)).map((d) => d.at),
  ];
  const js = kind === "css" ? -1 : text.search(JS_ANIMATION_RE);
  return { findings, animation: animated.length ? Math.min(...animated) : null, jsAnimation: js >= 0 ? js : null, reduced: REDUCED_RE.test(text), lines };
}

/** The whole tag from its "<" to the ">" that closes it (quotes and JSX braces respected). */
function tagText(text: string, from: number): string {
  let quote = "";
  let depth = 0;
  const end = Math.min(text.length, from + 4000);
  for (let i = from + 1; i < end; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === ">" && depth === 0) return text.slice(from, i + 1);
  }
  return text.slice(from, end);
}

/**
 * Scans a set of UI files together: the reduced motion rule counts a
 * project-wide reset in any stylesheet (and a shared hook in any script)
 * as handled. Findings come in file order, then line order.
 */
export function scanUi(files: readonly UiFile[]): UiFinding[] {
  const scans = files.map((f) => ({ file: f, kind: kindOf(f.path), scan: scanFile(f) }));
  const cssReduced = scans.some((s) => s.kind !== "jsx" && s.scan.reduced);
  const jsReduced = scans.some((s) => s.kind !== "css" && s.scan.reduced);
  const out: UiFinding[] = [];
  for (const { file, scan } of scans) {
    const f = [...scan.findings];
    if (scan.animation !== null && !scan.reduced && !cssReduced) {
      f.push({ file: file.path, line: scan.lines.at(scan.animation), rule: "reduced-motion", message: "animation with no prefers-reduced-motion rule: give reduced motion a still or a short fade" });
    }
    if (scan.jsAnimation !== null && !scan.reduced && !jsReduced) {
      f.push({ file: file.path, line: scan.lines.at(scan.jsAnimation), rule: "reduced-motion", message: "scripted animation with no reduced motion check: read prefers-reduced-motion and skip the travel" });
    }
    f.sort((a, b) => a.line - b.line);
    out.push(...f);
  }
  return out;
}

/** The tool output: a header line (the engine reads it as the check status), then file:line findings. */
export function formatUiReport(findings: readonly UiFinding[], checked: number, notes: readonly string[] = []): { ok: boolean; output: string; summary: string } {
  if (checked === 0) {
    return { ok: true, output: ["ui_check: no UI files to check (html, css, scss, jsx, tsx, vue, svelte)", ...notes].join("\n"), summary: "ui_check: no UI files" };
  }
  if (findings.length === 0) {
    const head = `ui_check: clean, ${checked} file${checked === 1 ? "" : "s"} checked`;
    return { ok: true, output: [head, ...notes].join("\n"), summary: head };
  }
  const byRule = new Map<string, number>();
  for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const files = new Set(findings.map((f) => f.file)).size;
  const head = `ui_check: ${findings.length} finding${findings.length === 1 ? "" : "s"} in ${files} of ${checked} files (${[...byRule].map(([r, n]) => `${r} ${n}`).join(", ")})`;
  const shown = findings.slice(0, UI_CHECK_LIMITS.maxShown).map((f) => `${f.file}:${f.line}: [${f.rule}] ${f.message}`);
  const more = findings.length > shown.length ? [`+${findings.length - shown.length} more findings; check fewer paths to see them`] : [];
  return { ok: false, output: [head, ...shown, ...more, ...notes, "Fix every finding, then run ui_check again."].join("\n"), summary: head };
}
