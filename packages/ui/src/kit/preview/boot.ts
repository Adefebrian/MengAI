// Shared boot for both preview pages: the direction from ?d=, and ?reduce=1
// to preview reduced motion without an OS switch (it answers the reduced
// motion query as matching for every script on the page, before any runs;
// CSS keeps the real preference, and the kit hides nothing unless a script
// armed it, so the page renders finished).
import { DIRECTIONS, type DirectionId } from "../Page";

export function bootDirection(fallback: DirectionId): DirectionId {
  const params = new URLSearchParams(location.search);
  if (params.get("reduce") === "1") {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      const q = query.replace(/\s+/g, " ").trim();
      if (q === "(prefers-reduced-motion: reduce)" || q === "(prefers-reduced-motion: no-preference)") {
        const fake = {
          matches: q.endsWith("reduce)"),
          media: query,
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent: () => false,
        };
        return fake as unknown as MediaQueryList;
      }
      return real(query);
    };
    document.documentElement.dataset.previewReduce = "";
  }
  const param = params.get("d") ?? fallback;
  const direction = (param in DIRECTIONS ? param : fallback) as DirectionId;
  document.documentElement.dataset.direction = direction;
  return direction;
}

/** The page renders after the browser tried the hash, so land on it once mounted. */
export function landOnHash(): void {
  if (!location.hash) return;
  const target = location.hash.slice(1);
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView()));
}
