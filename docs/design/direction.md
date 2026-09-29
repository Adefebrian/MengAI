# MengAI direction: landing and app

Seed: product "MengAI", screen "landing", key abaae16c, kind direction, pool 3, pick 0, reroll 0
Command: `bun -e '<directions.md section 3 one-liner>' "MengAI" "landing" 3` printed `{"key":"abaae16c","kind":"direction","pool":3,"reroll":0,"pick":0}` (the one-liner was checked against its documented example first: "Warung Kas" "landing" 4 gives key 7d4b6a5e, pick 3).
Decided: 2026-09-29. Mode: persuade (landing at `/`), operate (app at `/app/*`). Experience: modern (JEV `ui.experience` earlier: modern_motion 0.51 at confidence 0.35, the lighter mode applies; sections rise only through `motion.intensity`).
JEV: `ui.direction_screen` verified, 5 of 7 candidates survived, pool of 3 (ranks 3 to 5), drawn rank 3.

One direction for both surfaces. The landing shows the real app (a replay of a real run drawn with the real crew board components), radius tiers and the accent are one choice product-wide, and the app is the product people live in. So `data-direction="D1"` sits on `<html>` for `/` and `/app/*` alike; the app keeps the Operate ceilings (display tops at `--text-6`, one family, motion tier 1 at most).

## Brief

Audience: developers and small teams (1 to 10 people) on a MacBook in daylight, terminal and editor open beside it. They start a run, glance at it between other work, and come back when a cat needs an answer or a run is done. Many runs a week; long watching sessions while a run is live.
Job: landing, understand in one screen that one goal becomes tasks a crew of cats plans, builds, reviews and hands back, on your own keys, then download the Mac app or open the web app. App, see at a glance who is doing what, what is waiting on you, and what it costs.
Mechanism: a lead agent turns one goal into a task graph, role agents work it, hand off and review each other, and every agent is a living cat whose pose comes from its real tool call (`packages/shared/src/activity.ts`), so watching the crew is watching the work.
Rut: the dark AI-agent platform landing (near-black, purple glow, a glowing node graph with connector lines, three feature cards, a logo wall, "autonomous agents that 10x your team"). Predictable opposite: a candy-pastel mascot site with big bouncing cartoon cats and no product. The literal reading of the brief (cats in a room) joins the rut; one candidate was spent on it and JEV dropped it.

## Direction

Form: the ethologist's field observation sheet (an ethogram): each individual's behaviour logged against a clock. Original rank 3. Reason: the product's activity vocabulary (rest, think, plan, code, run, read, review, research, design, scan, automate, handoff, ask, wait, celebrate) is literally an ethogram, and mood is derived from recent outcomes with no LLM, so the page and the app read as a sheet of observed behaviour, not a sales deck.
Preset: D1 research_notebook (JAL Core knob set, not a design system).
Thesis: the crew is observed, not advertised. Every screen is a record of what each cat is doing right now, in ink on a neutral page, with the clock and the token count in tabular mono. It refuses the glowing agent graph and the mascot site.
Own world: accent teal `#0f766e` on links and the brand mark only; Geist in two weights with Geist Mono for every clock, count and tool target; rows between hairlines as the main container grammar; the cats as the only illustration (flat fills, one ink-muted contour, no scenery); line icons from koboyo in one stroke voice. With the copy removed, what stays is a sheet of rows with a cat at the start of each.
Story: understand (a goal becomes tasks and cats visibly do them), then believe (keys stay in the keychain, the Mac is touched only with permission, every run has a budget), then do (download for Mac, or open the web app).
First viewport, landing: 1280, the Masthead split: headline and lead on columns 1 to 5, Download for Mac (primary, ink) and Open the web app (secondary) under the lead; the replay of a recorded run in a MediaFrame `view` on columns 7 to 12 (crew row of 4 cats at 64px over the observation sheet rows, player controls below the stage); the masthead fills 70 to 90% of the 800px viewport, so the loop section's top edge shows. 375: the island header (wordmark, Download), headline at the display sm step (at most 3 lines), one lead, the two actions on one row (stacked at 320), then the replay's crew row of 4 cats at 48px inside the first screen above the split dock.
First viewport, app (`/app/runs/:id`): 1280, the island header with the destinations track and the always visible Stop all control; a page header row (run goal as the h1 at `--text-3`, run status as icon plus word, budget used as a tabular figure "182,400 of 400,000 tokens", Pause and Stop as secondary actions); the crew sheet (one row per agent) on columns 1 to 7 beside the task queue on 8 to 12; tabs below for Timeline, Decisions, Usage and Files. 375: the pinned header (goal truncated with its full text reachable, Stop all), the crew sheet rows (cat 48px, name, behaviour word, task on one line), then the Tasks, Timeline and Usage tabs scrolling inside the list; the split dock at the bottom (Runs, Approvals, Providers, More, and the New run action).
Signature moment: the scripted replay of a real recorded run in the landing Masthead, played on the JAL frame core (`motion.demo_medium` frame_core, confidence 1.0). Kopi, the lead cat, plans the task list, the engineer and reviewer cats pick tasks up with poses from their real tool calls, a task card travels from one cat to the next on handoff, the reviewer passes it, and the run ends on Kopi's report with tokens and time as recorded. No LLM at runtime. Full spec in `docs/design/landing-sections.md`, section Signature moment.
Page shape (landing): Split Studio opening into a Narrative Workflow (a real process stage by stage, numbers inline, no connectors), then a Long Document of proof. Below 960px the split stacks (text, then the replay); below 640px the app-shell ships and every region is one column.
Nav / Footer archetype: Floating pill (`shell.header.island`, the D1 default), bottom bar `shell.bar.split` with Download as the action (JEV `ui.component_recipe` 0.92). Footer inline (`kit.footer.inline`, JEV 1.0).
Compositions (landing, in order): `masthead.split`, `sticky-story.stage-start`, `custom.list` (crew roster on the JAL Core List spec), `custom.divided` (automation safety on the JAL Core divided section), `spec-rail`, `custom.divided` (providers), `stat-row.lead`, `faq.open`, `custom.close` (JAL Core plain spacing close), `footer.inline`. `validatePageRecipe(ledger, "marketing")` returned `[]` (run against `packages/ui/src/kit/recipe.ts` on 2026-09-29). The four custom sections are JEV picks, each recorded with its reason in the ledger below; they are built inside `<Section>` on the kit grid with `SectionHead`, never as a rewrite of a kit composition.
Headline chars: "Watch a crew of AI cats build it", 32 characters, 8 words, bucket 21 to 50 (the full display step the mode allows, capped by measure).
Media role evidence: `hm.image_need` for a devtool brief is none, so the hero stands on type alone; the replay is a live product view, not imagery. Deletion test: delete the replay and the headline, lead and actions still carry the Masthead.

## Knobs (the only values this file may set)

| Knob | Value | Token or mechanism | Reason |
|---|---|---|---|
| Type pairing | Geist / Geist / Geist Mono, no section display switch (no editorial section) | `--kit-font-sans`, `--kit-font-display`, `--kit-font-mono` as D1 sets them; `--kit-font-figure` stays the display face (Geist has tnum) | JEV `ui.type_pairing` geist at 0.66 (geist_bricolage 0.23, onest 0.01, inter_jetbrains 0.01). Nothing to fetch. |
| Accent | `#0f766e`, HSL 175/77/26 | `--color-accent`, `--color-accent-contrast: var(--color-surface)` | JEV `ui.accent_pick` teal at 0.62. 5.47:1 on surface, 5.24 on page, 4.75 on layer-2; 30 degrees from success, 33 from info, far from danger and warning; no coat is teal. |
| Accent role | `text_and_icon` | `--kit-link: var(--color-accent)` | D1 allows none or text_and_icon only. Links in running text, file and task links, the MengAI mark. Never a fill, a tinted band, a status, an active nav cue, a focus ring, a chart series or a native control fill. |
| Primary fill | ink | `--color-primary` unchanged | D1: one ink-filled action per view. |
| Canvas | neutral `#fafaf9` | `--color-page` (D1 default) | Cards and controls on white surface, readable layer step, no beige reflex. |
| Tracking | display -0.035em, heading -0.02em | `--tracking-display`, `--tracking-heading` (D1 values) | |
| Display ceiling | landing: `--text-display-2` at 1024 and up, `--text-display-1` from 768, `--text-6` below; app: `--text-6` | D1 kit display steps, capped by measure | One display element per page, the Masthead headline. |
| Radius tier | cards and media 12, controls 8 | `--kit-radius-card`, `--kit-radius-media`, `--kit-radius-control` (D1) | One choice product-wide. |
| Hairline | `--color-border` for structure, `--color-border-control` for controls | D1, section rule off | Sections separate by whitespace and tone, not rules. |
| Density | compact | `data-density="compact"` on the `/app` root | JEV `ui.density` compact at 1.0. Desktop rows 40px from 1024px only; controls stay 44px; below 1024 rows are at least 44px and wide tables stack. |
| Motion intensity | landing Page `motion="none"`; masthead tier 2 (the replay), loop tier 2 (the story), every other landing section tier 0; app tier 1 | kit `Page motion`, `jal-motion` | JEV `motion.intensity` per section (ledger below). |
| Media role | supporting: live product views only (the replay, real component views with sample data labelled) | `MediaFrame kind="view"` | No photography, no renders, no drawn product. |

Implementation (web workstream, `apps/web/src/styles.css`, not a `kit.css` edit):

```css
/* direction: D1 research_notebook plus the MengAI accent, see docs/design/direction.md */
[data-direction="D1"] {
  --color-accent: #0f766e;                    /* HSL 175, 5.47:1 on surface, role text_and_icon */
  --color-accent-contrast: var(--color-surface);
  --kit-link: var(--color-accent);            /* the only accent role on every surface */
}
```

Browser surfaces: `::selection` may take the accent mix and `caret-color` the accent (text role); `accent-color` stays ink, because a native checkbox or range fill would make the accent a fill.

## Cat coat palette check (on white grounds)

`packages/shared/src/cats.ts` fixes the coat ids; `packages/cats` owns the exact fills. The check below uses proposed flat fills and measures each against every JAL ground (surface `#ffffff`, page `#fafaf9`, layer-1 `#f5f5f4`, layer-2 `#efefed`, where a selected row sits). The threshold is 3:1 (WCAG 1.4.11, graphical objects), since the silhouette carries the cat's identity and pose.

| Coat part | Proposed fill | On surface | On page | On layer-2 | Verdict without contour |
|---|---|---|---|---|---|
| ginger base / marks | `#d9822b` / `#b0621c` | 2.93 / 4.56 | 2.80 / 4.36 | 2.54 / 3.96 | base fails |
| cream base / marks | `#f1e3c8` / `#dcc49a` | 1.27 / 1.69 | 1.21 / 1.62 | 1.10 / 1.47 | fails, disappears on white |
| gray base / marks | `#8f8e8a` / `#6f6e6a` | 3.28 / 5.10 | 3.14 / 4.89 | 2.85 / 4.43 | base fails on layer-2 |
| black | `#2a2826` | 14.69 | 14.06 | 12.76 | passes |
| tuxedo black / white | `#2a2826` / `#ffffff` | 14.69 / 1.00 | 14.06 / 1.04 | 12.76 / 1.15 | white parts vanish |
| calico white / ginger / black | `#ffffff` / `#d9822b` / `#2a2826` | 1.00 / 2.93 / 14.69 | 1.04 / 2.80 / 14.06 | 1.15 / 2.54 / 12.76 | white and ginger fail |
| tabby base / stripe | `#a0825f` / `#6b5238` | 3.59 / 7.27 | 3.44 / 6.96 | 3.12 / 6.31 | passes, barely |
| siamese body / points | `#efe4d2` / `#5b4636` | 1.26 / 8.85 | 1.20 / 8.47 | 1.09 / 7.68 | body vanishes |
| contour `--color-ink-muted` | `#474747` | 9.29 | 8.90 | 8.07 | passes on every ground |

Rules for `packages/cats` (the fix is the contour, not darker coats):

1. Every cat draws one closed contour around its silhouette in `--color-ink-muted` (`#474747`), at least 8:1 on every ground. One stroke voice for all coats and all sizes: 1.5px at 48 and 64, 2px at 96, 3px at 160 (scaled with the rig, not `vector-effect`). Inner detail lines, if any, use the same colour and weight.
2. Coats stay 1 to 3 flat fills, never a gradient, never a texture, never a shadow under the cat. No coat, eye, nose or prop fill in the HSL 235 to 330 band; noses take a warm pink outside it (for example hue 350 or warmer).
3. Eyes on the black and tuxedo coats use a light iris (for example `#d9b24a`, 7.29:1 on `#2a2826`) so the face reads.
4. A coat never carries meaning: status is always an icon plus a word beside the cat, never the coat, never a coloured ring. A selected cat row is a `layer-2` fill or a full 2px ink ring following the radius, never a coloured edge.
5. The accent never appears in a cat, a prop, or a cat background; props (laptop, magnifier, clipboard) are ink-muted line shapes on surface.
6. Check again with the final fills: every silhouette at 3:1 or more on layer-2 through its contour, every coat at a glance distinct from the next at 48px (ginger and calico differ by the black patch; cream and siamese by the dark points).

## App frame (Operate, `/app/*`)

- Shell: `AppShell scroll="contained"` (dense product screens), header `island`, bar `split`. Stop all (the kill switch) is a persistent header control on every width, icon plus the word, danger text, 44px, outside the destination track, never hidden in More. From 640px the destinations move into the island: Runs, Approvals, Providers, Memory, then More (Assets, Security, Evals, Settings). Below 640px: Runs, Approvals, Providers, More, plus New run as the split action (4 destinations, so the action shows its icon only and keeps "New run" in `aria-label`). Approvals carries a flat ink count badge, capped at 9+.
- Run screen regions and breakpoint contract:

| Region | Container | 375 | 768 | 1280 |
|---|---|---|---|---|
| Page header (goal, status, budget, Pause, Stop) | plain spacing | goal on 2 lines max, status and budget on one meta line, actions in a row | same, actions at the end | goal on 1 to 7, figures and actions on 8 to 12 |
| Crew sheet (one row per agent: cat, name, role, behaviour word, tool target in mono, task, energy bar, time in behaviour) | rows | cat 48, name, behaviour, task on one line; tool and energy reveal in the row detail | cat 64, adds tool target and energy | columns 1 to 7, all fields, compact rows from 1024 |
| Task queue (status icon plus word, owner cat, deps, review round) | rows | a tab | a tab | columns 8 to 12 beside the crew sheet |
| Timeline, Decisions, Usage, Files | rows (Usage is a real table) | tabs that scroll inside the list, hard edge | same | tabs under the two panes, full width, compact density |
| Agent detail (selected cat) | card | bottom sheet | bottom sheet | side panel replaces the task queue column while open |

- Motion (tier 1 cap, `motion.intensity` 1.04 at 0.92): cat loops are CSS keyframes that show a live behaviour, run only while the row is on screen and the tab is visible (IntersectionObserver plus `visibilitychange`), and stop entirely under reduced motion or the `still` prop (still poses). A handoff moves the task card with the Framer Motion `layoutId` from `handoffLayoutId(taskId)` once, `--dur-300`, `--ease-standard`, a crossfade under reduced motion. Status changes crossfade at `--dur-150`; rows enter and leave with `an.R21` at `--dur-200` and `--dur-200-exit`. Nothing else moves. Settings offers "Cat motion: live or still" so a user can freeze the crew for good.
- Every other app screen runs its own `ui.region_gate` and `ui.component_recipe` at build time inside this direction (a structure roll, never a new direction).

## Law (fixed, restated, not editable here)

JAL Core tokens and components. White-first page; dark only as an explicit dark mode. No gradients, no blurred shadows, no glow or neon, no side stripes or accent bars, no emoji, no em-dash, no eyebrow labels, no purple, violet or indigo, no overlap, 44px controls, mobile app-shell below 640px.

## Candidates (as screened)

| Rank | Form | Preset | slop | fit | Result |
|---|---|---|---|---|---|
| 1 | CI run and pull request timeline: every step an entry by a named cat, with tool, tokens and result | D3 blueprint_hairline | 0.26 | 2.75 (conf 0.75) | survivor, never drawn (rank 1); fit beats the drawn candidate by 1.04, an alternate on attended runs only; this run is unattended, so not shown |
| 2 | Team kanban board, task cards carried across columns by cats | D5 calm_productivity | 0.44 | 2.22 (conf 0.57) | survivor, never drawn (rank 2) |
| 3 | Ethologist's field observation sheet (ethogram) | D1 research_notebook | 0.19 | 1.71 (conf 0.35) | pool, drawn (pick 0) |
| 4 | Shift handover ledger with exact token and cost figures | D2 single_signal_ledger | 0.40 | 2.12 (conf 0.50) | pool |
| 5 | Film production call sheet (cast, scenes, call order) | D10 industrial_catalogue | 0.38 | 1.78 (conf 0.58) | pool |
| 6 | The cat house (literal reading) | D12 friendly_consumer | 0.95 | 0.13 (conf 0.87) | dropped (slop) |
| 7 | Warung kopi order rail, tasks as tickets called out by Kopi | D8 quiet_care | 0.35 | 1.45 (conf 0.31) | dropped (fit under 1.5) |

Families: engineering records (1), workplace artifacts (2, 4), field science (3), print production (5), place and ritual (6, 7). Presets D4, D6, D7, D9, D11 and D13 failed their gates for this brief (no real media, not a Read surface, not content-led, no product renders, no wordmark asset, no dark brief) and were never candidates.

## Decision ledger

| Decision | Source | Why |
|---|---|---|
| Direction D1, form ethogram | `ui.direction_screen` (verified) plus the seeded draw | Survivors 1 to 5, pool ranks 3 to 5, key abaae16c, pick 0 |
| One direction for landing and app | directions.md section 1 and 6 | Radius and accent are one choice product-wide; the landing replays the real app; the app keeps Operate ceilings |
| Type Geist / Geist / Geist Mono | `ui.type_pairing` geist 0.66 (verified) | Calmer candidate, the D1 default, zero bytes added |
| Accent teal `#0f766e`, text_and_icon | `ui.accent_pick` (novel id, framed per jal-jev) teal 0.62 (verified) | Most distance from every status hue in a status-heavy app; D1 permits text_and_icon only |
| Density compact | `ui.density` compact 1.0 (verified) | Timeline, usage and audit tables are scanned many rows at a time in long sessions |
| Demo medium frame core | `motion.demo_medium` frame_core 1.0 (verified) | Timed walkthrough with play, pause and scrub, crisp, no new dependency |
| Hero motion tier 2 | `motion.intensity` 2.45 at 0.45 (verified) | Low confidence: the lower of the top two tiers (3 at 0.56, 2 at 0.33) |
| Crew board motion tier 1 | `motion.intensity` 1.04 at 0.92 (verified) | Product UI cap 1 |
| Landing section tiers | `motion.intensity` batch (verified) | loop 1.96 at 0.27, lower of top two (2 and 3) is 2; crew 0.41, automation 0.46, keys 0.33, providers 0.14, budgets 0.39, faq 0.27, footer 0.03 round to 0; cta 0.77 at 0.46, lower of top two (1 and 0) is 0 |
| Landing regions, all 10 kept | `ui.region_gate` (verified) | Every implement 0.67 or more, every relevance 1.67 or more except footer 1.02 (see open decisions) |
| Landing section order changed after the gate | agent, section concept law | Order moved to masthead, loop, crew, automation, keys, providers, budgets, faq, cta, footer so every JEV primary container holds with no two neighbours alike (the crew roster's operator cat leads into automation); only the masthead and cta took a runner-up. Logged here so the change is visible, not re-asked |
| Masthead container plain spacing | `ui.region_gate` 0.41 divided vs 0.40 plain at 0.26 | Low confidence and the primary matched its neighbour (loop, divided), so the runner-up |
| CTA container plain spacing | `ui.region_gate` divided 0.58 at 0.49, runner-up card 0.20 | Primary matched the footer; the runner-up card would box section text, which the kit forbids, so the next lawful option; law conflict logged |
| Masthead recipe `kit.masthead.split` plus `frame.demo` | `ui.component_recipe` 0.54, layer_1 0.71 | Headline line reveal `an.R03` refused at 0.46, so the replay alone carries the hero motion |
| Loop recipe `kit.sticky-story.stage-start` | `ui.component_recipe` 0.57 | Stage flips away from the masthead media side |
| Crew recipe `core.list` (custom.list) | `ui.component_recipe` spec-table.grouped 0.58 at 0.37, runner-up core.list 0.40 | Low confidence with a JAL Core spec as runner-up: take the spec |
| Automation recipe `core.divided_section` (custom.divided) | `ui.component_recipe` feature-grid.detail 0.56 at 0.34, runner-up core.divided_section 0.38 | Same rule: take the JAL Core spec |
| Keys recipe `kit.spec-rail` | `ui.component_recipe` 0.86 | |
| Providers recipe `core.divided_section` (custom.divided) | `ui.component_recipe` 0.62 at 0.44, runner-up spec-table.grouped 0.20 | Low confidence, runner-up is not a core spec: keep the top pick |
| Budgets recipe `kit.stat-row.lead` | `ui.component_recipe` 0.62 at 0.43, runner-up spec-rail 0.34 | Keep the top pick |
| FAQ recipe `kit.faq.open` | `ui.component_recipe` first call faq.open 0.39 at 0.09 (state wrongly listed the container as rows); legitimate re-ask with the corrected container: `core.divided_section` 0.70, faq.open 0.19 | A third `custom.divided` breaks the variety ledger (at most twice), so law takes the next lawful option, `kit.faq.open`; law conflict logged. FAQ container stays divided section (JEV primary 0.59) |
| CTA recipe `core.plain_spacing` (custom.close) | `ui.component_recipe` 0.68 | |
| Footer `kit.footer.inline` | `ui.component_recipe` 1.0 | |
| Landing bottom bar `shell.bar.split` | `ui.component_recipe` 0.92 | Download is a real primary action |
| designmd kits | not used | No reference needed; `ui.designmd_screen` not run |

## Open decisions

- The replay fixture must be a real recorded run. Until the runs engine can record one, the landing ships the replay labelled "Sample run, scripted for this page" and replaces it with the recording, never presenting a scripted log as a real one.
- FAQ answers and the automation section repeat the rules in `docs/automation-safety.md`, which is still a proposal for Brian's approval. If Brian changes a rule, the copy changes with it.
- Footer relevance scored 1.02 (under the 1.5 drop line) while implement was 0.72. The footer is required chrome (credit and license), so it stays, stamped here as an override of a relevance score on chrome, for jal-lead to confirm.
- Lenis is the default smooth scroll for marketing pages, but `lenis` and `gsap` are not installed and this wave adds no dependency. The landing uses native scroll and the kit's own motion; adding the motion module is a later wave.
- The kit sets motion per page, not per section; the landing uses `Page motion="none"` and the two tier 2 sections carry their motion through their own recipes (the frame core Player and the StickyStory frame swap).
- The app's other screens (providers, memory, assets, security, automation, evals, settings) get their region gates when they are built.
- Mac app minimum macOS version, download URL and file size are unknown; the landing shows none of them until the desktop workstream publishes them.

## Finish

Verdict: pending. Docs-only pass; no surface is built yet. The landing and the app each go through `ui_audit` at 320, 375, 414, 768 and 1280 and the fresh-eyes critic gate before anything is called finished.
