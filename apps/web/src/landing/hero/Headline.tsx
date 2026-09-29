// The Masthead headline with the R02 per-word crossfade (showcase hero line,
// JEV ui.component_recipe layer_2 at 0.64): each word rises 8px and fades in
// once on load at --dur-600, --stagger-word apart, on --ease-standard. The
// animation fills backwards only, so a word always ends in its natural,
// visible state and can never stick hidden. Reduced motion, no WAAPI, or
// no JavaScript: the words render finished. The words stay real text with
// real spaces between them, so the heading reads as one line.
import { Fragment, useLayoutEffect, useRef } from "react";

const WORD_MS = 600; // --dur-600
const STAGGER_MS = 40; // --stagger-word
const EASE = "cubic-bezier(0.24, 1, 0.4, 1)"; // --ease-standard

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Headline({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const words = text.split(" ");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || typeof el.animate !== "function") return;
    const units = Array.from(el.querySelectorAll<HTMLElement>(".lp-word"));
    const running = units.map((u, i) =>
      u.animate(
        [
          { opacity: 0, transform: "translate3d(0, 8px, 0)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: WORD_MS, delay: i * STAGGER_MS, easing: EASE, fill: "backwards" },
      ),
    );
    return () => {
      for (const a of running) a.cancel();
    };
  }, []);

  return (
    <span ref={ref} className="lp-words">
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="lp-word">{w}</span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}
