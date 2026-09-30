// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The /island page. Inside the Tauri island window (window.__TAURI_INTERNALS__
// is there) it reads the notch from island_geometry and shows the island
// alone on a transparent page, fed live by the engine it is served from.
// In a plain browser it is the development preview: a desktop-sized frame
// with the island at the top, sample data per ?state= (idle, collapsed,
// peek, expanded, shipped, failed) or the engine's live feed with
// ?state=live, and ?notch=0 for a display without a notch.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createApiClient, type ApiClient } from "../api/client";
import { connectRuntime } from "../api/connect";
import { Island, type Answered } from "./Island";
import { clearFinish, deriveModel, withOrder, type IslandLive } from "./live";
import { estimateText, type Measure } from "./machine";
import { canvasMeasure } from "./measure";
import { usePrefersReducedMotion } from "./motion";
import { NO_NOTCH_GEOMETRY, PREVIEW_GEOMETRY, detectBridge, previewBridge, type IslandBridge, type IslandGeometry } from "./native";
import { PREVIEW_STATES, previewLive, readPreviewState, type PreviewState } from "./fixture";
import { useIslandLive } from "./useIslandLive";

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

function IslandFeedView({
  api,
  bridge,
  geometry,
  initial,
  now,
  holdFinish,
  forceHover,
}: {
  api: ApiClient | null;
  bridge: IslandBridge;
  geometry: IslandGeometry;
  initial?: IslandLive;
  now?: () => number;
  /** the preview keeps a finish on screen for inspection */
  holdFinish?: boolean;
  forceHover?: boolean;
}) {
  const feed = useIslandLive({ api, initial });
  const model = useMemo(() => deriveModel(feed.live), [feed.live]);
  const prefersReduced = usePrefersReducedMotion();
  const reduced = prefersReduced || feed.motion === "off";
  const measure = useMeasure();
  const { update, refreshOrders } = feed;
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

function writeQuery(state: PreviewState | "live", notch: boolean): void {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  q.set("state", state);
  if (notch) q.delete("notch");
  else q.set("notch", "0");
  window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
}

function PreviewIsland({ state, geometry }: { state: PreviewState | "live"; geometry: IslandGeometry }) {
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
    />
  );
}

/** The development preview: the island on a desktop-sized frame, with its states one click apart. */
export function IslandPreview({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const [state, setState] = useState<PreviewState | "live">(() => readPreviewState(params.get("state")));
  const [notch, setNotch] = useState(() => params.get("notch") !== "0");
  const geometry = notch ? PREVIEW_GEOMETRY : NO_NOTCH_GEOMETRY;
  const pick = (next: PreviewState | "live") => {
    setState(next);
    writeQuery(next, notch);
  };
  const pickNotch = (next: boolean) => {
    setNotch(next);
    writeQuery(state, next);
  };
  const states: Array<PreviewState | "live"> = [...PREVIEW_STATES, "live"];
  return (
    <main className="island-preview">
      <section className="island-preview-section" aria-labelledby="island-preview-title">
        <div className="island-preview-head">
          <h1 id="island-preview-title">Mac island</h1>
          <p>
            The small black window on the MacBook notch. {state === "live" ? "This preview follows the engine live." : "This preview shows sample data."} Pick a state to see it.
          </p>
        </div>
        <div className="island-preview-screen" data-notch={notch ? "" : undefined}>
          {notch ? null : <div className="island-preview-menubar" aria-hidden="true" />}
          <PreviewIsland state={state} geometry={geometry} />
        </div>
        <div className="island-preview-controls">
          <div className="island-preview-group island-preview-states" role="group" aria-label="Island state">
            {states.map((s) => (
              <button key={s} type="button" className="btn-secondary" aria-pressed={state === s} onClick={() => pick(s)}>
                {STATE_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="island-preview-group island-preview-display" role="group" aria-label="Display">
            <button type="button" className="btn-secondary" aria-pressed={notch} onClick={() => pickNotch(true)}>
              Notch
            </button>
            <button type="button" className="btn-secondary" aria-pressed={!notch} onClick={() => pickNotch(false)}>
              No notch
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

/** The page: the island window inside Tauri, the preview anywhere else. */
export function IslandApp({ bridge, search = typeof window === "undefined" ? "" : window.location.search }: { bridge?: IslandBridge; search?: string }) {
  const b = useMemo(() => bridge ?? detectBridge(), [bridge]);
  return b.native ? <NativeIsland bridge={b} /> : <IslandPreview search={search} />;
}
