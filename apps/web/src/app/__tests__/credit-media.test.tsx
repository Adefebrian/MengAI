// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The About page carries the credit and the new terms (source available
// under the PolyForm Noncommercial License 1.0.0, free for personal and
// noncommercial use, commercial use by written permission); engine media
// loads in CORS mode so the website, another origin, can show it; and a
// cat's ask is answered through the run's message route, the one the
// engine serves, never through an automation route it lacks.
import { afterEach, describe, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import type { ApprovalDTO } from "@mengai/shared";
import { EngineMedia } from "@mengai/ui/src/product";
import { AppRoot } from "../AppRoot";
import { askAnswer } from "../run/useRunData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReactRoot | null = null;
let host: HTMLElement | null = null;

async function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
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

describe("About: the credit and the license", () => {
  test("source available under PolyForm Noncommercial 1.0.0, the credit linked, commercial use by permission", async () => {
    window.history.pushState(null, "", "/app/about?demo=1");
    const el = await render(<AppRoot route={{ id: "about", params: {} }} location={{ pathname: "/app/about", search: "?demo=1", hash: "" }} demo />);
    const text = el.textContent ?? "";
    expect(el.querySelector(".app-lead")?.textContent).toContain("Built by Adefebrian, source available under the PolyForm Noncommercial License 1.0.0, free for personal and");
    expect(text).toContain("Free for personal and noncommercial use. Commercial use needs written permission: adefebrianpro@gmail.com");
    expect(text).not.toMatch(/open.?source|apache/i);
    const link = (label: string) => [...el.querySelectorAll<HTMLAnchorElement>(".p-kv-row")].find((r) => r.querySelector("dt")?.textContent === label)?.querySelector("a");
    expect(link("Built by")?.getAttribute("href")).toBe("https://adefebrian.com");
    expect(link("Built by")?.textContent).toBe("Adefebrian (adefebrian.com)");
    expect(link("License")?.getAttribute("href")).toBe("https://github.com/Adefebrian/MengAI/blob/main/LICENSE");
    expect(link("License")?.textContent).toBe("PolyForm Noncommercial License 1.0.0");
    expect(link("Use")?.getAttribute("href")).toBe("mailto:adefebrianpro@gmail.com");
  });
});

describe("engine media", () => {
  test("images and clips from the engine load in CORS mode, in the kit's media frame", async () => {
    const el = await render(
      <>
        <EngineMedia kind="image" ratio="4/3" src="http://127.0.0.1:4280/api/assets/a-1/file" alt="Export button" width={1024} height={1024} />
        <EngineMedia kind="video" ratio="4/3" src="http://127.0.0.1:4280/api/assets/a-2/file" alt="A short loop" />
      </>,
    );
    const img = el.querySelector("img")!;
    const video = el.querySelector("video")!;
    expect(img.getAttribute("crossorigin")).toBe("anonymous");
    expect(video.getAttribute("crossorigin")).toBe("anonymous");
    expect(img.closest(".kit-media-frame")).not.toBeNull();
    expect(video.closest("figure.kit-media")?.getAttribute("data-kind")).toBe("video");
  });
});

describe("answering a cat's ask", () => {
  const ask: ApprovalDTO = {
    id: "ap-1",
    runId: "run-1",
    agentId: "agent-2",
    capability: "shell",
    risk: "sensitive",
    title: "Install the chart library.",
    detail: {},
    status: "pending",
    scope: "once",
    createdAt: 0,
    decidedAt: null,
    expiresAt: 60_000,
  };

  test("the answer is a note to the asking cat, in plain words", () => {
    expect(askAnswer(ask, "approve", "once")).toEqual({ text: "Yes, go ahead this once: Install the chart library.", agentId: "agent-2" });
    expect(askAnswer(ask, "approve", "session").text).toBe("Yes, go ahead: Install the chart library. You may do this again for the rest of this run without asking.");
    expect(askAnswer({ ...ask, agentId: null }, "deny", "once")).toEqual({ text: "No, do not do this: Install the chart library." });
  });

  test("the run page never calls the automation approvals route", async () => {
    const src = await Bun.file(new URL("../run/useRunData.ts", import.meta.url)).text();
    expect(src).not.toContain("/api/automation/approvals");
    expect(src).toContain('"POST /api/runs/:id/message", { params: { id: runId }, body: askAnswer(a, decision, scope) }');
  });
});
