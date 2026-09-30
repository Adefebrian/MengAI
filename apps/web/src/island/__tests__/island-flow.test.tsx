// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The island on the page: approvals always need a click (Approve and
// Deny call the engine, the result shows in place, an engine error keeps
// the buttons), the expanded island is a labelled region that keeps focus
// inside, Open goes to the run through island_open_main, the native window
// is sized with island_set_state (the contract's names and arguments),
// reduced motion gives instant changes with still cats, and without Tauri
// the page is the preview with sample data per ?state=.
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { createApiClient, type FetchLike } from "../../api/client";
import { askOwner, orderDTO, previewLive, sampleRun, PREVIEW_RUN_ID } from "../fixture";
import { Island } from "../Island";
import { IslandApp } from "../IslandApp";
import { applyEvent, deriveModel, emptyLive, type IslandLive, type IslandModel } from "../live";
import { PREVIEW_GEOMETRY, previewBridge, tauriBridge, type NativeSize } from "../native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG_DASH = String.fromCharCode(0x2014);
const NOW = 1_800_000_000_000;
let root: ReactRoot | null = null;
let host: HTMLElement | null = null;
const realMatchMedia = window.matchMedia;

const settle = async (rounds = 4, ms = 20) => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }
};

async function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
  });
  await settle();
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.matchMedia = realMatchMedia;
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

function reduceMotion(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function liveWithAsks(): IslandLive {
  const s = sampleRun(NOW - 60_000);
  askOwner(s);
  s.emit("trade.order", { order: orderDTO("o-btc", null, NOW - 30_000) }, "a-gembul", null, null);
  let l = emptyLive();
  for (const e of s.events) l = applyEvent(l, e, NOW).live;
  return l;
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function fakeEngine(answer: (c: Call) => Response = () => Response.json({ ok: true })): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const c = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    return answer(c);
  };
  return { fetch, calls };
}

const buttons = (el: Element, label: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent?.trim() === label);
const press = async (b: HTMLElement) => {
  await act(async () => {
    b.click();
  });
  await settle(2);
};

function renderIsland(model: IslandModel, opts: { fetch?: FetchLike; reduced?: boolean; hover?: boolean } = {}) {
  const bridge = previewBridge(PREVIEW_GEOMETRY, () => {});
  const api = opts.fetch ? createApiClient({ base: "", fetch: opts.fetch }) : null;
  return { bridge, node: <Island model={model} geometry={PREVIEW_GEOMETRY} bridge={bridge} api={api} reduced={opts.reduced ?? true} forceHover={opts.hover} now={() => NOW} /> };
}

describe("approvals from the island", () => {
  test("nothing is answered without a click; Approve on a cat's question sends yes to that cat and shows the result in place", async () => {
    const engine = fakeEngine();
    const model = deriveModel(liveWithAsks());
    const { node, bridge } = renderIsland(model, { fetch: engine.fetch });
    const el = await mount(node);
    const island = el.querySelector<HTMLElement>(".island")!;
    expect(island.dataset.view).toBe("ask");
    expect(island.dataset.native).toBe("expanded");
    expect(engine.calls).toEqual([]);
    // the expanded island is a region named by who asks
    const labelled = document.getElementById(island.getAttribute("aria-labelledby")!);
    expect(labelled?.textContent).toBe("Klepon asks you");
    expect(el.textContent).toContain("1 of 2");
    expect(el.textContent).toContain("May I run npm install papaparse");
    const approve = buttons(el, "Approve")[0]!;
    expect(approve.className).toContain("island-btn");
    await press(approve);
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]!.method).toBe("POST");
    expect(engine.calls[0]!.url).toBe(`/api/runs/${PREVIEW_RUN_ID}/message`);
    expect(engine.calls[0]!.body).toEqual({ text: "Yes, go ahead this once.", agentId: "a-klepon" });
    const result = el.querySelector(".island-result");
    expect(result?.getAttribute("role")).toBe("status");
    expect(result?.textContent).toBe("Approved. Klepon goes ahead.");
    expect(buttons(el, "Approve")).toHaveLength(0);
    // after the result, the queue moves on to the live order
    await settle(1, 1700);
    expect(el.textContent).toContain("Live order from Gembul");
    expect(el.textContent).toContain("Buy 0.25 BTCUSDT");
    expect(bridge.calls.every((c) => c.cmd === "island_set_state")).toBe(true);
    expect(el.textContent?.includes(LONG_DASH)).toBe(false);
  });

  test("Deny on a live order rejects it at the engine; an engine error keeps the buttons and says why", async () => {
    let fail = true;
    const engine = fakeEngine((c) =>
      fail ? Response.json({ error: { code: "venue_down", message: "The venue did not answer." } }, { status: 502 }) : Response.json({ ...orderDTO("o-btc", null, NOW - 30_000), status: c.body && (c.body as { decision: string }).decision === "reject" ? "rejected" : "approved" }),
    );
    const live = liveWithAsks();
    // only the order waits
    const model = deriveModel({ ...live, runs: {} });
    expect(model.asks.map((a) => a.id)).toEqual(["order:o-btc"]);
    const { node } = renderIsland(model, { fetch: engine.fetch });
    const el = await mount(node);
    await press(buttons(el, "Deny")[0]!);
    expect(engine.calls[0]!.url).toBe("/api/trading/orders/o-btc/decision");
    expect(engine.calls[0]!.body).toEqual({ decision: "reject" });
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("The venue did not answer.");
    expect(buttons(el, "Approve")).toHaveLength(1);
    fail = false;
    await press(buttons(el, "Deny")[0]!);
    expect(el.querySelector(".island-result")?.textContent).toBe("Rejected. The crew will not place this order.");
  });

  test("Open sends the owner to the run in the main window; focus stays inside the expanded island", async () => {
    const model = deriveModel(liveWithAsks());
    const { node, bridge } = renderIsland(model);
    const el = await mount(node);
    const all = [...el.querySelectorAll<HTMLButtonElement>(".island button:not([disabled])")];
    const first = all[0]!;
    const last = all[all.length - 1]!;
    last.focus();
    await act(async () => {
      last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(first);
    first.focus();
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(last);
    await press(buttons(el, "Open")[0]!);
    expect(bridge.calls.filter((c) => c.cmd === "island_open_main").map((c) => c.args)).toEqual([{ path: `/app/runs/${PREVIEW_RUN_ID}` }]);
    // every island button is a real button with the 44 px control class
    for (const b of el.querySelectorAll(".island button")) expect(b.className).toContain("island-btn");
  });

  test("an open question is answered in the app, never with Approve", async () => {
    const s = sampleRun(NOW - 60_000);
    s.emit("request.raised", { requestId: "rq-color", fromAgentId: "a-onde", toAgentId: null, question: "Which accent should the button use?", toOwner: true }, "a-onde", null);
    let l = emptyLive();
    for (const e of s.events) l = applyEvent(l, e, NOW).live;
    const { node } = renderIsland(deriveModel(l));
    const el = await mount(node);
    expect(buttons(el, "Approve")).toHaveLength(0);
    expect(buttons(el, "Answer in MengAI")).toHaveLength(1);
  });
});

describe("the window and the motion", () => {
  test("the native window is sized with island_set_state, the view's exact size (instant under reduced motion)", async () => {
    const collapsedModel = deriveModel(previewLive("collapsed", NOW));
    const bridge = previewBridge(PREVIEW_GEOMETRY, () => {});
    const view = (model: IslandModel) => <Island model={model} geometry={PREVIEW_GEOMETRY} bridge={bridge} api={null} reduced now={() => NOW} />;
    const el = await mount(view(collapsedModel));
    const island = el.querySelector<HTMLElement>(".island")!;
    const first = bridge.calls[0]!;
    expect(first.cmd).toBe("island_set_state");
    const collapsed = first.args as NativeSize;
    expect(collapsed.state).toBe("collapsed");
    expect(collapsed.height).toBe(PREVIEW_GEOMETRY.notchHeight);
    expect(collapsed.width).toBeGreaterThan(PREVIEW_GEOMETRY.notchWidth);
    expect(island.style.width).toBe(`${collapsed.width}px`);

    const asked = deriveModel(liveWithAsks());
    await act(async () => root!.render(view(asked)));
    await settle();
    const expanded = bridge.calls.at(-1)!.args as NativeSize;
    expect(expanded.state).toBe("expanded");
    expect(expanded.width).toBe(400);
    expect(expanded.height).toBeGreaterThan(collapsed.height);
    expect(el.querySelector<HTMLElement>(".island")!.style.height).toBe(`${expanded.height}px`);

    await act(async () => root!.render(view(collapsedModel)));
    await settle(6);
    expect(bridge.calls.at(-1)!.args).toEqual(collapsed);
  });

  test("with motion, the window grows to hold both shapes before the morph and drops to the exact size after it", async () => {
    reduceMotion(false);
    const collapsedModel = deriveModel(previewLive("collapsed", NOW));
    const bridge = previewBridge(PREVIEW_GEOMETRY, () => {});
    const view = (model: IslandModel) => <Island model={model} geometry={PREVIEW_GEOMETRY} bridge={bridge} api={null} reduced={false} now={() => NOW} />;
    const el = await mount(view(collapsedModel));
    await settle(4, 40);
    const collapsed = bridge.calls[0]!.args as NativeSize;
    const island = el.querySelector<HTMLElement>(".island")!;
    expect(island.dataset.motion).toBe("live");

    await act(async () => root!.render(view(deriveModel(liveWithAsks()))));
    await settle(2, 10);
    const grown = bridge.calls.at(-1)!.args as NativeSize;
    expect(grown.state).toBe("expanded");
    // the union: as wide as the collapsed island, as tall as the expanded one
    expect(grown.width).toBe(Math.max(collapsed.width, 400));
    expect(grown.height).toBeGreaterThan(collapsed.height);
    await settle(10, 120);
    const exact = bridge.calls.at(-1)!.args as NativeSize;
    expect(exact).toEqual({ state: "expanded", width: 400, height: grown.height });

    // back to collapsed: the window waits for the morph, then drops to the collapsed size
    const before = bridge.calls.length;
    await act(async () => root!.render(view(collapsedModel)));
    await settle(1, 10);
    const during = bridge.calls.slice(before).map((c) => c.args as NativeSize);
    for (const s of during) expect(s.height).toBeGreaterThanOrEqual(exact.height);
    await settle(10, 120);
    expect(bridge.calls.at(-1)!.args).toEqual(collapsed);
  });

  test("reduced motion: instant, and every cat holds still", async () => {
    reduceMotion(true);
    const model = deriveModel(previewLive("peek", NOW));
    const bridge = previewBridge(PREVIEW_GEOMETRY, () => {});
    const el = await mount(<Island model={model} geometry={PREVIEW_GEOMETRY} bridge={bridge} api={null} reduced forceHover now={() => NOW} />);
    const island = el.querySelector<HTMLElement>(".island")!;
    expect(island.dataset.motion).toBe("still");
    expect(island.dataset.view).toBe("peek");
    const cats = [...el.querySelectorAll<HTMLElement>(".cat")];
    expect(cats.length).toBe(4);
    for (const c of cats) expect(c.dataset.motion).toBe("still");
    expect(el.querySelectorAll(".island-crew-row")).toHaveLength(3);
    expect(el.textContent).toContain("and 2 more at their desks");
  });

  test("with motion allowed the working cats are live and the island says so", async () => {
    reduceMotion(false);
    const model = deriveModel(previewLive("collapsed", NOW));
    const { node } = renderIsland(model, { reduced: false });
    const el = await mount(node);
    expect(el.querySelector<HTMLElement>(".island")!.dataset.motion).toBe("live");
    expect(el.querySelector<HTMLElement>(".island-band .cat")!.dataset.motion).toBe("live");
    expect(el.querySelector(".island-ring")?.getAttribute("aria-label")).toBe("62 percent of the tasks done");
    expect(el.querySelector(".island-ear-text")?.textContent).toBe("Review 5 of 7");
  });
});

describe("the page without Tauri: the preview", () => {
  test("?state=expanded shows the preview frame with sample asks and the state switch", async () => {
    const el = await mount(<IslandApp search="?state=expanded" />);
    expect(el.querySelector("h1")?.textContent).toBe("Mac island");
    expect(el.querySelector<HTMLElement>(".island")?.dataset.view).toBe("ask");
    expect(buttons(el, "Approve")).toHaveLength(1);
    const pressed = el.querySelector('.island-preview-states button[aria-pressed="true"]');
    expect(pressed?.textContent).toBe("Expanded");
    await press(buttons(el, "Failed")[0]!);
    expect(el.querySelector<HTMLElement>(".island")?.dataset.view).toBe("failed");
    expect(el.textContent).toContain("The run failed");
    await press(buttons(el, "No notch")[0]!);
    expect(el.querySelector<HTMLElement>(".island")?.hasAttribute("data-notch")).toBe(false);
    expect(el.querySelector(".island-preview-menubar")).not.toBeNull();
  });

  test("every preview state renders without Tauri and without a network", async () => {
    for (const state of ["idle", "collapsed", "peek", "expanded", "shipped", "failed"]) {
      const el = await mount(<IslandApp search={`?state=${state}`} />);
      const island = el.querySelector<HTMLElement>(".island")!;
      expect(island).not.toBeNull();
      expect(island.dataset.view).toBe(state === "expanded" ? "ask" : state);
      expect(el.textContent?.includes(LONG_DASH)).toBe(false);
      await act(async () => root?.unmount());
      host?.remove();
      root = null;
    }
  });

  test("inside Tauri the page asks the shell for the notch and sizes its window through the contract", async () => {
    const invoked: Array<{ cmd: string; args: unknown }> = [];
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: unknown) => {
        invoked.push({ cmd, args });
        if (cmd === "island_geometry") return { hasNotch: true, notchWidth: 200, notchHeight: 38, menuBarHeight: 38, scale: 2 };
        return null;
      },
    };
    const engine = fakeEngine((c) => {
      if (c.url.startsWith("/api/events")) return new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/event-stream" } });
      if (c.url.startsWith("/api/runs") || c.url.startsWith("/api/trading/orders")) return Response.json([]);
      return Response.json({ motion: "full" });
    });
    const bridge = tauriBridge((cmd, args) => (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(cmd, args));
    const { NativeIsland } = await import("../IslandApp");
    const el = await mount(<NativeIsland bridge={bridge} api={createApiClient({ base: "", fetch: engine.fetch })} />);
    expect(invoked[0]).toEqual({ cmd: "island_geometry", args: undefined });
    const set = invoked.find((c) => c.cmd === "island_set_state");
    expect(set?.args).toEqual({ state: "collapsed", width: 200, height: 38 });
    expect(el.querySelector<HTMLElement>(".island")?.dataset.view).toBe("idle");
    await bridge.openMain("https://evil.example");
    await bridge.openMain("/app/runs/r1");
    expect(invoked.filter((c) => c.cmd === "island_open_main").map((c) => c.args)).toEqual([{ path: "/app/runs/r1" }]);
    // the feed read the runs, the orders and the stream for all runs (no runId)
    const urls = engine.calls.map((c) => c.url);
    expect(urls).toContain("/api/runs");
    expect(urls).toContain("/api/trading/orders");
    expect(urls.some((u) => u === "/api/events")).toBe(true);
  });
});
