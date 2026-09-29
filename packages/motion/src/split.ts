// SplitText line reveal for a display headline (R03 line mask reveal), as
// logic over a small engine so it is tested with fakes.
//
// The heading waits unsplit at opacity 0 (never visibility, so assistive
// tech still reads it; set by script, so no-JS paints it finished). When it
// scrolls in, after fonts are ready (lines are measured on the real face),
// it splits into masked lines with its own text-wrap intact (so the lines
// are the lines it rests on), the lines rise out of their masks on the one
// curve, and the split reverts the moment they land. At rest the heading is
// its own plain text again: same box, same breaks, links and the accessible
// name untouched. The returned undo reverts it at any point: before the
// trigger, mid-rise, or after.

export interface SplitLike {
  lines: Element[];
  revert(): void;
}

export interface Killable {
  kill(): void;
}

export interface SplitEngine {
  set(target: Element | Element[], vars: Record<string, unknown>): void;
  trigger(vars: { trigger: Element; start: string; once: true; onEnter: () => void }): Killable;
  split(el: HTMLElement): SplitLike;
  /** Lines from yPercent 100 to 0 inside their masks; onComplete when landed. */
  rise(lines: Element[], vars: { duration: number; stagger: number; onComplete: () => void }): Killable;
}

export interface SplitOptions {
  start: string;
  duration: number;
  stagger: number;
  fontsReady: Promise<unknown>;
}

export const SPLIT_VARS = { type: "lines", mask: "lines", linesClass: "kit-line", aria: "auto" } as const;

export function splitReveal(el: HTMLElement, engine: SplitEngine, opts: SplitOptions): () => void {
  let split: SplitLike | null = null;
  let rise: Killable | null = null;
  let done = false;
  const settle = () => {
    rise?.kill();
    rise = null;
    split?.revert();
    split = null;
  };
  engine.set(el, { opacity: 0 });
  const trigger = engine.trigger({
    trigger: el,
    start: opts.start,
    once: true,
    onEnter: () => {
      opts.fontsReady.then(
        () => {
          if (done) return;
          split = engine.split(el);
          engine.set(el, { opacity: 1 });
          rise = engine.rise(split.lines, { duration: opts.duration, stagger: opts.stagger, onComplete: settle });
        },
        () => {
          if (!done) engine.set(el, { clearProps: "opacity" });
        },
      );
    },
  });
  return () => {
    if (done) return;
    done = true;
    trigger.kill();
    settle();
    engine.set(el, { clearProps: "opacity" });
  };
}
