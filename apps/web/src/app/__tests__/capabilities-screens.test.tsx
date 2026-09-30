// The connectors and trading screens, the company settings and the run
// tracker render from the bundled demo, with no API: every connector with
// its state and roles and no secret on the page, the trading desk with the
// no-advice note, the order waiting on you and the safe defaults, the CEO
// name and the org caps as Unlimited, and the tracker with its stages.
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { TRADING_VENUE_PRESETS } from "@mengai/shared";
import { AppRoot, type AppRouteId } from "../AppRoot";
import { isSecretField } from "../screens/Trading";

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
    expect(el.querySelector('.trading-settings [role="radio"][aria-checked="true"]')?.textContent).toBe("Paper");
    expect(text).toContain("Live auto-trade needs all three");
    expect(text.includes(LONG_DASH)).toBe(false);
  });

  test("trading venues: status, mode and the learned skills every cat shares", async () => {
    const el = await mount("trading", "/app/trading?demo=1");
    const rows = el.querySelector('.trading-venues [aria-label="Venues"]');
    expect(rows?.querySelectorAll('[data-kind="venue"]').length).toBe(2);
    const text = rows?.textContent ?? "";
    expect(text).toContain("Alpaca, paper account");
    expect(text).toContain("Ready");
    expect(text).toContain("3 learned skills, shared by every cat");
    expect(text).toContain("22 uses, 22 wins");
    expect(text).toContain("Live on the testnet");
    expect(text).toContain("Learning");
    expect(el.querySelector(".trading-venues")?.textContent).toContain("What one cat learns, every cat uses at once.");
  });

  test("trading wizard: a field is masked unless its preset marks it plain (secret false)", () => {
    const ccxt = TRADING_VENUE_PRESETS.find((p) => p.id === "ccxt-mcp")!;
    const field = (key: string) => ccxt.secrets.find((f) => f.key === key)!;
    expect(isSecretField(field("CCXT_MCP_APIKEY"))).toBe(true);
    expect(isSecretField(field("CCXT_MCP_SECRET"))).toBe(true);
    expect(isSecretField(field("CCXT_MCP_EXCHANGE"))).toBe(false);
    expect(isSecretField({ secret: true })).toBe(true);
    expect(isSecretField({})).toBe(true);
  });

  test("trading wizard: preset, command and secrets, paper or live, then the learning status; secrets never stay on the page", async () => {
    const el = await mount("trading", "/app/trading?demo=1");
    const card = () => el.querySelector<HTMLElement>(".venue-add")!;
    const button = (label: string) => [...card().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label)!;
    const press = async (b: HTMLElement) => {
      await act(async () => {
        b.click();
      });
    };
    expect(card().querySelectorAll('[data-name="venue-preset"] [role="radio"]').length).toBe(TRADING_VENUE_PRESETS.length);
    await press(card().querySelector<HTMLButtonElement>('[data-name="venue-preset"] [data-value="alpaca-mcp"]')!);
    await press(button("Next"));
    const command = card().querySelector<HTMLInputElement>("input.num")!;
    const alpaca = TRADING_VENUE_PRESETS.find((p) => p.id === "alpaca-mcp")!;
    expect(command.value).toBe(alpaca.target);
    const secrets = card().querySelectorAll<HTMLInputElement>('input[type="password"]');
    expect(secrets.length).toBe(alpaca.secrets.filter(isSecretField).length);
    expect(secrets.length).toBeGreaterThan(0);
    const setValue = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await setValue(secrets[0]!, "PKTEST1234abcd");
    await press(button("Next"));
    expect(card().querySelector('[data-name="venue-mode"] [aria-checked="true"]')?.textContent).toBe("Paper");
    expect(!!card().querySelector('[role="switch"]')).toBe(alpaca.supportsTestnet);
    await press(button("Connect and learn"));
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    expect(card().textContent).toContain("Venue connected");
    expect(card().textContent).toContain("Learning");
    expect(card().querySelectorAll('input[type="password"]').length).toBe(0);
    expect(el.textContent?.includes("PKTEST1234abcd")).toBe(false);
    expect(el.querySelectorAll('.trading-venues [data-kind="venue"]').length).toBe(3);
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
