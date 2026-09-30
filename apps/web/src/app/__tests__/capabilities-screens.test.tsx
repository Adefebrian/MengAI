// The connectors and trading screens, the company settings and the run
// tracker render from the bundled demo, with no API: every connector with
// its state and roles and no secret on the page, the trading desk with the
// no-advice note, the order waiting on you and the safe defaults, the CEO
// name and the org caps as Unlimited, and the tracker with its stages.
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { AppRoot, type AppRouteId } from "../AppRoot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG_DASH = String.fromCharCode(0x2014);
let root: ReactRoot | null = null;
let host: HTMLElement | null = null;

async function mount(id: AppRouteId, path: string, params: Record<string, string> = {}) {
  window.history.pushState(null, "", path);
  const url = new URL(path, "http://localhost");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AppRoot route={{ id, params }} location={{ pathname: url.pathname, search: url.search, hash: url.hash }} demo />);
  });
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.history.pushState(null, "", "/");
});

describe("demo screens for the new backend", () => {
  test("connectors: every connector with its state, kind and roles, a key hint at most", async () => {
    const el = await mount("connectors", "/app/connectors?demo=1");
    const text = el.textContent ?? "";
    expect(el.querySelector("h1")?.textContent).toBe("Connectors");
    for (const label of ["GitHub", "Market data", "Broker, paper account"]) expect(text).toContain(label);
    expect(text).toContain("Connected");
    expect(text).toContain("the key was revoked");
    expect(text).toContain("Every role");
    expect(text).toContain("ends in q7Zk");
    expect(el.querySelectorAll('[role="radiogroup"][data-name="connector-kind"] [role="radio"]').length).toBe(3);
    expect(el.querySelector('input[type="password"], textarea')).toBeTruthy();
    expect(text.includes(LONG_DASH)).toBe(false);
  });

  test("trading: the no-advice note, the order waiting on you, the book, and safe defaults", async () => {
    const el = await mount("trading", "/app/trading?demo=1");
    const text = el.textContent ?? "";
    expect(text).toContain("MengAI gives no investment advice");
    expect(text).toContain("1 live order waits on you");
    expect(text).toContain("Buy 5 NVDA");
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes("Approve"))).toBe(true);
    expect(text).toContain("AAPL");
    expect(text).toContain("+$43.80");
    expect(text).toContain("0 blocks every live order.");
    expect(el.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("Paper");
    expect(text.includes(LONG_DASH)).toBe(false);
  });

  test("settings: the CEO name, the org caps shown as Unlimited, budgets that allow 0", async () => {
    const el = await mount("settings", "/app/settings?demo=1");
    const text = el.textContent ?? "";
    expect(text).toContain("CEO name");
    expect(text).toContain("Unlimited cats, Unlimited depth");
    expect(text).toContain("0 means no cap");
  });

  test("the run page opens with the tracker: seven stages, the one it is on, and the tokens to go", async () => {
    const el = await mount("run", "/app/runs/demo?demo=1", { id: "demo" });
    const tracker = el.querySelector(".run-tracker");
    expect(tracker).toBeTruthy();
    expect(tracker!.querySelectorAll(".tracker-item").length).toBe(7);
    expect(tracker!.querySelector('[aria-current="step"]')?.textContent).toContain("Testing");
    expect(tracker!.querySelector(".tracker-stage")?.textContent).toContain("6 of 7");
    expect(el.querySelector(".status-now")?.textContent).toContain("Gembul is waiting on you");
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)[0]).toContain("Crew");
  });
});
