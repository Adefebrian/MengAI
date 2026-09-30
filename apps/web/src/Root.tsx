// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Top-level route split: "/" is the landing, "/app/*" is the app frame
// (the engine gate, then the crew screens). No hash carries anything: there
// is no pairing link and no launch token to forward.
import { AppRoot, type AppRouteId } from "./app/AppRoot";
import { detectDemo } from "./app/context";
import { Landing } from "./landing";
import { resolveRoute, useLocation } from "./router";

export const APP_ROUTES: ReadonlyArray<{ id: AppRouteId; path: string }> = [
  { id: "home", path: "/app" },
  { id: "run", path: "/app/runs/:id" },
  { id: "providers", path: "/app/providers" },
  { id: "connectors", path: "/app/connectors" },
  { id: "trading", path: "/app/trading" },
  { id: "approvals", path: "/app/approvals" },
  { id: "memory", path: "/app/memory" },
  { id: "skills", path: "/app/skills" },
  { id: "assets", path: "/app/assets" },
  { id: "security", path: "/app/security" },
  { id: "evals", path: "/app/evals" },
  { id: "settings", path: "/app/settings" },
  { id: "about", path: "/app/about" },
];

export function isAppPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export function Root() {
  const location = useLocation();
  if (!isAppPath(location.pathname)) return <Landing />;

  const route = resolveRoute(APP_ROUTES, location.pathname);
  return <AppRoot route={route} location={location} demo={detectDemo(location.search)} />;
}
