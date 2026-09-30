// The run tracker, pinned at the top of the run page like tracking an
// order in a delivery app: the DeliveryTracker from @mengai/cats (the CEO
// cat rides a flat route through the stages of the company kind, studio or
// fund, from COMPANY_STAGES). The data wiring is stages.ts: the stage from
// run.stage events (or placed from the tasks for an older server), every
// move back a loop with its Round tag while it is open, each stop reading
// the real reason of the move into it, the cat-voice line (a fresh loop
// back names its reason, else what the company is doing), and the tokens
// the run still needs in short. The courier idles only while the run is
// running; paused, stopped, failed or queued it waits still at its stop,
// and the app's still-cats setting holds it still everywhere. The replay
// scrubber folds the log up to its position, so it drives the tracker too.
// JEV ui.region_gate (verified jev-1.13.0): driver card 0.55 (plain below
// 640, 0.60), route kept (2.69), stop detail plain (0.89), stop names
// (1.64), round tag (1.71), the band pinned at every width (0.65), the
// strip full bleed below 640 (0.88).
import { DeliveryTracker, lookFor } from "@mengai/cats";
import type { RunState } from "../../store/runStore";
import { useApp } from "../context";
import { clockOf, leadOf } from "./office";
import { deliveryLooping, deliveryStages, etaShort, trackerLine, trackerModel } from "./stages";

export function RunTracker({ state, replaying }: { state: RunState; replaying: boolean }) {
  const { catsStill } = useApp();
  const run = state.run;
  if (!run) return null;
  const m = trackerModel(state);
  const lead = leadOf(state);
  const courier = { name: lead?.name ?? "Oyen", look: lead?.look ?? lookFor("Oyen") };
  const done = m.outcome === "done";
  return (
    <section
      className="app-region run-tracker"
      data-container="divided"
      data-outcome={m.outcome}
      aria-label={replaying ? "Run progress at the replay position" : "Run progress"}
    >
      <DeliveryTracker
        stages={deliveryStages(state, m)}
        current={m.index}
        looping={deliveryLooping(m)}
        loops={m.loops}
        done={done}
        status={trackerLine(state, m, clockOf(state))}
        eta={etaShort(run)}
        courier={courier}
        still={catsStill || (m.outcome !== "running" && !done)}
      />
    </section>
  );
}
