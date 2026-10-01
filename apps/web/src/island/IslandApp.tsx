// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The /island page. Inside the Tauri island window (window.__TAURI_INTERNALS__
// is there) it reads the notch from island_geometry and shows the island
// alone on a transparent page, fed live by the engine it is served from.
// In a plain browser it is the development preview: a desktop-sized frame
// with the island at the top, and two ways to look at it:
//   scenarios  ?scenario=<id>: one sample of every island scenario
//              (scenarios.ts), each played from t = 0 through the real
//              pipeline, its one-line description under the screen; Replay
//              plays it again, Play all tours every scenario in order with
//              Pause and Resume
//   states     ?state= (idle, collapsed, peek, expanded, shipped, failed) for
//              still sample data, or the engine's live feed with ?state=live
// plus ?notch=0 for a display without a notch and ?motion=reduced for the
// still island. Below 640 px the page is an app shell: a pinned header, the
// content scrolling on its own, and a bottom tab bar for the three panels.
// Containers (JEV ui.region_gate, verified jev-1.13.0): the screen is a card
// (0.58), the scenario list a divided section (runner-up, as plain spacing
// would repeat its neighbours), the states and display panels plain spacing
// (0.94, 0.91); all four kept (relevance 2.99, 2.99, 1.53, 1.58).
import type { MengaiEvent } from "@mengai/shared";
import { ProductIcon } from "@mengai/ui/src/product/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient, type ApiClient } from "../api/client";
import { connectRuntime } from "../api/connect";
import { Island, type Answered } from "./Island";
import { clearFinish, deriveModel, withOrder, type IslandLive } from "./live";
import { estimateText, type Measure } from "./machine";
import { canvasMeasure } from "./measure";
import { usePrefersReducedMotion } from "./motion";
import { NO_NOTCH_GEOMETRY, PREVIEW_GEOMETRY, detectBridge, previewBridge, type IslandBridge, type IslandGeometry } from "./native";
import { PREVIEW_STATES, previewLive, readPreviewState, type PreviewState } from "./fixture";
import { SCENARIOS, SCENARIO_GROUPS, findScenario, previewClock, type Scenario, type ScenarioCtx } from "./scenarios";
import { useIslandLive, type EventSink } from "./useIslandLive";
import { useIslandMoments, type IslandMoments } from "./useIslandMoments";

/** The ear font's width table: a canvas once the face is ready, the estimate before. */
function useMeasure(): Measure {
  const [measure, setMeasure] = useState<Measure>(() => (typeof document === "undefined" ? estimateText : canvasMeasure()));
  useEffect(() => {
    const fonts = typeof document !== "undefined" ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
    if (!fonts?.ready) return;
    let alive = true;
    const again = () => {
      if (alive) setMeasure(() => canvasMeasure());
    };
    void fonts.ready.then(again);
    // ready can resolve before the face is even asked for: measure again whenever a face lands
    fonts.addEventListener?.("loadingdone", again);
    return () => {
      alive = false;
      fonts.removeEventListener?.("loadingdone", again);
    };
  }, []);
  return measure;
}

/** Hands a scenario the feed's own apply; returns its cleanup. */
type Drive = (apply: (e: MengaiEvent) => void) => () => void;

function IslandFeedView({
  api,
  bridge,
  geometry,
  initial,
  now,
  holdFinish,
  forceHover,
  reducedOverride = false,
  clockEpoch = 0,
  seed,
  drive,
}: {
  api: ApiClient | null;
  bridge: IslandBridge;
  geometry: IslandGeometry;
  initial?: IslandLive;
  now?: () => number;
  /** the preview keeps a finish on screen for inspection */
  holdFinish?: boolean;
  forceHover?: boolean;
  /** the preview's Reduced switch */
  reducedOverride?: boolean;
  /** bumps when the preview's clock jumps forward */
  clockEpoch?: number;
  /** the director's seed (the preview pins it, so a scenario replays the same) */
  seed?: number;
  /** a scenario playing its events into the feed */
  drive?: Drive;
}) {
  // The moments hear every event the feed reduces; the hook comes after the model, so through a ref.
  const sink = useRef<IslandMoments | null>(null);
  const onEvent = useCallback<EventSink>((before, e, after) => sink.current?.onEvent(before, e, after), []);
  const clock = now ?? Date.now;
  const feed = useIslandLive({ api, initial, now: clock, onEvent });
  const model = useMemo(() => deriveModel(feed.live), [feed.live]);
  const prefersReduced = usePrefersReducedMotion();
  const reduced = prefersReduced || feed.motion === "off" || reducedOverride;
  const moments = useIslandMoments({ model, now: clock, quirks: !reduced, seed, epoch: clockEpoch });
  sink.current = moments;
  const measure = useMeasure();
  const { update, refreshOrders, apply } = feed;
  useEffect(() => (drive ? drive(apply) : undefined), [drive, apply]);
  const onAnswered = useCallback(
    (a: Answered) => {
      if (a.order) update((l) => withOrder(l, a.order!));
      if (a.ask.kind === "order") refreshOrders();
    },
    [update, refreshOrders],
  );
  const onFinishDone = useCallback(() => {
    if (!holdFinish) update(clearFinish);
  }, [holdFinish, update]);
  return (
    <Island
      model={model}
      geometry={geometry}
      bridge={bridge}
      api={api}
      reduced={reduced}
      forceHover={forceHover}
      measure={measure}
      now={now}
      onAnswered={onAnswered}
      onFinishDone={onFinishDone}
      moments={moments}
      clockEpoch={clockEpoch}
    />
  );
}

/** The island in its own window: the notch from the shell, the engine at the same origin. */
export function NativeIsland({ bridge, api: given }: { bridge: IslandBridge; api?: ApiClient }) {
  const [geometry, setGeometry] = useState<IslandGeometry | null>(null);
  const api = useMemo(() => given ?? createApiClient({ base: "" }), [given]);
  useEffect(() => {
    let alive = true;
    void bridge.geometry().then((g) => {
      if (alive) setGeometry(g);
    });
    return () => {
      alive = false;
    };
  }, [bridge]);
  if (!geometry) return null;
  return <IslandFeedView api={api} bridge={bridge} geometry={geometry} />;
}

const STATE_LABEL: Record<PreviewState | "live", string> = {
  idle: "Idle",
  collapsed: "Collapsed",
  peek: "Peek",
  expanded: "Expanded",
  shipped: "Shipped",
  failed: "Failed",
  live: "Live",
};

const STATE_TEXT: Record<PreviewState | "live", string> = {
  idle: "Sample data, held still: nothing runs, so the island is exactly the notch.",
  collapsed: "Sample data, held still: a run in review, mini Oyen, the ring and the stage in the ears.",
  peek: "Sample data, held still: the island open on the crew, as when your pointer rests on it.",
  expanded: "Sample data, held still: Klepon's question and a live order wait on your answer.",
  shipped: "Sample data, held still: the run shipped and the island celebrates.",
  failed: "Sample data, held still: the run failed and the island says why until you act.",
  live: "The engine's own feed, live: the island as it shows on your Mac right now.",
};

/** The scenario's director seed: pinned, so a replay picks the same quirk. */
const SCENARIO_SEED = 7;

type Choice = { kind: "state"; state: PreviewState | "live" } | { kind: "scenario"; id: string };

function readChoice(params: URLSearchParams): Choice {
  const scenario = findScenario(params.get("scenario"));
  if (scenario) return { kind: "scenario", id: scenario.id };
  return { kind: "state", state: readPreviewState(params.get("state")) };
}

function writeQuery(choice: Choice, notch: boolean, reduced: boolean): void {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  if (choice.kind === "scenario") {
    q.set("scenario", choice.id);
    q.delete("state");
  } else {
    q.set("state", choice.state);
    q.delete("scenario");
  }
  if (notch) q.delete("notch");
  else q.set("notch", "0");
  if (reduced) q.set("motion", "reduced");
  else q.delete("motion");
  window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
}

function PreviewIsland({ state, geometry, reduced }: { state: PreviewState | "live"; geometry: IslandGeometry; reduced: boolean }) {
  const bridge = useMemo(() => previewBridge(geometry), [geometry]);
  const [base, setBase] = useState<string | null>(null);
  const clock = useMemo(() => Date.now(), [state]);
  const initial = useMemo(() => (state === "live" ? undefined : previewLive(state, clock)), [state, clock]);
  const api = useMemo(() => (state === "live" && base !== null ? createApiClient({ base }) : null), [state, base]);
  useEffect(() => {
    if (state !== "live") return;
    let alive = true;
    void connectRuntime().then((c) => {
      if (alive && c.kind === "ready") setBase(c.base);
    });
    return () => {
      alive = false;
    };
  }, [state]);
  // A sample finish holds still (the clock is frozen a second after it), so each state can be looked at.
  const frozen = useCallback(() => clock + 1000, [clock]);
  return (
    <IslandFeedView
      key={`${state}:${geometry.hasNotch ? "notch" : "pill"}:${base ?? ""}`}
      api={api}
      bridge={bridge}
      geometry={geometry}
      initial={initial}
      now={state === "live" ? undefined : frozen}
      holdFinish={state !== "live"}
      forceHover={state === "peek"}
      reducedOverride={reduced}
      seed={SCENARIO_SEED}
    />
  );
}

/**
 * One scenario, played from t = 0 when it mounts (the gallery remounts it to
 * replay): its events go through the feed's own apply, stamped with a clock
 * that runs in real time and jumps forward when a step skips ahead; its
 * pointer calls go through the preview bridge like the shell's; the owner's
 * clicks and keys land on the island's real buttons.
 */
function ScenarioIsland({ scenario, geometry, reduced }: { scenario: Scenario; geometry: IslandGeometry; reduced: boolean }) {
  const [clock] = useState(() => previewClock(Date.now()));
  const [epoch, setEpoch] = useState(0);
  const bridge = useMemo(() => previewBridge(geometry), [geometry]);
  const [start] = useState(() => scenario.start(clock.now()));
  const host = useRef<HTMLDivElement | null>(null);
  const drive = useCallback<Drive>(
    (apply) => {
      const island = () => host.current?.querySelector<HTMLElement>(".island") ?? null;
      const ctx: ScenarioCtx = {
        now: clock.now,
        emit(type, data, agentId = null, taskId = null, runId) {
          start.script.at(clock.now());
          apply(start.script.emit(type, data, agentId, taskId, runId === undefined ? start.script.runId : runId));
        },
        pointer(zone, x = 0, y = 8) {
          bridge.emitPointer({ zone, x, y });
        },
        skip(ms) {
          clock.skip(ms);
          setEpoch((n) => n + 1);
        },
        press(label) {
          const buttons = [...(island()?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
          buttons.find((b) => !b.disabled && (b.textContent?.trim() === label || b.getAttribute("aria-label") === label))?.click();
        },
        tapCat() {
          island()?.querySelector<HTMLButtonElement>(".island-cat")?.click();
        },
        key(key) {
          island()?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        },
      };
      const timers = scenario.steps.map((s) => setTimeout(() => s.run(ctx), s.at));
      return () => timers.forEach(clearTimeout);
    },
    [scenario, clock, start, bridge],
  );
  return (
    <div ref={host} className="island-preview-host">
      <IslandFeedView api={null} bridge={bridge} geometry={geometry} initial={start.live} now={clock.now} clockEpoch={epoch} reducedOverride={reduced} seed={SCENARIO_SEED} drive={drive} />
    </div>
  );
}

type Panel = "scenarios" | "states" | "display";

const PANELS: ReadonlyArray<{ id: Panel; label: string; icon: "play" | "layers" | "settings" }> = [
  { id: "scenarios", label: "Scenarios", icon: "play" },
  { id: "states", label: "States", icon: "layers" },
  { id: "display", label: "Display", icon: "settings" },
];

interface Tour {
  /** which scenario of SCENARIOS plays */
  index: number;
  /** ms left on it */
  left: number;
  /** wall clock when this stretch began, null while paused */
  since: number | null;
}

/** The development preview: the island on a desktop-sized frame, every scenario and state one click apart. */
export function IslandPreview({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const [choice, setChoice] = useState<Choice>(() => readChoice(params));
  const [notch, setNotch] = useState(() => params.get("notch") !== "0");
  const [reduced, setReduced] = useState(() => params.get("motion") === "reduced");
  const [take, setTake] = useState(0);
  const [tour, setTour] = useState<Tour | null>(null);
  const [panel, setPanel] = useState<Panel>("scenarios");
  const geometry = notch ? PREVIEW_GEOMETRY : NO_NOTCH_GEOMETRY;
  const scenario = choice.kind === "scenario" ? findScenario(choice.id) : null;

  const show = useCallback(
    (next: Choice) => {
      setChoice(next);
      setTake((n) => n + 1);
      writeQuery(next, notch, reduced);
    },
    [notch, reduced],
  );
  const pick = (next: Choice) => {
    setTour(null);
    show(next);
  };
  const pickNotch = (next: boolean) => {
    setNotch(next);
    writeQuery(choice, next, reduced);
  };
  const pickMotion = (still: boolean) => {
    setReduced(still);
    writeQuery(choice, notch, still);
  };

  // The tour: each scenario for its own length, then the next; Pause holds it where it is.
  useEffect(() => {
    if (!tour || tour.since === null) return;
    const timer = setTimeout(() => {
      const index = tour.index + 1;
      const next = SCENARIOS[index];
      if (!next) {
        setTour(null);
        return;
      }
      show({ kind: "scenario", id: next.id });
      setTour({ index, left: next.ms, since: Date.now() });
    }, tour.left);
    return () => clearTimeout(timer);
  }, [tour, show]);
  const playAll = () => {
    const first = SCENARIOS[0]!;
    show({ kind: "scenario", id: first.id });
    setTour({ index: 0, left: first.ms, since: Date.now() });
  };
  const pause = () => setTour((t) => (t && t.since !== null ? { ...t, left: Math.max(0, t.left - (Date.now() - t.since)), since: null } : t));
  const resume = () => setTour((t) => (t && t.since === null ? { ...t, since: Date.now() } : t));

  const title = scenario ? scenario.title : choice.kind === "state" ? STATE_LABEL[choice.state] : "";
  const description = scenario ? scenario.description : choice.kind === "state" ? STATE_TEXT[choice.state] : "";
  const states: Array<PreviewState | "live"> = [...PREVIEW_STATES, "live"];
  return (
    <div className="island-preview kit-page" data-rhythm="tight">
      <header className="island-preview-bar">
        <h1 id="island-preview-title">Mac island</h1>
        <p>The small black window on the MacBook notch. Pick a scenario to play it, or a state to hold it still.</p>
      </header>
      <main className="island-preview-main">
        <section className="island-preview-section" aria-labelledby="island-preview-title">
          <div className="island-preview-view">
            <div className="island-preview-screen" data-notch={notch ? "" : undefined}>
              {notch ? null : <div className="island-preview-menubar" aria-hidden="true" />}
              {scenario ? (
                <ScenarioIsland key={`${scenario.id}:${take}:${notch ? "notch" : "pill"}`} scenario={scenario} geometry={geometry} reduced={reduced} />
              ) : choice.kind === "state" ? (
                <PreviewIsland key={`${choice.state}:${take}`} state={choice.state} geometry={geometry} reduced={reduced} />
              ) : null}
            </div>
            <div className="island-preview-now">
              <p className="island-preview-now-title">
                {title}
                {tour ? (
                  <span className="island-preview-now-step">
                    {" "}
                    {tour.index + 1} of {SCENARIOS.length}
                  </span>
                ) : null}
              </p>
              <p className="island-preview-now-text">{description}</p>
            </div>
            <div className="island-preview-player" role="group" aria-label="Player">
              <button type="button" className="btn-secondary" onClick={() => show(choice)}>
                <ProductIcon name="refresh" size={20} color="currentColor" />
                <span>Replay</span>
              </button>
              {!tour ? (
                <button type="button" className="btn-secondary" onClick={playAll}>
                  <ProductIcon name="play" size={20} color="currentColor" />
                  <span>Play all</span>
                </button>
              ) : tour.since !== null ? (
                <button type="button" className="btn-secondary" onClick={pause}>
                  <ProductIcon name="pause" size={20} color="currentColor" />
                  <span>Pause tour</span>
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={resume}>
                  <ProductIcon name="play" size={20} color="currentColor" />
                  <span>Resume tour</span>
                </button>
              )}
              {tour ? (
                <button type="button" className="btn-ghost" onClick={() => setTour(null)}>
                  <ProductIcon name="stop" size={20} color="currentColor" />
                  <span>Stop tour</span>
                </button>
              ) : null}
            </div>
          </div>
          <div className="island-preview-panels">
            <section className="island-preview-panel" data-panel="scenarios" data-active={panel === "scenarios" ? "" : undefined} aria-labelledby="island-preview-scenarios">
              <h2 id="island-preview-scenarios">Scenarios</h2>
              {SCENARIO_GROUPS.map((g) => (
                <div key={g.id} className="island-preview-family">
                  <h3 id={`island-preview-group-${g.id}`}>{g.title}</h3>
                  <div className="island-preview-group island-preview-scenarios" role="group" aria-labelledby={`island-preview-group-${g.id}`}>
                    {SCENARIOS.filter((s) => s.group === g.id).map((s) => (
                      <button key={s.id} type="button" className="btn-secondary" aria-pressed={scenario?.id === s.id} onClick={() => pick({ kind: "scenario", id: s.id })}>
                        {s.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
            <section className="island-preview-panel" data-panel="states" data-active={panel === "states" ? "" : undefined} aria-labelledby="island-preview-states-title">
              <h2 id="island-preview-states-title">Sample states</h2>
              <div className="island-preview-group island-preview-states" role="group" aria-label="Island state">
                {states.map((s) => (
                  <button key={s} type="button" className="btn-secondary" aria-pressed={choice.kind === "state" && choice.state === s} onClick={() => pick({ kind: "state", state: s })}>
                    {STATE_LABEL[s]}
                  </button>
                ))}
              </div>
            </section>
            <section className="island-preview-panel" data-panel="display" data-active={panel === "display" ? "" : undefined} aria-labelledby="island-preview-display-title">
              <h2 id="island-preview-display-title">Display</h2>
              <div className="island-preview-group island-preview-display" role="group" aria-label="Display">
                <button type="button" className="btn-secondary" aria-pressed={notch} onClick={() => pickNotch(true)}>
                  Notch
                </button>
                <button type="button" className="btn-secondary" aria-pressed={!notch} onClick={() => pickNotch(false)}>
                  No notch
                </button>
              </div>
              <div className="island-preview-group island-preview-motion" role="group" aria-label="Motion">
                <button type="button" className="btn-secondary" aria-pressed={!reduced} onClick={() => pickMotion(false)}>
                  Motion on
                </button>
                <button type="button" className="btn-secondary" aria-pressed={reduced} onClick={() => pickMotion(true)}>
                  Reduced
                </button>
              </div>
            </section>
          </div>
        </section>
      </main>
      <nav className="island-preview-tabs" aria-label="Preview panels">
        {PANELS.map((p) => (
          <button key={p.id} type="button" className="island-preview-tab" aria-pressed={panel === p.id} onClick={() => setPanel(p.id)}>
            <ProductIcon name={p.icon} size={20} color="currentColor" />
            <span>{p.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** The page: the island window inside Tauri, the preview anywhere else. */
export function IslandApp({ bridge, search = typeof window === "undefined" ? "" : window.location.search }: { bridge?: IslandBridge; search?: string }) {
  const b = useMemo(() => bridge ?? detectBridge(), [bridge]);
  return b.native ? <NativeIsland bridge={b} /> : <IslandPreview search={search} />;
}
