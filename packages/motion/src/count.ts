// StatRow, Bento, and quote figures count up once on entry (R07 count-up,
// mu.number-ticker), on the GSAP ticker so the page keeps one clock. The
// kit's parser and formatter are passed in (the module never re-implements
// them): a plain number counts ("612", "1.490.000", "2.9"), a range or a word
// stays still. The box width is locked to the final value first, so the unit
// beside it never moves, and the digits are tabular in kit.css. When the
// figure's owner writes a new value mid-count (a re-render), the count
// stops and keeps the new value; it never writes the old one back.

export interface CountableLike {
  value: number;
}

export interface CountEngine {
  /** Tween state.v to `to` on the ticker; onUpdate each frame. */
  tween(state: { v: number }, vars: { v: number; duration: number; onUpdate: () => void; onComplete: () => void }): { kill(): void };
}

export function countTo<C extends CountableLike>(
  el: HTMLElement,
  parse: (text: string) => C | null,
  format: (c: C, n: number) => string,
  engine: CountEngine,
  duration: number,
): (() => void) | null {
  const node = el.firstChild;
  if (!node || node.nodeType !== 3 || el.childNodes.length !== 1) return null;
  const final = node.nodeValue ?? "";
  const parsed = parse(final);
  if (!parsed || parsed.value === 0) return null;
  const width = el.getBoundingClientRect().width;
  const prior = el.style.inlineSize;
  if (width > 0) el.style.inlineSize = `${width}px`;
  let finished = false;
  const state = { v: 0 };
  // Declared before the tween so a zero-duration tween completing at once
  // finds it.
  let tween: { kill(): void } | null = null;
  // The text this count last wrote. Anything else in the node means the
  // owner (React re-rendering the figure with a new value) wrote it, or
  // replaced the node: the count steps aside and never writes the old
  // value back over the new one.
  let written = format(parsed, 0);
  const takenOver = () => el.firstChild !== node || node.nodeValue !== written;
  const finish = () => {
    if (finished) return;
    finished = true;
    tween?.kill();
    if (!takenOver()) node.nodeValue = final;
    el.style.inlineSize = prior;
  };
  node.nodeValue = written;
  tween = engine.tween(state, {
    v: parsed.value,
    duration,
    onUpdate: () => {
      if (finished) return;
      if (takenOver()) return finish();
      written = format(parsed, state.v);
      node.nodeValue = written;
    },
    onComplete: finish,
  });
  if (finished) tween.kill();
  return finish;
}
