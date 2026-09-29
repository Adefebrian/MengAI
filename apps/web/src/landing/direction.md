# MengAI landing: direction contract

Surface: the public landing at `/` (Persuade). Supersedes the landing half of `docs/design/direction.md` (the D1 ethogram direction); the app keeps D1. Written by the landing workstream on 2026-09-30; the lead folds it into `docs/design/direction.md`.

Seed: product "MengAI", screen "landing", key abaae16c, kind direction, re-roll 1 (the owner asked for a new direction), pool 1, pick 0.
Command: the `directions.md` section 3 one-liner with `"MengAI" "landing" 1 1` printed `{"key":"abaae16c","kind":"direction","pool":1,"reroll":1,"pick":0}`.

## Brief

Audience: developers and small teams on a MacBook in daylight, first visit.
Job: understand in one screen that MengAI is a working company of AI cats that does your software work on your own keys, then open the app or download the Mac app.
Mechanism: Kopi, the CEO cat, plans a goal into tasks; crew cats work at their own desks, meet (kickoff, sync, review, wrap-up), ask the CEO who approves requests on its own, review each change and hand work desk to desk.
Rut: the dark AI agent landing (near-black, purple glow, glowing node graph, three feature cards, logo wall). Opposite: a candy mascot site with no product.

## Direction

Form: the new-hire employee handbook. Each section is a chapter a new colleague reads: who runs the company, how we work, the tools on your desk, whose keys, what it costs, what we protect, plain answers. Original rank 4.
Preset: D5 calm_productivity, with two knob deltas below.
Thesis: the company is shown at work, never described as magic. Every view is the product's own UI with sample data, labelled as sample.
Concept and signature moment (JEV `imm.concept` n1, "Opening move"): the page opens with the company already at work. Within the first two seconds Mochi carries the CSV export card from its desk to Tempe's desk; then Onde asks Kopi a question and Kopi approves it on the spot, the crew walks to the meeting table for a sync and back, a cat takes a coffee in the pantry, and the plan on the CEO whiteboard fills to done. A caption under the office says what just happened, with a pause control. At 1280 the office sits beside the headline; at 375 the first desk row (Mochi, Klepon, Tempe) is inside the first screen.
Hero scene: the office is rendered by the landing's DeskFloor until the Office scene from `@mengai/cats` passes `ui_audit` inside the hero frame; both take the same `OfficeProps` (`hero/HeroOffice.tsx`, `HERO_USES_OFFICE`).

## Knobs

| Knob | Value | Reason |
|---|---|---|
| Type pairing | Geist / Geist / Geist Mono | JEV `ui.type_pairing` geist 0.92 at 0.87 |
| Accent | teal `#0f766e`, role text_and_icon | one accent product-wide (the app's hue); D5's red-orange would be a second accent |
| Canvas | warm `#faf8f5` (D5) | |
| Tracking | display -0.025em (D5 -0.01) | keeps the 39-character headline on two lines in the five-column measure |
| Display | D5 display-1 at 1024 and up, capped by measure | one display element, the Masthead headline |
| Radius | cards and media 12, controls 8 (D5) | |
| Density | default | JEV `ui.density` comfortable 0.50 at 0.26, low confidence, runner-up default |
| Motion | Page quiet; hero tier 2 (the story), company tier 3 (pinned stepper from 1024), workbench and tokens tier 2, the rest tier 1, FAQ 0 | JEV `motion.intensity` |
| Chrome | header rail, bottom bar split with Open the app | JEV `ui.component_recipe` |

## Compositions (in order)

`masthead.split`, `custom.steps` (JEV picked `frame.poster_steps` with `pinned_sequence`; no kit composition is a click-and-scroll stepper), `bento.lead-left`, `custom.divided` (JEV low confidence with the JAL Core divided-section spec as runner-up), `bento.lead-right`, `feature-grid.cells`, `faq.open`, `cta-band.split`. No footer: JEV `ui.region_gate` dropped it (relevance 1.01), so the credit and the license close the last section. `validatePageRecipe` returns `[]`.

## Law

JAL Core tokens and kit. White-first warm canvas, flat fills, depth from tonal steps and hairlines, no gradients, shadows, glow, side lines, connectors, emoji, em-dash, eyebrows or purple; nothing overlaps outside a true overlay (a card or a cat in flight carries `data-overlay`); 44px controls; app-shell below 640; transform and opacity only; reduced motion rests the story on its poster until the visitor presses play.
