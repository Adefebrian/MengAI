import { useEffect, useState } from "react";
import { AppShell, Bento, BentoItem } from "@mengai/ui";
import { api } from "./client";

// Every screen lives inside the JAL Core app-shell: bottom tab bar below
// 640px, top nav from 640px. Destinations here are the page sections.
const DESTINATIONS = [
  { id: "overview", label: "Overview", href: "#overview" },
  { id: "stack", label: "Stack", href: "#stack" },
  { id: "demo", label: "Demo", href: "#demo" },
];

function useCurrentSection(fallback: string): string {
  const read = () => (typeof location === "undefined" ? "" : location.hash.slice(1)) || fallback;
  const [current, setCurrent] = useState(read);
  useEffect(() => {
    const onHash = () => setCurrent(read());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return current;
}

export function App() {
  const current = useCurrentSection("overview");
  // Demo call through the typed Hono RPC client (see ./client.ts): the
  // response shape here is checked against apps/api's real route types at
  // build time, not hand-typed. Wired to a button click rather than fired on
  // mount, on purpose: this component renders in tests (App.test.tsx) and in
  // a fresh dev checkout with no API server running yet, and a real fetch
  // attempted on every render would fail noisily in both cases for no
  // benefit, since nothing in this demo depends on the result being present.
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  async function loadItemCount() {
    setLoadFailed(false);
    try {
      const res = await api.example.$get();
      const items = await res.json();
      setItemCount(items.length);
    } catch {
      // API not reachable, expected outside a full dev/deploy setup.
      setLoadFailed(true);
    }
  }

  // Section: hero. Job: say what this is. Message: one sentence. Action:
  // none. Container: plain-spacing.
  //
  // Section: stack. Job: explain what the template gives you. Message:
  // three balanced facts about the stack. Action: none. Container: bento
  // (mixed summary content, all three tiles equal shape and length).
  //
  // Section: demo. Job: prove the typed Hono client actually works. Message:
  // one action, one result. Action: run the demo call. Container: card (one
  // self-contained widget), kept out of the bento above so its button and
  // result never distort the sibling tiles' shape.
  const resultText = itemCount !== null ? `Example items: ${itemCount}` : loadFailed ? "Could not reach the API." : "";

  return (
    <AppShell title="crew" destinations={DESTINATIONS} current={current}>
      <div className="app">
      <section id="overview" className="app-hero">
        <h1>Welcome to crew</h1>
        <p>A Bun only monorepo: Hono API, React SPA bundled with Bun.build, no Vite, no Next.js.</p>
      </section>
      <Bento id="stack" className="app-bento">
        <BentoItem span="sm">
          <h2>Fast by default</h2>
          <p>Bun runs the app, builds the app, and tests the app, one runtime end to end.</p>
        </BentoItem>
        <BentoItem span="sm">
          <h2>Hardened API</h2>
          <p>Secure headers, CORS allowlist, and Redis backed rate limiting ship on day one.</p>
        </BentoItem>
        <BentoItem span="sm">
          <h2>Typed everywhere</h2>
          <p>TypeScript across apps and packages, validated env, zero plain JavaScript.</p>
        </BentoItem>
      </Bento>
      <section id="demo" className="app-demo">
        <h2>Typed RPC, proven live</h2>
        <p>Call the API through the typed Hono client and print what comes back.</p>
        <button type="button" className="btn btn-primary" onClick={loadItemCount}>
          Load example items
        </button>
        <p className="app-demo-result">{resultText}</p>
      </section>
      </div>
    </AppShell>
  );
}
