// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Live preview of what the crew built (JEV ui.region_gate: implement 0.83,
// relevance 2.71, divided section 0.76 over plain spacing 0.15). The local
// engine runs the project's own dev script, or serves its index.html, on a
// free 127.0.0.1 port with a minimal env (no provider keys), and this
// region frames it: the state as an icon plus a word, the URL, the width
// (phone 375, tablet 768, full; the toggle shows from 640px, below that
// every width is the region's own), Reload, Open in new tab and Stop, and
// one sandboxed iframe inside a bordered stage, never wider than it. While
// the engine installs or starts it, the page asks again every second. A
// failed start shows the reason and the output tail in a disclosure; a
// project with nothing to run says why, with Open folder as the next step.
// The sample run frames the sample site as a srcdoc: a page served by the
// engine or the website refuses to be framed, by design. On a platform
// without the crew sandbox (Windows and Linux today) a dev script cannot
// run: the region stays in place with Start preview disabled, the
// coming-soon tag and one line on why; a static site previews as ever.
import type { PreviewDTO, PreviewStatus } from "@mengai/shared";
import { EmptyState, Notice, ProductIcon, SkeletonRows, StatusPill, type GlyphName, type StatusTone } from "@mengai/ui/src/product";
import { useCallback, useEffect, useId, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { DEMO_SITE_HTML } from "../../demo/site";
import { useApp } from "../context";
import type { PlatformInfo } from "../platform";
import { OpenFolderButton } from "../parts/OpenFolder";
import { FormStatus, Segmented, Soon } from "../ui";

const LOOK: Record<PreviewStatus, { tone: StatusTone; icon: GlyphName; word: string }> = {
  idle: { tone: "neutral", icon: "minusCircle", word: "Not running" },
  installing: { tone: "info", icon: "download", word: "Installing" },
  starting: { tone: "info", icon: "hourglass", word: "Starting" },
  ready: { tone: "success", icon: "checkCircle", word: "Ready" },
  stopped: { tone: "neutral", icon: "stopAll", word: "Stopped" },
  failed: { tone: "danger", icon: "xCircle", word: "Failed" },
};

export type PreviewWidth = "phone" | "tablet" | "full";

const WIDTHS: Array<{ value: PreviewWidth; label: string }> = [
  { value: "phone", label: "Phone" },
  { value: "tablet", label: "Tablet" },
  { value: "full", label: "Full" },
];

/** How often the page asks again while the engine installs or starts the preview. */
export const PREVIEW_POLL_MS = 1000;

/** Installing, starting or serving. */
export function previewRunning(p: PreviewDTO | null): boolean {
  return !!p && (p.status === "installing" || p.status === "starting" || p.status === "ready");
}

/** A dev script project on a platform that cannot run dev scripts yet (a static site still previews). */
export function scriptPreviewOff(p: PreviewDTO | null, platform: PlatformInfo): boolean {
  return !platform.features.scriptPreview && !!p && p.kind === "script" && !previewRunning(p);
}

/** The engine says there is nothing to run: no dev, start or preview script and no index.html. */
export function nothingToPreview(p: PreviewDTO | null): boolean {
  return !!p && !previewRunning(p) && p.status !== "stopped" && !!p.error && p.logTail.length === 0 && p.kind === null;
}

export interface PreviewState {
  /** null until the engine first answers */
  preview: PreviewDTO | null;
  /** this engine has no preview route, so the region and its button stay away */
  unavailable: boolean;
  loadError: string | null;
  busy: "start" | "stop" | null;
  actionError: string | null;
  start: (restart?: boolean) => Promise<void>;
  stop: () => Promise<void>;
}

function missingRoute(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}

export function usePreview(projectId: string | null): PreviewState {
  const { api } = useApp();
  const [preview, setPreview] = useState<PreviewDTO | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setUnavailable(false);
    setLoadError(null);
    if (!projectId) return;
    const ctrl = new AbortController();
    api.call("GET /api/projects/:id/preview", { params: { id: projectId }, signal: ctrl.signal }).then(
      (p) => {
        if (!ctrl.signal.aborted) setPreview(p);
      },
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        if (missingRoute(err)) setUnavailable(true);
        else setLoadError(errorMessage(err));
      },
    );
    return () => ctrl.abort();
  }, [api, projectId]);

  // Installing or starting: ask again every second until it is ready or failed.
  const pending = preview?.status === "installing" || preview?.status === "starting";
  useEffect(() => {
    if (!pending || !projectId) return;
    let alive = true;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      timer = setTimeout(() => {
        api
          .call("GET /api/projects/:id/preview", { params: { id: projectId }, signal: ctrl.signal })
          .then(
            (p) => {
              if (alive) setPreview(p);
            },
            () => {},
          )
          .finally(() => {
            if (alive) tick();
          });
      }, PREVIEW_POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [api, projectId, pending]);

  const start = useCallback(
    async (restart = false) => {
      if (!projectId) return;
      setBusy("start");
      setActionError(null);
      try {
        setPreview(await api.call("POST /api/projects/:id/preview", { params: { id: projectId }, body: restart ? { restart: true } : {} }));
      } catch (err) {
        if (missingRoute(err)) setUnavailable(true);
        else setActionError(errorMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [api, projectId],
  );

  const stop = useCallback(async () => {
    if (!projectId) return;
    setBusy("stop");
    setActionError(null);
    try {
      setPreview(await api.call("DELETE /api/projects/:id/preview", { params: { id: projectId } }));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [api, projectId]);

  return { preview, unavailable, loadError, busy, actionError, start, stop };
}

/** The output tail, closed until asked for. */
function OutputLog({ lines }: { lines: string[] }) {
  return (
    <details className="preview-log">
      <summary className="preview-log-summary">
        <span className="preview-log-chevron">
          <ProductIcon name="chevronRight" size={16} />
        </span>
        {lines.length === 1 ? (
          <span>Output, the last line</span>
        ) : (
          <span>
            Output, the last <span className="tnum">{lines.length}</span> lines
          </span>
        )}
      </summary>
      <pre className="preview-log-text" tabIndex={0} aria-label="Dev server output">
        {lines.join("\n")}
      </pre>
    </details>
  );
}

export function PreviewRegion({
  state,
  projectId,
  projectName,
  shipped,
  onHide,
}: {
  state: PreviewState;
  projectId: string;
  projectName: string | null;
  shipped: boolean;
  /** before the run ships, the region can be put away again once it is not running */
  onHide?: () => void;
}) {
  const { demo, platform } = useApp();
  const hid = useId();
  const soonId = useId();
  const [width, setWidth] = useState<PreviewWidth>("full");
  const [nonce, setNonce] = useState(0);
  const p = state.preview;
  const status: PreviewStatus = p?.status ?? "idle";
  const look = LOOK[status];
  const running = previewRunning(p);
  const nothing = nothingToPreview(p);
  const off = scriptPreviewOff(p, platform);
  const ready = status === "ready" && !!p?.url;
  const name = projectName ?? "the project";
  const how = p?.kind === "static" ? `Serves the index.html of ${name}` : `Runs ${p?.command ?? "the dev server"} in ${name}`;

  const meta = nothing
    ? "The project's own dev script, or its index.html, runs right here once there is one."
    : off
      ? `${name} previews through ${p?.command ?? "its dev script"}.`
      : running || status === "failed"
        ? `${how}, on ${platform.machine}, with no keys in its environment.`
        : shipped
          ? "The crew shipped it. Click through it right here before anything else."
          : `What the crew has built so far, run from the project folder on ${platform.machine}.`;

  let body;
  if (!p && state.loadError) {
    body = (
      <p className="app-empty-line" role="alert">
        The preview did not answer: {state.loadError}
      </p>
    );
  } else if (!p) {
    body = <SkeletonRows rows={1} label="Checking the preview" />;
  } else if (nothing) {
    body = (
      <EmptyState icon="folder" title="Nothing to preview yet" action={<OpenFolderButton projectId={projectId} />}>
        {p.error}
      </EmptyState>
    );
  } else if (off) {
    body = (
      <>
        <Soon feature="scriptPreview" id={soonId} />
        <div className="app-form-actions">
          <button type="button" disabled aria-describedby={soonId}>
            <ProductIcon name="play" size={20} />
            <span>Start preview</span>
          </button>
          <OpenFolderButton projectId={projectId} />
          {onHide ? (
            <button type="button" className="btn-ghost" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
      </>
    );
  } else if (status === "failed") {
    body = (
      <>
        <Notice tone="danger" title="The preview did not start">
          {p.error ?? "The dev server stopped before it served a page."}
        </Notice>
        {p.logTail.length ? <OutputLog lines={p.logTail} /> : null}
        <div className="app-form-actions">
          <button type="button" aria-busy={state.busy === "start" || undefined} onClick={() => void state.start(true)}>
            <ProductIcon name="refresh" size={20} />
            <span>Try again</span>
          </button>
          <OpenFolderButton projectId={projectId} />
          {onHide ? (
            <button type="button" className="btn-ghost" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
        <FormStatus error={state.actionError} />
      </>
    );
  } else if (!running) {
    body = (
      <>
        <div className="app-form-actions">
          <button type="button" aria-busy={state.busy === "start" || undefined} onClick={() => void state.start(status === "stopped")}>
            <ProductIcon name="play" size={20} />
            <span>{status === "stopped" ? "Start again" : "Start preview"}</span>
          </button>
          <OpenFolderButton projectId={projectId} />
          {onHide ? (
            <button type="button" className="btn-ghost" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
        <FormStatus error={state.actionError} />
      </>
    );
  } else {
    body = (
      <>
        <div className="preview-bar">
          <span className="preview-url num" title={p.url ?? undefined}>
            {p.url ?? (status === "installing" ? "Installing the packages first" : "Waiting for the dev server")}
          </span>
          <div className="preview-widths">
            <Segmented<PreviewWidth> legend="Preview width" name="preview-width" value={width} options={WIDTHS} onChange={setWidth} />
          </div>
          <div className="preview-tools">
            <button type="button" className="btn-secondary" disabled={!ready} onClick={() => setNonce((n) => n + 1)}>
              <ProductIcon name="refresh" size={20} />
              <span>Reload</span>
            </button>
            {ready ? (
              <a className="btn btn-secondary" href={p.url!} target="_blank" rel="noopener noreferrer">
                Open in new tab
              </a>
            ) : (
              <a className="btn btn-secondary" aria-disabled="true">
                Open in new tab
              </a>
            )}
            <button type="button" className="btn-secondary" aria-busy={state.busy === "stop" || undefined} onClick={() => void state.stop()}>
              <ProductIcon name="stop" size={20} />
              <span>Stop</span>
            </button>
          </div>
        </div>
        <div className="preview-stage">
          <div className="preview-frame" data-width={width}>
            {ready ? (
              <iframe
                key={`${p.url}:${nonce}`}
                className="preview-iframe"
                src={p.url!}
                srcDoc={demo ? DEMO_SITE_HTML : undefined}
                title={`Live preview of ${name}`}
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="preview-wait" role="status">
                <ProductIcon name={look.icon} size={24} />
                <span>{status === "installing" ? "Installing the project's packages" : "Starting the dev server"}</span>
              </div>
            )}
          </div>
        </div>
        {p.logTail.length ? <OutputLog lines={p.logTail} /> : null}
        <FormStatus error={state.actionError} />
      </>
    );
  }

  return (
    <section className="app-region run-preview" data-container="divided" aria-labelledby={hid} id="preview">
      <div className="app-region-head" data-actions={p && !nothing ? "" : undefined}>
        <div className="app-region-text">
          <h2 className="app-h2" id={hid}>
            Live preview
          </h2>
          <p className="app-region-meta">{meta}</p>
        </div>
        {p && !nothing ? (
          <div className="app-region-actions">
            <StatusPill tone={look.tone} icon={look.icon}>
              {look.word}
            </StatusPill>
          </div>
        ) : null}
      </div>
      {body}
    </section>
  );
}
