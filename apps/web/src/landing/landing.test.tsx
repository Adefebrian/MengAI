import { afterAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readPageLedger, toLedgerEntry, validatePageRecipe } from "@mengai/ui";
import { LANDING_LEDGER, LEAD, Landing, TAGLINE } from "./index";
import { HEADLINE } from "./data/bench";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const EMDASH = String.fromCharCode(0x2014);
let root: Root | null = null;
const host = document.createElement("div");
document.body.appendChild(host);

async function mount() {
  root = createRoot(host);
  await act(async () => {
    root!.render(<Landing />);
  });
  return host;
}

afterAll(() => {
  act(() => root?.unmount());
  host.remove();
});

const key = (e: Parameters<typeof toLedgerEntry>[0]) => {
  const l = toLedgerEntry(e);
  return l.variant && l.variant !== "default" ? `${l.composition}.${l.variant}` : l.composition;
};

describe("landing", () => {
  test("renders the ledger it declares, and the ledger is lawful", async () => {
    const el = await mount();
    expect(readPageLedger(el).map(key)).toEqual(LANDING_LEDGER.map(key));
    expect(validatePageRecipe(LANDING_LEDGER, "marketing")).toEqual([]);
  });

  test("one h1, the tagline, the lead, and the bring-your-own-key note", () => {
    const h1s = host.querySelectorAll("h1");
    expect(h1s.length).toBe(1);
    expect(h1s[0]!.textContent).toBe(TAGLINE);
    expect(host.textContent).toContain(LEAD);
    const note = host.querySelector(".lp-byok")?.textContent ?? "";
    for (const part of ["Bring your own API key.", "keychain", "Any provider, any model", "gpt-4o-mini by default"]) expect(note).toContain(part);
  });

  test("shows the system: the relay crew, the lane card, the board replay, and a way into the app", () => {
    expect(host.querySelector(".lp-relay .lp-relay-crew")?.children.length).toBe(4);
    expect(host.querySelector(".lp-relay .lp-relay-card")).not.toBeNull();
    expect(host.querySelectorAll(".lp-relay .cat").length).toBe(4);
    expect(host.querySelector("#board .lp-stage")).not.toBeNull();
    expect(host.querySelectorAll("#board .lp-crow .cat").length).toBe(4);
    const toApp = Array.from(host.querySelectorAll<HTMLAnchorElement>("#board a")).filter((a) => a.getAttribute("href") === "/app");
    expect(toApp.some((a) => a.textContent === "Open the app")).toBe(true);
  });

  test("every player control is a named 44px button", () => {
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>(".lp-controls button"));
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) expect((b.getAttribute("aria-label") ?? b.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  test("carries the measured token numbers from the benchmark report", () => {
    const text = host.querySelector("#tokens")?.textContent ?? "";
    expect(text).toContain(`${HEADLINE.savingsPct}%`);
    expect(text).toContain(`${HEADLINE.promptCutPct}%`);
    expect(text).toContain(`${HEADLINE.cachedSharePct}%`);
    expect(text).toContain(HEADLINE.legacyMaxPrompt.toLocaleString("en-US"));
  });

  test("covers the brief: judge, security, open source, download, credit and license", () => {
    for (const id of ["loop", "crew", "decisions", "tokens", "keys", "security", "source", "faq", "get"]) expect(host.querySelector(`#${id}`)).not.toBeNull();
    const text = host.textContent ?? "";
    expect(text).toContain("UNVERIFIED BY JEV");
    expect(text).toContain("Built by Adefebrian");
    expect(text).toContain("Apache-2.0");
    const downloads = Array.from(host.querySelectorAll("a")).filter((a) => a.textContent === "Download for Mac");
    expect(downloads.length).toBeGreaterThanOrEqual(2);
  });

  test("carries no em-dash or emoji", () => {
    const text = host.textContent ?? "";
    expect(text.includes(EMDASH)).toBe(false);
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });

  test("keeps local computer control off the page", () => {
    const text = (host.textContent ?? "").toLowerCase();
    for (const word of ["operator", "screen capture", "keyboard and pointer", "accessibility"]) expect(text.includes(word)).toBe(false);
  });
});
