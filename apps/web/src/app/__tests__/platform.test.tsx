// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Platform features from GET /api/health, as the demo plays them: a Mac
// engine shows every feature; ?platform=win32 plays a Windows engine, where
// live trading, local MCP servers, dev script previews and crew shell
// commands stay in view, disabled, each with the "Coming soon on Windows"
// tag and one plain line on why, while paper trading, custom REST, remote
// MCP and static previews keep working. The download helpers order the
// builds and keep Android as coming soon, with no link.
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { demoHealth, demoPlatform } from "../../demo/demoApi";
import { DOWNLOADS, RELEASE_URL, availableDownloads, comingDownloads, downloadLine, visitorDownload } from "../../downloads";
import { AppRoot, type AppRouteId } from "../AppRoot";
import { examplePath, isAbsolutePath, platformOf, soonLabel, soonReason, trimPath } from "../platform";
import { downloadOrder } from "../screens/Onboarding";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG_DASH = String.fromCharCode(0x2014);
const SOON = "Coming soon on Windows";
const happy = (globalThis as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM;
let root: ReactRoot | null = null;
let host: HTMLElement | null = null;

const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
};

async function mount(id: AppRouteId, path: string, params: Record<string, string> = {}) {
  happy.setURL(`http://localhost${path}`);
  const url = new URL(path, "http://localhost");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AppRoot route={{ id, params }} location={{ pathname: url.pathname, search: url.search, hash: url.hash }} demo />);
  });
  await settle();
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  happy.setURL("about:blank");
});

const press = async (b: HTMLElement) => {
  await act(async () => {
    b.click();
  });
  await settle(2);
};
const buttonsIn = (el: Element, label: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent?.trim() === label);
const soonNotes = (el: Element) => [...el.querySelectorAll<HTMLElement>(".p-soon")];

describe("platform facts", () => {
  test("an engine from before the contract is a Mac with every feature on", () => {
    const p = platformOf({});
    expect(p.os).toBe("darwin");
    expect(p.name).toBe("macOS");
    expect(p.machine).toBe("this Mac");
    expect(p.features).toEqual({ shell: true, liveTrading: true, mcpStdio: true, scriptPreview: true });
  });

  test("a Windows engine names itself and keeps what it reports", () => {
    const p = platformOf({ platform: "win32", features: { shell: false, liveTrading: false, mcpStdio: false, scriptPreview: false } });
    expect(p.name).toBe("Windows");
    expect(p.machine).toBe("this PC");
    expect(soonLabel(p)).toBe(SOON);
    for (const f of ["shell", "liveTrading", "mcpStdio", "scriptPreview"] as const) {
      const line = soonReason(p, f);
      expect(line).toContain("crew sandbox");
      expect(line).toContain("Windows is not ready yet");
      expect(line.includes(LONG_DASH)).toBe(false);
    }
    expect(platformOf({ platform: "linux", features: { shell: false, liveTrading: false, mcpStdio: false, scriptPreview: false } }).name).toBe("Linux");
  });

  test("the demo engine: a Mac with every feature on, or Windows with the sandbox features off", () => {
    expect(demoPlatform("")).toBe("darwin");
    expect(demoPlatform("?platform=nope")).toBe("darwin");
    expect(demoHealth("?demo=1").features).toEqual({ shell: true, liveTrading: true, mcpStdio: true, scriptPreview: true });
    const win = demoHealth("?demo=1&platform=win32");
    expect(win.platform).toBe("win32");
    expect(win.features).toEqual({ shell: false, liveTrading: false, mcpStdio: false, scriptPreview: false });
    expect(demoHealth("?platform=linux").platform).toBe("linux");
  });

  test("folder paths follow the engine's system", () => {
    expect(isAbsolutePath("/Users/you/shop", "darwin")).toBe(true);
    expect(isAbsolutePath("C:\\Users\\you\\shop", "darwin")).toBe(false);
    expect(isAbsolutePath("C:\\Users\\you\\shop", "win32")).toBe(true);
    expect(isAbsolutePath("D:/code/shop", "win32")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share\\shop", "win32")).toBe(true);
    expect(isAbsolutePath("shop", "win32")).toBe(false);
    expect(isAbsolutePath("/Users/you/shop", "win32")).toBe(false);
    expect(trimPath("C:\\code\\shop\\", "win32")).toBe("C:\\code\\shop");
    expect(trimPath("C:\\", "win32")).toBe("C:\\");
    expect(trimPath("/Users/you/shop/", "darwin")).toBe("/Users/you/shop");
    expect(trimPath("/", "darwin")).toBe("/");
    expect(examplePath("win32")).toBe("C:\\Users\\you\\code\\shop");
  });
});

describe("downloads", () => {
  test("Mac and Windows go to the beta release; Android is coming soon with no link", () => {
    expect(RELEASE_URL).toBe("https://github.com/Adefebrian/MengAI/releases/tag/v0.1.0-beta");
    expect(availableDownloads().map((d) => [d.label, d.href])).toEqual([
      ["Download for Mac", RELEASE_URL],
      ["Download for Windows", RELEASE_URL],
    ]);
    expect(comingDownloads().map((d) => d.id)).toEqual(["android"]);
    expect(DOWNLOADS.find((d) => d.id === "android")?.href).toBeNull();
    const line = downloadLine();
    expect(line).toContain("Apple Silicon");
    expect(line).toContain("Windows x64");
    expect(line).toContain("A few crew tricks reach Windows later.");
    expect(line).toContain("Android is coming soon.");
    expect(line.includes(LONG_DASH)).toBe(false);
  });

  test("the visitor's own system leads the onboarding downloads, Mac first when unknown", () => {
    const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
    const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    expect(visitorDownload(WIN)).toBe("windows");
    expect(visitorDownload(MAC)).toBe("mac");
    expect(visitorDownload(IPAD)).toBeNull();
    expect(visitorDownload("Mozilla/5.0 (Linux; Android 15) Mobile")).toBe("android");
    expect(downloadOrder("windows").map((d) => d.id)).toEqual(["windows", "mac"]);
    expect(downloadOrder("mac").map((d) => d.id)).toEqual(["mac", "windows"]);
    expect(downloadOrder(null).map((d) => d.id)).toEqual(["mac", "windows"]);
    expect(downloadOrder("android").map((d) => d.id)).toEqual(["mac", "windows"]);
  });
});

describe("coming soon on Windows", () => {
  test("trading on a Mac: Live is a choice and nothing says coming soon", async () => {
    const el = await mount("trading", "/app/trading?demo=1");
    expect(el.textContent).not.toContain("Coming soon");
    const live = el.querySelector<HTMLButtonElement>('.trading-settings [data-name="trading-mode"] [data-value="live"]')!;
    expect(live.disabled).toBe(false);
    expect(el.querySelector<HTMLButtonElement>('.venue-add [data-name="venue-preset"] [data-value="ccxt-mcp"]')!.disabled).toBe(false);
  });

  test("trading on Windows: Live and live auto-trade are off with the reason, paper stays usable", async () => {
    const el = await mount("trading", "/app/trading?demo=1&platform=win32");
    const settings = el.querySelector<HTMLElement>(".trading-settings")!;
    const live = settings.querySelector<HTMLButtonElement>('[data-name="trading-mode"] [data-value="live"]')!;
    const paper = settings.querySelector<HTMLButtonElement>('[data-name="trading-mode"] [data-value="paper"]')!;
    expect(live.disabled).toBe(true);
    expect(paper.disabled).toBe(false);
    expect(paper.getAttribute("aria-checked")).toBe("true");
    const note = soonNotes(settings)[0]!;
    expect(note.textContent).toContain(SOON);
    expect(note.textContent).toContain("Paper trading works now.");
    expect(settings.querySelector('[data-name="trading-mode"]')?.getAttribute("aria-describedby")).toBe(note.id);
    const auto = [...settings.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((b) => b.textContent?.includes("Auto-trade live orders"))!;
    expect(auto.disabled).toBe(true);
    expect(auto.getAttribute("aria-checked")).toBe("false");
    expect(buttonsIn(settings, "Save trading settings")[0]!.disabled).toBe(false);
    expect(el.textContent?.includes(LONG_DASH)).toBe(false);
  });

  test("trading on Windows: the local MCP presets are off with their tags, custom REST leads, and the live order waits on Reject only", async () => {
    const el = await mount("trading", "/app/trading?demo=1&platform=win32");
    const card = el.querySelector<HTMLElement>(".venue-add")!;
    const preset = (id: string) => card.querySelector<HTMLButtonElement>(`[data-name="venue-preset"] [data-value="${id}"]`)!;
    for (const id of ["ccxt-mcp", "alpaca-mcp", "custom-mcp"]) {
      expect(preset(id).disabled).toBe(true);
      expect(preset(id).textContent).toContain(SOON);
    }
    expect(preset("custom-http").disabled).toBe(false);
    expect(preset("custom-http").getAttribute("aria-checked")).toBe("true");
    expect(preset("custom-http").textContent).not.toContain(SOON);
    expect(card.textContent).toContain("Remote MCP servers and HTTP APIs work now.");
    await press(buttonsIn(card, "Next")[0]!);
    const url = card.querySelector<HTMLInputElement>("input.num")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(url, "https://api.example.com/v1");
      url.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(buttonsIn(card, "Next")[0]!);
    const mode = card.querySelector('[data-name="venue-mode"]')!;
    expect(mode.querySelector<HTMLButtonElement>('[data-value="live"]')!.disabled).toBe(true);
    expect(mode.querySelector('[aria-checked="true"]')?.textContent).toBe("Paper");
    expect(card.textContent).toContain(SOON);

    const order = el.querySelector<HTMLElement>('.trading-orders [data-waiting]')!;
    expect(buttonsIn(order, "Approve")[0]!.disabled).toBe(true);
    expect(buttonsIn(order, "Reject")[0]!.disabled).toBe(false);
    expect(order.textContent).toContain(SOON);
    expect(order.textContent).toContain("Reject works now.");
    expect(buttonsIn(order, "Approve")[0]!.getAttribute("aria-describedby")).toBe(order.querySelector(".p-soon")?.id ?? "missing");

    const venues = [...el.querySelectorAll<HTMLElement>('.trading-venues [data-kind="venue"]')];
    for (const row of venues) {
      expect(row.textContent).toContain(SOON);
      expect(row.querySelector(".venue-state")).toBeNull();
      expect(buttonsIn(row, "Learn again").concat(buttonsIn(row, "Learn"))[0]!.disabled).toBe(true);
      expect(buttonsIn(row, "Remove")[0]!.disabled).toBe(false);
    }
  });

  test("connectors on Windows: the local command kind is off with its tag, remote is picked, and a local connector cannot be tested", async () => {
    const el = await mount("connectors", "/app/connectors?demo=1&platform=win32");
    const form = el.querySelector<HTMLElement>(".connector-add")!;
    const kind = (v: string) => form.querySelector<HTMLButtonElement>(`[data-name="connector-kind"] [data-value="${v}"]`)!;
    expect(kind("mcp_stdio").disabled).toBe(true);
    expect(kind("mcp_stdio").textContent).toContain(SOON);
    expect(kind("mcp_http").disabled).toBe(false);
    expect(kind("mcp_http").getAttribute("aria-checked")).toBe("true");
    expect(kind("http_api").disabled).toBe(false);
    expect(form.querySelector("textarea")).toBeNull();
    const note = soonNotes(form)[0]!;
    expect(note.textContent).toContain("A local MCP server runs as a process on this PC");
    expect(form.querySelector('[data-name="connector-kind"]')?.getAttribute("aria-describedby")).toBe(note.id);

    const rows = [...el.querySelectorAll<HTMLElement>('[data-kind="connector"]')];
    const github = rows.find((r) => r.textContent?.includes("GitHub"))!;
    expect(buttonsIn(github, "Test")[0]!.disabled).toBe(true);
    expect(github.textContent).toContain(SOON);
    expect(buttonsIn(github, "Remove")[0]!.disabled).toBe(false);
    const market = rows.find((r) => r.textContent?.includes("Market data"))!;
    expect(buttonsIn(market, "Test")[0]!.disabled).toBe(false);
    expect(market.textContent).not.toContain(SOON);
  });

  test("connectors on a Mac: the local command kind is the default and nothing says coming soon", async () => {
    const el = await mount("connectors", "/app/connectors?demo=1");
    expect(el.textContent).not.toContain("Coming soon");
    expect(el.querySelector('[data-name="connector-kind"] [data-value="mcp_stdio"]')?.getAttribute("aria-checked")).toBe("true");
  });

  test("preview on Windows: a dev script project keeps the region with Start preview off and the reason", async () => {
    const el = await mount("run", "/app/runs/demo?demo=1&at=end&platform=win32", { id: "demo" });
    const region = el.querySelector<HTMLElement>(".run-preview")!;
    expect(region).toBeTruthy();
    const start = buttonsIn(region, "Start preview")[0]!;
    expect(start.disabled).toBe(true);
    const note = soonNotes(region)[0]!;
    expect(note.textContent).toContain(SOON);
    expect(note.textContent).toContain("Static sites preview now.");
    expect(start.getAttribute("aria-describedby")).toBe(note.id);
    expect(region.textContent).toContain("previews through bun run dev");
    expect(buttonsIn(region, "Open folder").length).toBe(1);
  });

  test("preview on a Mac: Start preview works and nothing says coming soon", async () => {
    const el = await mount("run", "/app/runs/demo?demo=1&at=end", { id: "demo" });
    const region = el.querySelector<HTMLElement>(".run-preview")!;
    expect(buttonsIn(region, "Start preview")[0]!.disabled).toBe(false);
    expect(region.textContent).not.toContain("Coming soon");
  });

  test("home on Windows: New run says shell commands are coming soon, paths are Windows paths", async () => {
    const el = await mount("home", "/app?demo=1&platform=win32");
    const newRun = el.querySelector<HTMLElement>(".newrun")!;
    const note = soonNotes(newRun)[0]!;
    expect(note.textContent).toContain(SOON);
    expect(note.textContent).toContain("Tests, builds and installs run as processes on this PC");
    expect(buttonsIn(newRun, "Estimate the cost")[0]!.disabled).toBe(false);
    expect(el.textContent).toContain("Folder on this PC");
    expect(el.querySelector<HTMLInputElement>("#add-project input.num")?.placeholder).toBe("C:\\Users\\you\\code\\shop");
    expect(el.textContent).toContain("Its shell commands are coming soon here.");
  });

  test("home on a Mac: no coming-soon line and Mac paths", async () => {
    const el = await mount("home", "/app?demo=1");
    expect(el.textContent).not.toContain("Coming soon");
    expect(el.textContent).toContain("Folder on this Mac");
  });
});
