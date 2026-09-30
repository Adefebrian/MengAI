// The lifecycle simulation (custom.lifecycle): one goal grows a whole
// company, for a software studio or a hedge fund. Scripted, no model calls
// (story/lifecycle.ts). JEV imm.concept c4 "The door is the company".
//
// JEV decisions (verified, this round):
//   ui.region_gate   section divided_section (0.91); company switch card
//                    (0.57); tracker divided_section (low 0.17, the primary
//                    kept, it matches no neighbour); office plain_spacing
//                    (0.63, the Office draws its own floor plate); head
//                    card card (0.97); scenes divided_section (round C:
//                    the primary card at 0.31, low, matched the head card
//                    beside it, so the runner-up at 0.30)
//   ui.component_recipe  tracker: since round C the DeliveryTracker from
//                    @mengai/cats (the brief's call; its own JEV log is in
//                    packages/cats/src/tracker), replacing core.stepper_cells
//                    (0.90); switch md.segmented_button (an.R13
//                    at 0.18, low confidence, the runner-up is the JAL Core
//                    spec); head card core.rows (0.99) with the an.R21 new
//                    row layer (0.72); scenes core.list_two_col_fill (round C,
//                    0.95)
//   motion.intensity 2.01, tier 2; motion.choreography stagger_sequence
//                    (0.91): the tracker, the floor and the panels enter
//                    one after another
//
// Order inside the section: the tracker (the courier route under a bar
// with the pause or replay control), the full Office floor, then
// what is in the focus cat's head beside the scene list. Switching the
// company remounts the stage, so the new story starts from its first step.
import { Cat, DeliveryTracker, Office } from "@mengai/cats";
import { useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Section, SectionHead, staggerStyle } from "@mengai/ui";
import { ChartBarIcon, CodeIcon, PauseIcon, PlayIcon, RestartIcon } from "../icons";
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
  meetingStep,
  roomOf,
  trackerAt,
  type Company,
  type CompanyKind,
  type LifeScene,
} from "../story/lifecycle";
import { hourOf } from "../story/script";
import { useFadeOnChange } from "../story/useFade";
import { useLifeCamera } from "../story/useLifeCamera";
import { useStory, type StoryPlayer, type StoryScript, type StoryVisibility } from "../story/useStory";

export const LIFE_TITLE = "Watch a company grow around one goal";
export const LIFE_LEAD =
  "Oyen starts alone with your goal. The crew walks in with their boxes, works, meets and gets sent back, a cat that keeps failing is let go, and the goal ships.";

const KIND_ICON: Record<CompanyKind, ReactNode> = {
  studio: <CodeIcon size={20} color="currentColor" />,
  fund: <ChartBarIcon size={20} color="currentColor" />,
};

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

/** The story starts when the floor is half in view (critic fix round 2), then plays while any real part of it shows. */
export const LIFE_VISIBILITY: StoryVisibility = { start: 0.5, stay: 0.15 };

function LifeStage({ company }: { company: Company }) {
  const floor = useRef<HTMLDivElement>(null);
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
  const story = useStory(floor, script, LIFE_VISIBILITY);
  const scene = useMemo(() => lifeAt(company, story.index), [company, story.index]);
  const mount = useOfficeMount(company, story);
  const room = useMemo(() => roomOf(company, story.index), [company, story.index]);
  const cam = useLifeCamera(floor, room, `${mount.key}:${story.index}`);
  const floorStyle = cam.narrow
    ? ({ ...staggerStyle(1), "--lp-window-h": `${cam.viewH}px`, "--lp-cam-y": `${-cam.top}px` } as CSSProperties)
    : staggerStyle(1);

  return (
    <div className="lp-life-stage" data-kind={company.kind}>
      <Tracker company={company} scene={scene} story={story} />
      <div ref={floor} className="lp-life-office" data-motion="rise" data-window={cam.narrow ? "" : undefined} style={floorStyle}>
        <div key={mount.key} className="lp-life-scene" data-cut={mount.key > 0 ? "" : undefined}>
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
            hour={hourOf(scene.step.clock)}
          />
        </div>
      </div>
      <div className="lp-life-panels">
        <HeadCard company={company} scene={scene} />
        <Scenes company={company} current={story.index} onJump={story.jump} />
      </div>
    </div>
  );
}

/**
 * The meeting cut (critic round 2, life-1280-t25): when the story enters
 * its meeting, the floor opens on a fresh Office with the meeting already
 * in session, so the crew sits at the chair anchors exactly as the Office
 * seats a meeting that is running when it mounts (one cat per seat, extra
 * cats on their own stand spots at the foot of the table), instead of six
 * cats crossing the room at once. The key changes when the story crosses
 * into or out of the meeting chapter, and when a jump lands on the meeting
 * again; every other step keeps the same Office, so hires still walk in
 * and the crew walks back to the desks after the meeting.
 */
function useOfficeMount(company: Company, story: StoryPlayer): { key: number } {
  const at = meetingStep(company);
  const chapter = at >= 0 && story.index >= at ? 1 : 0;
  const onMeeting = story.index === at;
  const ref = useRef({ key: 0, chapter: 0, play: -1 });
  const cur = ref.current;
  if (chapter !== cur.chapter || (onMeeting && cur.play !== story.play)) {
    ref.current = { key: cur.key + 1, chapter, play: onMeeting ? story.play : cur.play };
  }
  return { key: ref.current.key };
}

function controlLabel(story: StoryPlayer): string {
  if (story.ended) return "Replay the story";
  return story.playing ? "Pause the story" : "Play the story";
}

/**
 * The on-demand tracker (round C): the DeliveryTracker from @mengai/cats,
 * Oyen riding the route from the goal to shipped, under one bar with the
 * story's pause or replay control, the office clock and the sample label.
 * A review that bounces turns the courier back one stop and tags Round 2;
 * the arrival at the last stop plays once. A tap on a stop retells that
 * stop's latest scene; Back to live returns to the story.
 */
function Tracker({ company, scene, story }: { company: Company; scene: LifeScene; story: StoryPlayer }) {
  const { step } = scene;
  const track = useMemo(() => trackerAt(company, story.index), [company, story.index]);
  const oyen = catOf(company, "oyen");
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
          <span>{LIFE_LABEL}</span>
        </p>
      </div>
      <div className="lp-track-route" role="group" aria-label={`Progress of the ${company.label.toLowerCase()} goal`}>
        <DeliveryTracker
          stages={track.stages}
          current={track.current}
          looping={track.looping}
          loops={track.loops}
          done={track.done}
          status={track.status}
          eta={null}
          courier={{ name: oyen.name, look: { coat: oyen.coat, seed: oyen.seed } }}
          still={story.still}
        />
      </div>
    </div>
  );
}

/** One head row's value, fading in when the story changes it. */
function HeadValue({ value }: { value: string }) {
  const ref = useFadeOnChange<HTMLSpanElement>(value);
  return (
    <span ref={ref} className="lp-head-text">
      {value}
    </span>
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
                <HeadValue value={row.value} />
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

/**
 * The scenes of the story in two columns, read left to right then down, on
 * a divided section beside the head card (JEV ui.region_gate scenes
 * divided_section, the runner-up: the primary card matched the head card;
 * ui.component_recipe core.list_two_col_fill 0.95). The heading and a one
 * line status sit inside the block on the card's header line; from 1024
 * the rows share the card's height, so the block starts and ends on the
 * card's lines. With an odd count the first scene, where the goal lands,
 * spans both columns, so no cell is empty and the pairs end flush.
 */
function Scenes({ company, current, onJump }: { company: Company; current: number; onJump: (i: number) => void }) {
  const id = useId();
  const rows = Math.ceil(company.steps.length / 2);
  return (
    <nav className="lp-scenes" aria-labelledby={id} data-motion="rise" style={staggerStyle(3)}>
      <div className="lp-scenes-head">
        <h3 id={id} className="kit-title">
          Jump to a scene
        </h3>
        <p className="lp-head-status">{company.steps.length} scenes. Pick one and the story plays from there.</p>
      </div>
      <ol className="lp-scene-list" style={{ "--lp-scene-rows": String(rows) } as CSSProperties}>
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
