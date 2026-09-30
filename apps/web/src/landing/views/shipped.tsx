// The close's proof (round C: a slim centered strip under the close's
// buttons, JEV ui.region_gate close_proof divided_section and
// ui.component_recipe core.strip_line_then_crew): the studio story from the
// lifecycle section at its last scene. One centered line says the goal
// shipped, one muted line gives every stage done and the clock, and the
// crew stands in a centered row under it with Oyen first, holding the
// shipped card. When the strip scrolls into view the crew celebrates once,
// one cat after another (JEV ui.component_recipe close
// kit.cta_split_sequence 1.00, carried); under reduced motion the cats
// rest in their still poses. One sprite per cat (critic round 2): the
// crew sits proud on the sitting rig and the celebration is the Cat's
// transform-only hop on that one sprite, never the done beat's lying rig,
// whose stretch-then-curl crossfade drew a see-through second cat.
import { Cat } from "@mengai/cats";
import { usePrefersReducedMotion } from "@mengai/ui";
import { StatusPill } from "@mengai/ui/src/product";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { STUDIO, catOf } from "../story/lifecycle";

/** The crew in the shipped strip, in the order they stand: Oyen first. */
export const SHIPPED_CREW = ["oyen", "cemong", "serabi", "tempe", "onde", "risol"];
/** Between two cats' celebrations, in ms (--stagger-item doubled, so each hop reads). */
const HOP_MS = 120;

/** The crew row's cats: 64 px when six fit side by side at that size, else 48 (three to a row on a narrow strip). */
function useCrewSize(ref: RefObject<HTMLElement | null>): { size: 48 | 64; cols: 3 | 6 } {
  const [fit, setFit] = useState<{ size: 48 | 64; cols: 3 | 6 }>({ size: 48, cols: 3 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      const gap = 8;
      const next = w >= 6 * 64 + 5 * gap ? { size: 64 as const, cols: 6 as const } : w >= 6 * 48 + 5 * gap ? { size: 48 as const, cols: 6 as const } : { size: 48 as const, cols: 3 as const };
      setFit((old) => (old.size === next.size && old.cols === next.cols ? old : next));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return fit;
}

function useCelebrations(ref: RefObject<HTMLElement | null>, count: number): number[] {
  const reduced = usePrefersReducedMotion();
  const [keys, setKeys] = useState<number[]>(() => Array.from({ length: count }, () => 0));
  useEffect(() => {
    const el = ref.current;
    if (reduced || !el || typeof IntersectionObserver === "undefined") return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        for (let i = 0; i < count; i++) {
          timers.push(setTimeout(() => setKeys((k) => k.map((v, j) => (j === i ? v + 1 : v))), 300 + i * HOP_MS));
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      for (const t of timers) clearTimeout(t);
    };
  }, [ref, reduced, count]);
  return keys;
}

export function ShippedView() {
  const ref = useRef<HTMLDivElement>(null);
  const keys = useCelebrations(ref, SHIPPED_CREW.length);
  const { size, cols } = useCrewSize(ref);
  const last = STUDIO.steps[STUDIO.steps.length - 1]!;
  const stages = STUDIO.stages.length;
  return (
    <div ref={ref} className="lp-shipped">
      <div className="lp-shipped-line">
        <StatusPill tone="success" icon="checkCircle" variant="pill">
          Shipped
        </StatusPill>
        <p className="lp-shipped-goal">{STUDIO.goal}</p>
      </div>
      <p className="lp-shipped-meta">
        <span className="kit-num">
          {stages} of {stages}
        </span>{" "}
        stages done at <span className="kit-num">{last.clock}</span>. Sample, the studio story above.
      </p>
      <ul className="lp-crew" data-cols={cols} data-size={size} aria-label="The crew that shipped it">
        {SHIPPED_CREW.map((id, i) => {
          const c = catOf(STUDIO, id);
          const lead = id === "oyen";
          return (
            <li key={id} className="lp-crew-cat">
              <Cat
                look={{ coat: c.coat, seed: c.seed }}
                role={c.role}
                status={lead ? "working" : "done"}
                activity={lead ? "handoff" : "rest"}
                mood="proud"
                label={lead ? `${c.name}, ${c.title}, holding the shipped card` : `${c.name}, ${c.title}, celebrating`}
                size={size}
                celebrateKey={keys[i]}
              />
              <span className="lp-crew-name">{c.name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
