// Files (JEV: card, ui.component_recipe core.list.paths): what the crew
// changed in this run first, then every other file in the workspace, as
// one flat list of paths. A path opens the read-only viewer: beside the
// list from 1024px, in a bottom sheet below that. Nothing here can write.
import type { FileContent, FileNodeDTO } from "@mengai/shared";
import { CodeView, ProductIcon, Sheet, SkeletonRows } from "@mengai/ui/src/product";
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../api/client";
import type { RunState } from "../../store/runStore";
import { useApp } from "../context";
import { fmtBytes, fmtClock } from "../format";
import { DESKTOP_QUERY, useMedia } from "../hooks";
import { RegionHead } from "../ui";
import { changedFiles } from "./derive";

const OP_WORD = { create: "Created", update: "Changed", delete: "Deleted" } as const;
const OP_ICON = { create: "plus", update: "fileText", delete: "trash" } as const;

function flatten(nodes: FileNodeDTO[], out: FileNodeDTO[] = []): FileNodeDTO[] {
  for (const n of nodes) {
    if (n.dir) flatten(n.children ?? [], out);
    else out.push(n);
  }
  return out;
}

interface PathRow {
  path: string;
  size: number;
  op: "create" | "update" | "delete" | null;
  ts: number | null;
}

export function Files({ state, projectId, projectName }: { state: RunState; projectId: string | null; projectName: string | null }) {
  const { api } = useApp();
  const desktop = useMedia(DESKTOP_QUERY);
  const [tree, setTree] = useState<FileNodeDTO[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const changed = changedFiles(state);
  const changeKey = changed.map((c) => `${c.path}:${c.ts}`).join("|");

  useEffect(() => {
    if (!projectId) return;
    const ctrl = new AbortController();
    api.call("GET /api/projects/:id/files", { params: { id: projectId }, signal: ctrl.signal }).then(
      (t) => setTree(t),
      (err: unknown) => {
        if (!ctrl.signal.aborted) setTreeError(errorMessage(err));
      },
    );
    return () => ctrl.abort();
  }, [api, projectId, changeKey]);

  useEffect(() => {
    if (!open || !projectId) return;
    const ctrl = new AbortController();
    setFile(null);
    setFileError(null);
    api.call("GET /api/projects/:id/file", { params: { id: projectId }, query: { path: open }, signal: ctrl.signal }).then(
      (f) => setFile(f),
      (err: unknown) => {
        if (!ctrl.signal.aborted) setFileError(errorMessage(err));
      },
    );
    return () => ctrl.abort();
  }, [api, projectId, open]);

  const rows = useMemo<PathRow[]>(() => {
    const seen = new Set<string>();
    const out: PathRow[] = [];
    for (const c of changed) {
      seen.add(c.path);
      out.push({ path: c.path, size: c.bytes, op: c.op, ts: c.ts });
    }
    for (const n of flatten(tree ?? [])) {
      if (seen.has(n.path)) continue;
      out.push({ path: n.path, size: n.size, op: null, ts: null });
    }
    return out;
  }, [changeKey, tree]);

  const selected = open ?? (desktop ? (rows.find((r) => r.op !== "delete")?.path ?? null) : null);
  useEffect(() => {
    if (desktop && !open && selected) setOpen(selected);
  }, [desktop, open, selected]);

  const viewer = selected ? (
    fileError ? (
      <p className="app-empty-line" role="alert">
        {fileError}
      </p>
    ) : file && file.path === selected ? (
      <CodeView
        path={file.path}
        content={file.content}
        meta={`${fmtBytes(file.size)}${file.truncated ? ", first part only" : ""}, read only`}
        note={file.binary ? "This file is binary, so there is nothing to read here." : file.content.length === 0 ? "This file is empty." : null}
      />
    ) : (
      <SkeletonRows rows={4} label="Opening the file" />
    )
  ) : null;

  return (
    <section className="app-region app-card files" data-container="card" aria-labelledby="files-h">
      <RegionHead
        title="Files"
        id="files-h"
        meta={changed.length > 0 ? `${changed.length} changed in ${projectName ?? "the workspace"} during this run` : `Workspace ${projectName ?? ""}`.trim()}
      />
      {treeError && rows.length === 0 ? (
        <p className="app-empty-line" role="alert">
          {treeError}
        </p>
      ) : rows.length === 0 ? (
        <p className="app-empty-line">No files touched yet. Paws off the code so far.</p>
      ) : (
        <div className="files-body">
          <ul className="files-list" aria-label="Files">
            {rows.map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  className="files-row"
                  aria-pressed={selected === r.path}
                  data-selected={selected === r.path ? "" : undefined}
                  disabled={r.op === "delete"}
                  onClick={() => setOpen(r.path)}
                >
                  <span className="files-icon">
                    <ProductIcon name={r.op ? OP_ICON[r.op] : "file"} size={16} />
                  </span>
                  <span className="files-path" title={r.path}>
                    {r.path}
                  </span>
                  <span className="files-meta">
                    {r.op ? <span>{OP_WORD[r.op]}</span> : null}
                    {r.ts ? <span className="num">{fmtClock(r.ts)}</span> : null}
                    <span className="num">{fmtBytes(r.size)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {desktop ? <div className="files-viewer">{viewer}</div> : null}
        </div>
      )}
      {!desktop ? (
        <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? (open.split("/").pop() ?? open) : "File"} description="Read only">
          {viewer}
        </Sheet>
      ) : null}
    </section>
  );
}
