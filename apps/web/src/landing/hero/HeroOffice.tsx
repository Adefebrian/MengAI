// The hero media: the living office. The Office scene from @mengai/cats
// (hero variant, frozen contract in packages/cats/src/office-contract.ts)
// plays the scripted day (story/script.ts): the kickoff, the plan dealt to
// the whiteboard, coding at the desks, a question to Oyen and the approval,
// a handoff carry, a review bounce and the sync, the fix, the tests, a
// coffee break, the wrap-up and the celebration.
//
// JEV ui.region_gate (verified, this round): office kept (relevance 2.90,
// plain_spacing, so no frame: the Office draws its own floor plate), story
// bar kept (1.88, plain_spacing), the chapter buttons dropped (implement
// 0.41: the lifecycle section below has its own scene list). JEV
// motion.intensity hero 1.94, tier 2.
//
// Under the scene: one pause control (the story loops for 84 s, WCAG
// 2.2.2; paused, the office holds still), the office clock and what just
// happened in words.
import { Office } from "@mengai/cats";
import { useMemo, useRef } from "react";
import { PauseIcon, PlayIcon } from "../icons";
import { STORY_LABEL, sceneAt, sceneLabel } from "../story/script";
import { useStory } from "../story/useStory";

export function HeroOffice() {
  const ref = useRef<HTMLElement>(null);
  const story = useStory(ref);
  const scene = useMemo(() => sceneAt(story.index), [story.index]);
  const label = sceneLabel(scene.step);

  return (
    <figure ref={ref} className="lp-hero-office">
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
      />
      <figcaption className="lp-story">
        <button
          type="button"
          className="jal-icon-btn"
          data-variant="outlined"
          aria-label={story.playing ? "Pause the story" : "Play the story"}
          onClick={story.toggle}
        >
          {story.playing ? <PauseIcon size={20} color="currentColor" /> : <PlayIcon size={20} color="currentColor" />}
        </button>
        <span className="lp-story-text">
          <span key={`${story.play}-${story.index}`} className="lp-story-caption">
            {scene.step.caption}
          </span>
          <span className="lp-story-meta">
            <span className="kit-num">{scene.step.clock}</span>
            <span>{STORY_LABEL}</span>
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
