// The landing's motion, from the main bundle: a tiny leaf that claims the
// page for the GSAP engine before the kit's own motion layer arms (so there
// is exactly one owner of every entrance), fades the hero text in on first
// paint (JEV ui.component_recipe hero_headline core.static 0.70: the
// headline paints in its final layout, only its block fades in), and then
// loads the engine chunk (engine.tsx) in the background. No script, a
// failed chunk, or reduced motion: the page is simply finished.
import { Suspense, lazy, useEffect, useLayoutEffect, useState, type ComponentType } from "react";

function Nothing(): null {
  return null;
}

// A chunk that fails to load leaves the finished page, never an error.
const Engine = lazy<ComponentType>(() =>
  import("./engine").then(
    (m) => ({ default: m.default }),
    () => ({ default: Nothing }),
  ),
);

const MOTION = "(prefers-reduced-motion: no-preference)";

function motionAllowed(): boolean {
  return typeof matchMedia === "function" && matchMedia(MOTION).matches && typeof IntersectionObserver !== "undefined";
}

export function LandingMotion({ engine = true }: { engine?: boolean }) {
  const [load, setLoad] = useState(false);

  useLayoutEffect(() => {
    if (!engine) return;
    const page = document.querySelector<HTMLElement>(".lp .kit-page");
    if (page && motionAllowed()) page.dataset.motionEngine = "gsap";
    const text = document.querySelector<HTMLElement>("#top .kit-masthead-text");
    if (text && motionAllowed() && typeof text.animate === "function") {
      text.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: "cubic-bezier(0.24, 1, 0.4, 1)", fill: "backwards" });
    }
  }, [engine]);

  useEffect(() => {
    if (engine && motionAllowed()) setLoad(true);
  }, [engine]);

  if (!load) return null;
  return (
    <Suspense fallback={null}>
      <Engine />
    </Suspense>
  );
}
