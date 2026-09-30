// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Live preview and Open folder, from the bundled demo with no API: a
// shipped run leads with the preview (Start preview, then the frame with
// its URL, widths, Reload, Open in new tab and Stop, in a sandboxed
// iframe); before it ships the preview opens from Preview so far in the
// header and polls through installing and starting; a failed start shows
// the reason and the output in a disclosure; a project with nothing to run
// says why with Open folder as the next step; Open folder sits on the run
// head and on every project row on Home.
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { AppRoot, type AppRouteId } from "../AppRoot";
import { PREVIEW_POLL_MS } from "../run/Preview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReactRoot | null = null;
let host: HTMLElement | null = null;

/** happy-dom starts on about:blank, where the query the demo reads is empty. */
const happy = (globalThis as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM;

const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
};

async function mount(path: string, id: AppRouteId = "run", params: Record<string, string> = { id: "demo" }) {
  happy.setURL(`http://localhost${path}`);
  const url = new URL(path, "http://localhost");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AppRoot route={{ id, params }} location={{ pathname: url.pathname, search: url.search, hash: "" }} demo />);
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

const buttons = (el: Element, label: string) => [...el.querySelectorAll<HTMLElement>("button, a")].filter((b) => b.textContent?.trim() === label);
const press = async (b: HTMLElement) => {
  await act(async () => {
    b.click();
  });
  await settle();
};

describe("live preview", () => {
  test("a shipped run leads with the preview and its Start preview call to action", async () => {
    const el = await mount("/app/runs/demo?demo=1&at=end");
    const region = el.querySelector(".run-preview")!;
    expect(region).toBeTruthy();
    const office = el.querySelector(".run-office")!;
    expect(region.compareDocumentPosition(office) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.textContent).toContain("The crew shipped it");
    expect(buttons(region, "Start preview").length).toBe(1);
    expect(buttons(region, "Open folder").length).toBe(1);
    expect(buttons(el.querySelector(".run-head")!, "Open folder").length).toBe(1);
    expect(buttons(el.querySelector(".run-head")!, "Preview so far").length).toBe(0);
  });

  test("ready: the URL, the widths, Reload, Open in new tab, Stop, and a sandboxed frame", async () => {
    const el = await mount("/app/runs/demo?demo=1&at=end&preview=ready");
    const region = el.querySelector(".run-preview")!;
    expect(region.textContent).toContain("Ready");
    expect(el.querySelector(".preview-url")?.textContent).toContain("/demo-site/index.html");
    const frame = region.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-same-origin allow-popups");
    expect(frame.getAttribute("title")).toContain("Live preview of");
    const radios = [...region.querySelectorAll<HTMLButtonElement>('[data-name="preview-width"] [role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(["Phone", "Tablet", "Full"]);
    await press(radios[0]!);
    expect(region.querySelector(".preview-frame")?.getAttribute("data-width")).toBe("phone");
    const open = buttons(region, "Open in new tab")[0]!;
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toContain("noopener");
    expect(buttons(region, "Reload").length).toBe(1);
    await press(buttons(region, "Stop")[0]!);
    expect(el.querySelector(".run-preview")?.textContent).toContain("Stopped");
    expect(buttons(el.querySelector(".run-preview")!, "Start again").length).toBe(1);
  });

  test("before it ships: Preview so far opens it, and it polls through installing and starting to ready", async () => {
    const el = await mount("/app/runs/demo?demo=1");
    expect(el.querySelector(".run-preview")).toBeNull();
    const open = buttons(el.querySelector(".run-head")!, "Preview so far")[0]!;
    expect(open).toBeTruthy();
    await press(open);
    const region = () => el.querySelector(".run-preview")!;
    expect(region().textContent).toContain("Installing");
    expect(region().querySelector("iframe")).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2600 + 2 * PREVIEW_POLL_MS));
    });
    await settle();
    expect(region().textContent).toContain("Ready");
    expect(region().querySelector("iframe")).toBeTruthy();
  }, 15_000);

  test("a failed start: the reason, the output in a disclosure, Try again and Open folder", async () => {
    const el = await mount("/app/runs/demo?demo=1&at=end&preview=failed");
    const region = el.querySelector(".run-preview")!;
    expect(region.textContent).toContain("The preview did not start");
    const log = region.querySelector("details.preview-log")!;
    expect(log.hasAttribute("open")).toBe(false);
    expect(log.querySelector("pre")?.textContent).toContain('script "dev" exited with code 1');
    expect(buttons(region, "Try again").length).toBe(1);
    expect(buttons(region, "Open folder").length).toBe(1);
  });

  test("nothing to preview yet: says why, with Open folder as the next step", async () => {
    const el = await mount("/app/runs/demo?demo=1&at=end&preview=empty");
    const region = el.querySelector(".run-preview")!;
    expect(region.textContent).toContain("Nothing to preview yet");
    expect(region.textContent).toContain("no index.html");
    expect(buttons(region, "Open folder").length).toBe(1);
    expect(buttons(region, "Start preview").length).toBe(0);
  });
});

describe("open folder", () => {
  test("every project row on Home has Open folder, and it confirms for assistive tech", async () => {
    const el = await mount("/app?demo=1", "home", {});
    const rows = [...el.querySelectorAll(".project-row")];
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(buttons(row, "Open folder").length).toBe(1);
    await press(buttons(rows[0]!, "Open folder")[0]!);
    expect(rows[0]!.textContent).toContain("Opened in Finder");
    expect(el.querySelector("#add-project")).toBeTruthy();
    expect(el.textContent).not.toContain("Add a folder");
  });
});
