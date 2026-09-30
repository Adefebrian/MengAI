// A text that changes in place fades in again: the same element, its text
// swapped, one opacity crossfade (WAAPI, --dur-200 on the standard curve).
// The element is never replaced, so nothing on the page is torn down while
// it is being read, and under reduced motion the text simply changes.
import { useLayoutEffect, useRef, type RefObject } from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";

export function useFadeOnChange<T extends HTMLElement>(value: unknown, duration = 200): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    if (typeof matchMedia === "function" && matchMedia(REDUCE).matches) return;
    const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: "cubic-bezier(0.24, 1, 0.4, 1)" });
    return () => a.cancel();
  }, [value, duration]);
  return ref;
}
