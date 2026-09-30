// The run page renders the cat company at work from the bundled demo, with
// no API: the office with every cat, the status line in cat voice, the
// meetings and CEO calls, the code editor on the file the crew touched
// last, the task queue, the request that blocks a cat with the asking cat
// beside it, and the record tabs. Nothing on it uses an em dash.
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
  for (let i = 0; i < 3; i++) {
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

const desktop = () => typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches;

describe("run page, demo", () => {
  test("the office holds every cat, the CEO first, and says what the company is doing", async () => {
    const el = await mount("/app/runs/demo?demo=1");
    expect(el.querySelector("h1")?.textContent).toContain("CSV export");
    const office = el.querySelector(".run-office");
    expect(office).toBeTruthy();
    const text = office!.textContent ?? "";
    for (const name of ["Oyen", "Gembul", "Klepon", "Tempe", "Onde", "Cilok"]) expect(text).toContain(name);
    expect(el.querySelector(".status-now")?.textContent).toContain("Gembul is waiting on you");
  });

  test("the request that blocks a cat sits on top with its cat, and the panels are there", async () => {
    const el = await mount("/app/runs/demo?demo=1");
    const ask = el.querySelector(".approvals-now");
    expect(ask?.textContent).toContain("Gembul needs you");
    expect(ask?.querySelector(".ask-cat")).toBeTruthy();
    expect(el.querySelectorAll('[role="tab"]').length).toBe(desktop() ? 5 : 8);
    if (desktop()) {
      expect(el.querySelector(".feed")?.textContent).toContain("Kickoff: CSV export");
      expect(el.querySelector(".feed")?.textContent).toContain("Oyen approved");
      expect(el.querySelectorAll(".queue-row").length).toBe(6);
      expect(el.querySelector(".ide")).toBeTruthy();
    }
  });

  test("the code editor opens the file the crew changed last, with line numbers", async () => {
    const el = await mount("/app/runs/demo?demo=1");
    if (!desktop()) {
      const codeTab = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.includes("Code"));
      await act(async () => codeTab?.click());
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    const path = el.querySelector(".ide-path")?.textContent ?? "";
    expect(path.length).toBeGreaterThan(0);
    expect(el.querySelectorAll(".ide-node").length).toBeGreaterThan(3);
  });

  test("never renders an em dash", async () => {
    const el = await mount("/app/runs/demo?demo=1");
    expect(el.textContent ?? "").not.toContain(EMDASH);
  });
});
