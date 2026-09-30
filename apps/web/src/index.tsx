// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The one entry index.html loads, kept tiny: it picks what this path
// boots. /island is the Mac island (a small black window on the notch,
// island/boot.tsx), with no app shell and no landing code; every other
// path boots the site and the app (main.tsx). Both are split chunks of the
// same Bun.build, so the island never downloads the app.
import { CONSOLE_CREDIT } from "./credit";
import { isIslandPath } from "./island/route";
import "./styles.css";
import "./island/island.css";

// The credit and the license, once, for anyone who opens the console.
// eslint-disable-next-line no-console
console.info(CONSOLE_CREDIT);

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

if (isIslandPath(window.location.pathname)) {
  void import("./island/boot").then((m) => m.bootIsland(root));
} else {
  void import("./main").then((m) => m.bootApp(root));
}
