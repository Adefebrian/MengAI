// /office: the living cat company on a scripted loop, three ways, in two
// companies (a software studio and a hedge fund trading floor). The full
// scene as the run page shows it (crew of 4, 8 or 12), the compact hero the
// landing shows, and the still scene reduced motion gets (still poses,
// instant moves, every beat as a note). One story clock drives all three;
// each scene keeps its own beat queue and reports each beat done, like the
// web store. Composed from the JAL Core kit and AppShell.
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, Page, Section, SectionHead } from "@mengai/ui";
import { ACTIVITY_LABEL, ROLE_LABEL } from "@mengai/shared";
import type { OfficeAgent, OfficeBeat, OfficeMeeting } from "../src/office-contract";
import { OfficeScene } from "../src/office/office";
import type { Director } from "../src/office/director";
import { CREW_SIZES, LOOP_S, agentsAt, eventsBetween, hourAt, meetingFrom, planAt, type CrewSize, type StoryEvent, type Theme } from "./office-story";

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

const THEMES: Array<{ id: Theme; label: string }> = [
  { id: "studio", label: "Studio" },
  { id: "fund", label: "Fund" },
];

function useStory(playing: boolean, theme: Theme, at = 0) {
  const [state, setState] = useState({ t: at, loop: 0 });
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
    const evs = eventsBetween(from, to, theme);
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
    // a capture that starts later in the day: the meeting already in session is running
    if (at > 0) {
      const before = eventsBetween(-1, Math.max(0, at - 1.5), theme);
      const open = before.filter((e) => e.meetingStart && !before.some((x) => x.meetingEnd?.id === e.meetingStart!.id));
      if (open.length) setMeetings(open.map((e) => meetingFrom(e.meetingStart!, 0)));
    }
    // the first beat plays at once, so the scene opens mid-story
    advance(at > 0 ? at - 1.5 : -1, at + 0.5, 0);
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
  theme: Theme;
  /** the story clock, 0 to 24 */
  hour: number;
  still?: boolean;
  selectable?: boolean;
}) {
  const [beats, setBeats] = useState<OfficeBeat[]>([]);
  const [selected, setSelected] = useState<string | null>("belang");
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
      if (f.ev.nap) director.current?.napNow(f.ev.nap);
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
      theme={props.theme}
      hour={props.hour}
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

/** ?only=full|hero|still renders one bare scene, for time-lapse captures; ?theme=fund and ?crew=4|8|12 pick the company, ?at=seconds starts the day later. */
function captureMode(): { only: "full" | "hero" | "still" | null; size: CrewSize; theme: Theme; at: number } {
  const q = new URLSearchParams(location.search);
  const only = q.get("only");
  const n = Number(q.get("crew"));
  return {
    only: only === "full" || only === "hero" || only === "still" ? only : null,
    size: (CREW_SIZES as readonly number[]).includes(n) ? (n as CrewSize) : 8,
    theme: q.get("theme") === "fund" ? "fund" : "studio",
    at: Math.max(0, Math.min(LOOP_S - 1, Number(q.get("at")) || 0)),
  };
}

function Capture({ only, size, theme, at }: { only: "full" | "hero" | "still"; size: CrewSize; theme: Theme; at: number }) {
  const story = useStory(true, theme, at);
  const agents = useStableAgents(useMemo(() => agentsAt(story.t, size, theme), [story.t, size, theme]));
  const plan = useStablePlan(useMemo(() => planAt(story.t, theme), [story.t, theme]));
  return (
    <main className={`pv-capture${only === "hero" ? " pv-hero" : ""}`}>
      <StoryOffice key={story.loop} fired={story.fired} agents={agents} meetings={story.meetings} plan={plan} variant={only === "hero" ? "hero" : "full"} theme={theme} hour={hourAt(story.t)} still={only === "still"} selectable={only === "full"} />
    </main>
  );
}

function OfficePreview() {
  const mode = captureMode();
  if (mode.only) return <Capture only={mode.only} size={mode.size} theme={mode.theme} at={mode.at} />;
  return <OfficeStory initialTheme={mode.theme} initialSize={mode.size} />;
}

function OfficeStory({ initialTheme, initialSize }: { initialTheme: Theme; initialSize: CrewSize }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  return <OfficeDay key={theme} theme={theme} setTheme={setTheme} initialSize={initialSize} />;
}

function OfficeDay({ theme, setTheme, initialSize }: { theme: Theme; setTheme: (t: Theme) => void; initialSize: CrewSize }) {
  const [playing, setPlaying] = useState(true);
  const [size, setSize] = useState<CrewSize>(initialSize);
  const story = useStory(playing, theme);
  const agents = useMemo(() => agentsAt(story.t, size, theme), [story.t, size, theme]);
  const heroAgents = useMemo(() => agentsAt(story.t, 8, theme), [story.t, theme]);
  const plan = useMemo(() => planAt(story.t, theme), [story.t, theme]);
  const stable = useStableAgents(agents);
  const heroStable = useStableAgents(heroAgents);
  const stablePlan = useStablePlan(plan);
  return (
    <Page rhythm="default" motion="none">
      <AppShell title="MengAI office" destinations={destinations} current="office" archetype={{ bar: "bar", labels: "all" }}>
        {/* the floor leads the page: its heading, the story controls, the company toolbar, then the scene in the first viewport */}
        <Section id="office" tone="base" labelledBy="office-title" composition="custom" variant="office-live">
          <div className="kit-head pv-office-head" data-layout="split">
            <h1 id="office-title" className="kit-heading">
              A cat company at work
            </h1>
            <p className="kit-lead">
              {theme === "fund"
                ? "One trading day on a loop. Oyen hands out the backtest, Tempe finds a lookahead bias, Moci walks out, Belo joins the desk, the risk committee meets, the fix passes and the target rings the bell."
                : "One company day on a loop. Oyen hands out the form, Tompel gets a yes, Tempe sends the form back, Moci walks out, Belo is hired, the crew meets, the fix passes and goes on the board."}
            </p>
            <div className="kit-head-action pv-office-controls">
              <button type="button" className="btn btn-secondary" aria-pressed={!playing} onClick={() => setPlaying((p) => !p)}>
                {playing ? "Pause the story" : "Play the story"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={story.restart}>
                Restart
              </button>
            </div>
          </div>
          <div className="pv-office-bar kit-full">
            <div className="pv-sizes-toggle" role="group" aria-label="Company">
              {THEMES.map((th) => (
                <button key={th.id} type="button" className="btn btn-secondary" aria-pressed={theme === th.id} onClick={() => setTheme(th.id)}>
                  {th.label}
                </button>
              ))}
            </div>
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
            <StoryOffice key={`full-${size}-${story.loop}`} fired={story.fired} agents={stable} meetings={story.meetings} plan={stablePlan} variant="full" theme={theme} hour={hourAt(story.t)} selectable />
          </div>
        </Section>
        <Section id="hero" tone="layer" labelledBy="hero-title" composition="custom" variant="office-hero">
          <SectionHead id="hero-title" title="The landing hero" lead="The same day in the compact scene the landing shows beside its headline." />
          <figure className="kit-full pv-hero pv-figure">
            <StoryOffice key={`hero-${story.loop}`} fired={story.fired} agents={heroStable} meetings={story.meetings} plan={stablePlan} variant="hero" theme={theme} hour={hourAt(story.t)} />
            <figcaption className="kit-meta">A sample crew on a scripted loop. The hero has no meeting room or pantry: the crew huddles at the plan board.</figcaption>
          </figure>
        </Section>
        <Section id="still" tone="base" labelledBy="still-title" composition="custom" variant="office-still">
          <SectionHead id="still-title" title="Still, for reduced motion" lead="Every cat keeps the still pose of its activity, moves are instant, and each beat is written out under the scene." />
          <div className="kit-full pv-office">
            <StoryOffice key={`still-${story.loop}`} fired={story.fired} agents={heroStable} meetings={story.meetings} plan={stablePlan} variant="full" theme={theme} hour={hourAt(story.t)} still />
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
