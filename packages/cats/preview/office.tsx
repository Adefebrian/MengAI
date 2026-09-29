// /office: the living cat company on a scripted loop, three ways. The full
// scene as the run page shows it (crew of 4, 8 or 12), the compact hero the
// landing shows, and the still scene reduced motion gets (still poses,
// instant moves, every beat as a note). One story clock drives all three;
// each scene keeps its own beat queue and reports each beat done, like the
// web store. Composed from the JAL Core kit and AppShell.
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, Masthead, Page, Section, SectionHead } from "@mengai/ui";
import { ACTIVITY_LABEL, ROLE_LABEL } from "@mengai/shared";
import type { OfficeAgent, OfficeBeat, OfficeMeeting } from "../src/office-contract";
import { OfficeScene } from "../src/office/office";
import type { Director } from "../src/office/director";
import { CREW_SIZES, LOOP_S, agentsAt, eventsBetween, meetingFrom, planAt, type CrewSize, type StoryEvent } from "./office-story";

const TICK_MS = 250;

const destinations = [
  { id: "office", label: "Office", href: "#office" },
  { id: "hero", label: "Hero", href: "#hero" },
  { id: "still", label: "Still", href: "#still" },
  { id: "cats", label: "Cats", href: "/" },
];

interface Fired {
  id: string;
  ev: StoryEvent;
}

function describe(agents: OfficeAgent[]): string {
  const lines = agents.map((a) => `${a.name}, ${ROLE_LABEL[a.role]}: ${ACTIVITY_LABEL[a.activity].toLowerCase()}`);
  return `The office, ${agents.length} cats at work. ${lines.join(". ")}.`;
}

function clock(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useStory(playing: boolean) {
  const [state, setState] = useState({ t: 0, loop: 0 });
  const [fired, setFired] = useState<Fired[]>([]);
  const [meetings, setMeetings] = useState<OfficeMeeting[]>([]);
  const last = useRef(state);
  useEffect(() => {
    last.current = state;
  }, [state]);
  const restart = () => {
    const loop = last.current.loop + 1;
    setState({ t: 0, loop });
    setFired([]);
    setMeetings([]);
  };
  const advance = (from: number, to: number, loop: number) => {
    const evs = eventsBetween(from, to);
    if (!evs.length) return;
    setFired((f) => [...f, ...evs.map((ev) => ({ id: `${loop}-${ev.key}`, ev }))].slice(-40));
    setMeetings((ms) => {
      let next = ms;
      for (const ev of evs) {
        if (ev.meetingStart) next = [...next, meetingFrom(ev.meetingStart, loop)];
        if (ev.meetingEnd) next = next.map((m) => (m.id === `${loop}-${ev.meetingEnd!.id}` ? { ...m, endedAt: Date.now(), notes: ev.meetingEnd!.notes } : m));
      }
      return next.slice(-4);
    });
  };
  useEffect(() => {
    // the first beat plays at once, so the scene opens mid-story
    advance(-1, 0.5, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const { t, loop } = last.current;
      const next = t + TICK_MS / 1000;
      if (next >= LOOP_S) {
        const n = loop + 1;
        setState({ t: 0, loop: n });
        setFired([]);
        setMeetings([]);
        return;
      }
      advance(t, next, loop);
      setState({ t: next, loop });
    }, TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
  return { ...state, fired, meetings, restart };
}

/** One scene with its own beat queue fed from the story. */
function StoryOffice(props: {
  fired: Fired[];
  agents: OfficeAgent[];
  meetings: OfficeMeeting[];
  plan: ReturnType<typeof planAt>;
  variant: "full" | "hero";
  still?: boolean;
  selectable?: boolean;
}) {
  const [beats, setBeats] = useState<OfficeBeat[]>([]);
  const [selected, setSelected] = useState<string | null>("mochi");
  const director = useRef<Director | null>(null);
  // a scene mounted mid-loop (a new crew size) starts from now, not from the loop's first beat
  const [handledSet] = useState(() => new Set(props.fired.map((f) => f.id)));
  const handled = useRef(handledSet);
  useEffect(() => {
    const fresh = props.fired.filter((f) => !handled.current.has(f.id));
    if (!fresh.length) return;
    for (const f of fresh) handled.current.add(f.id);
    const add: OfficeBeat[] = [];
    for (const f of fresh) {
      if (f.ev.beat) add.push({ ...f.ev.beat, id: f.id } as OfficeBeat);
      if (f.ev.coffee) director.current?.coffeeNow(f.ev.coffee);
    }
    if (add.length) setBeats((b) => [...b, ...add]);
  }, [props.fired]);
  const onBeatDone = useMemo(() => (id: string) => setBeats((b) => b.filter((x) => x.id !== id)), []);
  return (
    <OfficeScene
      agents={props.agents}
      meetings={props.meetings}
      beats={beats}
      onBeatDone={onBeatDone}
      plan={props.plan}
      variant={props.variant}
      still={props.still}
      selectedId={props.selectable ? selected : undefined}
      onSelect={props.selectable ? setSelected : undefined}
      label={describe(props.agents)}
      onDirector={(d) => {
        director.current = d;
      }}
    />
  );
}

/** ?only=full|hero|still renders one bare scene, for time-lapse captures. */
function captureMode(): { only: "full" | "hero" | "still" | null; size: CrewSize } {
  const q = new URLSearchParams(location.search);
  const only = q.get("only");
  const n = Number(q.get("crew"));
  return {
    only: only === "full" || only === "hero" || only === "still" ? only : null,
    size: (CREW_SIZES as readonly number[]).includes(n) ? (n as CrewSize) : 8,
  };
}

function Capture({ only, size }: { only: "full" | "hero" | "still"; size: CrewSize }) {
  const story = useStory(true);
  const agents = useStableAgents(useMemo(() => agentsAt(story.t, size), [story.t, size]));
  const plan = useStablePlan(useMemo(() => planAt(story.t), [story.t]));
  return (
    <main className={`pv-capture${only === "hero" ? " pv-hero" : ""}`}>
      <StoryOffice key={story.loop} fired={story.fired} agents={agents} meetings={story.meetings} plan={plan} variant={only === "hero" ? "hero" : "full"} still={only === "still"} selectable={only === "full"} />
    </main>
  );
}

function OfficePreview() {
  const mode = captureMode();
  if (mode.only) return <Capture only={mode.only} size={mode.size} />;
  return <OfficeStory />;
}

function OfficeStory() {
  const [playing, setPlaying] = useState(true);
  const [size, setSize] = useState<CrewSize>(8);
  const story = useStory(playing);
  const agents = useMemo(() => agentsAt(story.t, size), [story.t, size]);
  const heroAgents = useMemo(() => agentsAt(story.t, 8), [story.t]);
  const plan = useMemo(() => planAt(story.t), [story.t]);
  const stable = useStableAgents(agents);
  const heroStable = useStableAgents(heroAgents);
  const stablePlan = useStablePlan(plan);
  return (
    <Page rhythm="default" motion="none">
      <AppShell title="MengAI office" destinations={destinations} current="office" archetype={{ bar: "bar", labels: "all" }}>
        <Masthead
          id="top"
          variant="left"
          title="A cat company at work."
          lead="Every agent is a cat with its own desk. They code at their monitors, walk work over to each other, meet at the table, and ask the CEO cat when they need a yes."
        />
        <Section id="office" tone="base" labelledBy="office-title" composition="custom" variant="office-live">
          <SectionHead
            id="office-title"
            title="One company day, on a loop"
            lead="Kopi hands out the form, Tempe gets a yes, Onde sends the form back, the crew meets about it, the fix passes and goes on the board, then everyone wraps up."
            action={
              <div className="pv-office-controls">
                <button type="button" className="btn btn-secondary" aria-pressed={!playing} onClick={() => setPlaying((p) => !p)}>
                  {playing ? "Pause the story" : "Play the story"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={story.restart}>
                  Restart
                </button>
              </div>
            }
          />
          <div className="pv-office-bar kit-full">
            <div className="pv-sizes-toggle" role="group" aria-label="Crew size">
              {CREW_SIZES.map((n) => (
                <button key={n} type="button" className="btn btn-secondary" aria-pressed={size === n} onClick={() => setSize(n)}>
                  {n} cats
                </button>
              ))}
            </div>
            <p className="kit-meta pv-num pv-office-time">
              {clock(story.t)} of {clock(LOOP_S)}
            </p>
          </div>
          <div className="kit-full pv-office">
            <StoryOffice key={`full-${size}-${story.loop}`} fired={story.fired} agents={stable} meetings={story.meetings} plan={stablePlan} variant="full" selectable />
          </div>
        </Section>
        <Section id="hero" tone="layer" labelledBy="hero-title" composition="custom" variant="office-hero">
          <SectionHead id="hero-title" title="The landing hero" lead="The same day in the compact scene the landing shows beside its headline." />
          <figure className="kit-full pv-hero pv-figure">
            <StoryOffice key={`hero-${story.loop}`} fired={story.fired} agents={heroStable} meetings={story.meetings} plan={stablePlan} variant="hero" />
            <figcaption className="kit-meta">A sample crew on a scripted loop. The hero has no meeting room or pantry: the crew huddles at the easel.</figcaption>
          </figure>
        </Section>
        <Section id="still" tone="base" labelledBy="still-title" composition="custom" variant="office-still">
          <SectionHead id="still-title" title="Still, for reduced motion" lead="Every cat keeps the still pose of its activity, moves are instant, and each beat is written out under the scene." />
          <div className="kit-full pv-office">
            <StoryOffice key={`still-${story.loop}`} fired={story.fired} agents={heroStable} meetings={story.meetings} plan={stablePlan} variant="full" still />
          </div>
        </Section>
      </AppShell>
    </Page>
  );
}

/** Keeps the same array while nothing a scene reads has changed, so the scene does not re-render every tick. */
function useStableAgents(agents: OfficeAgent[]): OfficeAgent[] {
  const ref = useRef(agents);
  const key = JSON.stringify(agents.map((a) => [a.id, a.status, a.activity, a.mood, a.statusText, a.taskTitle, a.file, Math.round(a.energy * 20)]));
  const keyRef = useRef(key);
  if (keyRef.current !== key) {
    keyRef.current = key;
    ref.current = agents;
  }
  return ref.current;
}

function useStablePlan<T>(plan: T[]): T[] {
  const ref = useRef(plan);
  const key = JSON.stringify(plan);
  const keyRef = useRef(key);
  if (keyRef.current !== key) {
    keyRef.current = key;
    ref.current = plan;
  }
  return ref.current;
}

export { OfficePreview };
