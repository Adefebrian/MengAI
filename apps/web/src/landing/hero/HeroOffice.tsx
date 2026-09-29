// The hero media: the cat company at work. The scripted story (story/)
// plays through the frozen office contract, so the Office scene from
// @mengai/cats (hero variant) and the landing's own DeskFloor take the same
// props and swap with no other change.
//
// Which one renders: DeskFloor, until the Office hero variant is verified
// inside this frame (it must fit the 3:2 frame beside the headline and pass
// ui_audit at every width). Flip HERO_USES_OFFICE to true once it does; the
// preview takes ?scene=office or ?scene=floor to compare the two.
//
// Under the frame: one pause control (the story loops for 40 s, WCAG 2.2.2),
// the office clock, and what just happened, in words.
import * as Cats from "@mengai/cats";
import { useMemo, useRef, type ComponentType } from "react";
import type { OfficeProps } from "@mengai/cats";
import { MediaFrame } from "@mengai/ui";
import { PauseIcon, PlayIcon } from "../icons";
import { STORY_LABEL, sceneAt, sceneLabel } from "../story/script";
import { useStory } from "../story/useStory";
import { DeskFloor } from "./DeskFloor";

// Read by name at runtime, so this file builds before Office exists.
const OFFICE_EXPORT = "Office";

/** Set to true once the Office hero variant passes ui_audit in this frame. */
export const HERO_USES_OFFICE = false;

function sceneChoice(): "office" | "floor" | null {
  if (typeof location === "undefined") return null;
  const q = new URLSearchParams(location.search).get("scene");
  return q === "office" || q === "floor" ? q : null;
}

/** The Office scene when @mengai/cats exports it, else null. */
export function officeScene(mod: unknown = Cats): ComponentType<OfficeProps> | null {
  const c = (mod as Record<string, unknown>)[OFFICE_EXPORT];
  if (typeof c === "function") return c as ComponentType<OfficeProps>;
  if (c && typeof c === "object" && "$$typeof" in c) return c as unknown as ComponentType<OfficeProps>;
  return null;
}

export function HeroOffice() {
  const ref = useRef<HTMLDivElement>(null);
  const story = useStory(ref);
  const scene = useMemo(() => sceneAt(story.index), [story.index]);
  const choice = sceneChoice() ?? (HERO_USES_OFFICE ? "office" : "floor");
  const Scene = (choice === "office" ? officeScene() : null) ?? DeskFloor;
  const label = sceneLabel(scene.step);

  return (
    <div ref={ref} className="lp-hero-office" data-scene={Scene === DeskFloor ? "floor" : "office"}>
      <MediaFrame
        kind="view"
        ratio="3/2"
        tone="surface"
        caption={
          <span className="lp-story">
            <button
              type="button"
              className="btn btn-secondary lp-story-toggle"
              aria-label={story.playing ? "Pause the story" : "Play the story"}
              aria-pressed={!story.playing}
              onClick={story.toggle}
            >
              {story.playing ? <PauseIcon size={20} color="currentColor" /> : <PlayIcon size={20} color="currentColor" />}
            </button>
            <span className="lp-story-text">
              <span key={story.index + story.loop * 100} className="lp-story-caption">
                {scene.step.caption}
              </span>
              <span className="lp-story-meta">
                <span className="kit-num">{scene.step.clock}</span>
                <span>{STORY_LABEL}</span>
              </span>
            </span>
          </span>
        }
      >
        <Scene
          agents={scene.agents}
          meetings={scene.meetings}
          beats={story.beats}
          onBeatDone={story.done}
          plan={scene.plan}
          variant="hero"
          still={story.still}
          label={label}
        />
      </MediaFrame>
    </div>
  );
}
