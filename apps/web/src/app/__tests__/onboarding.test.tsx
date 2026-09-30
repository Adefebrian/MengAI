// The runtime gate: with MengAI not running, /app shows the onboarding in
// the cat voice (download, open, Open in browser, bun run dev) with the
// latest release link and a live look-again line; with MengAI running but
// this browser not paired, it shows the pairing screen. No sign in, no
// setup, no owner account anywhere.
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { resetConnectForTests } from "../../api/connect";
import { AppRoot } from "../AppRoot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realFetch = globalThis.fetch;
let root: ReactRoot | null = null;
let host: HTMLElement | null = null;

function stubFetch(fn: (url: string, init: RequestInit) => Promise<Response>) {
  const f = ((input: RequestInfo | URL, init?: RequestInit) => fn(String(input), init ?? {})) as typeof fetch;
  globalThis.fetch = f;
  window.fetch = f;
}

async function mount() {
  resetConnectForTests();
  window.history.pushState(null, "", "/app");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AppRoot route={{ id: "home", params: {} }} location={{ pathname: "/app", search: "", hash: "" }} demo={false} />);
  });
  for (let i = 0; i < 6; i++) {
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
  globalThis.fetch = realFetch;
  window.fetch = realFetch;
  localStorage.clear();
});

describe("runtime gate", () => {
  test("not running: download, open, Open in browser, the latest release, and it keeps looking", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const el = await mount();
    const text = el.textContent ?? "";
    expect(el.querySelector("h1")?.textContent).toBe("Oyen is not answering yet");
    expect(text).toContain("the website keeps nothing");
    expect(text).toContain("Click Open in browser in its menu");
    expect(text).toContain("bun run dev");
    expect(text).toContain("every few seconds");
    const download = [...el.querySelectorAll("a")].find((a) => a.textContent?.includes("Download for Mac"));
    expect(download?.getAttribute("href")).toBe("https://github.com/Adefebrian/MengAI/releases/latest");
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes("Check again"))).toBe(true);
    for (const gone of ["Sign in", "Set up the owner account", "Password", "Setup code"]) expect(text.includes(gone)).toBe(false);
    expect(el.querySelector('input[type="email"]')).toBeNull();
  });

  test("running but not paired: pair from the menu, or paste the link", async () => {
    stubFetch(async (_url, init) => {
      if (init.mode === "no-cors") return new Response(null, { status: 200 });
      throw new TypeError("Failed to fetch");
    });
    const el = await mount();
    const text = el.textContent ?? "";
    expect(el.querySelector("h1")?.textContent).toBe("Almost there. Pair this browser.");
    expect(text).toContain("Click Open in browser");
    expect(el.querySelector('input[type="password"]')).not.toBeNull();
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Pair this browser")).toBe(true);
    expect(text.includes("Sign in")).toBe(false);
  });
});
