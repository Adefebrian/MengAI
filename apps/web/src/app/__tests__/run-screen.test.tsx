// The run screen renders the crew at work from the bundled demo, with no
// API: one lane per cat with its CatCard, the task cards in their lanes,
// the request that blocks a cat with the asking cat beside it, and the
// record tabs. Nothing on it uses an em dash.
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { AppRoot } from "../AppRoot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMDASH = "\u2014";
let root: ReactRoot | null = null;
let host: HTMLElement | null = null;

async function mount(path: string) {
  window.history.pushState(null, "", path);
  const url = new URL(path, "http://localhost");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AppRoot route={{ id: "run", params: { id: "demo" } }} location={{ pathname: url.pathname, search: url.search, hash: "" }} demo />,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.history.pushState(null, "", "/");
});

describe("run screen, demo", () => {
  test("draws one lane per cat, lead first, with its CatCard", async () => {
    const el = await mount("/app/runs/demo?demo=1");
    const lanes = el.querySelectorAll(".lane");
    expect(lanes.length).toBe(6);
    expect(el.querySelectorAll(".lane .cat-card").length).toBe(6);
    expect(lanes[0]!.getAttribute("aria-label")).toBe("Kopi's lane");
    expect(el.querySelector("h1")?.textContent).toContain("CSV export");
  });

  test("puts every task card in a lane and the waiting request on top with its cat", async () => {
    const el = await mount("/app/runs/demo?demo=1");
    expect(el.querySelectorAll(".lane .tcard").length).toBe(6);
    const ask = el.querySelector(".approvals-now");
    expect(ask?.textContent).toContain("Mochi needs you");
    expect(ask?.querySelector(".ask-cat")).toBeTruthy();
    expect(el.querySelectorAll('[role="tab"]').length).toBe(5);
  });

  test("never renders an em dash", async () => {
    const el = await mount("/app/runs/demo?demo=1");
    expect(el.textContent ?? "").not.toContain(EMDASH);
  });
});
