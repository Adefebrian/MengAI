// Cats preview: the crew board on a scripted timeline (with one handoff),
// every pose live, moods and statuses, the four sizes, and the reduced
// motion stills. Composed from the JAL Core kit and AppShell.
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell, Masthead, Page, Section, SectionHead } from "@mengai/ui";
import {
  ACTIVITIES,
  ACTIVITY_LABEL,
  AGENT_STATUSES,
  MOODS,
  ROLE_LABEL,
  STATUS_LABEL,
  activityForStatus,
  type Activity,
  type AgentStatus,
  type Mood,
} from "@mengai/shared";
import { Cat, CatCard, type CatSize } from "../src/index";
import { CREW, TICK_MS, frame } from "./timeline";

let reducedAtStart = false;

const destinations = [
  { id: "crew", label: "Crew", href: "#crew" },
  { id: "poses", label: "Poses", href: "#poses" },
  { id: "moods", label: "Moods", href: "#moods" },
  { id: "stills", label: "Stills", href: "#stills" },
];

type PoseKey = Activity | "stopped";
const POSES: PoseKey[] = [...ACTIVITIES, "stopped"];

const NOTE: Record<PoseKey, string> = {
  rest: "Breathes, tail sways, idle quirks",
  think: "Paw to chin, slow head tilt",
  plan: "Checks off the clipboard",
  code: "Types with alternating paws",
  run: "Terminal lines scroll",
  read: "Head follows the lines",
  review: "Magnifier sweeps the page",
  design: "Brush strokes appear",
  research: "Spyglass scan",
  scan: "Shield up, looks around",
  automate: "Moves the mouse",
  handoff: "Carries the task card",
  ask: "Paw raised, calling you",
  wait: "Tail wrapped, tip flicks",
  celebrate: "Stretches, then curls up",
  stopped: "Lies down, dimmed",
};

const MOOD_NOTE: Record<Mood, string> = {
  calm: "Relaxed eyes, the base tempo",
  focused: "Narrowed eyes, a touch faster",
  proud: "Soft eyes and a smile",
  frustrated: "Tilted lids, ears back, quicker",
  tired: "Heavy lids, drooped ears, slower",
};

const STATUS_NOTE: Record<AgentStatus, string> = {
  idle: "Rests and plays quirks",
  thinking: "Thinks it over",
  working: "Shows the tool in use",
  waiting: "Waits for a teammate",
  approval: "Ears up, asks you",
  done: "Curls up content",
  error: "Ears back, one shake",
  stopped: "Lies down, dimmed",
};

function poseStatus(p: PoseKey): AgentStatus {
  return p === "stopped" ? "stopped" : p === "rest" ? "idle" : p === "wait" ? "waiting" : p === "ask" ? "approval" : p === "celebrate" ? "done" : p === "think" ? "thinking" : "working";
}
function poseActivity(p: PoseKey): Activity {
  return p === "stopped" ? "rest" : p;
}
function poseName(p: PoseKey): string {
  return p === "stopped" ? "Stopped" : ACTIVITY_LABEL[p];
}

function Crew() {
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(!reducedAtStart);
  const [selected, setSelected] = useState(CREW[1]!.id);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [playing]);
  const cats = frame(tick);
  return (
    <Section id="crew" tone="base" labelledBy="crew-title" composition="custom" variant="crew-board">
      <SectionHead
        id="crew-title"
        title="The crew at work"
        lead="Kopi hands the settings task to Mochi, the rest cycle through every activity and mood. Pick a cat to select it."
        action={
          <button type="button" className="btn btn-secondary" aria-pressed={!playing} onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pause the timeline" : "Play the timeline"}
          </button>
        }
      />
      <div className="pv-crew kit-full">
        {cats.map((c, i) => (
          <CatCard
            key={CREW[i]!.id}
            {...c}
            interactive
            selected={selected === CREW[i]!.id}
            onSelect={() => setSelected(CREW[i]!.id)}
          />
        ))}
      </div>
    </Section>
  );
}

function PoseTile({ pose, still }: { pose: PoseKey; still?: boolean }) {
  const m = CREW[POSES.indexOf(pose) % CREW.length]!;
  const status = poseStatus(pose);
  const activity = poseActivity(pose);
  return (
    <figure className="pv-pose">
      <Cat
        look={{ coat: m.coat, seed: m.seed }}
        role={m.role}
        status={status}
        activity={activity}
        mood="calm"
        label={`${m.name}, ${ROLE_LABEL[m.role]}, ${poseName(pose).toLowerCase()}`}
        size={96}
        still={still}
      />
      {still ? null : (
        <figcaption className="pv-pose-text">
          <span className="pv-name">{poseName(pose)}</span>
          <span className="kit-meta">{NOTE[pose]}</span>
        </figcaption>
      )}
    </figure>
  );
}

function Poses() {
  return (
    <Section id="poses" tone="layer" labelledBy="poses-title" composition="custom" variant="pose-index">
      <SectionHead id="poses-title" title="A pose for every activity" lead="Each activity has its own pose, prop, and loop. The role prop sits aside while a cat rests." />
      <div className="pv-poses kit-full">
        {POSES.map((p) => (
          <PoseTile key={p} pose={p} />
        ))}
      </div>
    </Section>
  );
}

function Row({ cat, name, note }: { cat: ReactNode; name: string; note: string }) {
  return (
    <li className="pv-row">
      {cat}
      <span className="pv-row-text">
        <span className="pv-name">{name}</span>
        <span className="kit-meta">{note}</span>
      </span>
    </li>
  );
}

function MoodsAndStatuses() {
  const gray = CREW[4]!;
  return (
    <Section id="moods" tone="base" labelledBy="moods-title" composition="custom" variant="rows">
      <SectionHead id="moods-title" title="Mood and status" lead="Mood changes the face and the tempo, never the pose. Status adds its own layer on top." />
      <div className="pv-lists kit-full">
        <div className="pv-list">
          <h3 className="kit-title">Mood, while writing code</h3>
          <ul className="pv-rows">
            {MOODS.map((mood) => (
              <Row
                key={mood}
                name={mood[0]!.toUpperCase() + mood.slice(1)}
                note={MOOD_NOTE[mood]}
                cat={<Cat look={{ coat: gray.coat, seed: gray.seed }} role="engineer" status="working" activity="code" mood={mood} label={`Onde, Engineer, ${mood}`} size={64} />}
              />
            ))}
          </ul>
        </div>
        <div className="pv-list">
          <h3 className="kit-title">Status</h3>
          <ul className="pv-rows">
            {AGENT_STATUSES.map((status, i) => {
              const m = CREW[i % CREW.length]!;
              return (
                <Row
                  key={status}
                  name={STATUS_LABEL[status]}
                  note={STATUS_NOTE[status]}
                  cat={
                    <Cat
                      look={{ coat: m.coat, seed: m.seed }}
                      role={m.role}
                      status={status}
                      activity={activityForStatus(status)}
                      mood={status === "error" ? "frustrated" : "calm"}
                      label={`${m.name}, ${ROLE_LABEL[m.role]}, ${STATUS_LABEL[status].toLowerCase()}`}
                      size={64}
                    />
                  }
                />
              );
            })}
          </ul>
        </div>
      </div>
    </Section>
  );
}

const SIZES: CatSize[] = [48, 64, 96, 160];

function Sizes() {
  const m = CREW[2]!;
  const [key, setKey] = useState(0);
  return (
    <Section id="sizes" tone="layer" labelledBy="sizes-title" composition="custom" variant="size-row">
      <SectionHead
        id="sizes-title"
        title="Readable from 48 to 160"
        lead="One silhouette at every size. Tap a cat to see it react, or celebrate to play the one-shot."
        action={
          <button type="button" className="btn btn-secondary" onClick={() => setKey((k) => k + 1)}>
            Celebrate
          </button>
        }
      />
      <ul className="pv-sizes kit-full">
        {SIZES.map((size) => (
          <li key={size} className="pv-size">
            <Cat
              look={{ coat: m.coat, seed: m.seed + size }}
              role={m.role}
              status="working"
              activity="code"
              mood="focused"
              label={`${m.name}, ${ROLE_LABEL[m.role]}, writing code, ${size} pixels`}
              size={size}
              interactive
              celebrateKey={key}
            />
            <span className="kit-meta pv-num">{size} px</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Stills() {
  return (
    <Section id="stills" tone="base" labelledBy="stills-title" composition="custom" variant="still-index">
      <SectionHead id="stills-title" title="Still, for reduced motion" lead="With reduced motion or the still prop, each activity keeps a distinct pose and says what it is." />
      <div className="pv-poses kit-full">
        {POSES.map((p) => (
          <PoseTile key={p} pose={p} still />
        ))}
      </div>
    </Section>
  );
}

function Preview() {
  return (
    <Page rhythm="default" motion="none">
      <AppShell title="MengAI cats" destinations={destinations} current="crew" archetype={{ bar: "bar", labels: "all" }}>
        <Masthead
          id="top"
          variant="left"
          title="Eight cats, one crew."
          lead="Every agent is a living cat. Its pose shows what it is doing, its face shows how it is going."
          proof={
            <ul className="pv-coats" aria-label="The eight coats">
              {CREW.map((m) => (
                <li key={m.id}>
                  <Cat
                    look={{ coat: m.coat, seed: m.seed }}
                    role={m.role}
                    status="idle"
                    activity="rest"
                    mood="calm"
                    label={`${m.name}, ${ROLE_LABEL[m.role]}, ${m.coat} coat, resting`}
                    size={64}
                    interactive
                  />
                </li>
              ))}
            </ul>
          }
        />
        <Crew />
        <Poses />
        <MoodsAndStatuses />
        <Sizes />
        <Stills />
      </AppShell>
    </Page>
  );
}

/** Boots the preview. ?reduce=1 answers the reduced motion query as matching, before anything renders. */
export function start(): void {
  const params = new URLSearchParams(location.search);
  if (params.get("reduce") === "1") {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes("prefers-reduced-motion")
        ? ({ matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as unknown as MediaQueryList)
        : real(query);
  }
  reducedAtStart = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mountNode = document.getElementById("root");
  if (mountNode) createRoot(mountNode).render(<Preview />);
}
