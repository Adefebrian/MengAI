// Everything the run screen reads, in one hook: the live state (the demo
// player or the REST snapshot plus the SSE stream), the call log for usage
// per cat, the full event log for the replay of a finished run, the run
// clock, and the actions (pause, resume, stop, approve, deny, message,
// stop one cat). Mutations go through the typed client, so every one of
// them carries the CSRF header.
import { SSE_EVENT_NAME, type ApprovalDTO, type LlmCallDTO, type MengaiEvent, type RunDTO } from "@mengai/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import { setDemoClock } from "../../demo/demoApi";
import { DEMO_RUN_ID } from "../../demo/fixture";
import { playDemo, type DemoPlayer } from "../../demo/player";
import { createRunStore, emptyRunState, replay, useRunState, type EventSourceLike, type RunState } from "../../store/runStore";
import { useApp } from "../context";
import { isFinished } from "../status";

export interface RunData {
  state: RunState;
  loading: boolean;
  error: string | null;
  reload: () => void;
  isDemo: boolean;
  /** the demo waits on your answer to the approval */
  holding: boolean;
  calls: LlmCallDTO[];
  /** the whole log of a finished run, for the replay; null while loading */
  replayLog: readonly MengaiEvent[] | null;
  now: () => number;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  decide: (a: ApprovalDTO, decision: "approve" | "deny", scope: "once" | "session") => Promise<void>;
  message: (text: string) => Promise<void>;
  stopAgent: (agentId: string) => Promise<void>;
  /** cancel a task that has not started, or put a stopped one back in the queue */
  patchTask: (taskId: string, status: "queued" | "cancelled") => Promise<void>;
}

/**
 * The owner's answer to a cat's ask, as the note the engine hands to the
 * waiting cat. Only the routes the engine serves are used.
 */
export function askAnswer(a: ApprovalDTO, decision: "approve" | "deny", scope: "once" | "session"): { text: string; agentId?: string } {
  const what = a.title.trim().replace(/[.\s]+$/, "");
  const text =
    decision === "deny"
      ? `No, do not do this: ${what}.`
      : scope === "session"
        ? `Yes, go ahead: ${what}. You may do this again for the rest of this run without asking.`
        : `Yes, go ahead this once: ${what}.`;
  return a.agentId ? { text, agentId: a.agentId } : { text };
}

function withRun(state: RunState, run: Partial<RunDTO>): RunState {
  return state.run ? { ...state, run: { ...state.run, ...run } } : state;
}

/** Collects the whole event log of a finished run from the stream, then closes it. */
function useFullLog(url: string | null, open: (url: string) => EventSourceLike): MengaiEvent[] | null {
  const [log, setLog] = useState<MengaiEvent[] | null>(null);
  useEffect(() => {
    if (!url || typeof EventSource === "undefined") {
      setLog(url ? [] : null);
      return;
    }
    const got: MengaiEvent[] = [];
    const es = open(url);
    let idle: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      es.close();
      setLog([...got].sort((a, b) => a.seq - b.seq));
    };
    const arm = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(done, 900);
    };
    es.addEventListener(SSE_EVENT_NAME, (msg: MessageEvent) => {
      try {
        const e = JSON.parse(String(msg.data)) as MengaiEvent;
        if (typeof e.seq === "number") got.push(e);
      } catch {
        // a malformed frame is skipped
      }
      arm();
    });
    es.onerror = () => done();
    arm();
    return () => {
      if (idle) clearTimeout(idle);
      es.close();
    };
  }, [url, open]);
  return log;
}

export function useRunData(runId: string): RunData {
  const { api, demo } = useApp();
  const store = useMemo(() => createRunStore(emptyRunState(runId)), [runId]);
  const state = useRunState(store);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [holding, setHolding] = useState(false);
  const [calls, setCalls] = useState<LlmCallDTO[]>([]);
  const player = useRef<DemoPlayer | null>(null);
  const offset = useRef(0);
  const isDemo = demo && runId === DEMO_RUN_ID;

  useEffect(() => {
    let alive = true;
    store.reset(runId);
    setHolding(false);
    if (isDemo) {
      const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
      const atEnd = query.get("at") === "end";
      // ?from=start plays the sample from the first plan, so every beat shows live.
      const fromStart = query.get("from") === "start";
      const p = playDemo(store, {
        ...(fromStart ? { warmSeq: 0 } : {}),
        onApply: (e) => {
          offset.current = Date.now() - e.ts;
        },
        onHold: () => {
          if (alive) setHolding(true);
        },
      });
      player.current = p;
      setDemoClock(() => p.now());
      if (atEnd) p.skipTo(Number.MAX_SAFE_INTEGER);
      setLoading(false);
      setError(null);
      return () => {
        alive = false;
        p.stop();
        player.current = null;
        setDemoClock(() => Number.POSITIVE_INFINITY);
      };
    }
    const ctrl = new AbortController();
    let disconnect: (() => void) | null = null;
    setLoading(true);
    setError(null);
    api.call("GET /api/runs/:id", { params: { id: runId }, signal: ctrl.signal }).then(
      (snap) => {
        if (!alive) return;
        store.load(snap);
        setLoading(false);
        if (demo) {
          store.setState({ ...store.getState(), connection: "demo" });
          return;
        }
        if (isFinished(snap.run.status)) {
          store.setState({ ...store.getState(), connection: "closed" });
          return;
        }
        disconnect = store.connect({ url: (after) => api.url("GET /api/events", { query: { runId, after } }), factory: (u) => api.stream(u) });
      },
      (err: unknown) => {
        if (!alive || ctrl.signal.aborted) return;
        setError(errorMessage(err));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
      ctrl.abort();
      disconnect?.();
    };
  }, [store, runId, isDemo, demo, api, nonce]);

  // Stop all anywhere in the app: the demo stops in place, a real run reloads.
  useEffect(() => {
    const onKill = () => {
      if (isDemo) {
        player.current?.stop();
        const s = store.getState();
        store.setState(withRun(s, { status: "stopped", statusReason: "Stopped with Stop all", endedAt: s.log.at(-1)?.ts ?? null }));
      } else setNonce((n) => n + 1);
    };
    window.addEventListener("mengai:killswitch", onKill);
    return () => window.removeEventListener("mengai:killswitch", onKill);
  }, [isDemo, store]);

  const running = !!state.run && !isFinished(state.run.status);
  const lastSeq = state.lastSeq;

  // The call log feeds usage per cat and the energy on the board.
  useEffect(() => {
    if (!state.run) return;
    const ctrl = new AbortController();
    const load = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      api.call("GET /api/runs/:id/calls", { params: { id: runId }, signal: ctrl.signal }).then(
        (list) => setCalls(list),
        () => {},
      );
    };
    load();
    const t = running ? setInterval(load, isDemo ? 2500 : 5000) : null;
    return () => {
      ctrl.abort();
      if (t) clearInterval(t);
    };
    // Reload once more when the run ends so the totals are final.
  }, [api, runId, running, isDemo, !!state.run]);

  // A demo that jumped to the end needs its final calls too.
  useEffect(() => {
    if (isDemo && !running && lastSeq > 0) {
      api.call("GET /api/runs/:id/calls", { params: { id: runId } }).then(setCalls, () => {});
    }
  }, [api, isDemo, running, runId, lastSeq]);

  const finished = !!state.run && isFinished(state.run.status);
  const logUrl = finished && !demo ? api.url("GET /api/events", { query: { runId, after: 0 } }) : null;
  const openStream = useCallback((u: string) => api.stream(u), [api]);
  const fullLog = useFullLog(logUrl, openStream);
  const replayLog = demo ? (finished ? state.log : null) : fullLog;

  const now = useCallback(() => (isDemo ? Date.now() - offset.current : Date.now()), [isDemo]);

  const pause = useCallback(async () => {
    if (isDemo) {
      player.current?.pause();
      store.setState(withRun(store.getState(), { status: "paused", statusReason: null }));
      return;
    }
    const run = await api.call("POST /api/runs/:id/pause", { params: { id: runId } });
    store.setState(withRun(store.getState(), { status: run.status, statusReason: run.statusReason }));
  }, [api, isDemo, runId, store]);

  const resume = useCallback(async () => {
    if (isDemo) {
      store.setState(withRun(store.getState(), { status: "running", statusReason: null }));
      player.current?.resume();
      return;
    }
    const run = await api.call("POST /api/runs/:id/resume", { params: { id: runId } });
    store.setState(withRun(store.getState(), { status: run.status, statusReason: run.statusReason }));
  }, [api, isDemo, runId, store]);

  const stop = useCallback(async () => {
    if (isDemo) {
      player.current?.stop();
      const s = store.getState();
      store.setState(withRun(s, { status: "stopped", statusReason: "You stopped the run", endedAt: s.log.at(-1)?.ts ?? null }));
      return;
    }
    const run = await api.call("POST /api/runs/:id/stop", { params: { id: runId } });
    store.setState(withRun(store.getState(), { status: run.status, statusReason: run.statusReason, endedAt: run.endedAt }));
  }, [api, isDemo, runId, store]);

  const decide = useCallback(
    async (a: ApprovalDTO, decision: "approve" | "deny", scope: "once" | "session") => {
      // The sample run answers in the page. A real ask is answered the way
      // the engine takes every answer from the owner: a note to the asking
      // cat on the run (POST /api/runs/:id/message resolves the cat that is
      // waiting on you), so the page never calls a route the engine lacks.
      if (!isDemo) await api.call("POST /api/runs/:id/message", { params: { id: runId }, body: askAnswer(a, decision, scope) });
      const next = { status: decision === "approve" ? ("approved" as const) : ("denied" as const), scope, decidedAt: Date.now() };
      const s = store.getState();
      const approvals = { ...s.approvals, [a.id]: { ...(s.approvals[a.id] ?? a), status: next.status, scope: next.scope, decidedAt: next.decidedAt } };
      if (isDemo) {
        if (decision === "approve") {
          store.setState({ ...s, approvals });
          player.current?.release();
        } else {
          player.current?.stop();
          store.setState(withRun({ ...s, approvals }, { status: "stopped", statusReason: "You denied the install; this sample run ends here", endedAt: s.log.at(-1)?.ts ?? null }));
        }
        return;
      }
      store.setState({ ...s, approvals });
    },
    [api, isDemo, runId, store],
  );

  const message = useCallback(
    async (text: string) => {
      await api.call("POST /api/runs/:id/message", { params: { id: runId }, body: { text } });
    },
    [api, runId],
  );

  const stopAgent = useCallback(
    async (agentId: string) => {
      const agent = await api.call("POST /api/runs/:id/agents/:agentId/stop", { params: { id: runId, agentId } });
      const s = store.getState();
      const prev = s.agents[agentId];
      if (!prev) return;
      store.setState({ ...s, agents: { ...s.agents, [agentId]: { ...prev, status: agent.status, activity: "rest", statusText: "Stopped by you" } } });
    },
    [api, runId, store],
  );

  const patchTask = useCallback(
    async (taskId: string, status: "queued" | "cancelled") => {
      const task = await api.call("PATCH /api/runs/:id/tasks/:taskId", { params: { id: runId, taskId }, body: { status } });
      const s = store.getState();
      const prev = s.tasks[taskId];
      store.setState({ ...s, tasks: { ...s.tasks, [taskId]: prev ? { ...prev, status: task.status, updatedAt: task.updatedAt } : task } });
    },
    [api, runId, store],
  );

  return {
    state,
    loading,
    error,
    reload: () => setNonce((n) => n + 1),
    isDemo,
    holding,
    calls,
    replayLog,
    now,
    pause,
    resume,
    stop,
    decide,
    message,
    stopAgent,
    patchTask,
  };
}

/** The state at a replay position: the first `at` events of the log folded from empty. */
export function stateAt(log: readonly MengaiEvent[], at: number, runId: string): RunState {
  return replay(log.slice(0, Math.max(0, at)), emptyRunState(runId));
}
