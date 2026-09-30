# MengAI landing: direction contract

Surface: the public landing at `/` (Persuade). Supersedes the landing half of `docs/design/direction.md` (the D1 ethogram direction); the app keeps D1. Written by the landing workstream on 2026-09-30, revised the same day for the lifecycle brief and again for the SaaS hero and the second critic round; the lead folds it into `docs/design/direction.md`.

Seed: product "MengAI", screen "landing", key abaae16c, kind direction, re-roll 1 (the owner asked for a new direction), pool 1, pick 0.
Command: the `directions.md` section 3 one-liner with `"MengAI" "landing" 1 1` printed `{"key":"abaae16c","kind":"direction","pool":1,"reroll":1,"pick":0}`.

## Brief

Audience: developers, small teams and traders on a MacBook in daylight, first visit; phones second.
Job: understand in one screen that MengAI is an autonomous company of AI cats that works a goal on your own keys, watch the whole company lifecycle, then open the app or download the Mac app.
Mechanism: Oyen, the CEO cat, plans a goal and hires the roles it needs (dynamic roles such as Copywriter or Risk officer); the crew works at their own desks, meets, reviews every change, lets go a cat that keeps failing and hires a replacement that starts with everything the role learned; tests, ships. Two company kinds: a software studio and a hedge fund. Every cat's next call carries its role charter plus the strategy and skills adopted automatically after an offline eval and a JEV decision.
Voice: playful, warm, confident cat voice, never childish. Names: the CEO is Oyen; every other cat has an Indonesian snack name (Cemong, Klepon, Tempe, Onde, Cilok, Bakwan, Serabi, Risol; Salak, Jahe, Kencur, Duku, Pukis, Lontong).
Rut: the dark AI agent landing (near-black, purple glow, glowing node graph, three feature cards, logo wall). Opposite: a candy mascot site with no product.

## Direction

Form: the new-hire employee handbook. Each section is a chapter a new colleague reads: who runs the company and how it grows, the tools on your desk, whose keys, what it costs, what we protect, plain answers. Original rank 4.
Preset: D5 calm_productivity, with the knob deltas below.
Thesis: the company is shown at work, never described as magic. Every view is the product's own UI or the Office scene with sample data, labelled as sample.

Hero concept (round 2, the owner asked for a top-tier SaaS hero with real motion; critic fix round 2): the hero is the app's own run view on sample data, a product frame under the headline. Inside it the living office is already at work: the hero Office (`@mengai/cats`, variant hero) seen through a camera cropped to one desk row at about 1.5x cat scale (Oyen's desk with the plan board, Cemong's desk, the aisle where the crew walks up; on a phone the crop starts at the desks so a working cat sits inside the first screen, Oyen plus two desks). The 84 s loop opens on desk work with a handoff already walking and moves the next goal's kickoff to its end. The camera eases between the wide shot and a close shot on the desk where the beat happens (JEV `ui.component_recipe` hero_frame `bang.shot_size` 0.68). Beside it the company feed deals in three notices from the app (tokens saved, a meeting, a CEO approval) and takes new ones as the story plays (hero_chips `an.R21_flip_feed` 0.67); under it the status strip ticks tasks done and the budget. The windows follow the story clock. A provider logo row sits under the hero. As the frame rises out of view it recedes a little (the hero's one scrub). Reduced motion rests on the same desk work, the wide shot, the feed filled.

Lifecycle concept and signature moment (JEV `imm.concept` c4 "The door is the company", core 2.34, first screen 0.72, feasible 0.78; round 1 candidates c1 to c3 failed first screen): the section opens on the company switch and the on-demand tracker over the full Office floor, the entrance door in its first band. The story starts the moment the section is on screen: Oyen alone reads the goal and deals cards onto the board; within about ten seconds the hires walk in through that door carrying their boxes, one of them a role the company never had, while the tracker ticks to Team hired. Every change of staff happens at the same door: a cat that failed three times walks out with its box as its replacement walks in. The floor also plays the kickoff, the coffee queue, a review that bounces (the tracker steps back one stage and marks the bounced stage Sent back), the nap, overtime yawns, the tests on the server rack, and the celebration. Under the floor, one cat's head card (Cemong in the studio, Jahe in the fund) shows its charter version, the strategy, skills and tools injected into its next call, its memory and the trust a reviewer has in it, each with the JEV decision and eval evidence behind it; rows the story just changed are marked New. The story plays once and rests on its last scene (Replay starts it again), so the floor never shrinks back under a reader by itself. Reduced motion rests on the desk-work poster.

## Knobs

| Knob | Value | Reason |
|---|---|---|
| Type pairing | Geist / Geist / Geist Mono | JEV `ui.type_pairing` geist 0.92 at 0.87 |
| Accent | teal `#0f766e`, role text_and_icon | one accent product-wide (the app's hue) |
| Canvas | warm `#faf8f5` (D5) | |
| Tracking | display -0.025em (D5 -0.01) | keeps the headline on two lines in the measure |
| Display | D5 display-1 at 1024 and up, capped by measure | one display element, the Masthead headline |
| Radius | cards and media 12, controls 8 (D5) | |
| Density | default | JEV `ui.density` comfortable 0.50 at 0.26, low confidence, runner-up default |
| Motion | Lenis smooth scroll and KitMotion tier 2 on one clock (the `@mengai/motion` module, a lazy chunk on this route); hero tier 3 (`motion.intensity` 2.85, `motion.choreography` scrub 0.63 carried by the frame, see Law notes), logo row tier 1 (0.88), lifecycle tier 2 (2.01, stagger_sequence 0.91), workbench tier 2 (1.91), tokens tier 2 (1.64, reveal), keys tier 1 (0.89), security tier 2 (1.61, reveal 0.88), close tier 2 (1.82, stagger_sequence 0.84), FAQ and footer 0 | JEV `motion.intensity`, `motion.choreography` |
| Chrome | header rail with the paw logo and the wordmark, bottom bar split with Open the app; footer inline with the same mark | JEV `ui.component_recipe` |
| Headline | "Hire a whole company of AI cats.", painted in its final layout, the text block fading in once | JEV `ui.tagline` h1 0.49 (low confidence, top pick); `ui.component_recipe` hero_headline core.static 0.70, the split line reveal layer declined 0.56 |

## Compositions (in order)

`masthead.left` (the product frame as the proof: JEV `ui.region_gate` hero_frame card 0.40, hero_chips plain_spacing as the runner-up to the frame's card, hero_logos plain_spacing as the runner-up to the lifecycle's divided section), `logo-row.row` (attached, `kit.logo_row_rise` 0.47), `custom.lifecycle` (hand-written: no kit composition holds a tracker, a live Office floor and a head card driven by one clock), `bento.lead-left` (the workbench), `feature-grid.rows` (bring your own key, JEV 0.29 top pick), `stat-row.chart` (tokens: `kit.stat_row_chart_count` 0.97, figures sized to their captions beside the chart), `bento.lead-right` (security as the app's controls: `kit.bento_reveal_states` 0.48, the ask and the kill switch lead with the audit log, the budget meter, the keychain and the project jail around them), `faq.split` (JEV 0.20 top pick), `cta-band.split` (the close with the shipped card and the crew row, `kit.cta_split_sequence` 1.00), `footer.inline` (JEV 0.85). `validatePageRecipe` returns `[]`.

## Law

Law over JEV, logged: `motion.choreography` hero scrub with the target frame_scale (0.17, low) had the frame grow from 0.96 to full size, which leaves it off the page's content line at rest (stacked regions share one left and one right edge); the same flat scale runs on the way out instead (full size and aligned at rest, receding to 0.96 as it leaves the view).

JAL Core tokens and kit. White-first warm canvas, flat fills, depth from tonal steps and hairlines, no gradients, shadows, glow, side lines, connectors, emoji, em-dash, eyebrows or purple; nothing overlaps outside a true overlay; 44 px controls; app-shell below 640; transform and opacity only; reduced motion rests both stories on their posters until the visitor presses play. Icons are reicon Outline glyphs (koboyo has no key on this machine), each a single path so no glyph part sits over another.
