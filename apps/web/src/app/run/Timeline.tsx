// The observation log (JEV: rows, ui.component_recipe an.R21 0.62,
// motion.choreography reveal): newest first, grouped by the cat that did
// the work, the way a shift log reads. A new line fades in at the top of
// its cat's group; when another cat acts, a new group fades in above. The
// log sits under a live office, so nothing in it slides: a layout transform
// here would replay every time the page above changed height. Under
// reduced motion lines and groups simply appear.
import { ROLE_LABEL } from "@mengai/shared";
import { ProductIcon } from "@mengai/ui/src/product";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { RunState } from "../../store/runStore";
import { fmtClock } from "../format";
import { T, useMotionLevel } from "../motion";
import { timelineLines, type TimelineLine } from "./describe";

const PAGE = 30;

interface Group {
  key: number;
  who: string;
  lines: TimelineLine[];
}

/** Consecutive lines by the same cat form one group; the group key is its oldest line, so it stays put as lines join. */
export function groupLines(lines: readonly TimelineLine[]): Group[] {
  const out: Group[] = [];
  for (const l of lines) {
    const who = l.who ?? "The run";
    const last = out[out.length - 1];
    if (last && last.who === who) {
      last.lines.push(l);
      last.key = l.seq;
    } else out.push({ key: l.seq, who, lines: [l] });
  }
  return out;
}

export function Timeline({ state }: { state: RunState }) {
  const [limit, setLimit] = useState(PAGE);
  const level = useMotionLevel();
  const off = level === "off";
  const all = timelineLines(state, 2000);
  const lines = all.slice(0, limit);
  if (lines.length === 0) {
    return <p className="app-empty-line">Quiet so far. The first paw prints land here.</p>;
  }
  const groups = groupLines(lines);
  const roleOf = new Map(state.agentOrder.map((id) => state.agents[id]).filter((a) => !!a).map((a) => [a!.name, ROLE_LABEL[a!.role]]));
  // A new line fades in where it lands; nothing slides, so the log never
  // moves when the page above it grows (the office, the feed) and no line
  // ever leaves the list's box mid-entrance.
  const enter = { opacity: 0 };
  const shown = { opacity: 1, transition: off ? T.reduced : T.base };
  const leave = { opacity: 0, transition: off ? T.reduced : T.baseExit };
  return (
    <div className="timeline">
      <ol className="timeline-list" tabIndex={0} data-lenis-prevent="" aria-label="Run timeline, newest first, grouped by cat" aria-live="polite" aria-relevant="additions">
        <AnimatePresence initial={false}>
          {groups.map((g) => (
            <motion.li key={g.key} className="tl-group" initial={enter} animate={shown} exit={leave}>
              <p className="tl-who">
                <span className="tl-name">{g.who}</span>
                {roleOf.get(g.who) ? <span>{roleOf.get(g.who)}</span> : null}
              </p>
              <ol className="tl-lines">
                <AnimatePresence initial={false}>
                  {g.lines.map((l) => (
                    <motion.li key={l.seq} className="timeline-row" initial={enter} animate={shown} exit={leave}>
                      <span className="timeline-clock tnum">{fmtClock(l.ts)}</span>
                      <span className="timeline-icon" data-tone={l.tone}>
                        <ProductIcon name={l.icon} size={16} />
                      </span>
                      <span className="timeline-body">
                        <span className="timeline-text">{l.text}</span>
                        {l.detail ? <span className="timeline-detail">{l.detail}</span> : null}
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      {all.length > lines.length ? (
        <button type="button" className="btn-secondary timeline-more" onClick={() => setLimit((n) => n + PAGE)}>
          Show older lines
        </button>
      ) : null}
    </div>
  );
}
