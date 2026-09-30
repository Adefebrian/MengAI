// Public contract of the DeliveryTracker: the on-demand style progress
// tracker (think a food delivery app) that follows a run from the goal to
// shipped. A courier cat rides a flat route through one stop per stage; the
// active stop pulses, finished stops tick, a failed review makes the courier
// turn back to the earlier stop, and the arrival plays a short celebration.
// Used by the app run page and the landing lifecycle simulation. Keep this
// file stable: both sides build in parallel.
import type { CatLook } from "@mengai/shared";

export interface TrackerStage {
  id: string;
  label: string;
  /** optional one-line detail shown when the stage is selected or active */
  detail?: string | null;
}

export interface DeliveryTrackerProps {
  stages: TrackerStage[];
  /** index of the stage the run is in right now */
  current: number;
  /** true while the run is heading back to an earlier stage (a failed review) */
  looping?: boolean;
  /** how many times the run looped back so far */
  loops?: number;
  /** true when the last stage is reached */
  done: boolean;
  /** cat-voice status line, e.g. "Oyen is wrapping up the export, 3 of 7 tasks done" */
  status: string;
  /** remaining estimate, e.g. "about 6 min" or "82k tokens left"; null hides it */
  eta?: string | null;
  /** the courier: the CEO cat by default */
  courier: { name: string; look: CatLook };
  /** tapping a stop selects it (to show its detail or tasks) */
  onStageSelect?: (index: number) => void;
  selected?: number | null;
  /** tighter layout for side panels and phones */
  compact?: boolean;
  /** forces still poses and instant moves (reduced motion is detected automatically too) */
  still?: boolean;
}
