// The hero's product frame: the app's own run view on sample data, with the
// living office inside it already at work (critic fix round 2).
//
// JEV decisions (verified, this round):
//   ui.region_gate    hero_frame kept (relevance 2.99, card 0.40, the
//                     primary kept); hero_chips kept (2.02, card 0.12 low,
//                     it matches the frame's card, so the runner-up
//                     plain_spacing); hero_logos kept (1.75)
//   motion.intensity  hero 2.85, tier 3
//   motion.choreography hero scrub (0.63), carried by the frame's scale
//                     (hero_scrub_target frame_scale 0.17, low, top pick)
//   ui.component_recipe hero_frame bang.shot_size (0.68): the camera eases
//                     between a wide shot of the desk rows and a close shot
//                     on the desk where the beat happens; the scrub tilt
//                     layer declined (0.47); hero_chips an.R21_flip_feed
//                     (0.67); hero_headline core.static (0.70), the split
//                     line layer declined (0.56)
//
// Anatomy, the app's run page in small: the run header (the goal, status,
// crew, the office clock, one pause control), the office camera beside the
// company feed, and the status strip (what just happened, tasks done and
// the budget, each with its meter). The office is drawn art inside the
// camera's clipped view: its layer is aria-hidden, and the view itself is
// one labelled image that says what the crew is doing.
import { Office } from "@mengai/cats";
import { usePrefersReducedMotion } from "@mengai/ui";
import { Meter, StatusPill } from "@mengai/ui/src/product";
import { motion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { PauseIcon, PlayIcon } from "../icons";
import { CREW, STORY_BUDGET, STORY_GOAL, STORY_LABEL, feedAt, hourOf, sceneAt, sceneLabel } from "../story/script";
import { useFadeOnChange } from "../story/useFade";
import { useStory } from "../story/useStory";
import { transformOf } from "./camera";
import { HeroFeed } from "./HeroFeed";
import { useCamera } from "./useCamera";

/** --ease-standard */
const EASE = [0.24, 1, 0.4, 1] as const;
// The frame fades in on its own box (round C: a 32 px rise carried it past
// its wrapper mid-entrance, ui_audit overflow-parent at 320; the scroll
// scrub on the wrapper stays the frame's one moving transform).

export type FrameLayout = "rail" | "strip3" | "strip2" | "one";

/** The frame's layout for its own width: the feed beside the office from 1120, three or two across under it, one on a phone. */
export function frameLayout(width: number): FrameLayout {
  if (width >= 1120) return "rail";
  if (width >= 880) return "strip3";
  if (width >= 560) return "strip2";
  return "one";
}

const FEED_COUNT: Record<FrameLayout, number> = { rail: 3, strip3: 3, strip2: 2, one: 1 };

function useFrameLayout(ref: RefObject<HTMLElement | null>): FrameLayout | null {
  const [layout, setLayout] = useState<FrameLayout | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setLayout(frameLayout(el.clientWidth));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return layout;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function HeroFrame() {
  const frame = useRef<HTMLElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const story = useStory(frame);
  const scene = useMemo(() => sceneAt(story.index), [story.index]);
  const feed = useMemo(() => feedAt(story.index), [story.index]);
  const measured = useFrameLayout(frame);
  const layout = measured ?? "one";
  const live = !story.still && !reduced;
  // every layout crops from the top of the wall, so the phone crop holds the whole plan board, never a sliver of it (critic round 2, 375-01)
  const cam = useCamera(view, world, scene.step.shot, `${story.play}-${story.index}`, live, false);
  const label = sceneLabel(scene.step);
  const now = useFadeOnChange<HTMLParagraphElement>(`${story.play}-${story.index}`, 300);
  const viewStyle: CSSProperties = cam.height ? { blockSize: `${cam.height}px` } : { aspectRatio: "16 / 9" };
  const worldStyle: CSSProperties = { inlineSize: `${cam.planW}px`, transform: cam.shot ? transformOf(cam.shot) : undefined };

  return (
    <div className="lp-frame-depth" data-lp-frame-depth="">
      <motion.figure
        ref={frame}
        className="lp-frame"
        data-layout={layout}
        aria-label="A sample run in the MengAI app"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduced ? { duration: 0 } : { duration: 0.6, ease: EASE, delay: 0.15 }}
      >
        <header className="lp-frame-head">
          <div className="lp-frame-title">
            <p className="lp-frame-goal">{STORY_GOAL}</p>
            <p className="lp-frame-meta">
              <StatusPill tone="info" icon="refresh" variant="pill">
                Working
              </StatusPill>
              <span className="kit-num">{scene.step.clock}</span>
              <span>
                <span className="kit-num">{CREW.length}</span> cats<span className="lp-frame-wide"> on the crew</span>
              </span>
              <span className="lp-frame-sample">{STORY_LABEL}</span>
            </p>
          </div>
          <button type="button" className="jal-icon-btn" data-variant="outlined" aria-label={story.playing ? "Pause the story" : "Play the story"} onClick={story.toggle}>
            {story.playing ? <PauseIcon size={20} color="currentColor" /> : <PlayIcon size={20} color="currentColor" />}
          </button>
        </header>
        <div className="lp-frame-body">
          <div ref={view} className="lp-cam" role="img" aria-label={label} style={viewStyle}>
            <div className="lp-cam-clip" aria-hidden="true">
            <div ref={world} className="lp-cam-world" style={worldStyle}>
              <Office
                agents={scene.agents}
                meetings={scene.meetings}
                beats={story.beats}
                onBeatDone={story.done}
                plan={scene.plan}
                variant="hero"
                theme="studio"
                still={story.still}
                label={label}
                hour={hourOf(scene.step.clock)}
              />
            </div>
            </div>
          </div>
          <div className="lp-frame-feed">
            <HeroFeed feed={feed} count={FEED_COUNT[layout]} reduced={reduced} ready={measured !== null} />
          </div>
        </div>
        <figcaption className="lp-frame-foot">
          <p ref={now} className="lp-frame-now" aria-live="polite">
            {scene.step.caption}
          </p>
          <div className="lp-frame-figures">
            <div className="lp-frame-figure">
              <p className="lp-frame-figure-text">
                <span>Tasks done</span>
                <span className="kit-num lp-frame-figure-value">
                  {scene.done} of {PLAN_SIZE}
                </span>
              </p>
              <Meter label="Tasks done" value={scene.done / PLAN_SIZE} valueText={`${scene.done} of ${PLAN_SIZE} tasks done`} compact animate />
            </div>
            <div className="lp-frame-figure">
              <p className="lp-frame-figure-text">
                <span>Budget used</span>
                <span className="kit-num lp-frame-figure-value">
                  {fmt(scene.tokens)} of {fmt(STORY_BUDGET)}
                </span>
              </p>
              <Meter label="Budget used" value={scene.tokens / STORY_BUDGET} valueText={`${fmt(scene.tokens)} of ${fmt(STORY_BUDGET)} tokens`} compact animate />
            </div>
          </div>
        </figcaption>
      </motion.figure>
    </div>
  );
}

const PLAN_SIZE = 6;
