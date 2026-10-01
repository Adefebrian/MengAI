# Island moments: living cats, auto hide, dynamic progress

Date: 2026-10-01. Status: approved direction (owner chose A + B + C combined, "motion must be relevant, interactive and engaging").
Built by Adefebrian (https://adefebrian.com).

## 1. Intent

The Mac island already shows the run (mini Oyen, ring, stage), a peek, asks with Approve and Deny, ship and failure.
The owner wants it to feel alive and to pull attention only when it matters:

1. When a cat needs the owner, that cat (not always Oyen) comes out under the island, holding what the ask is about, and reacts to the answer.
2. Cats react to what the crew does (hire, handoff, review pass or fail, bug found, stage done, ship) and fool around on their own when nothing happens.
3. Auto hide: the island tucks into the notch when nothing changes for a while, and gets out of the way when the pointer passes near it on its way to the menu bar.
4. Dynamic progress: the ring is alive (done and in-flight share, colour per state), the ear rotates what it says, and each finished stage pops.

Success: every animation answers "what changed and who did it" in one sentence; asks are impossible to miss without being noisy; nothing violates JAL law (Rule 0 included); reduced motion shows the same information with no movement.

Out of scope: Windows and Linux (no island there), sound, LLM-chosen animations, new cat art beyond reusing the rig's beats, props and quirks.

## 2. Architecture

```
engine (runs/engine.ts) --emit "moment" hint--> SSE --> island/moments.ts (event -> Moment, pure)
existing events (agent.spawned, run.stage, handoff, ...) ------^            |
                                                                           v
                                                    island/director.ts (one at a time, priority, cooldown, pure)
                                                                           |
                                         Island.tsx: shape (band + body) + Stage (cats under the shape) + progress
                                                                           | island_set_state { state, width, height, hit }
                                                                           v
                                         island.rs: window = shape + stage, click-through outside hit rects,
                                         pointer poll -> window.__islandPointer(zone)
```

Boundaries: the engine sends facts, never animation names. All visual decisions live in apps/web/src/island. Rust owns the window, click-through and the pointer.

## 3. Contract changes

### 3.1 Event `moment` (packages/shared/src/events.ts)

```ts
export const MOMENT_KINDS = ["review_pass", "review_fail", "ceo_approved", "ceo_denied", "rethink", "budget_low", "stuck"] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];
"moment": { kind: MomentKind; agentId: string | null; taskId: string | null; level: "info" | "good" | "bad"; text: string };
```

`text` is one short plain sentence (no secrets, clipped to 80 chars, goes through the event redaction like every event).

Engine emit points (apps/api/src/modules/runs/engine.ts), one line each through a small helper `momentFor(...)` in `runs/moments.ts`:

| kind | where | agentId |
|---|---|---|
| review_pass / review_fail | `completeReview` after the verdict | the reviewer |
| ceo_approved / ceo_denied | `ceoDecide` path in approveTool / askLead, when the CEO answers a crew request itself | the CEO |
| rethink | critic verdict fail in the self-check (agent.reflexion fail) | the cat that rethinks |
| budget_low | first time run usage crosses 80% of the token or USD budget (once per run) | the CEO |
| stuck | a guard trips (identical call x3, identical error x3, no progress x3) | the stuck cat |

No model call, no extra tokens. Tests: each emit point publishes exactly one `moment` with the right kind and agent.

### 3.2 `island_set_state` gains `hit` and the shell calls the page back

```
island_set_state({ state, width, height, hit: [{ x, y, width, height }] })   // window-local points, 1..4 rects
window.__islandPointer({ zone: "far" | "near" | "inside", x, y })            // shell -> page, via eval
```

- Window size = the union of the shape and the stage. `hit` = the shape rect plus the stage cat's rect when it is clickable.
- Rust keeps `hit`. A main-thread timer polls `NSEvent::mouseLocation` (no Accessibility permission needed) every 50 ms while the island is on screen, converts to window-local points and:
  - sets `ignoresMouseEvents(true)` when the pointer is outside every hit rect, `false` inside, so the transparent stage never steals a click from the app below;
  - computes the zone: `inside` (in a hit rect), `near` (within 48 pt horizontally of the shape and inside the menu bar band), `far`; calls the page only when the zone changes.
- `hit` is optional: a page that does not send it gets the whole window as hit (old behaviour). Rects are validated (finite, inside the window, at most 4).

## 4. Moments

A Moment: `{ id, kind, actor: MiniCat, partner?: MiniCat, beat, prop, ms, priority, text, path }`.
`moments.ts` derives them, pure, from engine `moment` hints and existing events. A hint beats an inferred moment for the same task within 2 s.

### 4.1 Catalog (the cat, what it does, why it is relevant)

| Moment | Trigger | Cat on the stage | Motion (rig beat + stage move) | Ends |
|---|---|---|---|---|
| ask_approval | approval.requested, or request.raised to owner yes/no | the asking cat | climbs out under the island holding the object of the ask (capability shell: terminal; fs: page; network or connector: spyglass; automation: runbook; else its role prop), plays `ask` (paw up), eyes follow the pointer; every 20 s unanswered one small hop | Approve: `celebrate` then back up. Deny: ears down (`stopped` pose) then back up |
| ask_order | live order proposed | the cat that proposed it | holds `card`, `ask` beat, same follow and nudge | same as above |
| ask_question | open question to owner | the asking cat | `think` beat holding `page` | answered in app, cat goes back |
| hire | agent.spawned (not the CEO at run start) | the new cat | drops out of the island, one wave (`ask` beat 600 ms), climbs back in | 2200 ms |
| let_go | agent.left by the CEO | the cat leaving | `stopped` pose, slides away to the side and fades | 1800 ms |
| handoff | handoff event | from cat and to cat side by side | from cat plays `handoff` (holds card), to cat plays its catch | 2400 ms |
| review_pass | hint review_pass | the reviewer | `review-stamp` (reviewer) or `review` beat, then `celebrate` | 2200 ms |
| review_fail | hint review_fail | the reviewer | `review-flag` or `review-hunt` with `bugcard`, ears back | 2200 ms |
| ceo_approved / ceo_denied | hint | Oyen | `review-crew` then nod (approved) or `stopped` (denied) | 1800 ms |
| rethink / stuck | hint | that cat | `think` with a head tilt; stuck adds a `twitch` quirk | 1800 ms |
| budget_low | hint | Oyen | `plan-board` with clipboard; the ring turns warning colour | 2200 ms |
| stage_done | run.stage changes | the cat that finished the last task of the stage | `celebrate` on the stage; body pops "Build done. Review next." | 2400 ms |
| shipped | run finished shipped | up to 3 crew cats in a row (lead in the middle) | each hops in on a 80 ms stagger and plays `celebrate` | the existing SHIP_MS |
| failed | run failed | Oyen | `stopped` pose, stays still under the island until Dismiss or Open | owner acts |
| quirk (fooling around) | collapsed or tucked, no moment for a seeded 45 to 120 s | a random crew cat at work | slides out at size 32, plays one quirk (yawn, stretch, groom, knead, bat), slides back | 3000 ms |
| tap (on demand) | owner clicks the band cat or the stage cat | that cat | the rig's tap reaction; three taps within 1.5 s: a crew cat pops out and waves | 900 ms |

Relevance rule: the actor is always the cat the event is about; the prop is always what the event is about. A moment with no known cat falls back to the lead.

### 4.2 Director (director.ts, pure)

- One stage moment at a time. Priority: ask (100) > failed (90) > shipped (80) > stage_done (60) > engine hint (50) > hire, let_go, handoff (40) > tap (30) > quirk (10).
- A higher priority cuts in (the running one exits fast); lower ones queue, max queue 3, oldest non-ask dropped first.
- Cooldowns: the same kind at most once per 8 s; non-ask moments at most 4 per minute; quirks never within 30 s of another moment.
- Asks stay on the stage while unanswered; other moments queue behind them only if they are asks too.
- Clock injected (`now`) and seeded random, so every schedule is reproducible in tests.

## 5. Stage (C)

- The stage is a transparent region under the shape, centred, `STAGE_H = 72` pt (a 48 pt cat plus room for the hop) and `STAGE_W = 160` pt, or wider for shipped (3 cats) and handoff (2 cats).
- The cat is a sibling of the shape, never its child. Its box ends exactly at the shape's bottom edge (touching, never overlapping). Rule 0 holds at every resting frame.
- Entrance: the stage clips its own top edge, so the cat slides down out of the island (translateY from -100% to 0) at `--dur-300` on `--ease-standard`; exit at `--dur-300-exit`. Hops are translateY on `--ease-standard`, no overshoot. Character life (ears, tail, paws, blink) comes from the rig's own beats and quirks.
- No text on the stage: the stage sits over any app, so every word stays inside the black shape.
- The window grows to shape plus stage before the entrance and drops back after the exit (same union rule as the morph today).
- Hover on the stage cat: pointer follow. Click: the tap reaction, and for an ask it focuses Approve.

## 6. Auto hide

- `tucked` view: a live run with no news (stage change, task done or started, ask, moment) for `TUCK_MS = 20 s` folds to exactly the notch (notched Mac) or leaves the screen (no notch, like idle). Any news untucks it for at least 8 s. Pointer on the notch untucks to peek.
- Pointer near (zone `near`) while collapsed or tucked: the ears fold away to the notch at once (`--dur-150-exit`), the window shrinks to the notch so the menu bar items under the ears are clickable. Back to `far` for 600 ms: the ears return. Never while an ask, failure or ship shows.
- Escape still snoozes the ask queue as today.

## 7. Dynamic progress

- Ring: two adjacent arcs on one circle, never stacked: done share (solid) and in-flight share (the tasks running now, at 45% ink). Both tween on `--dur-300`.
- Ring tone per state: running `--island-ink`, waits on you `--island-warning` (new token, amber, no glow), paused `--island-ink-muted`, budget low `--island-warning`, failed `--island-danger`, shipped `--island-success`.
- Ear rotation: every 6 s while collapsed, the ear cycles through what is true now: the stage ("Review 5 of 7"), who works ("Kopi coding"), what is left ("3 tasks left"). The band's mini cat switches to the cat the ear names. Crossfade only.
- Stage done pop: covered by the stage_done moment (body plus cat).

## 8. Reduced motion

Same information, no movement: moments show the cat still at its resting frame for the moment's duration (no slide, no hop, no quirk), quirks off, rotation still changes text but with an instant cut, ring jumps. The owner's motion setting "off" behaves the same.

## 9. Testing

- Pure units with bun test: moments.ts (every event and hint maps to the right actor, beat, prop), director.ts (priority, cut-in, cooldowns, seeded quirks), progress.ts (arcs, tones, rotation order), machine.ts (tucked, near, stage sizing, hit rects).
- Engine: each emit point publishes one `moment` (engine.test.ts style with the mock LLM).
- Rust: hit rect validation, zone math, contract parse (unit tests beside the existing ones).
- Web: happy-dom render of Stage per moment kind, reduced motion renders still.
- UI proof: the island preview route (fixture) for every moment, ui_audit at 320 to 1280 on the preview page, plus screenshots of the stage over a busy background.
