// Plays the bundled demo log into a run store: the first part lands at
// once (the whole crew is on the board and one request waits on you), the
// rest follows on a compressed clock. Like a real run, the crew waits on
// you: the player holds before the scripted answer to the approval until
// the page releases it (the owner pressed Approve). Nothing here calls the
// network.
import type { MengaiEvent } from "@mengai/shared";
import type { RunStore } from "../store/runStore";
import { DEMO_APPROVAL_ID, DEMO_EVENTS, DEMO_WARM_SEQ } from "./fixture";

export interface DemoPlayer {
  /** true once the last event is applied */
  readonly finished: boolean;
  /** true while the player waits for release() at the approval */
  readonly holding: boolean;
  /** the fixture time of the last applied event */
  now(): number;
  pause(): void;
  resume(): void;
  stop(): void;
  /** apply everything up to and including seq at once */
  skipTo(seq: number): void;
  /** let the run continue past the held approval */
  release(): void;
}

export interface DemoPlayerOptions {
  events?: readonly MengaiEvent[];
  warmSeq?: number;
  /** seq the player stops before until release(); null plays straight through */
  holdSeq?: number | null;
  /** fixture milliseconds per real millisecond */
  speed?: number;
  minGapMs?: number;
  maxGapMs?: number;
  onDone?: () => void;
  onHold?: () => void;
  onApply?: (last: MengaiEvent) => void;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** The seq of the scripted answer to the demo approval, where the player holds by default. */
export const DEMO_HOLD_SEQ: number | null = (() => {
  const hit = DEMO_EVENTS.find((e) => e.type === "approval.resolved" && (e as MengaiEvent<"approval.resolved">).data.id === DEMO_APPROVAL_ID);
  return hit ? hit.seq : null;
})();

export function playDemo(store: RunStore, opts: DemoPlayerOptions = {}): DemoPlayer {
  const events = opts.events ?? DEMO_EVENTS;
  const warm = opts.warmSeq ?? DEMO_WARM_SEQ;
  const speed = opts.speed ?? 3;
  const minGap = opts.minGapMs ?? 350;
  const maxGap = opts.maxGapMs ?? 1600;
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let hold = opts.holdSeq === undefined ? DEMO_HOLD_SEQ : opts.holdSeq;

  let index = 0;
  let handle: unknown = null;
  let paused = false;
  let stopped = false;
  let finished = false;
  let holding = false;
  let clock = events[0]?.ts ?? 0;

  const applyUpTo = (seq: number) => {
    const batch: MengaiEvent[] = [];
    while (index < events.length && events[index]!.seq <= seq) {
      batch.push(events[index]!);
      index += 1;
    }
    if (batch.length > 0) {
      const last = batch[batch.length - 1]!;
      clock = last.ts;
      store.apply(batch);
      opts.onApply?.(last);
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    opts.onDone?.();
  };

  const tick = () => {
    handle = null;
    if (stopped || paused) return;
    if (index >= events.length) return finish();
    const e = events[index]!;
    if (hold !== null && e.seq >= hold) {
      holding = true;
      opts.onHold?.();
      return;
    }
    applyUpTo(e.seq);
    if (index >= events.length) return finish();
    const gap = (events[index]!.ts - e.ts) / speed;
    handle = schedule(tick, Math.max(minGap, Math.min(maxGap, gap)));
  };

  applyUpTo(warm);
  store.setState({ ...store.getState(), connection: "demo" });
  handle = schedule(tick, minGap * 2);

  return {
    get finished() {
      return finished;
    },
    get holding() {
      return holding;
    },
    now: () => clock,
    pause() {
      paused = true;
      if (handle !== null) cancel(handle);
      handle = null;
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      if (!holding) handle = schedule(tick, minGap);
    },
    stop() {
      stopped = true;
      if (handle !== null) cancel(handle);
      handle = null;
    },
    skipTo(seq: number) {
      if (hold !== null && seq >= hold) {
        hold = null;
        holding = false;
      }
      applyUpTo(seq);
      if (index >= events.length) finish();
    },
    release() {
      hold = null;
      if (!holding) return;
      holding = false;
      if (!stopped && !paused && handle === null) handle = schedule(tick, minGap);
    },
  };
}
