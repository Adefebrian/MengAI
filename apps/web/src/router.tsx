// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A tiny history router. One external store over window.location (read
// with useSyncExternalStore), navigate() pushes or replaces a history
// entry, and <Link> turns plain same-origin clicks into navigation while
// leaving modified clicks (new tab, download) to the browser.
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

export interface Location {
  pathname: string;
  search: string;
  hash: string;
}

const NAV_EVENT = "mengai:navigate";

function read(): Location {
  if (typeof window === "undefined") return { pathname: "/", search: "", hash: "" };
  const { pathname, search, hash } = window.location;
  return { pathname, search, hash };
}

let cache: Location = read();
function snapshot(): Location {
  const next = read();
  if (next.pathname !== cache.pathname || next.search !== cache.search || next.hash !== cache.hash) cache = next;
  return cache;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener("hashchange", onChange);
  window.addEventListener(NAV_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(NAV_EVENT, onChange);
  };
}

export function useLocation(): Location {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const url = new URL(to, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return;
  }
  const target = url.pathname + url.search + url.hash;
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (target !== current) {
    if (opts.replace) window.history.replaceState(null, "", target);
    else window.history.pushState(null, "", target);
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

export type RouteParams = Record<string, string>;

/** Match "/app/runs/:id" against a pathname. Trailing slashes are ignored. */
export function matchPath(pattern: string, pathname: string): RouteParams | null {
  const norm = (p: string) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
  const a = norm(pattern).split("/");
  const b = norm(pathname).split("/");
  if (a.length !== b.length) return null;
  const params: RouteParams = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i]!;
    const val = b[i]!;
    if (seg.startsWith(":")) {
      if (val === "") return null;
      try {
        params[seg.slice(1)] = decodeURIComponent(val);
      } catch {
        return null;
      }
    } else if (seg !== val) return null;
  }
  return params;
}

export interface RouteMatch<Id extends string> {
  id: Id;
  params: RouteParams;
}

/** First route whose pattern matches, in table order. */
export function resolveRoute<Id extends string>(routes: ReadonlyArray<{ id: Id; path: string }>, pathname: string): RouteMatch<Id> | null {
  for (const r of routes) {
    const params = matchPath(r.path, pathname);
    if (params) return { id: r.id, params };
  }
  return null;
}

/** True for a plain left click the router should handle itself. */
export function isPlainClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.defaultPrevented;
}

export function onLinkClick(e: MouseEvent<Element>, href: string, anchor: Element = e.currentTarget): void {
  const target = anchor.getAttribute("target");
  if (!isPlainClick(e as MouseEvent<HTMLAnchorElement>) || (target && target !== "_self") || anchor.hasAttribute("download")) return;
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return;
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        onLinkClick(e, href);
      }}
      {...rest}
    />
  );
}

/** Query string helpers. */
export function queryFlag(search: string, name: string): boolean {
  const v = new URLSearchParams(search).get(name);
  return v === "1" || v === "true";
}
