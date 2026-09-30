// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's own entry, loaded by index.tsx for /island only: no app
// shell, no landing, no router. Inside Tauri the page is transparent
// (html[data-surface="island"]) so only the black shape shows on the
// notch; in a browser it is the preview page (data-surface="island-preview").
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IslandApp } from "./IslandApp";
import { tauriInvoke } from "./native";

export function bootIsland(root: HTMLElement): void {
  const html = document.documentElement;
  html.dataset.surface = tauriInvoke() ? "island" : "island-preview";
  document.title = "MengAI island";
  createRoot(root).render(
    <StrictMode>
      <IslandApp />
    </StrictMode>,
  );
}
