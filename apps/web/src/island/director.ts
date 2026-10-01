// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's director, pure: which moment plays on the stage under the
// island right now. The deriver (moments.ts) turns facts into moments; the
// director keeps the stage calm and the important things impossible to miss.
// The clock is always handed in (`now`) and the only randomness is a seeded
// stream, so every schedule replays the same in tests.
//
// The rules, in the order they apply to a moment that is offered:
//   seen       a moment id plays at most once: a replayed fact never plays twice
//   answer     an ask moment with a finite length is the cat's reaction to the
//              owner's answer: it ends that ask and plays at once, when the ask
//              was on the stage (or was, less than ANSWER_WINDOW_MS ago)
//   quirk      fooling around only on an empty stage, never within
//              QUIRK_QUIET_MS of another moment
//   hint       an engine hint beats an inferred moment about the same task
//              within HINT_WINDOW_MS, whichever arrives first
//   cooldown   the same type at most once per SAME_TYPE_MS; at most RATE_MAX
//              moments a RATE_WINDOW_MS that the island starts on its own
//              (asks, answers and taps are the owner's, and a run's end
//              happens once per run, so those never count)
//   place      one moment at a time: a higher priority cuts in (the running
//              one exits fast, EXIT_FAST_MS); an equal or lower one queues,
//              at most QUEUE_MAX, the oldest that may end on its own dropped
//              first. A moment that stays until resolved (an ask, a failure)
//              is never dropped: when an ask cuts in over it, it goes back to
//              the front of the queue. While one stays on the stage only
//              asks and failures queue behind it; anything else is dropped,
//              so nothing stale plays after the owner answers.
import { seededRandom } from "@mengai/cats/src/motion";
import type { Moment, MomentType } from "./moment-types";

/** Who wins the stage. Engine hints share one rank. */
export const PRIORITY: Record<MomentType, number> = {
  ask_approval: 100,
  ask_order: 100,
  ask_question: 100,
  failed: 90,
  shipped: 80,
  stage_done: 60,
  review_pass: 50,
  review_fail: 50,
  ceo_approved: 50,
  ceo_denied: 50,
  rethink: 50,
  stuck: 50,
  budget_low: 50,
  hire: 40,
  let_go: 40,
  handoff: 40,
  tap: 30,
  quirk: 10,
};

export const ASK_TYPES: ReadonlySet<MomentType> = new Set<MomentType>(["ask_approval", "ask_order", "ask_question"]);
/** Moments the owner causes, or that happen once per run: never rate limited. */
const UNMETERED: ReadonlySet<MomentType> = new Set<MomentType>(["tap", "shipped", "failed"]);

export const QUEUE_MAX = 3;
export const SAME_TYPE_MS = 8000;
export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX = 4;
/** A quirk never plays within this of another moment. */
export const QUIRK_QUIET_MS = 30_000;
/** The seeded wait, after the stage last moved, before a cat fools around. */
export const QUIRK_GAP_MIN_MS = 45_000;
export const QUIRK_GAP_MAX_MS = 120_000;
/** An engine hint beats an inferred moment about the same task within this. */
export const HINT_WINDOW_MS = 2000;
/** The reaction to an answer still plays this long after its ask left the stage. */
export const ANSWER_WINDOW_MS = 3000;
/** A moment cut away by a higher one exits on --dur-150-exit. */
export const EXIT_FAST_MS = 150;
/** Moment ids remembered, so a replay never plays twice. */
const SEEN_KEEP = 256;

/** What the director takes: a moment, plus what the hint rule needs. */
export interface Cue extends Moment {
  /** the task the moment is about, null or missing when none */
  taskId?: string | null;
  /** sent by the engine as a `moment` hint */
  hint?: boolean;
}

export type OfferResult =
  /** on the stage now */
  | "play"
  | "queue"
  /** this id was offered before */
  | "seen"
  /** the same type played less than SAME_TYPE_MS ago */
  | "cooldown"
  /** RATE_MAX moments already this minute */
  | "rate"
  /** a quirk too close to another moment */
  | "quiet"
  /** the stage holds an ask or a failure, or a quirk found it busy */
  | "busy"
  /** an engine hint about the same task came first */
  | "beaten"
  /** the queue was full of moments that outrank or outwait it */
  | "full"
  /** an answer whose ask is not on the stage */
  | "stale";

export interface Tick {
  current: Cue | null;
  startedAt: number | null;
  /** when the current one ends on its own; null while it stays until resolved */
  expiresAt: number | null;
  /** the moment a cut-in sent away less than EXIT_FAST_MS ago, for the fast exit */
  exiting: Cue | null;
}

export interface DirectorOptions {
  now: number;
  /** seeds the quirk gaps and the quirk seeds */
  seed?: number;
}

interface Playing {
  moment: Cue;
  startedAt: number;
  endsAt: number | null;
}

interface Queued {
  moment: Cue;
  at: number;
}

/** Stays on the stage until resolved: an ask, a failure. */
export function isHeld(m: Moment): boolean {
  return m.ms === null;
}

export function isAsk(m: Moment): boolean {
  return ASK_TYPES.has(m.type) && m.ms === null;
}

/** The reaction to an answer: an ask type that ends on its own. */
export function isAnswer(m: Moment): boolean {
  return ASK_TYPES.has(m.type) && m.ms !== null && !!m.askId;
}

function matches(m: Moment, key: string): boolean {
  return m.id === key || m.askId === key;
}

export class Director {
  private playing: Playing | null = null;
  private queue: Queued[] = [];
  private readonly seen = new Map<string, number>();
  private readonly lastOfType = new Map<MomentType, number>();
  private metered: number[] = [];
  private hints: Array<{ taskId: string; at: number }> = [];
  private cut: { moment: Cue; at: number } | null = null;
  private answered: { askId: string; at: number } | null = null;
  private lastActive: number;
  private nextQuirk: number;
  private readonly rand: () => number;

  constructor({ now, seed = 1 }: DirectorOptions) {
    this.rand = seededRandom(seed);
    this.lastActive = now;
    this.nextQuirk = now + this.gap();
  }

  /** Offer one moment; the answer says what became of it. */
  offer(m: Cue, now: number): OfferResult {
    this.advance(now);
    if (this.seen.has(m.id)) return "seen";
    this.remember(m.id, now);
    if (isAnswer(m)) return this.offerAnswer(m, now);
    const ask = isAsk(m);
    if (m.type === "quirk") {
      if (this.playing || this.queue.length) return "busy";
      if (now - this.lastActive < QUIRK_QUIET_MS) return "quiet";
    }
    if (!ask && !m.hint && m.taskId && this.hintWithin(m.taskId, now)) return "beaten";
    if (!ask && m.type !== "tap") {
      const last = this.lastOfType.get(m.type);
      if (last !== undefined && now - last < SAME_TYPE_MS) return "cooldown";
      if (!UNMETERED.has(m.type) && this.meteredSince(now) >= RATE_MAX) return "rate";
    }
    if (m.hint && m.taskId) this.beatInferred(m.taskId, now);
    const result = this.place(m, now);
    if (result === "busy" || result === "full") return result;
    this.lastOfType.set(m.type, now);
    if (!ask && !UNMETERED.has(m.type)) this.metered.push(now);
    if (m.hint && m.taskId) this.hints.push({ taskId: m.taskId, at: now });
    return result;
  }

  /**
   * The asks that wait right now (askMoments of the model): new ones join,
   * ones that are gone (answered anywhere, or their run left) end.
   */
  syncAsks(asks: readonly Cue[], now: number): void {
    this.advance(now);
    const keep = new Set(asks.map((a) => a.askId ?? a.id));
    for (const key of this.liveAsks()) if (!keep.has(key)) this.resolve(key, now);
    const live = new Set(this.liveAsks());
    for (const a of asks) if (!live.has(a.askId ?? a.id)) this.offer(a, now);
  }

  /** End a moment that stays until resolved (by its askId, or its id for a failure). */
  resolve(key: string, now: number): boolean {
    this.advance(now);
    let hit = false;
    const p = this.playing;
    if (p && matches(p.moment, key)) {
      if (isAsk(p.moment)) this.answered = { askId: p.moment.askId ?? p.moment.id, at: now };
      this.playing = null;
      this.rest(now);
      hit = true;
    }
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => !matches(q.moment, key));
    if (this.queue.length !== before) hit = true;
    this.advance(now);
    return hit;
  }

  /** What shows at `now`: the current moment and when it ends. */
  tick(now: number): Tick {
    this.advance(now);
    const p = this.playing;
    const exiting = this.cut && now - this.cut.at < EXIT_FAST_MS ? this.cut.moment : null;
    return { current: p?.moment ?? null, startedAt: p?.startedAt ?? null, expiresAt: p?.endsAt ?? null, exiting };
  }

  /**
   * A seed for quirkMoment when a cat may fool around now: the stage is
   * empty, the seeded gap since it last moved has passed, and no moment
   * played within QUIRK_QUIET_MS. Null otherwise. Each seed is handed out
   * once; the next gap is drawn right away. The island asks only while it
   * is collapsed or tucked.
   */
  quirkDue(now: number): number | null {
    this.advance(now);
    if (this.playing || this.queue.length) return null;
    if (now < this.nextQuirk || now - this.lastActive < QUIRK_QUIET_MS) return null;
    const seed = Math.floor(this.rand() * 0x7fffffff);
    this.nextQuirk = now + this.gap();
    return seed;
  }

  /** When the next quirk may come, for a timer. */
  get quirkAt(): number {
    return Math.max(this.nextQuirk, this.lastActive + QUIRK_QUIET_MS);
  }

  /** The moments waiting, in the order they will play. */
  get queued(): readonly Cue[] {
    return this.queue.map((q) => q.moment);
  }

  // ---------------------------------------------------------------- inside

  private gap(): number {
    return QUIRK_GAP_MIN_MS + Math.floor(this.rand() * (QUIRK_GAP_MAX_MS - QUIRK_GAP_MIN_MS + 1));
  }

  private remember(id: string, now: number): void {
    this.seen.set(id, now);
    if (this.seen.size > SEEN_KEEP) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }

  private meteredSince(now: number): number {
    this.metered = this.metered.filter((t) => now - t < RATE_WINDOW_MS);
    return this.metered.length;
  }

  private hintWithin(taskId: string, now: number): boolean {
    this.hints = this.hints.filter((h) => now - h.at < HINT_WINDOW_MS);
    return this.hints.some((h) => h.taskId === taskId);
  }

  /** A hint arrived: an inferred moment about the same task, accepted within the window, gives way. */
  private beatInferred(taskId: string, now: number): void {
    const inferred = (m: Cue) => !m.hint && !isHeld(m) && m.taskId === taskId;
    this.queue = this.queue.filter((q) => !(inferred(q.moment) && now - q.at < HINT_WINDOW_MS));
    const p = this.playing;
    if (p && inferred(p.moment) && now - p.startedAt < HINT_WINDOW_MS) {
      this.playing = null;
      this.cut = { moment: p.moment, at: now };
      this.lastActive = now;
    }
  }

  private offerAnswer(m: Cue, now: number): OfferResult {
    const key = m.askId!;
    const p = this.playing;
    if (p && isAsk(p.moment) && matches(p.moment, key)) {
      this.playing = null;
      this.queue = this.queue.filter((q) => !matches(q.moment, key));
      this.start(m, now);
      return "play";
    }
    // Answered while it only waited in the queue: its cat never came out.
    this.queue = this.queue.filter((q) => !matches(q.moment, key));
    if (this.answered && this.answered.askId === key && now - this.answered.at <= ANSWER_WINDOW_MS) {
      this.answered = null;
      if (this.playing) this.cutAway(now);
      this.start(m, now);
      return "play";
    }
    return "stale";
  }

  private place(m: Cue, now: number): OfferResult {
    const p = this.playing?.moment;
    if (!p) {
      this.start(m, now);
      return "play";
    }
    if (isHeld(p)) {
      if (isHeld(m) && m.priority > p.priority) {
        this.cutAway(now);
        this.start(m, now);
        return "play";
      }
      if (isHeld(m)) return this.enqueue(m, now, false);
      return "busy";
    }
    // A new tap restarts the tap reaction (three quick taps call a crew cat out).
    if (m.priority > p.priority || (m.type === "tap" && p.type === "tap")) {
      this.cutAway(now);
      this.start(m, now);
      return "play";
    }
    return this.enqueue(m, now, false);
  }

  /** Into the queue: by priority, then first come; held moments that were cut go first in their rank. */
  private enqueue(m: Cue, now: number, front: boolean): OfferResult {
    const entry: Queued = { moment: m, at: now };
    let i = this.queue.findIndex((q) => (front ? q.moment.priority <= m.priority : q.moment.priority < m.priority));
    if (i < 0) i = this.queue.length;
    this.queue.splice(i, 0, entry);
    while (this.queue.length > QUEUE_MAX) {
      let drop = -1;
      for (let j = 0; j < this.queue.length; j++) {
        const q = this.queue[j]!;
        if (isHeld(q.moment)) continue;
        if (drop < 0 || q.at < this.queue[drop]!.at) drop = j;
      }
      if (drop < 0) break;
      const [gone] = this.queue.splice(drop, 1);
      if (gone === entry) return "full";
    }
    return "queue";
  }

  /** The current moment leaves for a higher one: a held one waits at the front, anything else exits fast. */
  private cutAway(now: number): void {
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    if (isHeld(p.moment)) this.enqueue(p.moment, now, true);
    else this.cut = { moment: p.moment, at: now };
    this.lastActive = now;
  }

  private start(m: Cue, at: number): void {
    this.playing = { moment: m, startedAt: at, endsAt: m.ms === null ? null : at + m.ms };
    this.lastActive = at;
    // Behind a moment that stays, only asks and failures wait: the rest would be stale by the answer.
    if (isHeld(m)) this.queue = this.queue.filter((q) => isHeld(q.moment));
  }

  /** The stage went quiet at `at`: the next quirk is a fresh seeded gap away. */
  private rest(at: number): void {
    this.lastActive = at;
    this.nextQuirk = at + this.gap();
  }

  /** Ends what ran out by `now` and starts the next in line, each at the time it truly began. */
  private advance(now: number): void {
    for (;;) {
      const p = this.playing;
      if (p && p.endsAt !== null && now >= p.endsAt) {
        this.playing = null;
        this.rest(p.endsAt);
        const next = this.queue.shift();
        if (next) this.start(next.moment, p.endsAt);
        continue;
      }
      if (!p && this.queue.length) {
        this.start(this.queue.shift()!.moment, now);
        continue;
      }
      return;
    }
  }

  private liveAsks(): string[] {
    const out: string[] = [];
    const p = this.playing?.moment;
    if (p && isAsk(p)) out.push(p.askId ?? p.id);
    for (const q of this.queue) if (isAsk(q.moment)) out.push(q.moment.askId ?? q.moment.id);
    return out;
  }
}
