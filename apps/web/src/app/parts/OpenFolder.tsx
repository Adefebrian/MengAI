// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Open folder: asks the engine to show a project's folder in Finder on
// this Mac (POST /api/projects/:id/reveal). Every state on one secondary
// button: resting, hover, focus and press from the base, loading while the
// engine answers (the label keeps its width), success as a check with the
// same label for a moment (the visible result is Finder itself; the words
// are for assistive tech), error as a danger button with the cause beside
// it.
import { ProductIcon } from "@mengai/ui/src/product";
import { useEffect, useState } from "react";
import { useApp } from "../context";
import { useAction } from "../hooks";

export function OpenFolderButton({ projectId, label = "Open folder", className }: { projectId: string; label?: string; className?: string }) {
  const { api } = useApp();
  const act = useAction();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2400);
    return () => clearTimeout(t);
  }, [done]);
  const open = () =>
    void act.run(async () => {
      setDone(false);
      await api.call("POST /api/projects/:id/reveal", { params: { id: projectId } });
      setDone(true);
    });
  const state = act.error ? "error" : done ? "success" : undefined;
  return (
    <span className={["open-folder", className].filter(Boolean).join(" ")}>
      <button type="button" className="btn-secondary" aria-busy={act.busy || undefined} data-state={state} onClick={open} title="Show this project's folder in Finder">
        <ProductIcon name={act.error ? "alertCircle" : done ? "check" : "folderOpen"} size={20} />
        <span>{label}</span>
      </button>
      <span className="p-sr-wrap">
        <span className="p-sr-only" aria-live="polite">
          {done ? "Opened in Finder" : ""}
        </span>
      </span>
      {act.error ? (
        <span className="app-form-status open-folder-error" data-tone="danger" role="alert">
          <ProductIcon name="alertCircle" size={16} />
          <span>{act.error}</span>
        </span>
      ) : null}
    </span>
  );
}
