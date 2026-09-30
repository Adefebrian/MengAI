// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island's own path. The Tauri shell opens a window labelled "island"
// on http://127.0.0.1:<engine port>/island, the engine's origin, so the API
// and the event stream work and every write carries the engine origin.
export const ISLAND_PATH = "/island";

export function isIslandPath(pathname: string): boolean {
  return pathname === ISLAND_PATH || pathname === `${ISLAND_PATH}/`;
}
