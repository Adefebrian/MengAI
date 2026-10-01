// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The engine gate: with MengAI not running, /app shows the onboarding in
// the cat voice (download the beta, open it, the page connects by itself,
// or bun run dev) and keeps looking every 2 s; the moment the engine
// answers, the page moves on by itself. An engine that refuses this site
// says so on the same screen. No sign in, no pairing, no token or code to
// copy, no owner account anywhere.
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { resetConnectForTests } from "../../api/connect";
import { AppRoot, RECHECK_MS } from "../AppRoot";

const HEALTH = { ok: true, mode: "local", version: "0.1.0", configured: true, automation: { available: false, accessibility: false, screen: false }, jev: { configured: false } };

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

const NO_AUTH = ["Sign in", "Set up the owner account", "Password", "Setup code", "Pair", "pairing", "token", "Unpair"];

describe("engine gate", () => {
  test("not running: download the beta, open it, it connects by itself, bun run dev, and it keeps looking", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const el = await mount();
    const text = el.textContent ?? "";
    expect(el.querySelector("h1")?.textContent).toBe("Oyen is not answering yet");
    expect(text).toContain("the website keeps nothing");
    expect(text).toContain("This page connects by itself");
    expect(text).toContain("bun run dev");
    expect(text).toContain("every 2 seconds");
    expect(text).toContain("Free for personal and noncommercial use.");
    expect(text).toContain("A beta for Apple Silicon Macs. Android is coming soon.");
    expect(text).not.toMatch(/open.?source|apache/i);
    const download = [...el.querySelectorAll("a")].find((a) => a.textContent?.includes("Download for Mac"));
    expect(download?.getAttribute("href")).toBe("https://github.com/Adefebrian/MengAI/releases/tag/v0.1.0-beta");
    expect([...el.querySelectorAll("a")].some((a) => a.textContent?.includes("Download for Windows"))).toBe(false);
    expect([...el.querySelectorAll("a")].some((a) => /android/i.test(a.textContent ?? ""))).toBe(false);
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes("Check again"))).toBe(true);
    for (const gone of NO_AUTH) expect(text.includes(gone)).toBe(false);
    expect(el.querySelector('input[type="email"], input[type="password"]')).toBeNull();
  });

  test("the page moves on by itself once the engine answers", async () => {
    let up = false;
    stubFetch(async (url) => {
      if (!up) throw new TypeError("Failed to fetch");
      const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.endsWith("/api/health")) return reply(200, HEALTH);
      if (/\/api\/(runs|projects|trading\/orders)$/.test(url)) return reply(200, []);
      return reply(404, { error: { code: "not_found", message: "No such API route" } });
    });
    const el = await mount();
    expect(el.querySelector("h1")?.textContent).toBe("Oyen is not answering yet");
    up = true;
    await act(async () => {
      await new Promise((r) => setTimeout(r, RECHECK_MS + 300));
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    expect(el.querySelector("h1")?.textContent).toBe("Runs");
  });

  test("running but refusing this site: says so and links the engine's own page, still no sign in", async () => {
    stubFetch(async (_url, init) => {
      if (init.mode === "no-cors") return new Response(null, { status: 200 });
      throw new TypeError("Failed to fetch");
    });
    const el = await mount();
    const text = el.textContent ?? "";
    expect(el.querySelector("h1")?.textContent).toBe("Oyen is awake, but the door is shut");
    expect(text).toContain("does not take requests from this site");
    const own = [...el.querySelectorAll("a")].find((a) => a.getAttribute("href")?.endsWith("/app") && a.textContent?.includes("/app"));
    expect(own).toBeTruthy();
    for (const gone of NO_AUTH) expect(text.includes(gone)).toBe(false);
    expect(el.querySelector('input[type="password"]')).toBeNull();
  });
});
