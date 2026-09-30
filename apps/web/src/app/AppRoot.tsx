// The /app frame: the runtime gate (find MengAI on this machine, pair this
// browser), then every screen inside the JAL Core AppShell (contained
// scroll, island header, split bar with New run below 640px). There are no
// accounts: the page talks to the owner's own runtime, so a runtime that is
// not running shows the onboarding, and one that is running but not paired
// shows the pairing screen, both inside the shell. Stop all, the kill
// switch, sits in the header at every width and is never moved into More.
import type { OwnerSettings, SessionDTO } from "@mengai/shared";
import { AppShell, type AppShellDestination } from "@mengai/ui";
import { Glyph, Notice, ProductIcon, SkeletonRows } from "@mengai/ui/src/product";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createApiClient, type ApiClient } from "../api/client";
import { connectRuntime, runtimeClient, takePairLink, type Connection } from "../api/connect";
import { clearSessionToken, hasPairHash, originOf, readSessionToken, runtimeLabel, type PairLink } from "../api/runtime";
import { createDemoFetch } from "../demo/demoApi";
import { DEMO_LABEL } from "../demo/fixture";
import { onLinkClick, type Location, type RouteMatch } from "../router";
import { AppContext, readCatMotion, writeCatMotion, type AppContextValue, type CatMotion, type Flash } from "./context";
import { useAction, useMedia } from "./hooks";
import { RunScreen } from "./run/RunScreen";
import { AboutScreen } from "./screens/About";
import { ApprovalsScreen } from "./screens/Approvals";
import { AssetsScreen } from "./screens/Assets";
import { ConnectorsScreen } from "./screens/Connectors";
import { EvalsScreen } from "./screens/Evals";
import { HomeScreen } from "./screens/Home";
import { MemoryScreen } from "./screens/Memory";
import { NotFoundScreen } from "./screens/NotFound";
import { PairScreen, RuntimeOfflineScreen } from "./screens/Onboarding";
import { ProvidersScreen } from "./screens/Providers";
import { SecurityScreen } from "./screens/Security";
import { SettingsScreen } from "./screens/Settings";
import { TradingScreen } from "./screens/Trading";
import { Page } from "./ui";

export type AppRouteId = "home" | "run" | "providers" | "connectors" | "trading" | "approvals" | "memory" | "assets" | "security" | "evals" | "settings" | "about";

const NAV_OF: Record<AppRouteId, string> = {
  home: "runs",
  run: "runs",
  providers: "providers",
  connectors: "connectors",
  trading: "trading",
  approvals: "approvals",
  memory: "memory",
  assets: "assets",
  security: "security",
  evals: "evals",
  settings: "settings",
  about: "about",
};

function destinations(pending: number): AppShellDestination[] {
  const icon = (name: Parameters<typeof ProductIcon>[0]["name"]) => <ProductIcon name={name} size={24} />;
  return [
    { id: "runs", label: "Runs", href: "/app", icon: icon("runs") },
    { id: "approvals", label: "Approvals", href: "/app/approvals", icon: icon("approvals"), badge: pending > 0 ? pending : undefined },
    { id: "providers", label: "Providers", href: "/app/providers", icon: icon("providers") },
    { id: "connectors", label: "Connectors", href: "/app/connectors", icon: icon("cpu") },
    { id: "trading", label: "Trading", href: "/app/trading", icon: icon("dollar") },
    { id: "memory", label: "Memory", href: "/app/memory", icon: icon("memory") },
    { id: "assets", label: "Assets", href: "/app/assets", icon: icon("assets") },
    { id: "security", label: "Security", href: "/app/security", icon: icon("security") },
    { id: "evals", label: "Evals", href: "/app/evals", icon: icon("evals") },
    { id: "settings", label: "Settings", href: "/app/settings", icon: icon("settings") },
    { id: "about", label: "About", href: "/app/about", icon: icon("infoCircle") },
  ];
}

const DEMO_SESSION: SessionDTO = { authenticated: true, mode: "local", needsSetup: false };

type Gate = { kind: "loading" } | Connection;

/** How often the onboarding and pairing screens look again on their own. */
const RECHECK_MS = 3000;

/** Plain same-origin link clicks anywhere in the app become router navigation. */
function interceptLinks(e: MouseEvent<HTMLDivElement>) {
  const target = e.target as Element | null;
  const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || !e.currentTarget.contains(a)) return;
  const href = a.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
  onLinkClick(e, href, a);
}

export function AppRoot({ route, location, demo }: { route: RouteMatch<AppRouteId> | null; location: Location; demo: boolean }) {
  const [gate, setGate] = useState<Gate>(demo ? { kind: "ready", base: "", session: DEMO_SESSION } : { kind: "loading" });
  const [pairing, setPairing] = useState(false);
  const base = gate.kind === "ready" || gate.kind === "unpaired" ? gate.base : "";
  const lost = useRef<() => void>(() => {});
  const api = useMemo<ApiClient>(
    () => (demo ? createApiClient({ fetch: createDemoFetch() }) : runtimeClient(base, { onUnauthenticated: () => lost.current() })),
    [demo, base],
  );

  const apply = useCallback((next: Connection, quiet: boolean) => {
    setGate((cur) => {
      // a quiet look again only moves the page when something changed
      if (quiet && cur.kind === next.kind && next.kind !== "ready") return cur;
      return next;
    });
  }, []);

  const check = useCallback(
    (opts: { quiet?: boolean; link?: PairLink | null } = {}) => {
      if (!opts.quiet) setGate((cur) => (cur.kind === "ready" ? cur : { kind: "loading" }));
      return connectRuntime({ link: opts.link ?? null }).then((c) => apply(c, !!opts.quiet));
    },
    [apply],
  );

  // A session the runtime no longer knows sends the page back to pairing.
  lost.current = () => setGate((cur) => (cur.kind === "ready" ? { kind: "unpaired", base: cur.base, error: "This browser's pairing ended. Pair it again from the MengAI menu.", health: null } : cur));

  useEffect(() => {
    if (demo) {
      setGate({ kind: "ready", base: "", session: DEMO_SESSION });
      return;
    }
    void check({ link: takePairLink() });
  }, [demo, check]);

  // A pairing link opened in this tab later (the menu's Open in browser on an open tab).
  useEffect(() => {
    if (demo) return;
    const onHash = () => {
      if (!hasPairHash(window.location.hash)) return;
      void check({ link: takePairLink() });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [demo, check]);

  // Offline or unpaired, the page keeps looking: every few seconds while
  // visible, and at once when another tab of this site pairs.
  const waiting = gate.kind === "offline" || gate.kind === "unpaired";
  useEffect(() => {
    if (demo || !waiting) return;
    const tick = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void check({ quiet: true });
    }, RECHECK_MS);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith("mengai.runtime")) void check({ quiet: true });
    };
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(tick);
      window.removeEventListener("storage", onStorage);
    };
  }, [demo, waiting, check]);

  const retry = useCallback(() => void check(), [check]);
  const pair = useCallback(
    (link: PairLink) => {
      setPairing(true);
      void check({ link }).finally(() => setPairing(false));
    },
    [check],
  );
  const forget = useCallback(async () => {
    const origin = originOf(base);
    try {
      if (readSessionToken(origin)) await api.call("POST /api/auth/logout");
    } catch {
      // the local copy goes either way
    }
    clearSessionToken(origin);
    await check();
  }, [api, base, check]);

  return <Frame api={api} demo={demo} gate={gate} route={route} location={location} onRetry={retry} onPair={pair} pairing={pairing} onForget={forget} />;
}

function Frame({
  api,
  demo,
  gate,
  route,
  location,
  onRetry,
  onPair,
  pairing,
  onForget,
}: {
  api: ApiClient;
  demo: boolean;
  gate: Gate;
  route: RouteMatch<AppRouteId> | null;
  location: Location;
  onRetry: () => void;
  onPair: (link: PairLink) => void;
  pairing: boolean;
  onForget: () => Promise<void>;
}) {
  const ready = gate.kind === "ready";
  const [settings, setSettings] = useState<OwnerSettings | null>(null);
  const [catMotion, setCatMotionState] = useState<CatMotion>(() => readCatMotion());
  const [flash, setFlash] = useState<Flash | null>(null);
  const [pending, setPending] = useState(0);
  const [approvalsNonce, setApprovalsNonce] = useState(0);
  const osReduced = useMedia("(prefers-reduced-motion: reduce)");
  const stopAll = useAction();

  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    api.call("GET /api/settings", { signal: ctrl.signal }).then(setSettings, () => {});
    return () => ctrl.abort();
  }, [api, ready]);

  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    const load = () =>
      api.call("GET /api/automation/approvals", { signal: ctrl.signal }).then(
        (list) => setPending(list.filter((a) => a.status === "pending").length),
        () => {},
      );
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      ctrl.abort();
      clearInterval(t);
    };
  }, [api, ready, approvalsNonce]);

  // A route change clears a flash that belonged to the last screen.
  useEffect(() => setFlash(null), [location.pathname]);

  const setCatMotion = useCallback((m: CatMotion) => {
    writeCatMotion(m);
    setCatMotionState(m);
  }, []);

  const motion: AppContextValue["motion"] = osReduced ? "off" : (settings?.motion ?? "full");
  const catsStill = motion === "off" || catMotion === "still";

  const onStopAll = () =>
    stopAll.run(async () => {
      const r = await api.call("POST /api/killswitch", { body: { by: "user" } });
      setFlash({
        tone: "success",
        title: "Everything stopped",
        text: `${r.stoppedRuns === 1 ? "1 run" : `${r.stoppedRuns} runs`} stopped and ${r.killedProcesses === 1 ? "1 process" : `${r.killedProcesses} processes`} ended. Every cat has its paws down.`,
      });
      window.dispatchEvent(new Event("mengai:killswitch"));
    });

  const notices: ReactNode = (
    <>
      {demo ? (
        <p className="app-demo-note">
          <ProductIcon name="infoCircle" size={16} />
          <span>
            {DEMO_LABEL}. Sample data only; nothing here touches a real project or a real key.{" "}
            <a href={"/app/runs/demo?demo=1&from=start"}>Watch it from the first plan</a>
          </span>
        </p>
      ) : null}
      {flash ? (
        <Notice tone={flash.tone} title={flash.title} onDismiss={() => setFlash(null)}>
          {flash.text}
        </Notice>
      ) : null}
      {stopAll.error ? (
        <Notice tone="danger" title="Stop all did not reach the server" onDismiss={() => stopAll.setError(null)}>
          {stopAll.error} Quit the Mac app or stop the server process to be sure.
        </Notice>
      ) : null}
    </>
  );

  const ctx: AppContextValue | null = ready
    ? {
        api,
        demo,
        session: gate.session,
        settings,
        setSettings,
        catMotion,
        setCatMotion,
        catsStill,
        motion,
        flash: setFlash,
        pendingApprovals: pending,
        refreshApprovals: () => setApprovalsNonce((n) => n + 1),
        notices,
        runtime: { label: demo ? "Sample data in this page" : runtimeLabel(gate.base), paired: !demo && !!readSessionToken(originOf(gate.base)) },
        forgetBrowser: onForget,
      }
    : null;

  const current = route ? NAV_OF[route.id] : "runs";
  const stopAllButton = (
    <button
      type="button"
      className="btn-secondary app-stopall"
      onClick={onStopAll}
      aria-busy={stopAll.busy || undefined}
      disabled={!ready}
      title="Stop every run now"
    >
      <ProductIcon name="stopAll" size={20} />
      <span>Stop all</span>
    </button>
  );

  let body: ReactNode;
  if (gate.kind === "loading") body = <LoadingPage />;
  else if (gate.kind === "offline") body = <RuntimeOfflineScreen tried={gate.tried} onRetry={onRetry} still={catsStill} />;
  else if (gate.kind === "unpaired") body = <PairScreen base={gate.base} error={gate.error} onRetry={onRetry} onPair={onPair} pairing={pairing} still={catsStill} />;
  else body = <Screen route={route} location={location} />;

  return (
    <div className="app-root" data-density="compact" data-motion={motion} onClickCapture={interceptLinks}>
      {/* calm keeps the moves that carry meaning; off (OS or setting) lands every beat on its final state */}
      <MotionConfig reducedMotion={motion === "off" ? "always" : "user"}>
        <AppShell
          title="MengAI"
          brand={
            <span className="app-brand">
              <img className="app-brand-logo" src="/brand/mengai-logo-192.png" alt="" width={28} height={28} decoding="async" />
              <span className="app-brand-word">MengAI</span>
            </span>
          }
          brandHref="/app"
          destinations={destinations(pending)}
          current={current}
          archetype={{ header: "island", bar: "split" }}
          scroll="contained"
          actions={stopAllButton}
          primaryAction={{ label: "New run", href: "/app#new-run", icon: <Glyph name="plus" /> }}
          moreIcon={<ProductIcon name="more" size={24} />}
        >
          {ctx ? <AppContext.Provider value={ctx}>{body}</AppContext.Provider> : body}
        </AppShell>
      </MotionConfig>
    </div>
  );
}

function LoadingPage() {
  return (
    <Page>
      <SkeletonRows rows={4} label="Waking the crew" />
    </Page>
  );
}

function Screen({ route, location }: { route: RouteMatch<AppRouteId> | null; location: Location }) {
  if (!route) return <NotFoundScreen />;
  switch (route.id) {
    case "home":
      return <HomeScreen hash={location.hash} />;
    case "run":
      return <RunScreen key={route.params.id} runId={route.params.id ?? ""} />;
    case "providers":
      return <ProvidersScreen />;
    case "connectors":
      return <ConnectorsScreen />;
    case "trading":
      return <TradingScreen />;
    case "approvals":
      return <ApprovalsScreen />;
    case "memory":
      return <MemoryScreen />;
    case "assets":
      return <AssetsScreen />;
    case "security":
      return <SecurityScreen />;
    case "evals":
      return <EvalsScreen />;
    case "settings":
      return <SettingsScreen />;
    case "about":
      return <AboutScreen />;
  }
}

