# MengAI landing: section plan

Route `/` (Persuade). Direction and every knob: `docs/design/direction.md`. This file is the section concept for the landing workstream (`apps/web/src/landing`): every section's job, one message, one action or none, the container JEV chose, the composition JEV picked, and the motion tier JEV set. Copy lines here are proposals the landing workstream may tighten; the job, message, action, container, composition and tier are decided.

## Page settings

- Root: `data-direction="D1"` on `<html>` (shared with `/app`), `<Page direction="D1" rhythm="default" motion="none">`. The rhythm is D1's (96 at 1024 and up, 80 from 640, 64 below). `motion="none"` because JEV scored every section tier 0 except the masthead and the loop, which carry their own motion through their recipes (the frame core Player and the StickyStory frame swap).
- Shell: `AppShell scroll="document"`, header `island` (the D1 default, the Floating pill archetype): wordmark MengAI, a destinations track (How it works `#loop`, Crew `#crew`, Safety `#automation`, FAQ `#faq`) and Download as the header action. Below 640px the bar is `shell.bar.split` (JEV 0.92): the same four destinations plus Download as the filled last segment, icon only, `aria-label="Download for Mac"`. Scrollspy on (every destination is an anchor).
- Type: Geist / Geist / Geist Mono. Five sizes on the page at most: display (masthead headline only), heading (section h2 and the budget figures), title 19, body 16, meta 13. Every clock, count, token figure and tool target is `.kit-num` (tabular, slashed zero).
- Accent teal `#0f766e` only on text links and the MengAI mark. Primary actions are ink.
- Ledger (composition plus variant, in order): `masthead.split`, `sticky-story.stage-start`, `custom.list`, `custom.divided`, `spec-rail`, `custom.divided`, `stat-row.lead`, `faq.open`, `custom.close`, `footer.inline`. `validatePageRecipe(ledger, "marketing")` returned `[]`. Every section writes `data-kit-composition` and `data-variant` with these values, so `readPageLedger` and `ui_audit composition-repeat` read the same list.
- Tones: masthead base, loop layer, crew base, automation layer, keys base, providers base, budgets layer, faq base, close base, footer base.
- Media: every media slot is a `MediaFrame kind="view"` holding real product components (the cats, the crew sheet, the approval sheet), with a caption below and sample data labelled as sample. No photography, no drawn product, no re-drawn window chrome, no logos.

## Signature moment: the replay of a real run

Recipe `frame.demo` on the JAL frame core (`packages/ui/src/frames`: Composition, Sequence, Player), JEV `motion.demo_medium` frame_core at 1.0, kept as the masthead's first layer (`ui.component_recipe` layer_1 0.71).

What the visitor sees: Kopi, the lead cat, turns a goal into a task list; engineer and reviewer cats pick tasks up, their poses changing with every tool call; a task card travels from one cat's row to the next on a handoff; the reviewer passes it; the run ends on Kopi's report with tokens and time as recorded. About 24 seconds, once.

Data, never an LLM at runtime:

- The fixture is the event log of a real MengAI run (`events` rows: seq, ts, type, agent_id, task_id, data, as typed in `packages/shared/src/events.ts`), exported through the events API replay, passed through `redact()`, and trimmed to the events the view needs. It lives with the landing (for example `apps/web/src/landing/replay/run.json`), holds no tool output (events carry summaries only), no key, no absolute path from the recording machine, and stays under about 60 KB.
- The replay drives the same reducer and the same components the app uses (the store over events, `@mengai/cats`, the crew sheet rows, `handoffLayoutId(taskId)`), so the stage is the real crew board, not a drawing of one.
- Until a real run is recorded, the landing ships a scripted log with the caption "Sample run, scripted for this page". It is never labelled as recorded until it is.

Time map: the frame core Composition maps the run's real timestamps to replay time, one compression factor per stage so each beat reads, and never shows a behaviour for less than `ACTIVITY_MIN_DWELL_MS` (1,200ms) of replay time.

| Stage | Replay time | What changes on the stage |
|---|---|---|
| Plan | 0 to about 4s | Kopi goes Thinking then Planning; the task rows arrive one by one from `create_tasks` (the real count, 12 at most), each entering at `--dur-200` |
| Build | about 4 to 13s | ready tasks get owners; the engineer and designer cats switch poses with each tool call (Reading, Writing code, Running commands); the latest timeline entries push in; the token figure ticks with its width locked |
| Review | about 13 to 18s | the reviewer cat goes Reviewing; the `submit_review` verdict appears as an icon plus a word (Passed, or Changes requested with the fix task returning to its owner once, if the recording had one) |
| Hand off | about 18 to 24s | a finished task card travels to the cat that depends on it (`layoutId`, `--dur-600`, `--ease-standard`, once); at the end Kopi plays celebrate once, then rests; the run line turns to Done with the recorded totals |

Stage anatomy (inside the MediaFrame, fixed minimum ratio so nothing entering can change its height):

- Run line: the goal (one line, ellipsis, full text in `title`), status as icon plus word, the elapsed clock in mono.
- Crew sheet: four rows, one per cat: cat (64px at 1024 and up, 48px below), name and role, behaviour word from `ACTIVITY_LABEL`, tool target in mono (hidden below 640), task title on one line. Row slots are reserved, so a row that changes never moves its neighbours.
- Timeline strip: the latest three entries at 1024 and up, two below: time, cat, action, in mono where it is data.
- Run footer: tokens used of the budget, as recorded, tabular.
- Below the stage, outside the frame: the Player controls, Pause or Play and Restart as 44px icon buttons with names ("Pause replay", "Restart replay"), and a four-segment control (Plan, Build, Review, Hand off) that jumps to each stage. Then the caption: "Replay of a recorded run: <goal>. Times and token counts as recorded, played about <N> times faster."

Playback rules:

- Plays once when the masthead first enters view, only when reduced motion is off and `navigator.connection.saveData` is not set. Ends on its final frame and stays there: no loop, so no render loop keeps running.
- Pauses when the stage leaves the viewport or the tab is hidden; Pause freezes the cats too, because during the replay the cats' poses follow the frame clock, never free-running keyframes.
- Reduced motion: no autoplay; the poster frame is the Build stage (every cat in its working pose, task rows with statuses, clock and tokens as recorded then). The stage segments swap between the four stills with an opacity crossfade of 150ms or less, no travel.
- The stage has an accessible name ("Replay of a recorded MengAI run"); every cat carries its `label` ("Kopi, Lead, planning"); the stage is not a live region, so nothing chatters at a screen reader; the caption and the four segment labels carry the story in text.
- The headline, not the stage, is the LCP element; the fixture loads with the landing chunk and the first frame renders from it without a request.

Reuse: the loop section shows this composition's frame at each stage mark as a still (the Player paused at that frame), so the story section and the hero are one continuous world.

## Sections

### 1. Masthead

- Job: understand what MengAI is and see it work, in one screen.
- Message: Give one goal, and a crew of AI cats plans it, builds it, reviews it and hands it back while you watch.
- Action: Download for Mac (primary, ink). Secondary: Open the web app (links to `/app`).
- Container: plain spacing (JEV `ui.region_gate` divided 0.41 vs plain 0.40 at 0.26; the primary matched the loop's container, so the runner-up).
- Composition: `kit.masthead.split` (JEV 0.54), media on the end side, plus `frame.demo`. The headline line reveal `an.R03` was refused (0.46), so the replay alone moves.
- Motion: tier 2 (JEV 2.45 at 0.45, the lower of the top two tiers).
- Copy: headline "Watch a crew of AI cats build it" (32 characters, one display element, the D1 display step capped by measure: at most 3 lines below 640, 2 from 640). Lead: "Give MengAI one goal. Kopi, the lead cat, splits it into tasks, the crew builds and reviews them, and the work comes back to you, on your own model keys."
- 1280: headline and lead on columns 1 to 5, actions under the lead, the replay on 7 to 12; the masthead fills 70 to 90% of the first viewport, bottom padding at least 1.3 times the top. 768: stacked, text then the replay, display md step. 375: stacked, display sm step, the two actions on one row (stacked at 320), the replay's crew row inside the first screen above the dock.
- States: both actions carry all eight states; if no Mac build is published yet, Download goes to the release page named in the open decisions, never to a dead link.

### 2. How a run works (`#loop`)

- Job: understand the four stages every run follows.
- Message: Every run follows one loop: Kopi plans, the crew builds, a reviewer checks, and finished work is handed on.
- Action: none.
- Container: divided section (JEV 0.56 at 0.45).
- Composition: `kit.sticky-story.stage-start` (JEV 0.57): the stage on the start side, away from the masthead media.
- Motion: tier 2 (JEV 1.96 at 0.27, the lower of the top two tiers). The kit's active step (ink) and inactive steps (ink-subtle, never hidden), frames swap with no travel or fade under reduced motion. No GSAP, no pin beyond the kit's CSS stage.
- Head: "Plan, build, review, hand off" with the lead "The same loop runs every time, and you can pause, resume or stop it at any step."
- Steps (a real ordered process, so order is by position and words, never "01" markers or connector lines), each with the replay frozen at its stage:
  - Plan: Kopi turns your goal into up to 12 tasks, each with an owner, its dependencies and whether it needs a review.
  - Build: every ready task goes to a cat with that role, up to 4 at once by default, and each cat's pose is the tool it is using right now.
  - Review: a reviewer cat passes the task or sends a fix task back to its owner, three rounds at most.
  - Hand off: a cat that needs another role hands off a child task with a short summary, and when every task is done Kopi hands you the report.
- 1024 and up: the story pins with the stage on columns 1 to 6 and the four steps on 8 to 12, the text column never empty. Below 1024: each step shows its frame in flow, one column.

### 3. The crew (`#crew`)

- Job: know who is in the crew and what each role may do.
- Message: Eight roles, each a cat with its own small set of tools.
- Action: none.
- Container: rows (JEV 0.48 at 0.35, kept: in the final order its neighbours are divided sections).
- Composition: `custom.list` on the JAL Core List spec (JEV picked `kit.spec-table.grouped` 0.58 at 0.37; low confidence with the JAL Core spec as runner-up, so the spec). Built inside `<Section>` with `SectionHead`.
- Motion: tier 0 (JEV 0.41). The cats are still (`still`, activity rest, mood calm).
- Rows (one bordered list container, hairline dividers, 44px minimum, not interactive): leading still cat at 48px, a distinct coat per row; the role as the row title; one supporting line. Two text tiers only.
  - Lead: Kopi. Plans the goal into tasks, keeps track of the crew, and asks you when it must.
  - Engineer: Reads and edits the code, runs commands inside the project, and hands off what it cannot do.
  - Designer: Edits interface files and makes images and video through your media provider.
  - Reviewer: Reads the change, runs the checks, and passes it or asks for a fix.
  - QA: Writes and runs tests, and reports what breaks.
  - Security: Scans dependencies, secrets and configuration, and reports what it finds.
  - Researcher: Searches and reads the web, and writes what it learns into the project.
  - Operator: Uses your Mac's screen, keyboard, pointer, apps and browser, only with your permission. Trailing meta: "Mac app only".
  (Each line follows `ROLE_TOOLS` in `packages/shared/src/activity.ts`; if a role's tools change, its line changes.)
- 1024 and up: the head stacked on columns 1 to 4, the list on 5 to 12. Below: head, then the list, one column.

### 4. Your Mac, with permission (`#automation`)

- Job: trust that the operator cat touches the Mac only with explicit permission.
- Message: Every capability starts off, and anything destructive or sensitive asks you first, every time.
- Action: none.
- Container: divided section (JEV 0.63 at 0.53).
- Composition: `custom.divided` on the JAL Core divided section (JEV picked `kit.feature-grid.detail` 0.56 at 0.34; low confidence with the JAL Core spec as runner-up, so the spec).
- Motion: tier 0 (JEV 0.46). Views are static.
- Head: "Your Mac, with permission" with the lead "The operator cat exists only in the Mac app, and it can use only what you turn on."
- Four groups top to bottom, separated by hairline dividers; each group is a title and one sentence on columns 1 to 5 and its real component in a MediaFrame view on 7 to 12, captioned "Sample data". All four views on the same side, so the region keeps one content line.
  - Off until you turn it on: files, shell, browser, input, screen, apps and network are each off on a fresh install, and each grant can carry a scope and an expiry. View: the seven capability rows with their switches off.
  - It asks before anything that matters: deleting, overwriting, installing, sending data out or touching a password field always opens the approval sheet with the exact command, path or target, and an approval expires after five minutes. View: the approval sheet for one destructive command.
  - One control stops everything: Stop all sits in the app header, the menu bar and a global shortcut, and ends every run, every tool call and any held input. View: the app header with Stop all.
  - Every action is on the record: each action, approval and stop is added to a log where every row carries the hash of the row before, so the chain can be checked and exported. View: three audit rows and "Chain verified" as an icon plus a word.
- Below 1024: each group stacks, title and sentence, then its view.
- Truth: every claim here comes from `docs/automation-safety.md`, which is still a proposal for Brian's approval; the section follows whatever he approves.

### 5. Your keys stay yours

- Job: trust that model keys stay yours.
- Message: Your key is stored once, in your keychain or an encrypted vault, and is never logged, shown again or sent to a model.
- Action: none.
- Container: rows (JEV 0.63 at 0.54).
- Composition: `kit.spec-rail` (JEV 0.86): the SectionHead split (heading and lead on 1 to 5) beside one SpecRail on 7 to 12.
- Motion: tier 0 (JEV 0.33).
- Rows (label, then value; words stay in the text face, only figures are tabular):
  - On the Mac app: the macOS keychain
  - On your own server: an AES-256-GCM vault, one data key per secret
  - Shown after saving: the last 4 characters
  - Sent to: the provider you chose, inside its own request
  - Logs, events and prompts: never; active keys are scrubbed from tool output
- Below 1024: head, then the rail, one column, rows stay label and value.

### 6. Any provider, any model

- Job: confirm your provider and model work.
- Message: Bring any provider and any model, from hosted APIs to Ollama on your own Mac.
- Action: none.
- Container: divided section (JEV 0.47 at 0.33, kept: its neighbours are rows and a stat row).
- Composition: `custom.divided` on the JAL Core divided section (JEV 0.62 at 0.44; the runner-up was not a core spec, so the top pick).
- Motion: tier 0 (JEV 0.14).
- Head stacked on columns 1 to 8 (not split, so it does not rhyme with the keys section above). Six groups under hairline dividers, the group name as the title on 1 to 3, the names as body text on 4 to 12. Names only, no logos.
  - Hosted model APIs: OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Mistral, xAI Grok, Xiaomi MiMo, Moonshot Kimi, Z.ai GLM, Alibaba Qwen, MiniMax
  - Routers: OpenRouter, AgentRouter
  - Inference clouds: Groq, Together AI, Fireworks AI
  - On your own machine: Ollama and LM Studio, in the Mac app
  - Any compatible endpoint: any OpenAI compatible or Anthropic compatible base URL
  - Images, video and judge: OpenAI images and video, Gemini images and Veo, fal.ai, Replicate, the JEV judge
  (The list follows `packages/shared/src/providers.ts`; a preset added or removed there changes this list.)
- Below 1024: each group stacks, name then the list.

### 7. Every run has a budget

- Job: trust that a run cannot quietly burn money.
- Message: Every run has a budget, and the crew stops when it is spent.
- Action: none.
- Container: rows (JEV 0.54 at 0.42).
- Composition: `kit.stat-row.lead` (JEV 0.62 at 0.43): the heading and one lead on 1 to 5, four figures as a 2 by 2 block on 7 to 12, a structural rule above each, figures at the heading step in ink, never a giant numeral.
- Motion: tier 0 (JEV 0.39). Final values at once, no count-up.
- Lead: "You see tokens and cost for every call as it happens, and you can raise or lower the budget for any run."
- Figures (configured defaults and caps, labelled as such, never results): 400,000 tokens per run by default; 12,000 tokens of input per call at most; 24 steps per task; 3 review rounds.
- Below 1024: heading and lead, then the figures two across (one across at 320).

### 8. Questions (`#faq`)

- Job: clear the last objections.
- Message: Plain answers on cost, data, models and platforms.
- Action: none.
- Container: divided section (JEV 0.59 at 0.49; the primary holds in the final order, its neighbours are a stat row and plain spacing).
- Composition: `kit.faq.open`. The first `ui.component_recipe` call was sent with the container wrongly listed as rows (faq.open 0.39 at 0.09); the corrected re-ask chose `core.divided_section` at 0.70, but a third `custom.divided` on this page breaks the variety ledger (a composition and variant at most twice), so the law takes the next lawful option, `kit.faq.open` (0.19), which renders the same divided reading: every answer visible, two columns, one top hairline. Six pairs, so the two columns fill evenly.
- Motion: tier 0 (JEV 0.27).
- Pairs (each answer checked against the owning workstream before it ships):
  - What does it cost? MengAI is free and open source under Apache-2.0. You pay your model provider for the tokens a run uses, and every run has a budget.
  - Does my code or my key pass through a MengAI server? No. There is no MengAI server: runs talk only to the providers you add, with your key.
  - Which models can I use? Any provider in the list, or any OpenAI or Anthropic compatible endpoint, including local models through Ollama or LM Studio.
  - Can a cat touch files outside my project? Only in the Mac app, only for capabilities you turn on, and anything destructive or sensitive asks you every time.
  - Can I stop a run halfway? Yes. Pause holds new work at the next step, Stop ends the calls in flight, and Stop all ends every run at once.
  - Does it run on Windows or Linux? The web app runs on your own server with Docker. The desktop app is macOS only for now.
- Below 1024: one column, question then answer.

### 9. Put the crew to work (close)

- Job: take the step.
- Message: Download the Mac app, or run the web app on your own server.
- Action: Download for Mac (primary, ink; the page's one close button). Open the web app as a text link beside it (accent, link role).
- Container: plain spacing (JEV divided 0.58 at 0.49; the primary matched the footer and the runner-up card would box section text, which the kit forbids, so the next lawful option; law conflict logged in the direction contract).
- Composition: `custom.close` on JAL Core plain spacing (JEV 0.68 over `kit.cta-band.split` 0.21). Start aligned, never centred.
- Motion: tier 0 (JEV 0.77 at 0.46, the lower of the top two tiers).
- Content, from the page's own world: the four cats from the replay resting after the run (still, 64px, 48px below 640, with their names), then the heading "Put the crew to work", the lead "Free and open source under Apache-2.0. You pay only your model provider, and only for the tokens a run uses.", the action row, and one meta line: "Apache-2.0. Built by Adefebrian. Source on GitHub."
- 1024 and up: everything on columns 1 to 8. Below: one column, action full width.

### 10. Footer

- Job: close the page with credit, license and source.
- Message: MengAI, built by Adefebrian, Apache-2.0.
- Action: none.
- Container: divided section (JEV 0.60 at 0.50): one top hairline.
- Composition: `kit.footer.inline` (JEV 1.0): MengAI, "Built by Adefebrian", the Apache-2.0 license link, the source link, separated by gap only (no dots, no dashes).
- Motion: tier 0 (JEV 0.03).
- Relevance scored 1.02, under the 1.5 drop line, with implement at 0.72; kept as required chrome (credit and license), flagged in the direction contract for jal-lead.

## Build checklist for the landing workstream

- Every section writes `data-kit-composition` and `data-variant` from the ledger above; the four custom sections sit inside `<Section>` on the kit grid with `SectionHead`.
- The frame core replay: fixed-ratio stage, reserved row slots, Player controls 44px below the stage, poster frame under reduced motion, no loop, pause off screen and on hidden tabs, sample label until a real recording exists.
- No card around section text; views and the crew list are the only framed things.
- Cats follow the coat check in the direction contract (the ink-muted contour on every coat).
- `ui_audit` at 320, 375, 414, 768 and 1280 must PASS, including `stuck-reveal`, `reduced-motion`, `composition-repeat`, `display-measure` and `mobile-app-shell`; then `ui_shots` at 375 and 1280 for the fresh-eyes critic.
