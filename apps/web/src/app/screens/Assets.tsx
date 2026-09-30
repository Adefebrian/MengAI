// Assets (/app/assets): images and short clips made with the owner's own
// routed media model. The visible page head was dropped by JEV (relevance
// 1.46), so the screen title is for assistive tech only. The create form
// (card) sits beside the library (divided section, JEV
// kit.media-frame.grid): every asset in a MediaFrame of one shape, the real
// file or an honest placeholder that names the subject and its state. From
// the website the file is read with the paired bearer token (api.media).
import type { AssetDTO, AssetKind } from "@mengai/shared";
import { MediaFrame } from "@mengai/ui";
import { EmptyState, ProductIcon, SkeletonRows, StatusPill } from "@mengai/ui/src/product";
import { useEffect, useState, type FormEvent } from "react";
import { useApp } from "../context";
import { fmtAgo, fmtUsd } from "../format";
import { useAction, useNow, useResource } from "../hooks";
import { JOB_STATUS } from "../status";
import { FormStatus, Page, Region, ScreenTitle, Segmented, SelectField, TextArea } from "../ui";

/** The runtime file as a src: the path on the runtime's own page, a signed blob from the website. */
function useMediaSrc(url: string | undefined): string | undefined {
  const { api } = useApp();
  const [src, setSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    setSrc(undefined);
    if (!url) return;
    const ctrl = new AbortController();
    let revoke = () => {};
    api.media(url, ctrl.signal).then(
      (m) => {
        if (ctrl.signal.aborted) return m.revoke();
        revoke = m.revoke;
        setSrc(m.src);
      },
      () => {},
    );
    return () => {
      ctrl.abort();
      revoke();
    };
  }, [api, url]);
  return src;
}

function AssetTile({ a, now, onDelete }: { a: AssetDTO; now: number; onDelete: (id: string) => void }) {
  const { api } = useApp();
  const del = useAction();
  const look = JOB_STATUS[a.status];
  const src = useMediaSrc(a.status === "done" && a.url ? a.url : undefined);
  return (
    <li className="asset-tile">
      {src && a.kind === "image" ? (
        <MediaFrame kind="image" ratio="4/3" src={src} alt={a.prompt} width={a.width ?? 1024} height={a.height ?? 1024} />
      ) : src && a.kind === "video" ? (
        <MediaFrame kind="video" ratio="4/3" src={src} alt={a.prompt} />
      ) : (
        <MediaFrame kind="placeholder" ratio="4/3" alt={a.status === "failed" ? `Not made: ${a.prompt}` : a.status === "done" ? `${a.kind === "image" ? "Image" : "Clip"}: ${a.prompt}` : `Being made: ${a.prompt}`} />
      )}
      <span className="asset-caption">
        <span className="asset-prompt" title={a.prompt}>
          {a.prompt}
        </span>
        <span className="asset-meta">
          <StatusPill tone={look.tone} icon={look.icon}>
            {look.word}
          </StatusPill>
          <span className="num">{a.model}</span>
          {a.width && a.height ? (
            <span className="num">
              {a.width} by {a.height}
            </span>
          ) : null}
          <span className="num">{fmtUsd(a.costUsd)}</span>
          <span>{fmtAgo(a.createdAt, now)}</span>
        </span>
        {a.error ? <span className="asset-error">{a.error}</span> : null}
        <button
          type="button"
          className="btn-ghost asset-delete"
          aria-busy={del.busy || undefined}
          onClick={() =>
            del.run(async () => {
              await api.call("DELETE /api/assets/:id", { params: { id: a.id } });
              onDelete(a.id);
            })
          }
        >
          <ProductIcon name="trash" size={20} />
          <span>Delete</span>
        </button>
      </span>
    </li>
  );
}

export function AssetsScreen() {
  const { api } = useApp();
  const now = useNow(60_000);
  const assets = useResource((signal) => api.call("GET /api/assets", { signal }), "assets");
  const [kind, setKind] = useState<AssetKind>("image");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<"1024x1024" | "1536x1024" | "1024x1536">("1024x1024");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const make = useAction();
  const list = assets.data ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    if (!prompt.trim()) {
      setPromptError("Describe what to make, a sentence is enough.");
      return;
    }
    void make.run(async () => {
      const a = await api.call("POST /api/assets", { body: { kind, prompt: prompt.trim(), size: kind === "image" ? size : undefined } });
      assets.setData((prev) => [a, ...(prev ?? [])]);
      setPrompt("");
      setOk(`Queued on ${a.model}. It shows up in the library when it is ready.`);
    });
  };

  return (
    <Page>
      <ScreenTitle>Assets</ScreenTitle>
      <div className="app-split assets-split">
        <div className="app-split-side assets-side">
          <Region container="card" title="Make an asset" className="app-card" meta="Made with the media model you routed under Providers, billed to your key.">
            <form className="app-form" onSubmit={submit} noValidate>
              <Segmented<AssetKind>
                legend="Kind"
                name="asset-kind"
                showLegend
                value={kind}
                options={[
                  { value: "image", label: "Image" },
                  { value: "video", label: "Clip" },
                ]}
                onChange={setKind}
              />
              <TextArea
                label="Prompt"
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  if (promptError) setPromptError(null);
                }}
                rows={3}
                maxLength={2000}
                placeholder="Empty state for a day with no sales, flat, ink on white"
                error={promptError}
                hint="Say the subject, the style and what must be legible."
              />
              {kind === "image" ? (
                <SelectField label="Size" value={size} onChange={(e) => setSize(e.target.value as typeof size)}>
                  <option value="1024x1024">Square, 1024 by 1024</option>
                  <option value="1536x1024">Wide, 1536 by 1024</option>
                  <option value="1024x1536">Tall, 1024 by 1536</option>
                </SelectField>
              ) : null}
              <div className="app-form-actions">
                <button type="submit" aria-busy={make.busy || undefined}>
                  Make it
                </button>
              </div>
              <FormStatus ok={ok} error={make.error} />
            </form>
          </Region>
        </div>
        <div className="app-split-main">
          <Region container="divided" title="Library" meta={list.length ? `${list.length} ${list.length === 1 ? "asset" : "assets"}` : undefined}>
            {assets.error ? (
              <EmptyState icon="alertCircle" tone="danger" title="Assets did not load" action={<button type="button" onClick={assets.reload}>Try again</button>}>
                {assets.error}
              </EmptyState>
            ) : assets.loading && !assets.data ? (
              <SkeletonRows rows={3} label="Loading assets" />
            ) : list.length === 0 ? (
              <p className="app-empty-line">No assets yet. Describe an image and the designer cat makes it.</p>
            ) : (
              <ul className="asset-grid">
                {list.map((a) => (
                  <AssetTile key={a.id} a={a} now={now} onDelete={(id) => assets.setData((prev) => (prev ?? []).filter((x) => x.id !== id))} />
                ))}
              </ul>
            )}
          </Region>
        </div>
      </div>
    </Page>
  );
}
