// The lifecycle simulation (custom.lifecycle): one goal grows a whole
// company, for a software studio or a hedge fund. Scripted, no model calls
// (story/lifecycle.ts). JEV imm.concept c4 "The door is the company".
//
// JEV decisions (verified, this round):
//   ui.region_gate   section divided_section (0.91); company switch card
//                    (0.57); tracker divided_section (low 0.17, the primary
//                    kept, it matches no neighbour); office plain_spacing
//                    (0.63, the Office draws its own floor plate); head
//                    card card (0.97); scenes rows (0.48, the primary)
//   ui.component_recipe  tracker core.stepper_cells (0.90) with the
//                    cell-state crossfade layer (0.72); status line
//                    core.static (0.70); switch md.segmented_button (an.R13
//                    at 0.18, low confidence, the runner-up is the JAL Core
//                    spec); head card core.rows (0.99) with the an.R21 new
//                    row layer (0.72); scenes core.list (0.83)
//   motion.intensity 2.01, tier 2; motion.choreography stagger_sequence
//                    (0.91): the tracker, the floor and the panels enter
//                    one after another
//
// Order inside the section: the tracker (status line over seven stage
// cells, with the pause or replay control), the full Office floor, then
// what is in the focus cat's head beside the scene list. Switching the
// company remounts the stage, so the new story starts from its first step.
import { Cat, Office } from "@mengai/cats";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Section, SectionHead, staggerStyle } from "@mengai/ui";
import { ChartBarIcon, CheckCircleIcon, ClockCircleIcon, CodeIcon, PauseIcon, PlayIcon, RestartIcon, RingIcon, UndoIcon } from "../icons";
import {
  COMPANIES,
  COMPANY_KINDS,
  HEAD_KEYS,
  HEAD_LABEL,
  LIFE_LABEL,
  catOf,
  lifeAt,
  lifeBeats,
  lifeLabel,
  stageWords,
  type CellState,
  type Company,
  type CompanyKind,
  type LifeScene,
} from "../story/lifecycle";
import { useStory, type StoryPlayer, type StoryScript } from "../story/useStory";

export const LIFE_TITLE = "Watch a company grow around one goal";
export const LIFE_LEAD =
  "Oyen starts alone with your goal. The crew walks in with their boxes, works, meets and gets sent back, a cat that keeps failing is let go, and the goal ships.";

const KIND_ICON: Record<CompanyKind, ReactNode> = {
  studio: <CodeIcon size={20} color="currentColor" />,
  fund: <ChartBarIcon size={20} color="currentColor" />,
};

export const STATE_WORD: Record<CellState, string> = {
  done: "Done",
  now: "Now",
  next: "Next",
  back: "Sent back",
};

/** The state glyph carries the cell's name for assistive tech: below 768 the cell shows only the glyph. */
function StateIcon({ state, label }: { state: CellState; label: string }) {
  const name = `${label}: ${STATE_WORD[state]}`;
  if (state === "done") return <CheckCircleIcon size={20} color="currentColor" label={name} />;
  if (state === "now") return <ClockCircleIcon size={20} color="currentColor" label={name} />;
  if (state === "back") return <UndoIcon size={20} color="currentColor" label={name} />;
  return <RingIcon size={20} color="currentColor" label={name} />;
}

export function LifecycleSection() {
  const headId = useId();
  const [kind, setKind] = useState<CompanyKind>("studio");
  return (
    <Section id="company" tone="layer" composition="custom" variant="lifecycle" labelledBy={headId} className="lp-life">
      <SectionHead id={headId} title={LIFE_TITLE} lead={LIFE_LEAD} action={<KindSwitch kind={kind} onPick={setKind} />} />
      <LifeStage key={kind} company={COMPANIES[kind]} />
    </Section>
  );
}

/**
 * The two companies as one segmented control, the JAL Core segmented
 * anatomy (44 px segments, one control boundary around the group, radius
 * on the outer ends, selection a tonal fill). The rule between the two
 * segments is the group's 1 px gap, so no segment overlaps its neighbour.
 */
function KindSwitch({ kind, onPick }: { kind: CompanyKind; onPick: (k: CompanyKind) => void }) {
  return (
    <div className="lp-kinds" role="group" aria-label="Kind of company">
      {COMPANY_KINDS.map((k) => (
        <button key={k} type="button" className="lp-kind" aria-pressed={k === kind} onClick={() => onPick(k)}>
          <span className="lp-kind-icon">{KIND_ICON[k]}</span>
          <span>{COMPANIES[k].label}</span>
        </button>
      ))}
    </div>
  );
}

function LifeStage({ company }: { company: Company }) {
  const ref = useRef<HTMLDivElement>(null);
  const script = useMemo<StoryScript>(
    () => ({
      steps: company.steps,
      total: company.total,
      start: 0,
      poster: company.poster,
      loop: false,
      beats: (i, play) => lifeBeats(company, i, play),
    }),
    [company],
  );
  const story = useStory(ref, script);
  const scene = useMemo(() => lifeAt(company, story.index), [company, story.index]);

  return (
    <div ref={ref} className="lp-life-stage" data-kind={company.kind}>
      <Tracker company={company} scene={scene} story={story} />
      <div className="lp-life-office" data-motion="rise" style={staggerStyle(1)}>
        <Office
          agents={scene.agents}
          meetings={scene.meetings}
          beats={story.beats}
          onBeatDone={story.done}
          plan={scene.plan}
          variant="full"
          theme={company.theme}
          still={story.still}
          label={lifeLabel(company, scene.step)}
        />
      </div>
      <div className="lp-life-panels">
        <HeadCard company={company} scene={scene} />
        <Scenes company={company} current={story.index} onJump={story.jump} />
      </div>
    </div>
  );
}

function controlLabel(story: StoryPlayer): string {
  if (story.ended) return "Replay the story";
  return story.playing ? "Pause the story" : "Play the story";
}

/** The on-demand tracker: one status line over the seven stage cells. */
function Tracker({ company, scene, story }: { company: Company; scene: LifeScene; story: StoryPlayer }) {
  const { step, cells } = scene;
  return (
    <div className="lp-track" data-motion="rise">
      <div className="lp-track-bar">
        <button type="button" className="jal-icon-btn" data-variant="outlined" aria-label={controlLabel(story)} onClick={story.toggle}>
          {story.ended ? (
            <RestartIcon size={20} color="currentColor" />
          ) : story.playing ? (
            <PauseIcon size={20} color="currentColor" />
          ) : (
            <PlayIcon size={20} color="currentColor" />
          )}
        </button>
        <p className="lp-track-meta">
          <span className="kit-num">{step.clock}</span>
          <span>{stageWords(company, step)}</span>
          <span>{LIFE_LABEL}</span>
        </p>
      </div>
      <p key={`${story.play}-${story.index}`} className="lp-track-status">
        {step.caption}
      </p>
      <ol className="lp-cells" aria-label={`Progress of the ${company.label.toLowerCase()} goal`}>
        {company.stages.map((s, i) => {
          const state = cells[i]!;
          return (
            <li key={s.id} className="lp-cell" data-state={state} aria-current={state === "now" ? "step" : undefined}>
              <span key={state} className="lp-cell-icon">
                <StateIcon state={state} label={s.label} />
              </span>
              <span className="lp-cell-text" aria-hidden="true">
                <span className="lp-cell-label">{s.label}</span>
                <span className="lp-cell-state">{STATE_WORD[state]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** What the focus cat carries into its next call, with the evidence behind each part. */
function HeadCard({ company, scene }: { company: Company; scene: LifeScene }) {
  const id = useId();
  const cat = catOf(company, company.focus);
  const { head, fresh } = scene;
  return (
    <article className="lp-head" aria-labelledby={id} data-motion="rise" style={staggerStyle(2)}>
      <header className="lp-head-top">
        <Cat
          look={{ coat: cat.coat, seed: cat.seed }}
          role={cat.role}
          status={scene.focusHired ? "working" : "idle"}
          activity={scene.focusHired ? "think" : "rest"}
          mood="focused"
          label={`${cat.name}, ${cat.title}`}
          size={48}
          still
        />
        <div className="lp-head-title">
          <h3 id={id} className="kit-title">
            What is in {cat.name}'s head
          </h3>
          <p className="lp-head-status">
            {cat.title}. {head.status}.
          </p>
        </div>
      </header>
      <dl className="lp-head-rows">
        {HEAD_KEYS.map((k) => {
          const row = head.rows[k];
          const isNew = fresh.includes(k);
          return (
            <div key={k} className="lp-head-row" data-fresh={isNew ? "" : undefined}>
              <dt className="lp-head-key">
                <span>{HEAD_LABEL[k]}</span>
                {isNew ? <span className="lp-new">New</span> : null}
              </dt>
              <dd className="lp-head-value">
                <span key={row.value} className="lp-head-text">
                  {row.value}
                </span>
                <span className="lp-head-evidence">{row.evidence}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="lp-head-note">Sample. In the app every cat has this card, filled from its real calls.</p>
    </article>
  );
}

/** The scenes of the story as rows; any one plays at a tap. */
function Scenes({ company, current, onJump }: { company: Company; current: number; onJump: (i: number) => void }) {
  const id = useId();
  return (
    <nav className="lp-scenes" aria-labelledby={id} data-motion="rise" style={staggerStyle(3)}>
      <h3 id={id} className="kit-title">
        Jump to a scene
      </h3>
      <ol className="lp-scene-list">
        {company.steps.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className="lp-scene"
              aria-current={i === current ? "step" : undefined}
              aria-label={`Play the ${s.scene.toLowerCase()} scene, ${s.clock}`}
              onClick={() => onJump(i)}
            >
              <span className="kit-num lp-scene-clock">{s.clock}</span>
              <span className="lp-scene-name">{s.scene}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
