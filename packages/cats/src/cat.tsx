// Cat: the living cat character. One flat SVG rig (rig.tsx) in a square
// stage of the requested size; nothing ever leaves that box. Motion layers:
//   status    data-status (error ears back plus one shake, stopped lies down dimmed)
//   activity  the pose and its loop, held ACTIVITY_MIN_DWELL_MS, crossfaded over --dur-300
//   mood      data-mood (expression and loop tempo only)
//   quirks    seeded one-shots every 8 to 20 s while idle or waiting
//   pointer   head and eyes follow the pointer, tap and focus reactions (interactive)
//   celebrate one-shot from celebrateKey: tail up, a small hop, paw prints under 900 ms
// Reduced motion and `still` render the static pose for the activity with
// its label under the cat; no animation class is ever set then.
import { useEffect, useId, useRef, useState, type CSSProperties, type Ref, type RefObject } from "react";
import { ACTIVITY_MIN_DWELL_MS } from "@mengai/shared";
import type { CatProps } from "./contract";
import { CELEBRATE_MS, CROSSFADE_MS, TAP_MS, useDwell, useOffscreen, usePointerFollow, useQuirks, useReducedMotion } from "./motion";
import { QUIRK_POSES, coatOf, phaseMs, poseFor, stillCaption, type Pose } from "./poses";
import { Cushion, PawPrints, Rig } from "./rig";

export interface CatFigureProps extends CatProps {
  /** Draw the flat cushion under the cat (CatCard). */
  cushion?: boolean;
  /** Show the activity words under a still cat (96 px and up). CatCard carries its own text. */
  caption?: boolean;
  /** "figure" never renders a button, for a cat inside a larger hit target (CatCard). */
  host?: "auto" | "figure";
}

/** Holds the previous pose for one crossfade after the pose changes, while motion is allowed. */
function useCrossfade(pose: Pose, live: boolean): Pose | null {
  const [state, setState] = useState<{ pose: Pose; leaving: Pose | null; n: number }>({ pose, leaving: null, n: 0 });
  let current = state;
  if (state.pose !== pose) {
    current = { pose, leaving: live ? state.pose : null, n: state.n + 1 };
    setState(current);
  }
  const { n, leaving } = current;
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setState((s) => (s.n === n ? { ...s, leaving: null } : s)), CROSSFADE_MS);
    return () => clearTimeout(timer);
  }, [n, leaving]);
  return current.leaving;
}

/** Counts up when celebrateKey changes (never on mount), back to 0 after the celebration. */
function useCelebrate(key: number | undefined, live: boolean): number {
  const [playing, setPlaying] = useState(0);
  const prev = useRef(key);
  useEffect(() => {
    if (Object.is(prev.current, key)) return;
    prev.current = key;
    if (live && key !== undefined) setPlaying((p) => p + 1);
  }, [key, live]);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setPlaying(0), CELEBRATE_MS);
    return () => clearTimeout(timer);
  }, [playing]);
  return live ? playing : 0;
}

/** A short head bob on tap, click, or keyboard activation of the cat or its card. */
function useTap(target: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [tap, setTap] = useState(0);
  useEffect(() => {
    const el = target.current;
    if (!el || !enabled) return;
    const host = (el.closest(".cat-card") as HTMLElement | null) ?? el;
    const onTap = () => setTap((t) => t + 1);
    host.addEventListener("click", onTap);
    return () => host.removeEventListener("click", onTap);
  }, [target, enabled]);
  useEffect(() => {
    if (!tap) return;
    const timer = setTimeout(() => setTap(0), TAP_MS);
    return () => clearTimeout(timer);
  }, [tap]);
  return enabled && tap > 0;
}

function idPart(raw: string): string {
  return "cat" + raw.replace(/[^A-Za-z0-9_-]/g, "");
}

export function CatFigure(props: CatFigureProps) {
  const {
    look,
    role,
    status,
    activity,
    mood,
    label,
    size = 96,
    interactive = false,
    onSelect,
    still = false,
    celebrateKey,
    cushion = false,
    caption = true,
    host = "auto",
  } = props;
  const reduced = useReducedMotion();
  const live = !still && !reduced;
  const pose = useDwell(poseFor(status, activity), ACTIVITY_MIN_DWELL_MS);
  const leaving = useCrossfade(pose, live);
  const rootRef = useRef<HTMLElement | null>(null);
  const offscreen = useOffscreen(rootRef, live);
  const quirk = useQuirks(live && (status === "idle" || status === "waiting") && QUIRK_POSES.has(pose), look.seed, offscreen);
  usePointerFollow(rootRef, live && interactive);
  const tapped = useTap(rootRef, live && interactive);
  const celebrating = useCelebrate(celebrateKey, live);
  const clipBase = idPart(useId());

  const className = [
    "cat",
    live ? "cat--live" : null,
    quirk ? `cat-quirk-${quirk}` : null,
    celebrating ? "cat-celebrate" : null,
    tapped ? "cat-react-tap" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const attrs = {
    className,
    "data-size": String(size),
    "data-coat": coatOf(look.coat, look.seed),
    "data-role": role,
    "data-status": status,
    "data-cat-status": status,
    "data-activity": activity,
    "data-pose": pose,
    "data-mood": mood,
    "data-motion": live ? "live" : "still",
    style: { "--cat-phase": `${phaseMs(look.seed)}ms` } as CSSProperties,
  };

  const stage = (
    <span className="cat-stage">
      <svg className="cat-svg" viewBox="0 0 160 160" aria-hidden="true" focusable="false">
        {cushion ? <Cushion /> : null}
        {leaving ? <Rig key={leaving} pose={leaving} role={role} clipBase={clipBase} live={live} fade="out" /> : null}
        <Rig key={pose} pose={pose} role={role} clipBase={clipBase} live={live} fade={leaving ? "in" : undefined} />
        {celebrating ? <PawPrints key={celebrating} /> : null}
      </svg>
    </span>
  );
  const words = !live && caption && size >= 96 ? <span className="cat-caption">{stillCaption(pose)}</span> : null;

  if (onSelect && host === "auto") {
    return (
      <button ref={rootRef as Ref<HTMLButtonElement>} type="button" {...attrs} aria-label={label} onClick={onSelect}>
        {stage}
        {words}
      </button>
    );
  }
  return (
    <span ref={rootRef as Ref<HTMLSpanElement>} {...attrs} role="img" aria-label={label}>
      {stage}
      {words}
    </span>
  );
}

export function Cat(props: CatProps) {
  return <CatFigure {...props} />;
}
