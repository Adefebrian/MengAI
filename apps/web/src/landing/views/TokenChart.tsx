// Billable input tokens per benchmark scenario, legacy engine against v2,
// from docs/reports/token-benchmark.md (data/bench.ts). Two bars per row on
// one shared scale, labelled in words, no legend swatches. The bars grow
// from the start edge with transform the first time the chart scrolls into
// view (R36 entrance); a chart already on screen, no script, or reduced
// motion shows them at their final length.
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { usePrefersReducedMotion } from "@mengai/ui";
import { SCENARIOS } from "../data/bench";

export const NAMES: Record<string, string> = {
  "engineer-settings-migration": "Settings migration",
  "engineer-discount": "Discount rule",
  "qa-flaky-checkout": "Flaky checkout test",
  "reviewer-payments": "Payments review",
  "security-audit": "Security audit",
  "researcher-search-index": "Search index research",
  "lead-plan": "Plan a goal",
  "designer-landing-hero": "Landing hero design",
};

/** "armed" waits off screen at zero length, "in" grows, null rests at full length. */
function useGrow(ref: RefObject<HTMLElement | null>): "armed" | "in" | null {
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState<"armed" | "in" | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (reduced || !el || typeof IntersectionObserver === "undefined") return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return;
    setState("armed");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("in");
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, reduced]);
  return reduced ? null : state;
}

export function TokenChart() {
  const ref = useRef<HTMLDivElement>(null);
  const grow = useGrow(ref);
  const max = Math.max(...SCENARIOS.map((s) => s.legacy));
  return (
    <div ref={ref} className="lp-chart" data-grow={grow ?? undefined}>
      <p className="lp-chart-key">
        <span className="lp-view-muted">Billable input tokens per task, lighter bar the old engine, ink bar v2</span>
      </p>
      <ol className="lp-chart-rows" aria-label="Billable input tokens per scenario">
        {SCENARIOS.map((s, i) => (
          <li key={s.id} className="lp-chart-row" style={{ "--lp-i": String(i) } as CSSProperties}>
            <span className="lp-view-strong lp-clip" title={NAMES[s.id] ?? s.id}>
              {NAMES[s.id] ?? s.id}
            </span>
            <span className="lp-view-muted lp-row-end">
              <span className="kit-num">{s.savingsPct}%</span> less
            </span>
            <span className="lp-bars" role="img" aria-label={`${NAMES[s.id] ?? s.id}: ${s.legacy.toLocaleString("en-US")} tokens before, ${s.v2.toLocaleString("en-US")} with v2`}>
              <span className="lp-bar" data-series="legacy" style={{ "--lp-bar": String(s.legacy / max) } as CSSProperties} />
              <span className="lp-bar" data-series="v2" style={{ "--lp-bar": String(s.v2 / max) } as CSSProperties} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
