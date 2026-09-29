import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { errorMessage } from "../api/client";

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (next: T | ((prev: T | null) => T)) => void;
}

/** Load once per key, with loading, error, reload and an optimistic setter. */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, key: string): Resource<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    loader
      .current(ctrl.signal)
      .then((v) => {
        if (ctrl.signal.aborted) return;
        setDataState(v);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((next: T | ((prev: T | null) => T)) => {
    setDataState((prev) => (typeof next === "function" ? (next as (p: T | null) => T)(prev) : next));
  }, []);
  return { data, error, loading, reload, setData };
}

function mediaList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
}

/** Live media query match. */
export function useMedia(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = mediaList(query);
      if (!list) return () => {};
      list.addEventListener?.("change", onChange);
      return () => list.removeEventListener?.("change", onChange);
    },
    () => mediaList(query)?.matches ?? fallback,
    () => fallback,
  );
}

export const DESKTOP_QUERY = "(min-width: 1024px)";

/** A clock that ticks every `ms` while mounted, for "time in behaviour". */
export function useNow(ms = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
  return now;
}

/** Busy flag and error text for one async action (a button's loading and error states). */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errorMessage(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
