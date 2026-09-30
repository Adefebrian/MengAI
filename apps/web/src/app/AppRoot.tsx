// The /app frame: session gate (launch token, setup, login), then every
// screen inside the JAL Core AppShell (contained scroll, island header,
// split bar with New run below 640px). Stop all, the kill switch, sits in
// the header at every width and is never moved into More.
import type { OwnerSettings, SessionDTO } from "@mengai/shared";
import { AppShell, type AppShellDestination } from "@mengai/ui";
import { EmptyState, Glyph, Notice, ProductIcon, SkeletonRows } from "@mengai/ui/src/product";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { ApiError, createApiClient, errorMessage, type ApiClient } from "../api/client";
import { consumeLaunchToken } from "../api/launch";
import { createDemoFetch } from "../demo/demoApi";
import { DEMO_LABEL } from "../demo/fixture";
import { onLinkClick, type Location, type RouteMatch } from "../router";
import { AppContext, readCatMotion, writeCatMotion, type AppContextValue, type CatMotion, type Flash } from "./context";
import { useAction, useMedia } from "./hooks";
import { RunScreen } from "./run/RunScreen";
import { AboutScreen } from "./screens/About";
import { ApprovalsScreen } from "./screens/Approvals";
import { AssetsScreen } from "./screens/Assets";
import { LocalLaunchScreen, LoginScreen, SetupScreen } from "./screens/Auth";
import { ConnectorsScreen } from "./screens/Connectors";
import { EvalsScreen } from "./screens/Evals";
import { HomeScreen } from "./screens/Home";
import { MemoryScreen } from "./screens/Memory";
import { NotFoundScreen } from "./screens/NotFound";
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

type Gate = { kind: "loading" } | { kind: "offline"; message: string } | { kind: "ready"; session: SessionDTO };

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
  const api = useMemo<ApiClient>(() => (demo ? createApiClient({ fetch: createDemoFetch() }) : createApiClient()), [demo]);
  const [gate, setGate] = useState<Gate>(demo ? { kind: "ready", session: DEMO_SESSION } : { kind: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (demo) {
      setGate({ kind: "ready", session: DEMO_SESSION });
      return;
    }
    let alive = true;
    setGate({ kind: "loading" });
    (async () => {
      try {
        // A launch token that was already used (a reopened tab, a restored
        // address) is not an outage: the session cookie still decides.
        const launched = await consumeLaunchToken(api).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 401) return null;
          throw err;
        });
        const session = launched ?? (await api.call("GET /api/session"));
        if (alive) setGate({ kind: "ready", session });
      } catch (err) {
        if (alive) setGate({ kind: "offline", message: errorMessage(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, demo, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  const onSession = useCallback((session: SessionDTO) => setGate({ kind: "ready", session }), []);

  if (gate.kind === "ready" && !gate.session.authenticated) {
    if (gate.session.mode === "local") return <LocalLaunchScreen onRetry={retry} />;
    if (gate.session.needsSetup) return <SetupScreen api={api} onDone={onSession} />;
    return <LoginScreen api={api} onDone={onSession} />;
  }

  return <Frame api={api} demo={demo} gate={gate} route={route} location={location} onRetry={retry} />;
}

function Frame({
  api,
  demo,
  gate,
  route,
  location,
  onRetry,
}: {
  api: ApiClient;
  demo: boolean;
  gate: Gate;
  route: RouteMatch<AppRouteId> | null;
  location: Location;
  onRetry: () => void;
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
  else if (gate.kind === "offline") body = <OfflinePage message={gate.message} onRetry={onRetry} />;
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

function OfflinePage({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Page>
      <h1 className="app-title">MengAI is not reachable</h1>
      <EmptyState
        icon="alertCircle"
        tone="danger"
        title="Cannot reach the MengAI server"
        action={
          <>
            <button type="button" onClick={onRetry}>
              <ProductIcon name="refresh" size={20} />
              <span>Try again</span>
            </button>
            <a className="btn btn-secondary" href="/app/runs/demo?demo=1">
              Watch the sample run
            </a>
          </>
        }
      >
        {message} On the Mac app, reopen MengAI from the menu bar. On a server, check that the API process is up.
      </EmptyState>
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

