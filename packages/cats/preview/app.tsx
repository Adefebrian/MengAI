// Cats preview: the crew board on a scripted timeline that cycles every
// scenario (each role plays its own work beats, with handoffs, a catch, an
// error, a stop, approvals, done, and a budget running low), the scenario
// index live, mood and status, the four sizes, and the reduced motion
// stills. Composed from the JAL Core kit and AppShell.
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell, Masthead, Page, Section, SectionHead } from "@mengai/ui";
import { AGENT_STATUSES, MOODS, ROLE_LABEL, STATUS_LABEL, activityForStatus, type AgentStatus, type Mood } from "@mengai/shared";
import { Cat, CatCard, type CatSize } from "../src/index";
import { CatFigure } from "../src/cat";
import { CREW, SCENARIOS, STEPS, TICK_MS, catLabel, frame, statusFor, type Scenario } from "./timeline";

let reducedAtStart = false;

const destinations = [
  { id: "crew", label: "Crew", href: "#crew" },
  { id: "scenarios", label: "Scenes", href: "#scenarios" },
  { id: "moods", label: "Moods", href: "#moods" },
  { id: "stills", label: "Stills", href: "#stills" },
];

const MOOD_NOTE: Record<Mood, string> = {
  calm: "Relaxed eyes, the base tempo",
  focused: "Narrowed eyes, a touch faster",
  proud: "Soft eyes and a smile",
  frustrated: "Tilted lids, ears back, quicker, fail stamps",
  tired: "Heavy lids, drooped ears, slower",
};

const STATUS_NOTE: Record<AgentStatus, string> = {
  idle: "Rests and plays quirks",
  thinking: "Thinks it over",
  working: "Plays its role's work beat",
  waiting: "Waits, glancing at the blocker",
  approval: "Ears up, raises the flag",
  done: "Stretches, curls up content",
  error: "Ears back, one shake, a warning",
  stopped: "Lies down, dimmed",
};

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
        lead="Kopi plans and hands the settings task to Mochi, Mochi builds and tests it for Onde to review, and the rest play their own roles. Pick a cat to select it."
        action={
          <button type="button" className="btn btn-secondary" aria-pressed={!playing} onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pause the timeline" : "Play the timeline"}
          </button>
        }
      />
      <p className="pv-step kit-full kit-meta" aria-live="polite">
        Step {(tick % STEPS) + 1} of {STEPS}
      </p>
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

/** A scenario cat. `from` alternates the scenario with its opening state, to show a transition. */
function SceneCat({ s, still, size = 96 }: { s: Scenario; still?: boolean; size?: CatSize }) {
  const m = CREW.find((c) => c.role === s.role)!;
  const [early, setEarly] = useState(Boolean(s.from) && !still && !reducedAtStart);
  useEffect(() => {
    if (!s.from || still || reducedAtStart) return;
    const timer = setTimeout(() => setEarly((e) => !e), early ? 2400 : 5200);
    return () => clearTimeout(timer);
  }, [s.from, still, early]);
  const activity = early && s.from ? s.from : s.activity;
  const status = early ? statusFor(activity) : (s.status ?? statusFor(s.activity));
  return (
    <CatFigure
      look={{ coat: m.coat, seed: m.seed }}
      role={s.role}
      status={status}
      activity={activity}
      mood={s.mood ?? "calm"}
      label={`${catLabel(m, status, activity)}: ${s.name.toLowerCase()}`}
      size={size}
      still={still}
      energy={s.energy}
    />
  );
}

/** Live: the cat, then its name and what it does. Still: the name first, the cat keeps its own label under it. */
function SceneTile({ s, still }: { s: Scenario; still?: boolean }) {
  if (still) {
    return (
      <figure className="pv-scene">
        <figcaption className="pv-scene-text">
          <span className="pv-name">{s.name}</span>
        </figcaption>
        <SceneCat s={s} still />
      </figure>
    );
  }
  return (
    <figure className="pv-scene">
      <SceneCat s={s} />
      <figcaption className="pv-scene-text">
        <span className="pv-name">{s.name}</span>
        <span className="kit-meta">{s.note}</span>
      </figcaption>
    </figure>
  );
}

function Scenarios() {
  return (
    <Section id="scenarios" tone="layer" labelledBy="scenarios-title" composition="custom" variant="scenario-index">
      <SectionHead
        id="scenarios-title"
        title="Every scenario has its own beat"
        lead="Every role plays its own work for each activity, then holds the result. At most eight cats play a full beat at once; the rest breathe and hold their pose."
      />
      <div className="pv-scenes kit-full">
        {SCENARIOS.map((s) => (
          <SceneTile key={s.key} s={s} />
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
  const gray = CREW[2]!;
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
  const m = CREW[1]!;
  const [key, setKey] = useState(0);
  return (
    <Section id="sizes" tone="layer" labelledBy="sizes-title" composition="custom" variant="size-row">
      <SectionHead
        id="sizes-title"
        title="Readable from 48 to 160"
        lead="One silhouette and one line weight at every size. Tap a cat to see it react, or celebrate to play the one-shot."
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
      <SectionHead id="stills-title" title="Still, for reduced motion" lead="With reduced motion or the still prop, every scenario keeps its own frame and says what it is." />
      <div className="pv-scenes kit-full">
        {SCENARIOS.map((s) => (
          <SceneTile key={s.key} s={s} still />
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
          lead="Every agent is a living cat. What it does shows its work, its face shows how it is going."
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
        <Scenarios />
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
