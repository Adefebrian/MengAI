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
//   company   a hire steps in at the door with a box and walks to its
//             desk; a cat that leaves packs a box and walks out the door;
//             idle cats take a coffee or nap in the cat bed; the rack
//             blinks while tests run (the fund's router while orders are
//             executed), then shows pass or fail; the fund's bell rings
//             when a target is hit; the windows follow the story clock in
//             three flat skies (day until 18:00, dusk, then night only for
//             overtime)
//   ambient   an idle-life scheduler: one idle cat at a time takes a
//             coffee, a nap in the cat bed or a stroll in the corridor, so
//             a cat is always somewhere between the story beats (JEV
//             motion.intensity ambient tier 1: one cat, long holds)
//   depth     a floor cat's feet pick its depth band: behind a furniture
//             row's front edge the row's blocks are cut out of it (a clip
//             swapped at each waypoint and front crossing), so a cat behind
//             a desk goes behind the desk
//   camera    the room where the current beat plays, for the narrow floor's
//             camera window (JEV motion.intensity camera tier 1)
// JEV motion.choreography: handoff, ask, decided, review, deliver, the
// coffee break, the hire, the departure and the nap are stagger_sequence
// (one step after another), the meeting files in with a stagger, celebrate
// plays in parallel. Under reduced motion every walk is instant and every
// beat is also a text note.
import type { MeetingKind } from "@mengai/shared";
import type { OfficeAgent, OfficeBeat, OfficeMeeting } from "../office-contract";
import { allDesks, bandOf, deskOf, facingOf, pathLength, route, type Facing, type OfficePlan, type Pt, type Spot } from "./geometry";

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
  /** the door swings open and a cat steps through */
  door: 700,
  /** a new hire's box stays on its desk this long */
  unpack: 6000,
  nap: 16000,
  /** the rack shows pass or fail this long after the run */
  rackHold: 9000,
  bell: 1400,
  /** how often the windows re-read the local hour (a story clock sets it directly) */
  day: 300000,
  /** the first ambient trip after the scene mounts, and the gap between two */
  ambientFirst: 1200,
  ambientGap: 1600,
  /** a meeting that shows up this soon after the scene mounts was already in session: its crew is seated at once */
  opening: 1500,
  /** a cat back from an idle trip stays at its desk at least this long before the next one */
  ambientRest: 20000,
  /** how long a stroller sits in the corridor */
  stroll: 9000,
} as const;

/** The window sky: three flat fills swapped by the story clock. */
export type Daypart = "day" | "dusk" | "night";

/** Day with a sun disc until 18:00, dusk until 20:00, then night (overtime); before 06:00 it is night too. */
export function daypartOf(hour: number): Daypart {
  if (hour >= 6 && hour < 18) return "day";
  if (hour >= 18 && hour < 20) return "dusk";
  return "night";
}

export type RackMode = "idle" | "testing" | "pass" | "fail";

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
export type Carry = "card" | "card-pass" | "card-deny" | "mug" | "stamp-pass" | "stamp-return" | "box";
/** exit: stepping out through the door, fading */
export type FloorPose = "walk" | "stand" | "front" | "back" | "exit";
export type Reaction = "catch" | "nod" | "shake" | "celebrate" | "stamp-pass" | "stamp-return" | "look" | "approve";
/** desk: seated at its desk; floor: up and about; seat: at the meeting table; nap: in the cat bed; out: not in the office */
export type Where = "desk" | "floor" | "seat" | "nap" | "out";

export interface ActorView {
  id: string;
  where: Where;
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
  /** a new hire's open box on its desk */
  unpack: boolean;
  /** a leaver has packed its desk things into the box */
  packed: boolean;
  /** dozing, curled up on its own desk top (a nap when there is no cat bed) */
  dozing: boolean;
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
  /** agenda items talked through so far */
  discussed: number;
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

/** An idle cat's trip away from its desk. */
export type Trip = "coffee" | "nap" | "stroll";

/** The scene's own beats: a hire walking in, a cat walking out. Their ids start with "~" and never reach onBeatDone. */
type SceneBeat = OfficeBeat | { id: string; kind: "arrive"; agentId: string } | { id: string; kind: "depart"; agentId: string };

export interface SceneChanges {
  /** cats that just joined: they walk in through the door */
  arriving?: string[];
  /** cats that are leaving: they pack a box and walk out, then onGone fires */
  leaving?: string[];
}

class Abort extends Error {
  constructor() {
    super("office scene reset");
  }
}

function moversOf(beat: SceneBeat): string[] {
  switch (beat.kind) {
    case "arrive":
    case "depart":
      return [beat.agentId];
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

/** Every cat a beat touches, movers and the cats they walk to. */
function involvedIn(beat: SceneBeat): string[] {
  switch (beat.kind) {
    case "handoff":
    case "ask":
      return [beat.fromId, beat.toId];
    case "decided":
      return [beat.byId, beat.toId];
    case "review":
      return [beat.reviewerId, beat.ownerId];
    default:
      return moversOf(beat);
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
  /** reads the local hour (tests pin it) */
  hour?: () => number;
  /** the idle-life scheduler (on by default; tests of one trip turn it off) */
  ambient?: boolean;
}

/** Two plans put every cat, room and walkway in the same place: a hire into a free desk needs no reset. */
export function samePlaces(a: OfficePlan, b: OfficePlan): boolean {
  if (a.width !== b.width || a.height !== b.height || a.variant !== b.variant || a.theme !== b.theme) return false;
  const key = (p: OfficePlan) =>
    JSON.stringify([p.ceo.rect, p.ceo.board.p, p.meeting?.rect, p.meeting?.table, p.pantry?.rect, p.pantry?.counter, p.door?.rect, p.lanes, p.spines, p.huddle.map((s) => s.p)]);
  if (key(a) !== key(b)) return false;
  const desks = new Map(allDesks(b).map((d) => [d.agentId, d]));
  for (const d of allDesks(a)) {
    const o = desks.get(d.agentId);
    if (o && JSON.stringify(o.rect) !== JSON.stringify(d.rect)) return false;
  }
  return true;
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
  private pending: SceneBeat[] = [];
  private seen = new Set<string>();
  private done = new Set<string>();
  private sleepers = new Set<(err: Abort) => void>();
  private gen = 0;
  private reactN = 0;
  private idleTimers = new Map<string, number>();
  private mugTimers = new Map<string, number>();
  private rand = new Map<string, () => number>();

  private meeting: MeetingView = { id: null, kind: null, title: "", agenda: [], notes: [], running: false, seated: [], speaker: null, discussed: 0 };
  private meetingSource: OfficeMeeting | null = null;
  private talkTimer = 0;
  /** the meeting's seat reservation table: one cat per seat, stand or huddle spot */
  private seatClaims = new Map<number, string>();
  private strollN = 0;
  private notes: Note[] = [];
  private noteN = 0;
  private boardN = 0;
  private brewN = 0;

  private listeners = new Map<string, Set<() => void>>();
  private disposed = false;
  private running = new Map<string, SceneBeat>();

  /** fires when a leaving cat has walked out of the door */
  onGone: ((agentId: string) => void) | undefined;
  private arriving = new Set<string>();
  private announced = new Set<string>();
  private leaving = new Set<string>();
  private doorHolders = new Set<string>();
  private unpackTimers = new Map<string, number>();
  private rack: { mode: RackMode; n: number } = { mode: "idle", n: 0 };
  private rackRunners = new Set<string>();
  private rackTimer = 0;
  private bellN = 0;
  private hour: () => number;
  /** the story clock's hour when the scene is given one; the local hour otherwise */
  private storyHour: number | null = null;
  private day: Daypart;
  private dayTimer = 0;
  private sceneN = 0;

  /** the scene's clip id base: the depth band clips are `${clipBase}-depth-${band}` */
  clipBase = "of";
  private ambientOn: boolean;
  private ambientTimer = 0;
  private ambientId: string | null = null;
  private tripEnd = new Map<string, number>();
  private ambientLast = new Map<string, number>();
  private ambientN = 0;
  private trips = new Map<string, Trip>();
  /** what the camera looks at, by source: beats first, then the meeting, then an idle trip */
  private focusBy = new Map<string, { y: number; prio: number; at: number }>();
  private meetingsSeen = false;
  private attachedAt = 0;
  private focusN = 0;

  constructor(opts: DirectorOptions = {}) {
    this.clock = new Clock(opts.timers);
    this.onBeatDone = opts.onBeatDone;
    this.hour = opts.hour ?? (() => new Date().getHours());
    this.ambientOn = opts.ambient ?? true;
    this.day = daypartOf(this.hour());
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
      v = { id, where: "desk", pose: "stand", beat: "rest", paw: false, carry: null, seat: -1, react: null, mug: false, unpack: false, packed: false, dozing: false, moves: 0 };
      this.actors.set(id, v);
    }
    return v;
  }

  doorOpen(): boolean {
    return this.doorHolders.size > 0;
  }

  rackView(): { mode: RackMode; n: number } {
    return this.rack;
  }

  bell(): number {
    return this.bellN;
  }

  daypart(): Daypart {
    return this.day;
  }

  /** The hour the windows and the wall clock show: the story clock's, else the local hour. */
  hourNow(): number {
    return this.storyHour ?? this.hour();
  }

  /** The story clock (0 to 24, fractions allowed), or null to follow the local hour. */
  setHour(hour: number | null): void {
    const h = hour === null || !Number.isFinite(hour) ? null : ((hour % 24) + 24) % 24;
    const wasHour = Math.floor(this.hourNow());
    this.storyHour = h;
    const next = daypartOf(this.hourNow());
    if (next !== this.day) {
      this.day = next;
      this.emit("day");
    }
    if (Math.floor(this.hourNow()) !== wasHour) this.emit("clock");
  }

  /** The world y the camera should look at, or null to rest on the plan board. */
  cameraFocus(): number | null {
    let best: { y: number; prio: number; at: number } | null = null;
    for (const f of this.focusBy.values()) if (!best || f.prio > best.prio || (f.prio === best.prio && f.at > best.at)) best = f;
    return best ? best.y : null;
  }

  private focus(key: string, y: number | null, prio: number): void {
    if (y === null) {
      if (this.focusBy.delete(key)) this.emit("camera");
      return;
    }
    this.focusBy.set(key, { y, prio, at: ++this.focusN });
    this.emit("camera");
  }

  /** Where a beat plays, for the camera: the desk walked to, the CEO office, the board, the door. */
  private beatFocus(beat: SceneBeat): number | null {
    const plan = this.plan;
    if (!plan) return null;
    const deskY = (id: string) => {
      const d = deskOf(plan, id);
      return d ? d.rect.y + d.rect.h * 0.6 : null;
    };
    switch (beat.kind) {
      case "handoff":
        return deskY(beat.toId);
      case "ask":
        return deskY(beat.toId) ?? plan.ceo.rect.y + plan.ceo.rect.h / 2;
      case "decided":
        return this.parked.has(beat.toId) ? deskY(beat.byId) : deskY(beat.toId);
      case "review":
        return deskY(beat.ownerId);
      case "deliver":
        return plan.ceo.board.p.y;
      case "arrive":
        return deskY(beat.agentId);
      case "depart":
        return plan.door ? plan.door.spot.p.y : deskY(beat.agentId);
      case "celebrate":
        return null;
    }
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
    this.scheduleAmbient(TIMING.ambientFirst);
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
    this.applyAgents(agents);
    this.scheduleIdleAll();
    this.pump();
  }

  /** A new plan (width or crew changed). When the cats' places moved, every running script stops and every cat goes back to its desk or seat. */
  setPlan(plan: OfficePlan): void {
    this.applyPlan(plan);
    this.pump();
  }

  /** The crew, its floor plan and who joins or leaves, applied together so a hire walks to a desk that exists. */
  setScene(agents: OfficeAgent[], plan: OfficePlan, changes: SceneChanges = {}): void {
    this.applyAgents(agents);
    if (plan !== this.plan) this.applyPlan(plan);
    const arrivals: SceneBeat[] = [];
    for (const id of changes.arriving ?? []) {
      // each hire walks in once, however often the scene hands the same change over
      if (this.announced.has(id) || !this.agents.has(id)) continue;
      this.announced.add(id);
      this.arriving.add(id);
      this.cancelIdle(id);
      this.set(id, { where: "out", carry: null, moves: this.actor(id).moves + 1 });
      arrivals.push({ id: `~in:${id}:${++this.sceneN}`, kind: "arrive", agentId: id });
    }
    // a hire walks in before it does anything else, in the order they joined
    this.pending = [...arrivals, ...this.pending];
    // a leaver who is back in the crew stays: its walk out is called off
    const stay = new Set(changes.leaving ?? []);
    for (const id of [...this.leaving]) {
      if (stay.has(id)) continue;
      this.leaving.delete(id);
      this.pending = this.pending.filter((b) => !(b.kind === "depart" && b.agentId === id));
    }
    for (const id of changes.leaving ?? []) {
      if (this.leaving.has(id) || !this.agents.has(id)) continue;
      this.leaving.add(id);
      this.cancelIdle(id);
      this.pending.push({ id: `~out:${id}:${++this.sceneN}`, kind: "depart", agentId: id });
    }
    this.scheduleIdleAll();
    this.pump();
  }

  private applyAgents(agents: OfficeAgent[]): void {
    const next = new Map(agents.map((a) => [a.id, a]));
    this.agents = next;
    for (const id of next.keys()) this.actor(id);
    for (const id of [...this.arriving]) if (!next.has(id)) this.arriving.delete(id);
    for (const id of [...this.announced]) if (!next.has(id)) this.announced.delete(id);
    for (const id of [...this.leaving]) if (!next.has(id)) this.leaving.delete(id);
    this.updateRack();
  }

  private applyPlan(plan: OfficePlan): void {
    const old = this.plan;
    this.plan = plan;
    const napMoved = old !== null && JSON.stringify(old.nap?.bed) !== JSON.stringify(plan.nap?.bed) && ([...this.actors.values()].some((v) => v.where === "nap") || this.reserved.has("nap"));
    const moved = old !== null && (napMoved || !samePlaces(old, plan));
    if (moved) this.reset();
    for (const d of allDesks(plan)) {
      const v = this.actors.get(d.agentId);
      // a cat up and about keeps walking when nothing moved
      if (moved || !this.at.has(d.agentId) || !v || v.where === "desk") this.at.set(d.agentId, d.home);
    }
    for (const [id, el] of this.els) {
      const spot = this.at.get(id);
      if (spot && (moved || this.actor(id).where === "desk")) this.place(el, spot.p);
    }
    if (moved) this.reseatMeeting();
    // the theme decides what the rack watches
    if (!old || old.theme !== plan.theme) this.updateRack();
  }

  /* ---------------- the rack: blinking while tests (or trades) run, then pass or fail ---------------- */

  private updateRack(): void {
    // the studio's rack runs the tests; the fund's order router works the orders being executed
    const fund = this.plan?.theme === "fund";
    const runners = [...this.agents.values()].filter((a) => a.activity === (fund ? "automate" : "run") && (a.status === "working" || a.status === "thinking"));
    if (runners.length) {
      for (const a of runners) this.rackRunners.add(a.id);
      if (this.rackTimer) this.clock.cancel(this.rackTimer);
      this.rackTimer = 0;
      if (this.rack.mode !== "testing") this.setRack("testing");
      return;
    }
    if (this.rack.mode !== "testing") return;
    const failed = [...this.rackRunners].some((id) => {
      const a = this.agents.get(id);
      return a !== undefined && (a.status === "error" || a.mood === "frustrated");
    });
    this.rackRunners.clear();
    this.setRack(failed ? "fail" : "pass");
    this.rackTimer = this.clock.after(TIMING.rackHold, () => {
      this.rackTimer = 0;
      this.setRack("idle");
    });
  }

  private setRack(mode: RackMode): void {
    this.rack = { mode, n: this.rack.n + 1 };
    this.emit("rack");
  }

  /* ---------------- the windows: the local hour in flat steps ---------------- */

  private watchDay(): void {
    if (this.dayTimer) this.clock.cancel(this.dayTimer);
    this.dayTimer = this.clock.after(TIMING.day, () => {
      this.dayTimer = 0;
      const next = daypartOf(this.hourNow());
      if (next !== this.day) {
        this.day = next;
        this.emit("day");
      }
      this.emit("clock");
      this.watchDay();
    });
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
    // a meeting already running when the scene opens: its crew is in its seats, not walking in from the desks
    const opening = !this.meetingsSeen && this.plan !== null && this.clock.now() - this.attachedAt <= TIMING.opening;
    if (running && this.plan) this.meetingsSeen = true;
    if (current && (!running || running.id !== current.id)) {
      const ended = meetings.find((m) => m.id === current.id);
      this.endMeeting(ended?.notes ?? []);
    }
    if (running && (!this.meetingSource || this.meetingSource.id !== running.id)) {
      this.startMeeting(running);
      if (opening) this.reseatMeeting();
    } else if (running) this.setMeetingView({ title: running.title, agenda: running.agenda });
  }

  /** Mounted: idle life and the queue run. */
  attach(): void {
    this.disposed = false;
    this.attachedAt = this.clock.now();
    const now = daypartOf(this.hourNow());
    if (now !== this.day) {
      this.day = now;
      this.emit("day");
    }
    this.watchDay();
    this.scheduleIdleAll();
    this.scheduleAmbient(TIMING.ambientFirst);
    this.pump();
  }

  /** Unmounted (or a StrictMode remount): scripts stop, beats in flight go back to the queue. */
  detach(): void {
    this.reset();
    this.disposed = true;
    this.clock.clear();
    this.idleTimers.clear();
    this.mugTimers.clear();
    this.unpackTimers.clear();
    this.talkTimer = 0;
    this.rackTimer = 0;
    this.dayTimer = 0;
    this.ambientTimer = 0;
    this.ambientId = null;
    this.trips.clear();
    this.focusBy.clear();
    this.meetingsSeen = false;
    this.meetingSource = null;
    this.meeting = { id: null, kind: null, title: "", agenda: [], notes: [], running: false, seated: [], speaker: null, discussed: 0 };
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
    this.seatClaims.clear();
    this.busy.clear();
    if (this.doorHolders.size) {
      this.doorHolders.clear();
      this.emit("door");
    }
    const waiting = new Set(this.pending.filter((b) => b.kind === "arrive").map((b) => moversOf(b)[0]!));
    for (const [id, v] of this.actors) {
      if (waiting.has(id)) {
        if (v.where !== "out") this.set(id, { where: "out", pose: "stand", carry: null, paw: false, seat: -1, moves: v.moves + 1 });
        continue;
      }
      if (v.where !== "desk" || v.pose !== "stand" || v.carry || v.packed || v.dozing) this.set(id, { where: "desk", pose: "stand", carry: null, paw: false, seat: -1, packed: false, dozing: false, moves: v.moves + 1 });
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
    this.restack(el, p.y);
    this.setBand(el, p.y);
  }

  /** The element the scene wraps a floor cat in (its depth slot), else the cat itself. */
  private slotOf(el: Element): Element {
    const parent = el.parentElement;
    return parent && parent.getAttribute("data-slot") !== null ? parent : el;
  }

  /**
   * Depth: floor cats are drawn in the order of their feet, so a cat nearer
   * the front passes in front of one further back, never through it.
   */
  private restack(el: SVGGraphicsElement, y: number): void {
    el.setAttribute("data-y", String(Math.round(y)));
    const slot = this.slotOf(el);
    slot.setAttribute("data-y", String(Math.round(y)));
    const parent = slot.parentNode;
    if (!parent) return;
    let before: Node | null = null;
    for (const node of Array.from(parent.childNodes)) {
      if (node === slot || !(node instanceof Element)) continue;
      const ny = Number(node.getAttribute("data-y") ?? "0");
      if (ny > y) {
        before = node;
        break;
      }
    }
    if (before) {
      if (slot.nextSibling !== before) parent.insertBefore(slot, before);
    } else if (parent.lastChild !== slot) parent.appendChild(slot);
  }

  /** Depth against the furniture: behind a row's front edge, the row's blocks are cut out of the cat. */
  private setBand(el: SVGGraphicsElement, y: number): void {
    const plan = this.plan;
    const slot = this.slotOf(el);
    if (!plan || slot === el) return;
    const band = bandOf(plan, y);
    const value = band >= plan.occluders.length ? null : `url(#${this.clipBase}-depth-${band})`;
    if (value === null) slot.removeAttribute("clip-path");
    else if (slot.getAttribute("clip-path") !== value) slot.setAttribute("clip-path", value);
  }

  private free(id: string): boolean {
    return this.agents.has(id) && !this.busy.has(id);
  }

  private finish(beatId: string): void {
    if (this.done.has(beatId)) return;
    this.done.add(beatId);
    if (!this.disposed && !beatId.startsWith("~")) this.onBeatDone?.(beatId);
  }

  /** Starts every pending beat whose movers are free, keeping each cat's beats in order. */
  private pump(): void {
    if (!this.plan || this.disposed) return;
    const claimed = new Set<string>();
    const keep: SceneBeat[] = [];
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

  private start(beat: SceneBeat, movers: string[]): void {
    for (const id of movers) {
      this.busy.add(id);
      this.cancelIdle(id);
    }
    const gen = this.gen;
    this.running.set(beat.id, beat);
    this.focus(`beat:${beat.id}`, this.beatFocus(beat), 3);
    const run = async () => {
      try {
        await this.play(beat, movers);
      } catch (err) {
        if (!(err instanceof Abort)) throw err;
      } finally {
        this.focus(`beat:${beat.id}`, null, 3);
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

  private async play(beat: SceneBeat, movers: string[]): Promise<void> {
    switch (beat.kind) {
      case "arrive":
        return this.arrive(beat.agentId);
      case "depart":
        return this.depart(beat.agentId);
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
      let acc = 0;
      const frames: Keyframe[] = pts.map((p, i) => {
        if (i > 0) acc += Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y);
        return { transform: `translate(${p.x}px, ${p.y}px)`, offset: total ? acc / total : 1 };
      });
      const anim = el.animate(frames, { duration: dur, easing: "linear", fill: "forwards" });
      this.anims.add(anim);
      if (this.clock.paused) anim.pause();
      let t = 0;
      const fronts = plan.occluders.map((o) => o.front);
      el.removeAttribute("data-lean");
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const face = facingOf(a, b);
        const seg = (Math.hypot(b.x - a.x, b.y - a.y) / total) * dur;
        const depth = Math.min(a.y, b.y);
        const turn = () => {
          el.setAttribute("data-face", face);
          this.restack(el, depth);
          this.setBand(el, a.y);
        };
        if (i === 1) turn();
        else this.clock.after(t, turn);
        // a front edge crossed on the way up or down the floor swaps the depth band as the feet pass it
        if (Math.abs(b.y - a.y) > 0.5) {
          for (const f of fronts) {
            if ((f - a.y) * (f - b.y) >= 0) continue;
            const down = b.y > a.y;
            this.clock.after(t + (Math.abs(f - a.y) / Math.abs(b.y - a.y)) * seg, () => this.setBand(el, down ? f + 0.5 : f - 1));
          }
        }
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
    // docked beside a desk, the raised paw reaches toward it
    if (el) {
      if (to.lean) el.setAttribute("data-lean", to.lean);
      else el.removeAttribute("data-lean");
    }
    this.set(id, { pose: "stand" });
  }

  private async goHome(id: string): Promise<void> {
    const plan = this.plan;
    const desk = plan && deskOf(plan, id);
    if (!desk) return;
    const where = this.actor(id).where;
    if (where === "desk" || where === "out") return;
    if (where === "seat" || where === "nap") this.set(id, { where: "floor", pose: "stand", seat: -1, moves: this.actor(id).moves + 1 });
    await this.walkTo(id, desk.home);
    await this.sitDown(id);
  }

  /** The scene opens on a cat already at a spot: up from its desk and there at once, no walk. */
  private appearAt(id: string, spot: Spot): void {
    this.unpark(id);
    this.at.set(id, spot);
    const el = this.els.get(id);
    if (el) {
      el.setAttribute("data-face", "down");
      this.place(el, spot.p);
    }
    this.set(id, { where: "floor", pose: "stand", paw: false, seat: -1, react: null, moves: this.actor(id).moves + 1 });
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
    // the keys name the place: two desks that share a spine share its docks
    if (targetId === lead || !deskOf(plan, targetId)) {
      return plan.ceo.visitors.map((spot, i) => ({ key: spot.key ?? `ceo:${i}`, spot }));
    }
    return deskOf(plan, targetId)!.visits.map((spot, i) => ({ key: spot.key ?? `desk:${targetId}:${i}`, spot }));
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
    // yes: a nod and the approval stamp comes down on the desk; no: a head shake
    this.react(byId, approved ? "approve" : "shake");
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
      this.ring();
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
    this.ring();
    await this.sleep(TIMING.celebrate);
    await Promise.all(
      standing.map(async (id) => {
        if (this.actor(id).where === "floor") await this.sitDown(id);
      }),
    );
  }

  /** The fund's bell on the lead's desk: a target was hit. */
  private ring(): void {
    this.bellN++;
    this.emit("bell");
  }

  private holdDoor(id: string, open: boolean): void {
    const was = this.doorHolders.size > 0;
    if (open) this.doorHolders.add(id);
    else this.doorHolders.delete(id);
    if (was !== this.doorHolders.size > 0) this.emit("door");
  }

  /** A hire: the door opens, it steps in carrying its box, walks to its new desk, sits and unpacks. */
  private async arrive(id: string): Promise<void> {
    const plan = this.plan!;
    const desk = deskOf(plan, id);
    this.note(`${this.name(id)} joins the crew`);
    const door = plan.door;
    if (!desk || !door || !this.live) {
      if (desk) this.at.set(id, desk.home);
      this.arriving.delete(id);
      this.set(id, { where: "desk", pose: "stand", carry: null, moves: this.actor(id).moves + 1 });
      if (desk) this.unpackFor(id);
      return;
    }
    const slot = await this.reserve(id, [{ key: "door", spot: door.spot }]);
    try {
      this.at.set(id, door.spot);
      const el = this.els.get(id);
      if (el) {
        el.setAttribute("data-face", "down");
        this.place(el, door.spot.p);
      }
      this.holdDoor(id, true);
      this.set(id, { where: "floor", pose: "stand", carry: "box", moves: this.actor(id).moves + 1 });
      this.arriving.delete(id);
      await this.sleep(TIMING.door);
      const walk = this.walkTo(id, desk.home);
      walk.catch(() => undefined);
      // the next hire may use the door once this one is through it
      await this.sleep(TIMING.door);
      this.holdDoor(id, false);
      this.release(slot.key, id);
      await walk;
    } finally {
      this.holdDoor(id, false);
      this.release(slot.key, id);
    }
    await this.sitDown(id);
    this.set(id, { carry: null });
    this.unpackFor(id);
  }

  private unpackFor(id: string): void {
    this.set(id, { unpack: true });
    const old = this.unpackTimers.get(id);
    if (old) this.clock.cancel(old);
    this.unpackTimers.set(
      id,
      this.clock.after(TIMING.unpack, () => {
        this.unpackTimers.delete(id);
        this.set(id, { unpack: false });
      }),
    );
  }

  /** A cat leaving the company: it packs its desk into a box, walks to the door and out. */
  private async depart(id: string): Promise<void> {
    const plan = this.plan!;
    this.note(`${this.name(id)} packs a box and leaves the office`);
    await this.standUp(id);
    this.set(id, { carry: "box", packed: true });
    const door = plan.door;
    if (door) {
      const slot = await this.reserve(id, [{ key: "door", spot: door.spot }]);
      try {
        await this.walkTo(id, door.spot);
        this.holdDoor(id, true);
        this.set(id, { pose: "exit" });
        const el = this.els.get(id);
        el?.setAttribute("data-face", "up");
        await this.sleep(this.live ? TIMING.door : 0);
        this.set(id, { where: "out", pose: "stand", carry: null });
        await this.sleep(this.live ? TIMING.door : 0);
      } finally {
        this.holdDoor(id, false);
        this.release(slot.key, id);
      }
    } else {
      this.set(id, { where: "out", pose: "stand", carry: null });
    }
    if (!this.leaving.has(id)) {
      // called back while walking out: it comes back in and sits down again
      const desk = this.plan && deskOf(this.plan, id);
      if (desk && door) {
        this.set(id, { where: "floor", pose: "stand", packed: false, moves: this.actor(id).moves + 1 });
        await this.walkTo(id, desk.home);
      }
      await this.sitDown(id);
      this.set(id, { packed: false });
      return;
    }
    const gone = this.onGone;
    // after this beat's own bookkeeping, so the scene can drop the cat
    this.clock.after(0, () => gone?.(id));
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
    this.setMeetingView({ id: m.id, kind: m.kind, title: m.title, agenda: m.agenda, notes: [], running: true, seated: [], speaker: null, discussed: 0 });
    this.focus("meeting", this.meetingFocus(), 2);
    this.seatClaims.clear();
    this.arrivalOrder(ids).forEach(({ id, delay }, i) => {
      void this.joinMeeting(m.id, id, i, delay);
    });
  }

  /**
   * Who walks in first, and when each cat sets off: the nearest cat takes
   * the far seat, and each cat leaves late enough to reach the room a cat's
   * width behind the one ahead, so two cats never meet at the gap or file
   * in on top of each other, and a later arrival never passes a seated cat.
   */
  private arrivalOrder(ids: string[]): Array<{ id: string; delay: number }> {
    const plan = this.plan;
    const first = this.seatSpot(0);
    if (!plan || !first || !this.live) return ids.map((id) => ({ id, delay: 0 }));
    const walk = ids.map((id, k) => {
      const from = this.at.get(id);
      return { id, k, ms: from ? (pathLength(route(plan, from, first)) / plan.m.speed) * 1000 : 0 };
    });
    walk.sort((a, b) => a.ms - b.ms || a.k - b.k);
    const gap = Math.max(TIMING.stagger, ((72 * plan.m.walker) / plan.m.speed) * 1000);
    let prev = -Infinity;
    return walk.map(({ id, ms }) => {
      const arrive = Math.max(ms, prev + gap);
      prev = arrive;
      return { id, delay: Math.round(arrive - ms) };
    });
  }

  /** The free seat nearest the way in (the last in the far-first order), for a cat that comes in late. */
  private lastFreeSeat(): number | null {
    const room = this.plan?.meeting;
    const total = room ? room.seats.length + room.stands.length : (this.plan?.huddle.length ?? 0);
    for (let i = total - 1; i >= 0; i--) if (!this.seatClaims.has(i) && this.seatSpot(i)) return i;
    return null;
  }

  private async waitFree(id: string, meetingId: string): Promise<boolean> {
    while (this.busy.has(id)) {
      await this.sleep(TIMING.poll);
      if (this.meeting.id !== meetingId || !this.meeting.running) return false;
    }
    return true;
  }

  private async joinMeeting(meetingId: string, id: string, rank: number, delay: number): Promise<void> {
    try {
      await this.sleep(this.live ? delay : 0);
      const late = this.busy.has(id);
      if (!(await this.waitFree(id, meetingId))) return;
      if (this.meeting.id !== meetingId || !this.meeting.running) return;
      // one cat per seat: a cat held up elsewhere takes the free seat nearest the way in, so it never walks past a seated cat
      const i = late || this.seatClaims.has(rank) ? this.lastFreeSeat() : rank;
      if (i === null) return;
      const spot = this.seatSpot(i);
      if (!spot) return;
      this.seatClaims.set(i, id);
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
    // every second turn the board ticks off the next agenda item
    const discussed = speaker && turn > 0 && turn % 2 === 0 ? Math.min(this.meeting.agenda.length, this.meeting.discussed + 1) : this.meeting.discussed;
    this.setMeetingView({ speaker, discussed });
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
    this.focus("meeting", null, 2);
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

  private meetingFocus(): number | null {
    const plan = this.plan;
    if (!plan) return null;
    if (plan.meeting) return plan.meeting.table.y + plan.meeting.table.h / 2;
    return plan.huddle[0]?.p.y ?? null;
  }

  /** After a reset the running meeting's attendees take their seats again at once. */
  private reseatMeeting(): void {
    const src = this.meetingSource;
    if (!src || !this.meeting.running) return;
    const ids = this.attendees(src);
    const seated: string[] = [];
    this.seatClaims.clear();
    ids.forEach((id, i) => {
      const spot = this.seatSpot(i);
      if (!spot) return;
      this.seatClaims.set(i, id);
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
        this.maybeIdleTrip(id);
      }),
    );
  }

  /** An idle cat's trip: a coffee, or a nap in the cat bed when it is tired; stretching and grooming play at the desk. */
  private maybeIdleTrip(id: string): void {
    const a = this.agents.get(id);
    const plan = this.plan;
    const eligible =
      a &&
      plan &&
      this.live &&
      IDLE_STATUSES.has(a.status) &&
      this.free(id) &&
      !this.parked.has(id) &&
      !this.leaving.has(id) &&
      this.actor(id).where === "desk" &&
      !this.meeting.running &&
      // one idle cat out at a time (JEV motion.intensity ambient tier 1)
      this.trips.size === 0 &&
      !this.pending.some((b) => moversOf(b).includes(id));
    if (!eligible) {
      this.scheduleIdle(id);
      return;
    }
    const canCoffee = plan.pantry !== null && plan.pantry.spots.some((_, i) => !this.reserved.has(`pantry:${i}`));
    // a nap in the cat bed, or curled up on its own desk when the bed is taken or there is none
    const canNap = true;
    const sleepy = a.mood === "tired" || a.energy >= 0.7 || a.status === "done";
    const r = this.randFor(id)();
    const trip = canNap && (sleepy ? r < 0.6 : r < 0.3) ? "nap" : canCoffee ? "coffee" : canNap ? "nap" : null;
    if (!trip) {
      this.scheduleIdle(id);
      return;
    }
    this.runTrip(id, trip, trip === "nap" ? () => this.nap(id) : () => this.coffee(id));
  }

  private runTrip(id: string, kind: Trip, trip: () => Promise<void>): void {
    this.cancelIdle(id);
    this.busy.add(id);
    this.trips.set(id, kind);
    this.focus(`trip:${id}`, this.tripFocus(kind), 1);
    void trip()
      .catch((err) => {
        if (!(err instanceof Abort)) throw err;
      })
      .finally(() => {
        this.trips.delete(id);
        this.tripEnd.set(id, this.clock.now());
        this.focus(`trip:${id}`, null, 1);
        this.busy.delete(id);
        this.scheduleIdle(id);
        if (this.ambientId === id) this.ambientId = null;
        this.scheduleAmbient(TIMING.ambientGap);
        this.pump();
      });
  }

  private tripFocus(kind: Trip): number | null {
    const plan = this.plan;
    if (!plan) return null;
    if (kind === "coffee") return plan.pantry?.spots[0]?.p.y ?? null;
    if (kind === "nap") return plan.nap?.spot.p.y ?? null;
    return this.strollSpots()[0]?.p.y ?? null;
  }

  /* ---------------- ambient: a cat is always somewhere ---------------- */

  private scheduleAmbient(ms: number): void {
    if (this.ambientTimer || !this.live || this.disposed || !this.ambientOn) return;
    this.ambientTimer = this.clock.after(ms, () => {
      this.ambientTimer = 0;
      this.ambientTick();
    });
  }

  /** A cat free for idle life: idle, waiting or done, at its desk, in no beat or meeting that is coming. */
  private ambientFree(id: string): boolean {
    const a = this.agents.get(id);
    const v = this.actor(id);
    if (!a || !IDLE_STATUSES.has(a.status) || !this.free(id) || this.parked.has(id) || this.leaving.has(id) || this.arriving.has(id)) return false;
    if (v.where !== "desk" || v.dozing || id === this.leadId()) return false;
    if (this.clock.now() - (this.tripEnd.get(id) ?? -Infinity) < TIMING.ambientRest) return false;
    if (this.meeting.running && this.meetingSource?.agentIds.includes(id)) return false;
    const touches = (b: SceneBeat) => involvedIn(b).includes(id);
    return !this.pending.some(touches) && ![...this.running.values()].some(touches);
  }

  /**
   * The idle-life scheduler: whenever no idle cat is out, the one that went
   * longest ago takes a trip (a coffee, a nap in the cat bed, a stroll in
   * the corridor, in turn), then the next one goes after a short gap.
   */
  private ambientTick(): void {
    const plan = this.plan;
    if (!this.live || this.disposed) return;
    if (!plan || this.trips.size > 0) {
      this.scheduleAmbient(TIMING.ambientGap);
      return;
    }
    const free = [...this.agents.keys()].filter((id) => this.ambientFree(id));
    if (!free.length) {
      this.scheduleAmbient(TIMING.ambientGap * 2);
      return;
    }
    free.sort((a, b) => (this.ambientLast.get(a) ?? -1) - (this.ambientLast.get(b) ?? -1));
    const id = free[0]!;
    const kinds: Trip[] = [];
    if (plan.pantry && plan.pantry.spots.some((_, i) => !this.reserved.has(`pantry:${i}`))) kinds.push("coffee");
    if (plan.nap && !this.reserved.has("nap")) kinds.push("nap");
    if (this.strollSpots().some((_, i) => !this.reserved.has(`stroll:${i}`))) kinds.push("stroll");
    if (!kinds.length) {
      this.scheduleAmbient(TIMING.ambientGap * 2);
      return;
    }
    const a = this.agents.get(id)!;
    const sleepy = a.mood === "tired" || a.status === "done";
    const kind = sleepy && kinds.includes("nap") ? "nap" : kinds[this.ambientN++ % kinds.length]!;
    this.ambientId = id;
    this.ambientLast.set(id, this.clock.now());
    // the scene opens mid-day: the first idle cat is already on its break, not just getting up
    const instant = this.clock.now() - this.attachedAt <= TIMING.opening;
    this.runTrip(id, kind, kind === "nap" ? () => this.nap(id, instant) : kind === "coffee" ? () => this.coffee(id, instant) : () => this.stroll(id, instant));
  }

  /**
   * Where a stroller stops for a stretch and a look round: two spots in the
   * corridor, clear of the room gaps and the spines, then one in each aisle
   * between the desk rows, under a monitor and a cat's width clear of every
   * spot a cat stands at on that lane (homes, docks, the pantry, the bed),
   * so idle life also walks the aisles and never lands on another cat.
   */
  private strollSpots(): Spot[] {
    const plan = this.plan;
    if (!plan) return [];
    const clear = Math.round(44 * plan.m.walker);
    const body = Math.round(64 * plan.m.walker);
    const spines = plan.spines.flatMap((s) => [s.xD, s.xU]);
    const out: Spot[] = [];
    if (plan.corridor) {
      const lane = plan.lanes[0]!;
      const c = plan.corridor;
      const avoid = [...plan.rooms.flatMap((r) => (r.gap && r.front !== null ? [r.gap.x] : [])), ...spines];
      for (const f of [0.38, 0.7, 0.22, 0.86, 0.54]) {
        const x = Math.round(c.x + c.w * f);
        if (avoid.some((a) => Math.abs(a - x) < clear) || out.some((o) => Math.abs(o.p.x - x) < clear * 2)) continue;
        out.push({ p: { x, y: lane.yR }, lane: 0, attach: x, inner: [] });
        if (out.length === 2) break;
      }
    }
    const corridor = out.splice(0);
    const desks = plan.desks;
    const taken: Spot[] = [...allDesks(plan).flatMap((d) => [d.home, ...d.visits]), ...(plan.pantry?.spots ?? []), ...(plan.nap ? [plan.nap.spot] : []), ...plan.huddle];
    const lanes = [...new Set(desks.map((d) => d.home.lane))].filter((l) => l > 0 || !plan.corridor);
    for (const l of lanes) {
      const onLane = taken.filter((t) => t.lane === l && Math.abs(t.p.y - (desks.find((d) => d.home.lane === l)?.home.p.y ?? 0)) < body);
      for (const d of desks.filter((k) => k.home.lane === l)) {
        const x = Math.round(d.monitor.x + d.monitor.w / 2);
        if (onLane.some((t) => Math.abs(t.p.x - x) < body) || spines.some((a) => Math.abs(a - x) < clear)) continue;
        out.push({ p: { x, y: d.home.p.y }, lane: l, attach: x, inner: [] });
        break;
      }
    }
    // corridor and aisles in turn
    const aisles = out.splice(0);
    for (let i = 0; i < Math.max(corridor.length, aisles.length); i++) out.push(...(corridor[i] ? [corridor[i]!] : []), ...(aisles[i] ? [aisles[i]!] : []));
    return out;
  }

  /** A stroll: out to the corridor or down an aisle, a stretch and a look round, then back; work calls it back early. */
  private async stroll(id: string, instant = false): Promise<void> {
    const all = this.strollSpots();
    if (!all.length) return;
    if (!instant) await this.standUp(id);
    // each stroll starts from the next spot in turn, so idle life works through the corridor and every aisle
    const from = this.strollN++ % all.length;
    const order = all.map((spot, i) => ({ key: `stroll:${i}`, spot })).map((_, k, arr) => arr[(from + k) % arr.length]!);
    const slot = await this.reserve(id, order);
    try {
      if (instant) this.appearAt(id, slot.spot);
      else await this.walkTo(id, slot.spot);
      this.set(id, { pose: "front", beat: "rest" });
      await this.idleHold(id, TIMING.stroll);
      this.set(id, { pose: "stand" });
    } finally {
      this.release(slot.key, id);
    }
    await this.goHome(id);
  }

  /** Holds up to ms, and returns at once when work comes in. */
  private async idleHold(id: string, ms: number): Promise<void> {
    const step = 1000;
    for (let t = 0; t < ms; t += step) {
      await this.sleep(Math.min(step, ms - t));
      const a = this.agents.get(id);
      if (!a || !IDLE_STATUSES.has(a.status) || this.pending.some((b) => moversOf(b).includes(id))) return;
    }
  }

  /** Sleeps up to the nap's length, and wakes at once when work comes in. */
  private async snooze(id: string): Promise<void> {
    await this.idleHold(id, TIMING.nap);
  }

  /** A nap: into the cat bed, curled up with its eyes shut for a while, then back to the desk; on the desk top when there is no free bed. */
  private async nap(id: string, instant = false): Promise<void> {
    const nap = this.plan?.nap;
    if (!nap || this.reserved.has("nap")) {
      this.set(id, { dozing: true });
      try {
        await this.snooze(id);
      } finally {
        this.set(id, { dozing: false });
      }
      return;
    }
    if (!instant) await this.standUp(id);
    const slot = await this.reserve(id, [{ key: "nap", spot: nap.spot }]);
    try {
      if (instant) this.appearAt(id, nap.spot);
      else await this.walkTo(id, nap.spot);
      this.set(id, { where: "nap", moves: this.actor(id).moves + 1 });
      await this.snooze(id);
      this.set(id, { where: "floor", pose: "stand", moves: this.actor(id).moves + 1 });
      await this.sleep(TIMING.stand);
    } finally {
      this.release(slot.key, id);
    }
    await this.goHome(id);
  }

  private async coffee(id: string, instant = false): Promise<void> {
    const pantry = this.plan?.pantry;
    if (!pantry) return;
    if (!instant) await this.standUp(id);
    const slot = await this.reserve(
      id,
      pantry.spots.map((spot, i) => ({ key: `pantry:${i}`, spot })),
    );
    try {
      if (instant) this.appearAt(id, slot.spot);
      else await this.walkTo(id, slot.spot);
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
    if (!this.agents.has(id) || !this.free(id) || this.actor(id).where !== "desk" || !this.plan?.pantry || this.leaving.has(id)) return false;
    this.runTrip(id, "coffee", () => this.coffee(id));
    return true;
  }

  /** Sends one idle cat for a nap now, in the cat bed or on its desk (preview story). Returns false when it cannot go. */
  napNow(id: string): boolean {
    if (!this.agents.has(id) || !this.free(id) || this.actor(id).where !== "desk" || !this.plan || this.leaving.has(id)) return false;
    this.runTrip(id, "nap", () => this.nap(id));
    return true;
  }
}

export type { Facing };
