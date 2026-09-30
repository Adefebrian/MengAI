// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Reasoning effort per tier on Providers, Model routing, from the bundled
// demo with no API: every tier row carries a Reasoning select (Default,
// None, Low, Medium, High) on the same row as its provider and model, the
// one line under the tiers says what Default and None do, a change marks
// the routing unsaved and saves with it through PUT /api/routing, and
// Default is stored as the missing value. The demo engine refuses a value
// it would not know.
import { CSRF_HEADER, REASONING_EFFORTS, type ModelRouting } from "@mengai/shared";
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { AppRoot } from "../AppRoot";
import { REASONING_NOTE, REASONING_WORD } from "../screens/Providers";
import { createDemoFetch } from "../../demo/demoApi";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG_DASH = String.fromCharCode(0x2014);
let root: ReactRoot | null = null;
let host: HTMLElement | null = null;

const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
};

const setUrl = (href: string) => (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(href);

async function mountProviders() {
  const url = new URL("/app/providers?demo=1", "http://localhost");
  setUrl(url.href);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AppRoot route={{ id: "providers", params: {} }} location={{ pathname: url.pathname, search: url.search, hash: url.hash }} demo />);
  });
  await settle();
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  setUrl("about:blank");
});

const choose = async (sel: HTMLSelectElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle(2);
};

const reasoningOf = (el: HTMLElement, tier: string) => el.querySelector<HTMLSelectElement>(`select[aria-label="${tier} reasoning"]`)!;
const status = (el: HTMLElement) => (el.querySelector(".rt-status span:last-child")?.textContent ?? "").trim();

describe("model routing, reasoning per tier", () => {
  test("every tier row carries a Reasoning select with the five efforts, and one line says what Default and None do", async () => {
    const el = await mountProviders();
    const rows = [...el.querySelectorAll<HTMLElement>('.rt-row[data-kind="tier"]')];
    expect(rows.length).toBe(3);
    for (const row of rows) {
      const sel = row.querySelector<HTMLSelectElement>(".rt-reason select")!;
      expect(sel).toBeTruthy();
      expect([...sel.options].map((o) => o.value)).toEqual([...REASONING_EFFORTS]);
      expect([...sel.options].map((o) => o.textContent)).toEqual(["Default", "None", "Low", "Medium", "High"]);
      // its own label for the stacked phone layout
      expect(row.querySelector(`label[for="${sel.id}"]`)?.textContent).toBe("Reasoning");
      // the note describes it
      const note = document.getElementById(sel.getAttribute("aria-describedby")!);
      expect(note?.textContent).toBe(REASONING_NOTE);
    }
    expect(REASONING_NOTE).toContain("Default lets each model decide");
    expect(REASONING_NOTE).toContain("MengAI handles a vendor that refuses");
    expect(REASONING_NOTE).toContain("None is the fastest and cheapest");
    // the demo plays Fast on None, Balanced left on Default, Deep on High
    expect(reasoningOf(el, "Fast").value).toBe("none");
    expect(reasoningOf(el, "Balanced").value).toBe("default");
    expect(reasoningOf(el, "Deep").value).toBe("high");
    // the tier table heads name the fourth column; role and media tables keep three
    const heads = [...el.querySelectorAll(".rt-head")].map((h) => [...h.children].map((c) => c.textContent));
    expect(heads[0]).toEqual(["Tier", "Provider", "Model", "Reasoning"]);
    expect(heads[1]).toEqual(["Role", "Tier", "Model"]);
    expect(Object.values(REASONING_WORD).join(" ")).toBe("Default None Low Medium High");
    expect(el.textContent?.includes(LONG_DASH)).toBe(false);
  });

  test("a change marks the routing unsaved, saves with it, and a Default choice goes back to Default", async () => {
    const el = await mountProviders();
    expect(status(el)).toBe("Saved");
    await choose(reasoningOf(el, "Balanced"), "medium");
    expect(status(el)).toBe("Unsaved changes");
    // back to where it was is not a change
    await choose(reasoningOf(el, "Balanced"), "default");
    expect(status(el)).toBe("Saved");

    await choose(reasoningOf(el, "Balanced"), "medium");
    await choose(reasoningOf(el, "Deep"), "default");
    const save = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save routing")!;
    await act(async () => save.click());
    await settle();
    expect(status(el)).toBe("Saved. New steps use it right away.");
    expect(reasoningOf(el, "Balanced").value).toBe("medium");
    expect(reasoningOf(el, "Deep").value).toBe("default");
    expect(reasoningOf(el, "Fast").value).toBe("none");
  });
});

describe("demo engine, routing reasoning", () => {
  const call = async (f: ReturnType<typeof createDemoFetch>, method: string, body?: unknown) => {
    const res = await f("/api/routing", { method, headers: { "content-type": "application/json", [CSRF_HEADER]: "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as ModelRouting & { error?: { code: string } } };
  };

  test("Default is stored as the missing value, a known effort is kept, an unknown one is refused", async () => {
    const f = createDemoFetch();
    const start = (await call(f, "GET")).body;
    expect(start.tiers.map((t) => t.reasoning ?? "default")).toEqual(["none", "default", "high"]);

    const next: ModelRouting = { ...start, tiers: start.tiers.map((t) => ({ ...t, reasoning: t.tier === "fast" ? "default" : "low" })) };
    const put = await call(f, "PUT", next);
    expect(put.status).toBe(200);
    expect("reasoning" in put.body.tiers[0]!).toBe(false);
    expect(put.body.tiers.slice(1).map((t) => t.reasoning)).toEqual(["low", "low"]);
    expect((await call(f, "GET")).body.tiers.map((t) => t.reasoning ?? "default")).toEqual(["default", "low", "low"]);

    const bad = await call(f, "PUT", { ...start, tiers: start.tiers.map((t) => ({ ...t, reasoning: "max" })) });
    expect(bad.status).toBe(422);
    expect(bad.body.error?.code).toBe("invalid_body");
  });
});
