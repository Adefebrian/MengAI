// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The code editor (JEV ui.region_gate card, ui.component_recipe
// core.tpl.ide 1.0 with layers an.R22 file tree 0.73 and mu.R01 line
// entrance 0.82, motion tier 1): the workspace tree beside a read-only
// editor with line numbers and the built-in highlighter. The open file
// refreshes on every file.changed for it; the lines the crew just wrote
// enter once, top to bottom, and keep a flat tonal fill for a few seconds
// while their numbers stay bold, so the change reads without color alone.
// Follow the crew (on by default) opens the file a cat is writing right
// now; picking a file yourself turns it off. The name tag says who is
// writing the open file, or who changed it last. Below 768px the tree
// folds into a disclosure above the editor. Nothing here can write.
import { Cat } from "@mengai/cats";
import type { FileContent, FileNodeDTO } from "@mengai/shared";
import { ProductIcon, SkeletonRows } from "@mengai/ui/src/product";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { errorMessage } from "../../api/client";
import type { RunState } from "../../store/runStore";
import { useApp } from "../context";
import { fmtBytes, fmtClock } from "../format";
import { useMedia } from "../hooks";
import { useMotionLevel } from "../motion";
import { RegionHead, Switch } from "../ui";
import { changedLines, highlight, langOf, type Span } from "./highlight";
import { clockOf, roleWord, toolTarget } from "./office";

const WRITE_TOOLS = new Set(["fs_write", "fs_edit", "fs_delete"]);
/** how long freshly written lines keep their tint, ms (the CSS fade matches) */
export const TINT_MS = 4200;
/** the line entrance stagger and its cap, ms */
const LINE_STAGGER = 40;
const LINE_STAGGER_CAP = 1000;
const MAX_LINES = 4000;

/** The file a cat is writing right now (a write tool in flight), newest first. */
export function writingNow(state: RunState): Record<string, string> {
  const out: Record<string, { agentId: string; ts: number }> = {};
  for (const [agentId, tool] of Object.entries(state.tools)) {
    if (!tool || !WRITE_TOOLS.has(tool.tool)) continue;
    const target = toolTarget(tool.argsPreview);
    if (!target) continue;
    const cur = out[target];
    if (!cur || tool.ts > cur.ts) out[target] = { agentId, ts: tool.ts };
  }
  return Object.fromEntries(Object.entries(out).map(([p, v]) => [p, v.agentId]));
}

/** Lockfiles, images, fonts and hidden tool folders change too, but nobody watches them being written. */
const NOT_FOLLOWED = /(\.lock|-lock\.json|lock\.yaml|\.png|\.jpe?g|\.gif|\.webp|\.ico|\.pdf|\.woff2?|\.mp4|\.webm)$|(^|\/)\.[^/]+\//i;

/** The file to open when nothing is being written: a readme or a page before anything hidden. */
function firstUseful(files: FileNodeDTO[]): string | null {
  const shown = files.filter((f) => !NOT_FOLLOWED.test(f.path) && !f.name.startsWith("."));
  const pick = (re: RegExp) => shown.find((f) => re.test(f.name))?.path;
  return pick(/^readme\.md$/i) ?? pick(/^index\.(html|tsx?|jsx?)$/i) ?? shown[0]?.path ?? files[0]?.path ?? null;
}

/** The path follow mode should show: a file being written now, else the latest change. */
export function followTarget(state: RunState): string | null {
  let best: { path: string; ts: number } | null = null;
  for (const [agentId, tool] of Object.entries(state.tools)) {
    void agentId;
    if (!tool || tool.tool === "fs_delete" || !WRITE_TOOLS.has(tool.tool)) continue;
    const target = toolTarget(tool.argsPreview);
    if (!target || NOT_FOLLOWED.test(target)) continue;
    if (!best || tool.ts > best.ts) best = { path: target, ts: tool.ts };
  }
  for (const [path, f] of Object.entries(state.files)) {
    if (f.op === "delete" || NOT_FOLLOWED.test(path)) continue;
    // same moment: the file changed later in the log wins
    if (!best || f.ts >= best.ts) best = { path, ts: f.ts };
  }
  return best?.path ?? null;
}

/** Hidden entries (.mengai, .git) sink to the end of their folder. */
function tidyTree(nodes: FileNodeDTO[]): FileNodeDTO[] {
  const hidden = (n: FileNodeDTO) => n.name.startsWith(".");
  return [...nodes]
    .sort((a, b) => Number(hidden(a)) - Number(hidden(b)))
    .map((n) => (n.children ? { ...n, children: tidyTree(n.children) } : n));
}

function flatten(nodes: FileNodeDTO[], out: FileNodeDTO[] = []): FileNodeDTO[] {
  for (const n of nodes) {
    if (n.dir) flatten(n.children ?? [], out);
    else out.push(n);
  }
  return out;
}

function parents(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

interface TreeProps {
  nodes: FileNodeDTO[];
  depth: number;
  open: string | null;
  expanded: Set<string>;
  changes: RunState["files"];
  writing: Record<string, string>;
  nameOf: (id: string) => string;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}

function TreeLevel(p: TreeProps) {
  return (
    <ul className="ide-tree-level" role={p.depth === 0 ? undefined : "group"}>
      {p.nodes.map((n) => {
        const style = { "--depth": String(p.depth) } as CSSProperties;
        if (n.dir) {
          const on = p.expanded.has(n.path);
          return (
            <li key={n.path}>
              <button type="button" className="ide-node" data-dir="" aria-expanded={on} style={style} onClick={() => p.onToggle(n.path)} title={n.path}>
                <span className="ide-node-chevron" aria-hidden="true">
                  <ProductIcon name="chevronRight" size={16} />
                </span>
                <span className="ide-node-icon" aria-hidden="true">
                  <ProductIcon name={on ? "folderOpen" : "folder"} size={16} />
                </span>
                <span className="ide-node-name">{n.name}</span>
              </button>
              {on && n.children && n.children.length > 0 ? <TreeLevel {...p} nodes={n.children} depth={p.depth + 1} /> : null}
            </li>
          );
        }
        const change = p.changes[n.path];
        const writer = p.writing[n.path];
        const selected = p.open === n.path;
        return (
          <li key={n.path}>
            <button
              type="button"
              className="ide-node"
              aria-current={selected ? "true" : undefined}
              data-selected={selected ? "" : undefined}
              style={style}
              onClick={() => p.onOpen(n.path)}
              title={n.path}
            >
              <span className="ide-node-chevron" aria-hidden="true" />
              <span className="ide-node-icon" aria-hidden="true">
                <ProductIcon name={change ? "fileText" : "file"} size={16} />
              </span>
              <span className="ide-node-name">{n.name}</span>
              {writer ? (
                <span className="ide-node-mark" data-live="">
                  <ProductIcon name="pen" size={16} />
                  <span>{p.nameOf(writer)}</span>
                </span>
              ) : change ? (
                <span className="ide-node-mark">{change.op === "create" ? "New" : "Changed"}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Line({ spans }: { spans: Span[] }) {
  if (spans.length === 0) return <>{" "}</>;
  return (
    <>
      {spans.map((s, i) =>
        s.tok ? (
          <span key={i} className={`tok-${s.tok}`}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function EditingTag({ state, path, still }: { state: RunState; path: string; still: boolean }) {
  const writerId = writingNow(state)[path];
  const writer = writerId ? state.agents[writerId] : undefined;
  const last = state.files[path];
  const lastBy = last?.by ? state.agents[last.by] : undefined;
  const cat = writer ?? lastBy;
  if (!cat) return <p className="ide-tag">Not changed during this run</p>;
  return (
    <p className="ide-tag" data-live={writer ? "" : undefined}>
      <span className="ide-tag-cat" aria-hidden="true">
        <Cat look={cat.look} role={cat.role} status={cat.status} activity={writer ? "code" : cat.activity} mood={cat.mood} label={cat.name} size={48} still={still || !writer} />
      </span>
      <span className="ide-tag-text">
        {writer ? (
          <>
            <span className="ide-tag-name">{writer.name}</span>, {roleWord(writer.role)}, is writing this file
          </>
        ) : (
          <>
            Last changed by <span className="ide-tag-name">{lastBy!.name}</span> at <span className="num">{fmtClock(last!.ts)}</span>
          </>
        )}
      </span>
    </p>
  );
}

export function CodeEditor({ state, projectId, projectName, still }: { state: RunState; projectId: string | null; projectName: string | null; still: boolean }) {
  const { api } = useApp();
  const wide = useMedia("(min-width: 768px)");
  const level = useMotionLevel();
  const [tree, setTree] = useState<FileNodeDTO[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [file, setFile] = useState<FileContent | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ path: string; lines: Set<number>; key: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [treeShown, setTreeShown] = useState(false);
  const seen = useRef(new Map<string, string>());
  const codeRef = useRef<HTMLPreElement>(null);
  const live = useRef({ files: state.files, clock: clockOf(state) });
  live.current = { files: state.files, clock: clockOf(state) };

  const writing = writingNow(state);
  const target = followTarget(state);
  const treeKey = Object.entries(state.files)
    .filter(([, f]) => f.op !== "update")
    .map(([p, f]) => `${p}:${f.op}`)
    .sort()
    .join("|");
  const version = open ? (state.files[open]?.ts ?? 0) : 0;

  // The tree, again whenever a file is created or deleted.
  useEffect(() => {
    if (!projectId) return;
    const ctrl = new AbortController();
    api.call("GET /api/projects/:id/files", { params: { id: projectId }, signal: ctrl.signal }).then(
      (t) => {
        setTree(tidyTree(t));
        setTreeError(null);
      },
      (err: unknown) => {
        if (!ctrl.signal.aborted) setTreeError(errorMessage(err));
      },
    );
    return () => ctrl.abort();
  }, [api, projectId, treeKey]);

  const files = useMemo(() => flatten(tree ?? []), [tree]);

  // Follow the crew, else open the latest change, else the first file.
  useEffect(() => {
    if (follow && target && target !== open) {
      setOpen(target);
      return;
    }
    if (!open && files.length > 0) setOpen(target ?? firstUseful(files));
  }, [follow, target, open, files]);

  // Folders open along the path of every changed file and the open one; a small tree opens whole.
  useEffect(() => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (files.length <= 40) for (const f of files) for (const d of parents(f.path)) if (!/(^|\/)\./.test(d)) next.add(d);
      for (const p of Object.keys(state.files)) for (const d of parents(p)) next.add(d);
      if (open) for (const d of parents(open)) next.add(d);
      return next.size === cur.size ? cur : next;
    });
  }, [files, treeKey, open]);

  // The open file, again on every change the crew makes to it.
  useEffect(() => {
    if (!open || !projectId) return;
    const ctrl = new AbortController();
    setFileError(null);
    api.call("GET /api/projects/:id/file", { params: { id: projectId }, query: { path: open }, signal: ctrl.signal }).then(
      (f) => {
        const before = seen.current.get(f.path);
        seen.current.set(f.path, f.content);
        setFile(f);
        if (f.binary) return;
        // A file the crew just created counts as all new; any other file needs a first version to compare with.
        const change = live.current.files[f.path];
        const justCreated = before === undefined && change?.op === "create" && live.current.clock - change.ts < 8000;
        const lines = before !== undefined && before !== f.content ? changedLines(before, f.content) : justCreated ? f.content.replace(/\n$/, "").split("\n").map((_, i) => i) : [];
        if (lines.length > 0) setFresh({ path: f.path, lines: new Set(lines), key: Date.now() });
      },
      (err: unknown) => {
        if (!ctrl.signal.aborted) setFileError(errorMessage(err));
      },
    );
    return () => ctrl.abort();
  }, [api, projectId, open, version]);

  // The tint fades; the fresh set clears when it has.
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh((f) => (f && f.key === fresh.key ? null : f)), TINT_MS);
    return () => clearTimeout(t);
  }, [fresh]);

  // Follow keeps the first new line in view, inside the editor only.
  useEffect(() => {
    if (!fresh || !follow || fresh.path !== open) return;
    const el = codeRef.current;
    const first = Math.min(...fresh.lines);
    const row = el?.querySelector<HTMLElement>(`[data-line="${first}"]`);
    if (!el || !row) return;
    const top = row.offsetTop - el.clientHeight / 3;
    el.scrollTo({ top: Math.max(0, top), behavior: level === "off" ? "auto" : "smooth" });
  }, [fresh, follow, open, level]);

  const shown = file && file.path === open ? file : null;
  const lines = useMemo(() => (shown && !shown.binary ? highlight(shown.content, langOf(shown.path)).slice(0, MAX_LINES) : []), [shown]);
  const freshHere = fresh && shown && fresh.path === shown.path ? fresh : null;
  const order = freshHere ? [...freshHere.lines].sort((a, b) => a - b) : [];
  const changedCount = Object.keys(state.files).length;
  const nameOf = (id: string) => state.agents[id]?.name ?? "A cat";
  const writerHere = open ? writing[open] : undefined;
  const lastFresh = order.length ? order[order.length - 1]! : lines.length - 1;

  const pick = (path: string) => {
    setFollow(false);
    setOpen(path);
    if (!wide) setTreeShown(false);
  };
  const toggle = (path: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const treeView =
    treeError && !tree ? (
      <p className="app-empty-line" role="alert">
        {treeError}
      </p>
    ) : !tree ? (
      <SkeletonRows rows={4} label="Reading the workspace" />
    ) : files.length === 0 ? (
      <p className="ide-tree-empty">No files yet. New files appear here as the crew writes them.</p>
    ) : (
      <nav className="ide-tree" aria-label="Workspace files">
        <TreeLevel nodes={tree} depth={0} open={open} expanded={expanded} changes={state.files} writing={writing} nameOf={nameOf} onToggle={toggle} onOpen={pick} />
      </nav>
    );

  const canvasNote = (title: string, text: string, alert = false) => (
    <div className="ide-canvas" role={alert ? "alert" : undefined}>
      <span className="ide-canvas-icon" aria-hidden="true">
        <ProductIcon name="code" size={24} />
      </span>
      <p className="ide-canvas-title">{title}</p>
      <p className="ide-canvas-text">{text}</p>
    </div>
  );

  const editor = !open ? (
    <div className="ide-editor">
      {canvasNote(
        "No file open yet",
        follow ? "Follow the crew is on, so the first file a cat writes opens here as it is written." : "Pick a file from the tree, or turn on Follow the crew.",
      )}
    </div>
  ) : (
    <div className="ide-editor">
      <div className="ide-editor-head">
        <p className="ide-path-row">
          <span className="ide-path" title={open}>
            {open}
          </span>
          <span className="ide-meta">
            {shown ? `${fmtBytes(shown.size)}${shown.truncated ? ", first part" : ""}, read only` : "Opening"}
            {freshHere ? (
              <>
                , <span className="ide-fresh-word">{freshHere.lines.size === 1 ? "1 line just changed" : `${freshHere.lines.size} lines just changed`}</span>
              </>
            ) : null}
          </span>
        </p>
        <EditingTag state={state} path={open} still={still} />
      </div>
      {fileError && !shown ? (
        canvasNote("This file did not open", fileError, true)
      ) : !shown ? (
        <div className="ide-canvas" data-loading="">
          <SkeletonRows rows={6} label="Opening the file" />
        </div>
      ) : shown.binary ? (
        canvasNote("Nothing to read here", "This file is binary: an image, a font or a lockfile.")
      ) : shown.content.length === 0 ? (
        canvasNote("This file is empty", writerHere ? `${nameOf(writerHere)} is writing it now.` : "No lines yet.")
      ) : (
        <pre className="ide-code" ref={codeRef} tabIndex={0} aria-label={`Contents of ${open}`} data-motion={level}>
          <code className="ide-lines">
            {lines.map((spans, i) => {
              const isFresh = freshHere?.lines.has(i) ?? false;
              const rank = isFresh ? order.indexOf(i) : 0;
              return (
                <span
                  key={freshHere && isFresh ? `${i}-${freshHere.key}` : i}
                  className="ide-row"
                  data-line={i}
                  data-fresh={isFresh ? "" : undefined}
                  style={isFresh ? ({ "--line-delay": `${Math.min(rank * LINE_STAGGER, LINE_STAGGER_CAP)}ms` } as CSSProperties) : undefined}
                >
                  <span className="ide-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="ide-text">
                    <Line spans={spans} />
                    {writerHere && i === lastFresh ? <span className="ide-caret" aria-hidden="true" /> : null}
                  </span>
                </span>
              );
            })}
          </code>
        </pre>
      )}
    </div>
  );

  return (
    <section className="app-region app-card ide" data-container="card" aria-labelledby="ide-h">
      <RegionHead
        title="Code"
        id="ide-h"
        meta={changedCount > 0 ? `${changedCount} ${changedCount === 1 ? "file" : "files"} changed in ${projectName ?? "the workspace"} during this run` : `Watching ${projectName ?? "the workspace"}`}
        actions={
          <span className="ide-follow">
            <Switch label="Follow the crew" checked={follow} onChange={setFollow} />
          </span>
        }
      />
      {!projectId ? (
        <p className="app-empty-line">This run has no workspace to show yet.</p>
      ) : wide ? (
        <div className="ide-body">
          <div className="ide-side">{treeView}</div>
          {editor}
        </div>
      ) : (
        <div className="ide-body">
          <button type="button" className="ide-files-toggle" aria-expanded={treeShown} onClick={() => setTreeShown((v) => !v)}>
            <span className="ide-node-icon" aria-hidden="true">
              <ProductIcon name={treeShown ? "folderOpen" : "folder"} size={20} />
            </span>
            <span className="ide-files-label">{treeShown ? "Hide files" : `Files, ${files.length}`}</span>
            <span className="ide-node-chevron" aria-hidden="true">
              <ProductIcon name="chevronDown" size={20} />
            </span>
          </button>
          {treeShown ? <div className="ide-side">{treeView}</div> : null}
          {editor}
        </div>
      )}
    </section>
  );
}
