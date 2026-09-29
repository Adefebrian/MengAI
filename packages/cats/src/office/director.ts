// The office director: one light scheduler for the whole scene. It owns
// every cat's place on the floor and plays the story beats as small
// scripts (stand up, walk the lanes, hand over, sit back down), queued per
// cat, then reports each beat done. No React in here and no standing
// animation frame loop:
//   Clock     one pausable timer for every wait in the scene (paused when
//             the scene is off screen or the tab is hidden)
//   walks     one Web Animations translate per trip along the plan's lane
//             waypoints, at constant speed (the walk cycle is a CSS loop,
//             so the feet only match a constant pace); facing flips at each
//             waypoint through a data attribute, never a React render
//   state     per cat: where it is (desk, floor, meeting seat), its floor
//             pose, what it carries, one-shot reactions; subscribers
//             re-render only the cat that changed
// JEV motion.choreography: handoff, ask, decided, review, deliver and the
// coffee break are stagger_sequence (one actor after another), the meeting
// files in with a stagger, celebrate plays in parallel. Under reduced
// motion every walk is instant and every beat is also a text note.
import type { MeetingKind } from "@mengai/shared";
import type { OfficeAgent, OfficeBeat, OfficeMeeting } from "../office-contract";
import { allDesks, deskOf, facingOf, pathLength, route, type Facing, type OfficePlan, type Pt, type Spot } from "./geometry";

/* ---------------------------------------------------------------------
 * Timing (ms). Holds are long enough to read the moment at a glance.
 * ------------------------------------------------------------------- */
export const TIMING = {
  stand: 360,
  sit: 360,
  handReach: 800,
  handGive: 1000,
  nod: 1100,
  stamp: 1300,
  pin: 1300,
  celebrate: 2200,
  brew: 1800,
  sip: 3400,
  stagger: 600,
  talk: 2400,
  park: 45000,
  mug: 30000,
  idleMin: 22000,
  idleMax: 55000,
  poll: 400,
} as const;

/* ---------------------------------------------------------------------
 * Clock: one pausable timer queue
 * ------------------------------------------------------------------- */
export interface TimerHost {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

export const realTimers: TimerHost = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
};

interface Timer {
  at: number;
  id: number;
  fn: () => void;
}

export class Clock {
  private base = 0;
  private realBase: number;
  private stopped = false;
  private queue: Timer[] = [];
  private seq = 0;
  private handle: unknown = null;

  constructor(private host: TimerHost = realTimers) {
    this.realBase = host.now();
  }

  get paused(): boolean {
    return this.stopped;
  }

  now(): number {
    return this.stopped ? this.base : this.base + (this.host.now() - this.realBase);
  }

  after(ms: number, fn: () => void): number {
    const id = ++this.seq;
    const at = this.now() + Math.max(0, ms);
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1]!.at > at) i--;
    this.queue.splice(i, 0, { at, id, fn });
    this.arm();
    return id;
  }

  cancel(id: number): void {
    const i = this.queue.findIndex((t) => t.id === id);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.arm();
    }
  }

  pause(): void {
    if (this.stopped) return;
    this.base = this.now();
    this.stopped = true;
    this.disarm();
  }

  resume(): void {
    if (!this.stopped) return;
    this.realBase = this.host.now();
    this.stopped = false;
    this.arm();
  }

  clear(): void {
    this.queue = [];
    this.disarm();
  }

  private disarm(): void {
    if (this.handle !== null) this.host.clear(this.handle);
    this.handle = null;
  }

  private arm(): void {
    this.disarm();
    if (this.stopped || this.queue.length === 0) return;
    const wait = Math.max(0, this.queue[0]!.at - this.now());
    this.handle = this.host.set(() => this.fire(), wait);
  }

  private fire(): void {
    this.handle = null;
    const t = this.now();
    while (this.queue.length && this.queue[0]!.at <= t + 1 && !this.stopped) {
      const timer = this.queue.shift()!;
      timer.fn();
    }
    this.arm();
  }
}

/* ---------------------------------------------------------------------
 * What the scene renders for each cat
 * ------------------------------------------------------------------- */
export type Carry = "card" | "card-pass" | "card-deny" | "mug" | "stamp-pass" | "stamp-return";
export type FloorPose = "walk" | "stand" | "front" | "back";
export type Reaction = "catch" | "nod" | "shake" | "celebrate" | "stamp-pass" | "stamp-return" | "look";

export interface ActorView {
  id: string;
  where: "desk" | "floor" | "seat";
  pose: FloorPose;
  /** the seated front rig's beat while on the floor (coffee: rest) */
  beat: "rest" | "wait";
  /** back pose: the right paw raised, holding what it carries */
  paw: boolean;
  carry: Carry | null;
  /** meeting seat index (or stand index past the seats) while where is "seat" */
  seat: number;
  react: { kind: Reaction; n: number } | null;
  /** a fresh mug stands on the desk after a coffee break */
  mug: boolean;
  /** bumps on every stand up and sit down, so the entrance replays */
  moves: number;
}

export interface MeetingView {
  id: string | null;
  kind: MeetingKind | null;
  title: string;
  agenda: string[];
  notes: string[];
  running: boolean;
  seated: string[];
  speaker: string | null;
}

export interface Note {
  id: string;
  text: string;
}

const IDLE_STATUSES = new Set(["idle", "waiting", "done"]);

const MEETING_WORD: Record<MeetingKind, string> = {
  kickoff: "Kickoff",
  sync: "Sync",
  review: "Review meeting",
  wrapup: "Wrap-up",
};

class Abort extends Error {
  constructor() {
    super("office scene reset");
  }
}

function moversOf(beat: OfficeBeat): string[] {
  switch (beat.kind) {
    case "handoff":
    case "ask":
    case "deliver":
      return [beat.fromId];
    case "decided":
      return [beat.toId];
    case "review":
      return [beat.reviewerId];
    case "celebrate":
      return [...beat.agentIds];
  }
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DirectorOptions {
  timers?: TimerHost;
  onBeatDone?: (beatId: string) => void;
}

export class Director {
  readonly clock: Clock;
  onBeatDone: ((beatId: string) => void) | undefined;

  private plan: OfficePlan | null = null;
  private agents = new Map<string, OfficeAgent>();
  private live = true;

  private actors = new Map<string, ActorView>();
  private at = new Map<string, Spot>();
  private els = new Map<string, SVGGraphicsElement>();
  private anims = new Set<Animation>();
  private busy = new Set<string>();
  private parked = new Map<string, { spot: string; timer: number }>();
  private reserved = new Map<string, string>();
  private pending: OfficeBeat[] = [];
  private seen = new Set<string>();
  private done = new Set<string>();
  private sleepers = new Set<(err: Abort) => void>();
  private gen = 0;
  private reactN = 0;
  private idleTimers = new Map<string, number>();
  private mugTimers = new Map<string, number>();
  private rand = new Map<string, () => number>();

  private meeting: MeetingView = { id: null, kind: null, title: "", agenda: [], notes: [], running: false, seated: [], speaker: null };
  private meetingSource: OfficeMeeting | null = null;
  private talkTimer = 0;
  private notes: Note[] = [];
  private noteN = 0;
  private boardN = 0;
  private brewN = 0;

  private listeners = new Map<string, Set<() => void>>();
  private disposed = false;
  private running = new Map<string, OfficeBeat>();

  constructor(opts: DirectorOptions = {}) {
    this.clock = new Clock(opts.timers);
    this.onBeatDone = opts.onBeatDone;
  }

  /* ---------------- store ---------------- */

  subscribe(key: string, fn: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  private emit(key: string): void {
    for (const fn of [...(this.listeners.get(key) ?? [])]) fn();
  }

  actor(id: string): ActorView {
    let v = this.actors.get(id);
    if (!v) {
      v = { id, where: "desk", pose: "stand", beat: "rest", paw: false, carry: null, seat: -1, react: null, mug: false, moves: 0 };
      this.actors.set(id, v);
    }
    return v;
  }

  meetingView(): MeetingView {
    return this.meeting;
  }

  noteList(): Note[] {
    return this.notes;
  }

  boardFlash(): number {
    return this.boardN;
  }

  brewing(): number {
    return this.brewN;
  }

  isLive(): boolean {
    return this.live;
  }

  private set(id: string, patch: Partial<ActorView>): void {
    const next = { ...this.actor(id), ...patch };
    this.actors.set(id, next);
    this.emit(`actor:${id}`);
  }

  private react(id: string, kind: Reaction): void {
    if (!this.agents.has(id)) return;
    this.set(id, { react: { kind, n: ++this.reactN } });
  }

  private note(text: string): void {
    this.notes = [{ id: `n${++this.noteN}`, text }, ...this.notes].slice(0, 6);
    this.emit("notes");
  }

  private setMeetingView(patch: Partial<MeetingView>): void {
    this.meeting = { ...this.meeting, ...patch };
    this.emit("meeting");
  }

  /* ---------------- inputs ---------------- */

  /** The floor element of a cat, for the walks. Writes its current position at once. */
  register(id: string, el: SVGGraphicsElement | null): void {
    if (!el) {
      this.els.delete(id);
      return;
    }
    this.els.set(id, el);
    const spot = this.at.get(id);
    if (spot) this.place(el, spot.p);
  }

  setLive(live: boolean): void {
    this.live = live;
    if (!live) for (const anim of this.anims) anim.finish();
    this.scheduleIdleAll();
  }

  pause(): void {
    this.clock.pause();
    for (const anim of this.anims) anim.pause();
  }

  resume(): void {
    for (const anim of this.anims) anim.play();
    this.clock.resume();
  }

  setAgents(agents: OfficeAgent[]): void {
    const next = new Map(agents.map((a) => [a.id, a]));
    this.agents = next;
    for (const id of next.keys()) this.actor(id);
    this.scheduleIdleAll();
    this.pump();
  }

  /** A new plan (width or crew changed): every running script stops, every cat goes back to its desk or seat. */
  setPlan(plan: OfficePlan): void {
    const first = this.plan === null;
    this.plan = plan;
    if (!first) this.reset();
    for (const d of allDesks(plan)) this.at.set(d.agentId, d.home);
    for (const [id, el] of this.els) {
      const spot = this.at.get(id);
      if (spot) this.place(el, spot.p);
    }
    if (!first) this.reseatMeeting();
    this.pump();
  }

  setBeats(beats: OfficeBeat[]): void {
    for (const beat of beats) {
      if (this.seen.has(beat.id)) continue;
      this.seen.add(beat.id);
      this.pending.push(beat);
    }
    this.pump();
  }

  setMeetings(meetings: OfficeMeeting[]): void {
    const running = [...meetings].reverse().find((m) => m.endedAt === null) ?? null;
    const current = this.meetingSource;
    if (current && (!running || running.id !== current.id)) {
      const ended = meetings.find((m) => m.id === current.id);
      this.endMeeting(ended?.notes ?? []);
    }
    if (running && (!this.meetingSource || this.meetingSource.id !== running.id)) this.startMeeting(running);
    else if (running) this.setMeetingView({ title: running.title, agenda: running.agenda });
  }

  /** Mounted: idle life and the queue run. */
  attach(): void {
    this.disposed = false;
    this.scheduleIdleAll();
    this.pump();
  }

  /** Unmounted (or a StrictMode remount): scripts stop, beats in flight go back to the queue. */
  detach(): void {
    this.reset();
    this.disposed = true;
    this.clock.clear();
    this.idleTimers.clear();
    this.mugTimers.clear();
    this.talkTimer = 0;
    this.meetingSource = null;
    this.meeting = { id: null, kind: null, title: "", agenda: [], notes: [], running: false, seated: [], speaker: null };
  }

  dispose(): void {
    this.detach();
    this.listeners.clear();
  }

  /* ---------------- plumbing ---------------- */

  private reset(): void {
    this.gen++;
    // beats in flight replay from the start after the reset, in their order
    if (this.running.size) {
      this.pending = [...this.running.values(), ...this.pending];
      this.running.clear();
    }
    for (const wake of [...this.sleepers]) wake(new Abort());
    this.sleepers.clear();
    for (const anim of this.anims) anim.cancel();
    this.anims.clear();
    for (const p of this.parked.values()) this.clock.cancel(p.timer);
    this.parked.clear();
    this.reserved.clear();
    this.busy.clear();
    for (const [id, v] of this.actors) {
      if (v.where !== "desk" || v.pose !== "stand" || v.carry) this.set(id, { where: "desk", pose: "stand", carry: null, paw: false, seat: -1, moves: v.moves + 1 });
    }
  }

  private sleep(ms: number): Promise<void> {
    const gen = this.gen;
    return new Promise<void>((resolve, reject) => {
      const wake = (err?: Abort) => {
        this.sleepers.delete(wake);
        if (err || gen !== this.gen) reject(err ?? new Abort());
        else resolve();
      };
      this.sleepers.add(wake);
      this.clock.after(ms, () => wake());
    });
  }

  private name(id: string): string {
    return this.agents.get(id)?.name ?? "A teammate";
  }

  private leadId(): string | null {
    return this.plan?.ceo.desk?.agentId ?? null;
  }

  private place(el: SVGGraphicsElement, p: Pt): void {
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }

  private free(id: string): boolean {
    return this.agents.has(id) && !this.busy.has(id);
  }

  private finish(beatId: string): void {
    if (this.done.has(beatId)) return;
    this.done.add(beatId);
    if (!this.disposed) this.onBeatDone?.(beatId);
  }

  /** Starts every pending beat whose movers are free, keeping each cat's beats in order. */
  private pump(): void {
    if (!this.plan || this.disposed) return;
    const claimed = new Set<string>();
    const keep: OfficeBeat[] = [];
    for (const beat of this.pending) {
      const movers = moversOf(beat).filter((id) => this.agents.has(id));
      if (movers.length === 0) {
        this.finish(beat.id);
        continue;
      }
      if (movers.some((id) => claimed.has(id) || this.busy.has(id))) {
        for (const id of movers) claimed.add(id);
        keep.push(beat);
        continue;
      }
      for (const id of movers) claimed.add(id);
      this.start(beat, movers);
    }
    this.pending = keep;
  }

  private start(beat: OfficeBeat, movers: string[]): void {
    for (const id of movers) {
      this.busy.add(id);
      this.cancelIdle(id);
    }
    const gen = this.gen;
    this.running.set(beat.id, beat);
    const run = async () => {
      try {
        await this.play(beat, movers);
      } catch (err) {
        if (!(err instanceof Abort)) throw err;
      } finally {
        // a reset put this beat back in the queue: it is not done yet
        if (gen === this.gen) {
          this.running.delete(beat.id);
          for (const id of movers) this.busy.delete(id);
          this.finish(beat.id);
          for (const id of movers) this.scheduleIdle(id);
          this.pump();
        }
      }
    };
    void run();
  }

  private async play(beat: OfficeBeat, movers: string[]): Promise<void> {
    switch (beat.kind) {
      case "handoff":
        return this.handoff(beat.fromId, beat.toId, beat.taskTitle);
      case "ask":
        return this.ask(beat.fromId, beat.toId, beat.question);
      case "decided":
        return this.decided(beat.byId, beat.toId, beat.approved, beat.answer);
      case "review":
        return this.review(beat.reviewerId, beat.ownerId, beat.passed, beat.taskTitle);
      case "deliver":
        return this.deliver(beat.fromId, beat.taskTitle);
      case "celebrate":
        return this.celebrate(movers);
    }
  }

  /* ---------------- steps ---------------- */

  private async standUp(id: string): Promise<void> {
    this.unpark(id);
    const v = this.actor(id);
    if (v.where === "floor") return;
    const desk = this.plan && deskOf(this.plan, id);
    if (desk && v.where === "desk") this.at.set(id, desk.home);
    const el = this.els.get(id);
    const spot = this.at.get(id);
    if (el && spot) this.place(el, spot.p);
    this.set(id, { where: "floor", pose: "stand", paw: false, seat: -1, react: null, moves: v.moves + 1 });
    await this.sleep(this.live ? TIMING.stand : 0);
  }

  private async sitDown(id: string): Promise<void> {
    const v = this.actor(id);
    this.set(id, { where: "desk", pose: "stand", paw: false, carry: null, moves: v.moves + 1 });
    await this.sleep(this.live ? TIMING.sit : 0);
  }

  private async walkTo(id: string, to: Spot): Promise<void> {
    const plan = this.plan;
    const from = this.at.get(id);
    if (!plan || !from) return;
    const pts = route(plan, from, to);
    this.at.set(id, to);
    if (pts.length < 2) return;
    const el = this.els.get(id);
    const total = pathLength(pts);
    const dur = this.live ? Math.round((total / plan.m.speed) * 1000) : 0;
    this.set(id, { pose: "walk" });
    const end = pts[pts.length - 1]!;
    if (el && dur > 0 && typeof el.animate === "function") {
      // the walker goes on top of every cat standing still
      el.parentNode?.appendChild(el);
      let acc = 0;
      const frames: Keyframe[] = pts.map((p, i) => {
        if (i > 0) acc += Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y);
        return { transform: `translate(${p.x}px, ${p.y}px)`, offset: total ? acc / total : 1 };
      });
      const anim = el.animate(frames, { duration: dur, easing: "linear", fill: "forwards" });
      this.anims.add(anim);
      if (this.clock.paused) anim.pause();
      let t = 0;
      for (let i = 1; i < pts.length; i++) {
        const face = facingOf(pts[i - 1]!, pts[i]!);
        const seg = (Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y) / total) * dur;
        if (i === 1) el.setAttribute("data-face", face);
        else this.clock.after(t, () => el.setAttribute("data-face", face));
        t += seg;
      }
      try {
        await this.sleep(dur);
      } finally {
        this.place(el, end);
        anim.cancel();
        this.anims.delete(anim);
      }
    } else {
      // no element to move (not mounted yet, or no Web Animations): the walk still takes its time
      if (el) {
        el.setAttribute("data-face", facingOf(pts[pts.length - 2]!, end));
        this.place(el, end);
      }
      if (dur > 0) await this.sleep(dur);
    }
    this.set(id, { pose: "stand" });
  }

  private async goHome(id: string): Promise<void> {
    const plan = this.plan;
    const desk = plan && deskOf(plan, id);
    if (!desk) return;
    if (this.actor(id).where === "desk") return;
    if (this.actor(id).where === "seat") this.set(id, { where: "floor", pose: "stand", seat: -1 });
    await this.walkTo(id, desk.home);
    await this.sitDown(id);
  }

  /** The first free spot among keys, waiting while all are taken. */
  private async reserve(id: string, options: Array<{ key: string; spot: Spot }>): Promise<{ key: string; spot: Spot }> {
    for (;;) {
      for (const o of options) {
        const holder = this.reserved.get(o.key);
        if (!holder || holder === id) {
          this.reserved.set(o.key, id);
          return o;
        }
      }
      await this.sleep(TIMING.poll);
    }
  }

  private release(key: string, id: string): void {
    if (this.reserved.get(key) === id) this.reserved.delete(key);
  }

  private visitSpots(targetId: string): Array<{ key: string; spot: Spot }> {
    const plan = this.plan!;
    const lead = this.leadId();
    if (targetId === lead || !deskOf(plan, targetId)) {
      return plan.ceo.visitors.map((spot, i) => ({ key: `ceo:${i}`, spot }));
    }
    return deskOf(plan, targetId)!.visits.map((spot, i) => ({ key: `desk:${targetId}:${i}`, spot }));
  }

  private unpark(id: string): void {
    const p = this.parked.get(id);
    if (!p) return;
    this.clock.cancel(p.timer);
    this.release(p.spot, id);
    this.parked.delete(id);
  }

  /* ---------------- beats ---------------- */

  private async handoff(fromId: string, toId: string, title: string): Promise<void> {
    this.note(`${this.name(fromId)} hands "${title}" to ${this.name(toId)}`);
    if (fromId === toId || !this.agents.has(toId)) return;
    await this.standUp(fromId);
    this.set(fromId, { carry: "card" });
    const slot = await this.reserve(fromId, this.visitSpots(toId));
    try {
      await this.walkTo(fromId, slot.spot);
      this.set(fromId, { pose: "back", paw: true });
      await this.sleep(TIMING.handReach);
      this.set(fromId, { paw: false, carry: null });
      this.react(toId, "catch");
      await this.sleep(TIMING.handGive);
    } finally {
      this.release(slot.key, fromId);
    }
    await this.goHome(fromId);
  }

  private async ask(fromId: string, toId: string, question: string): Promise<void> {
    this.note(`${this.name(fromId)} asks ${this.name(toId)}: ${question}`);
    await this.standUp(fromId);
    const slot = await this.reserve(fromId, this.visitSpots(toId));
    await this.walkTo(fromId, slot.spot);
    this.set(fromId, { pose: "back", paw: true });
    this.react(toId, "look");
    // parked: waits with the paw up until the answer comes, or goes back after a while
    const timer = this.clock.after(TIMING.park, () => {
      if (!this.parked.has(fromId) || this.busy.has(fromId)) return;
      this.unpark(fromId);
      this.busy.add(fromId);
      void this.goHome(fromId)
        .catch((err) => {
          if (!(err instanceof Abort)) throw err;
        })
        .finally(() => {
          this.busy.delete(fromId);
          this.scheduleIdle(fromId);
          this.pump();
        });
    });
    this.parked.set(fromId, { spot: slot.key, timer });
  }

  private async decided(byId: string, toId: string, approved: boolean, answer: string): Promise<void> {
    this.note(`${this.name(byId)} ${approved ? "approves" : "says not yet to"} ${this.name(toId)}: ${answer}`);
    this.react(byId, approved ? "nod" : "shake");
    await this.sleep(TIMING.nod);
    if (this.parked.has(toId)) {
      this.set(toId, { carry: approved ? "card-pass" : "card-deny", paw: true });
      await this.sleep(TIMING.stamp);
      this.set(toId, { paw: false });
      this.unpark(toId);
      await this.goHome(toId);
      this.set(toId, { carry: null });
      return;
    }
    if (this.actor(toId).where === "desk") {
      this.react(toId, approved ? "stamp-pass" : "stamp-return");
      await this.sleep(TIMING.stamp);
    }
  }

  private async review(reviewerId: string, ownerId: string, passed: boolean, title: string): Promise<void> {
    this.note(`${this.name(reviewerId)} ${passed ? "passes" : "sends back"} "${title}" for ${this.name(ownerId)}`);
    const stamp = passed ? "stamp-pass" : "stamp-return";
    if (reviewerId === ownerId || !this.agents.has(ownerId)) {
      this.react(reviewerId, stamp);
      await this.sleep(TIMING.stamp);
      return;
    }
    await this.standUp(reviewerId);
    this.set(reviewerId, { carry: stamp });
    const slot = await this.reserve(reviewerId, this.visitSpots(ownerId));
    try {
      await this.walkTo(reviewerId, slot.spot);
      this.set(reviewerId, { pose: "back", paw: true });
      await this.sleep(TIMING.handReach);
      this.react(ownerId, stamp);
      await this.sleep(TIMING.stamp);
      this.set(reviewerId, { paw: false, carry: null });
    } finally {
      this.release(slot.key, reviewerId);
    }
    await this.goHome(reviewerId);
  }

  private async deliver(fromId: string, title: string): Promise<void> {
    this.note(`${this.name(fromId)} pins "${title}" to the board`);
    const plan = this.plan!;
    await this.standUp(fromId);
    this.set(fromId, { carry: "card" });
    const slot = await this.reserve(fromId, [{ key: "board", spot: plan.ceo.board }]);
    try {
      await this.walkTo(fromId, slot.spot);
      this.set(fromId, { pose: "back", paw: true });
      await this.sleep(TIMING.handReach);
      this.set(fromId, { paw: false, carry: null });
      this.boardN++;
      this.emit("board");
      await this.sleep(TIMING.pin);
    } finally {
      this.release(slot.key, fromId);
    }
    await this.goHome(fromId);
  }

  private async celebrate(ids: string[]): Promise<void> {
    this.note("The crew celebrates: the goal is done");
    const standing = ids.filter((id) => this.actor(id).where === "desk");
    await Promise.all(standing.map((id) => this.standUp(id)));
    for (const id of ids) this.react(id, "celebrate");
    await this.sleep(TIMING.celebrate);
    await Promise.all(
      standing.map(async (id) => {
        if (this.actor(id).where === "floor") await this.sitDown(id);
      }),
    );
  }

  /* ---------------- meetings ---------------- */

  private seatSpot(i: number): Spot | null {
    const plan = this.plan;
    if (!plan) return null;
    const room = plan.meeting;
    if (!room) return plan.huddle[i] ?? null;
    if (i < room.seats.length) return room.seats[i]!.spot;
    return room.stands[i - room.seats.length] ?? null;
  }

  /** Sat down for the meeting: at the table, or in the huddle in front of the easel. */
  private takeSeat(id: string, i: number): void {
    if (this.plan?.meeting) this.set(id, { where: "seat", seat: i, pose: "stand", moves: this.actor(id).moves + 1 });
    else this.set(id, { where: "floor", pose: "back", paw: false, seat: i });
  }

  private attendees(m: OfficeMeeting): string[] {
    const order = this.plan ? allDesks(this.plan).map((d) => d.agentId) : [];
    return m.agentIds.filter((id) => this.agents.has(id)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  private startMeeting(m: OfficeMeeting): void {
    this.meetingSource = m;
    const ids = this.attendees(m);
    this.note(`${MEETING_WORD[m.kind]}: ${m.title}`);
    this.setMeetingView({ id: m.id, kind: m.kind, title: m.title, agenda: m.agenda, notes: [], running: true, seated: [], speaker: null });
    ids.forEach((id, i) => {
      void this.joinMeeting(m.id, id, i);
    });
  }

  private async waitFree(id: string, meetingId: string): Promise<boolean> {
    while (this.busy.has(id)) {
      await this.sleep(TIMING.poll);
      if (this.meeting.id !== meetingId || !this.meeting.running) return false;
    }
    return true;
  }

  private async joinMeeting(meetingId: string, id: string, i: number): Promise<void> {
    try {
      await this.sleep(this.live ? i * TIMING.stagger : 0);
      if (!(await this.waitFree(id, meetingId))) return;
      if (this.meeting.id !== meetingId || !this.meeting.running) return;
      const spot = this.seatSpot(i);
      if (!spot) return;
      this.busy.add(id);
      this.cancelIdle(id);
      await this.standUp(id);
      await this.walkTo(id, spot);
      if (this.meeting.id !== meetingId || !this.meeting.running) {
        await this.goHome(id);
        this.busy.delete(id);
        this.pump();
        return;
      }
      this.takeSeat(id, i);
      this.setMeetingView({ seated: [...this.meeting.seated, id] });
      if (!this.talkTimer) this.talk(meetingId, 0);
    } catch (err) {
      if (!(err instanceof Abort)) throw err;
    }
  }

  private talk(meetingId: string, turn: number): void {
    if (this.meeting.id !== meetingId || !this.meeting.running) {
      this.talkTimer = 0;
      return;
    }
    const seated = this.meeting.seated;
    const speaker = seated.length >= 2 ? seated[turn % seated.length]! : null;
    this.setMeetingView({ speaker });
    this.talkTimer = this.clock.after(TIMING.talk, () => this.talk(meetingId, turn + 1));
  }

  private endMeeting(notes: string[]): void {
    const src = this.meetingSource;
    this.meetingSource = null;
    if (this.talkTimer) this.clock.cancel(this.talkTimer);
    this.talkTimer = 0;
    if (!src) return;
    this.note(`${MEETING_WORD[src.kind]} wrapped up: ${src.title}`);
    const leaving = [...this.meeting.seated].reverse();
    this.setMeetingView({ running: false, speaker: null, notes, seated: [] });
    leaving.forEach((id, i) => {
      void (async () => {
        try {
          await this.sleep(this.live ? i * TIMING.stagger : 0);
          const v = this.actor(id);
          if (v.where === "desk") return;
          this.set(id, { where: "floor", pose: "stand", seat: -1, moves: v.where === "seat" ? v.moves + 1 : v.moves });
          await this.goHome(id);
        } catch (err) {
          if (!(err instanceof Abort)) throw err;
        } finally {
          this.busy.delete(id);
          this.scheduleIdle(id);
          this.pump();
        }
      })();
    });
  }

  /** After a reset the running meeting's attendees take their seats again at once. */
  private reseatMeeting(): void {
    const src = this.meetingSource;
    if (!src || !this.meeting.running) return;
    const ids = this.attendees(src);
    const seated: string[] = [];
    ids.forEach((id, i) => {
      const spot = this.seatSpot(i);
      if (!spot) return;
      this.at.set(id, spot);
      const el = this.els.get(id);
      if (el) this.place(el, spot.p);
      this.busy.add(id);
      this.takeSeat(id, i);
      seated.push(id);
    });
    this.setMeetingView({ seated });
    if (this.talkTimer) this.clock.cancel(this.talkTimer);
    this.talkTimer = 0;
    this.talk(src.id, 0);
  }

  /* ---------------- idle life ---------------- */

  private randFor(id: string): () => number {
    let r = this.rand.get(id);
    if (!r) {
      const seed = this.agents.get(id)?.look.seed ?? id.length * 997;
      r = seeded(seed ^ 0x51f15e);
      this.rand.set(id, r);
    }
    return r;
  }

  private cancelIdle(id: string): void {
    const t = this.idleTimers.get(id);
    if (t) this.clock.cancel(t);
    this.idleTimers.delete(id);
  }

  private scheduleIdleAll(): void {
    for (const id of this.agents.keys()) this.scheduleIdle(id);
  }

  private scheduleIdle(id: string): void {
    this.cancelIdle(id);
    if (!this.live || this.disposed || !this.agents.has(id)) return;
    const r = this.randFor(id);
    const wait = TIMING.idleMin + Math.floor(r() * (TIMING.idleMax - TIMING.idleMin));
    this.idleTimers.set(
      id,
      this.clock.after(wait, () => {
        this.idleTimers.delete(id);
        this.maybeCoffee(id);
      }),
    );
  }

  private maybeCoffee(id: string): void {
    const a = this.agents.get(id);
    const plan = this.plan;
    const eligible =
      a &&
      plan &&
      this.live &&
      IDLE_STATUSES.has(a.status) &&
      this.free(id) &&
      !this.parked.has(id) &&
      this.actor(id).where === "desk" &&
      !this.meeting.running &&
      !this.pending.some((b) => moversOf(b).includes(id)) &&
      plan.pantry !== null &&
      plan.pantry.spots.some((_, i) => !this.reserved.has(`pantry:${i}`));
    if (!eligible) {
      this.scheduleIdle(id);
      return;
    }
    this.busy.add(id);
    void this.coffee(id)
      .catch((err) => {
        if (!(err instanceof Abort)) throw err;
      })
      .finally(() => {
        this.busy.delete(id);
        this.scheduleIdle(id);
        this.pump();
      });
  }

  private async coffee(id: string): Promise<void> {
    const pantry = this.plan?.pantry;
    if (!pantry) return;
    await this.standUp(id);
    const slot = await this.reserve(
      id,
      pantry.spots.map((spot, i) => ({ key: `pantry:${i}`, spot })),
    );
    try {
      await this.walkTo(id, slot.spot);
      this.set(id, { pose: "back", paw: false });
      this.brewN++;
      this.emit("brew");
      await this.sleep(TIMING.brew);
      this.set(id, { pose: "front", beat: "rest", carry: "mug" });
      await this.sleep(TIMING.sip);
      this.set(id, { pose: "stand" });
    } finally {
      this.release(slot.key, id);
    }
    await this.goHome(id);
    this.set(id, { carry: null, mug: true });
    const old = this.mugTimers.get(id);
    if (old) this.clock.cancel(old);
    this.mugTimers.set(
      id,
      this.clock.after(TIMING.mug, () => {
        this.mugTimers.delete(id);
        this.set(id, { mug: false });
      }),
    );
  }

  /* ---------------- test and preview hooks ---------------- */

  /** Where a cat stands right now (its current spot's point). */
  position(id: string): Pt | null {
    return this.at.get(id)?.p ?? null;
  }

  isBusy(id: string): boolean {
    return this.busy.has(id);
  }

  pendingCount(): number {
    return this.pending.length;
  }

  /** Sends one idle cat for coffee now (preview story). Returns false when it cannot go. */
  coffeeNow(id: string): boolean {
    if (!this.agents.has(id) || !this.free(id) || this.actor(id).where !== "desk" || !this.plan?.pantry) return false;
    this.cancelIdle(id);
    this.busy.add(id);
    void this.coffee(id)
      .catch((err) => {
        if (!(err instanceof Abort)) throw err;
      })
      .finally(() => {
        this.busy.delete(id);
        this.scheduleIdle(id);
        this.pump();
      });
    return true;
  }
}

export type { Facing };
