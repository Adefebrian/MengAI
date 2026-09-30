// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A server-sent events reader over fetch, for a client built on an
// injected fetch (the demo server in the page, tests) or a runtime with no
// EventSource. It has the EventSourceLike shape the run store already
// drives: named events, onopen, onerror, readyState and close. On any drop
// it closes (readyState 2) and the store reopens with after=lastSeq, so
// there is no silent retry in here.
import type { EventSourceLike } from "../store/runStore";
import type { FetchLike } from "./client";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

export interface FetchStreamInit {
  headers: Record<string, string>;
  credentials: RequestCredentials;
  fetch?: FetchLike;
}

type Listener = (e: MessageEvent) => void;

/** Parse complete SSE frames out of a text buffer; returns the unparsed tail. */
export function parseSseChunk(buffer: string, emit: (event: string, data: string, id: string | null) => void): string {
  let rest = buffer;
  for (;;) {
    const end = rest.search(/\r?\n\r?\n/);
    if (end < 0) return rest;
    const frame = rest.slice(0, end);
    const sep = rest.slice(end).match(/^\r?\n\r?\n/)?.[0].length ?? 2;
    rest = rest.slice(end + sep);
    let event = "message";
    let id: string | null = null;
    const data: string[] = [];
    for (const raw of frame.split(/\r?\n/)) {
      if (!raw || raw.startsWith(":")) continue;
      const i = raw.indexOf(":");
      const field = i < 0 ? raw : raw.slice(0, i);
      const value = i < 0 ? "" : raw.slice(i + 1).replace(/^ /, "");
      if (field === "event") event = value || "message";
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
    }
    if (data.length) emit(event, data.join("\n"), id);
  }
}

export function fetchEventSource(url: string, init: FetchStreamInit): EventSourceLike {
  const ctrl = new AbortController();
  const listeners = new Map<string, Set<Listener>>();
  const doFetch: FetchLike = init.fetch ?? ((input, req) => fetch(input, req));

  const source = {
    readyState: CONNECTING as number,
    onopen: null as EventSourceLike["onopen"],
    onerror: null as EventSourceLike["onerror"],
    addEventListener(type: string, listener: Listener) {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(listener);
    },
    close() {
      source.readyState = CLOSED;
      ctrl.abort();
    },
  };
  const self = source as unknown as EventSource;

  const fail = () => {
    if (ctrl.signal.aborted && source.readyState === CLOSED) return;
    source.readyState = CLOSED;
    source.onerror?.call(self, new Event("error"));
  };

  void (async () => {
    try {
      const res = await doFetch(url, {
        method: "GET",
        headers: { accept: "text/event-stream", ...init.headers },
        credentials: init.credentials,
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) return fail();
      source.readyState = OPEN;
      source.onopen?.call(self, new Event("open"));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer = parseSseChunk(buffer + decoder.decode(value, { stream: true }), (event, data, id) => {
          const set = listeners.get(event);
          if (!set) return;
          const msg = new MessageEvent(event, { data, lastEventId: id ?? "" });
          for (const l of set) l(msg);
        });
      }
      fail();
    } catch {
      fail();
    }
  })();

  return source;
}
