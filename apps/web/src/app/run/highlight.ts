// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A small syntax highlighter for the read-only editor, no dependency: one
// pass over the whole file (so a block comment or a template string can
// span lines), then the tokens are cut into lines. Languages: ts, tsx, js,
// jsx, json, css, html, md. Anything else is plain text. The palette is
// JEV ui.syntax_palette two_hue: keywords blue and strings green from the
// --viz tokens, everything else in ink steps (see app.css .tok-*).

export type Tok = "kw" | "str" | "num" | "com" | "type" | "tag" | "attr" | "prop" | "punct" | "head" | "strong";

export interface Span {
  text: string;
  tok?: Tok;
}

export type Lang = "js" | "json" | "css" | "html" | "md" | "text";

export function langOf(path: string): Lang {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "mts":
    case "cts":
      return "js";
    case "json":
    case "jsonc":
      return "json";
    case "css":
      return "css";
    case "html":
    case "htm":
    case "svg":
    case "xml":
      return "html";
    case "md":
    case "markdown":
      return "md";
    default:
      return "text";
  }
}

const JS_KEYWORDS = new Set(
  "abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let namespace new null of override private protected public readonly return satisfies set static super switch this throw true try type typeof undefined unique var void while with yield".split(" "),
);
const JS_TYPES = new Set("any bigint boolean never number object string symbol unknown void".split(" "));
/** After these, a slash starts a regular expression, not a division. */
const REGEX_AFTER = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^", "return", "typeof", "case", "do", "else", "in", "of", "void", "yield", "await", ""]);

type Push = (text: string, tok?: Tok) => void;

function scanJs(src: string, push: Push) {
  let i = 0;
  let prev = ""; // last significant token, for the regex rule
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      push(src.slice(i, stop), "com");
      i = stop;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      push(src.slice(i, stop), "com");
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j += 1;
        else if (c !== "`" && src[j] === "\n") break;
        j += 1;
      }
      const stop = Math.min(n, j + 1);
      push(src.slice(i, stop), "str");
      i = stop;
      prev = "str";
      continue;
    }
    if (c === "/" && REGEX_AFTER.has(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        const ch = src[j]!;
        if (ch === "\\") j += 1;
        else if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
        j += 1;
      }
      if (j < n && src[j] === "/") {
        j += 1;
        while (j < n && /[a-z]/i.test(src[j]!)) j += 1;
        push(src.slice(i, j), "str");
        i = j;
        prev = "str";
        continue;
      }
    }
    if (/[0-9]/.test(c) || (c === "." && d !== undefined && /[0-9]/.test(d))) {
      const m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?n?)/.exec(src.slice(i, i + 64));
      const text = m?.[0] || c;
      push(text, "num");
      i += text.length;
      prev = "num";
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 128))!;
      const word = m[0];
      const before = prev;
      if (JS_TYPES.has(word)) push(word, "type");
      else if (JS_KEYWORDS.has(word)) push(word, "kw");
      else if (/^[A-Z]/.test(word)) push(word, "type");
      else if (before === "<" || before === "</") push(word, "tag");
      else push(word);
      i += word.length;
      prev = word;
      continue;
    }
    if (c === "<" && d !== undefined && /[A-Za-z/>]/.test(d) && REGEX_AFTER.has(prev) && prev !== "<") {
      // a JSX tag opening in expression position
      if (d === "/") {
        push("</", "punct");
        i += 2;
        prev = "</";
      } else {
        push("<", "punct");
        i += 1;
        prev = "<";
      }
      continue;
    }
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < n && /\s/.test(src[j]!)) j += 1;
      push(src.slice(i, j));
      i = j;
      continue;
    }
    push(c, "punct");
    prev = c;
    i += 1;
  }
}

function scanJson(src: string, push: Push) {
  const re = /("(?:[^"\\\n]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|([{}[\],:])|(\s+)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) {
      push(m[1], m[2] ? "prop" : "str");
      if (m[2]) push(m[2], "punct");
    } else if (m[3]) push(m[3], "num");
    else if (m[4]) push(m[4], "kw");
    else if (m[5]) push(m[5], "com");
    else if (m[6]) push(m[6], "punct");
    else push(m[0]);
  }
}

function scanCss(src: string, push: Push) {
  const re = /(\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(@[\w-]+)|(--[\w-]+|[a-z-]+)(\s*:)(?!:)|(#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|rem|em|%|ms|s|vh|vw|svh|dvh|fr|ch|deg)?\b)|([{}();,:])|(\s+)|([^\s{}();,:"'/]+|.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) push(m[1], "com");
    else if (m[2]) push(m[2], "str");
    else if (m[3]) push(m[3], "kw");
    else if (m[4] && m[5]) {
      push(m[4], "prop");
      push(m[5], "punct");
    } else if (m[6]) push(m[6], "num");
    else if (m[7]) push(m[7], "punct");
    else push(m[0]);
  }
}

function scanHtml(src: string, push: Push) {
  const re = /(<!--[\s\S]*?-->)|(<\/?)([A-Za-z][\w:-]*)|(\/?>)|([A-Za-z_:][\w:.-]*)(=)("[^"]*"|'[^']*')|(\s+)|([^<>\s]+|.)/g;
  let m: RegExpExecArray | null;
  let inTag = false;
  while ((m = re.exec(src))) {
    if (m[1]) push(m[1], "com");
    else if (m[2] && m[3]) {
      push(m[2], "punct");
      push(m[3], "kw");
      inTag = true;
    } else if (m[4]) {
      push(m[4], "punct");
      inTag = false;
    } else if (m[5] && m[6] && m[7] && inTag) {
      push(m[5], "attr");
      push(m[6], "punct");
      push(m[7], "str");
    } else if (m[5] && m[6] && m[7]) push(m[0]);
    else push(m[0], inTag && m[9] ? "attr" : undefined);
  }
}

function scanMd(src: string, push: Push) {
  const lines = src.split("\n");
  let fence = false;
  lines.forEach((line, i) => {
    const nl = i < lines.length - 1 ? "\n" : "";
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      push(line, "punct");
    } else if (fence) push(line, "str");
    else if (/^#{1,6}\s/.test(line)) push(line, "head");
    else {
      const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\[[^\]]*\]\([^)]*\))|(^\s*(?:[-*+]|\d+\.)\s)|([^`*_[]+|.)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        if (m[1]) push(m[1], "str");
        else if (m[2]) push(m[2], "strong");
        else if (m[3]) push(m[3], "attr");
        else if (m[4]) push(m[4], "punct");
        else push(m[0]);
        if (m[0].length === 0) re.lastIndex += 1;
      }
    }
    if (nl) push(nl);
  });
}

/** Tokens per line, ready to render; a line with no text is an empty array. */
export function highlight(content: string, lang: Lang): Span[][] {
  const lines: Span[][] = [[]];
  const push: Push = (text, tok) => {
    if (!text) return;
    const parts = text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push(tok ? { text: part, tok } : { text: part });
    });
  };
  const src = content.replace(/\r\n?/g, "\n");
  switch (lang) {
    case "js":
      scanJs(src, push);
      break;
    case "json":
      scanJson(src, push);
      break;
    case "css":
      scanCss(src, push);
      break;
    case "html":
      scanHtml(src, push);
      break;
    case "md":
      scanMd(src, push);
      break;
    default:
      push(src);
  }
  // A trailing newline does not make a visible last line.
  if (lines.length > 1 && lines[lines.length - 1]!.length === 0 && src.endsWith("\n")) lines.pop();
  return lines;
}

/**
 * Indexes (0-based, in `next`) of the lines that are new or changed since
 * `prev`: the lines outside a longest common subsequence of whole lines.
 * Large files fall back to trimming the common head and tail.
 */
export function changedLines(prev: string, next: string): number[] {
  const a = prev.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const b = next.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  if (bm.length === 0) return [];
  if (am.length === 0) return bm.map((_, i) => head + i);
  if (am.length * bm.length > 2_000_000) return bm.map((_, i) => head + i);
  // LCS table over the middle
  const w = bm.length + 1;
  const dp = new Uint32Array((am.length + 1) * w);
  for (let i = am.length - 1; i >= 0; i--) {
    for (let j = bm.length - 1; j >= 0; j--) {
      dp[i * w + j] = am[i] === bm[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const kept = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < am.length && j < bm.length) {
    if (am[i] === bm[j]) {
      kept.add(j);
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i += 1;
    else j += 1;
  }
  const out: number[] = [];
  for (let k = 0; k < bm.length; k++) if (!kept.has(k)) out.push(head + k);
  return out;
}
