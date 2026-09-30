// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The site and the app: the landing on "/", the crew screens on "/app/*".
// Loaded by index.tsx for every path except the Mac island (/island),
// which boots its own small entry (island/boot.tsx) instead.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root";

export function bootApp(root: HTMLElement): void {
  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
