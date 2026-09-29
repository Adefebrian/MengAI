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
