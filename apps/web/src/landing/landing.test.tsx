import { afterAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readPageLedger, toLedgerEntry, validatePageRecipe } from "@mengai/ui";
import { BYOK, LANDING_LEDGER, LEAD, Landing, TAGLINE } from "./index";
import { HEADLINE } from "./data/bench";
import { DOWNLOAD_URL, WEB_APP_URL } from "./links";
import { CHAT_PROVIDERS } from "./sections/Keys";
import { QUESTIONS } from "./sections/Questions";
import { SAFEGUARDS } from "./sections/Security";
import { COMPANY_STEPS } from "./sections/Company";
import { CREW } from "./story/script";

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

const links = (href: string) => Array.from(host.querySelectorAll<HTMLAnchorElement>("a")).filter((a) => a.getAttribute("href") === href);

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
    expect(note).toContain(BYOK.title);
    for (const part of ["keychain", "Any provider, any model", "gpt-4o-mini by default"]) expect(note).toContain(part);
  });

  test("the hero shows the company at work: every cat at a desk, the plan, the story bar", () => {
    const hero = host.querySelector("#top .lp-hero-office");
    expect(hero).not.toBeNull();
    const floor = hero!.querySelector(".lp-floor");
    expect(floor?.getAttribute("role")).toBe("group");
    expect(floor?.getAttribute("aria-label")).toContain("Sample story");
    expect(floor!.querySelectorAll(".cat").length).toBe(CREW.length);
    expect(floor!.querySelectorAll(".lp-floor-board > li").length).toBe(6);
    const toggle = hero!.querySelector<HTMLButtonElement>(".lp-story-toggle");
    expect(toggle?.getAttribute("aria-label")).toMatch(/^(Pause|Play) the story$/);
    expect(hero!.querySelector(".lp-story-caption")?.textContent?.length).toBeGreaterThan(0);
    expect(hero!.textContent).toContain("Sample story, scripted for this page");
  });

  test("both calls to action reach the app and the Mac download", () => {
    expect(links(WEB_APP_URL).some((a) => a.textContent === "Open the app")).toBe(true);
    expect(links(WEB_APP_URL).length).toBeGreaterThanOrEqual(3);
    expect(links(DOWNLOAD_URL).filter((a) => a.textContent === "Download for Mac").length).toBeGreaterThanOrEqual(2);
  });

  test("how the company works: five steps, each a named button and a view", () => {
    const buttons = host.querySelectorAll<HTMLButtonElement>("#company .lp-step-button");
    expect(buttons.length).toBe(COMPANY_STEPS.length);
    expect(host.querySelectorAll("#company .lp-steps-frame").length).toBe(COMPANY_STEPS.length);
    expect(host.querySelectorAll("#company .lp-steps-frame[data-active]").length).toBe(1);
    expect(host.querySelectorAll('#company .lp-steps-frame[aria-hidden="true"]').length).toBe(COMPANY_STEPS.length - 1);
    const text = host.querySelector("#company")?.textContent ?? "";
    for (const word of ["Kopi plans", "desks", "meet", "Kopi decides", "unreviewed"]) expect(text).toContain(word);
  });

  test("the code editor and the timeline are real UI", () => {
    const bench = host.querySelector("#workbench");
    expect(bench?.querySelector(".lp-editor .lp-code")).not.toBeNull();
    expect(bench?.textContent).toContain("src/report/export.ts");
    expect(bench?.querySelector('[aria-label="Timeline"]')).not.toBeNull();
    const labels = Array.from(bench?.querySelectorAll("[aria-label]") ?? []).map((el) => el.getAttribute("aria-label"));
    expect(labels).toContain("Kopi's decisions");
  });

  test("keys: the real provider presets and the default model", () => {
    const text = host.querySelector("#keys")?.textContent ?? "";
    expect(CHAT_PROVIDERS.length).toBeGreaterThan(10);
    for (const p of CHAT_PROVIDERS) expect(text).toContain(p);
    expect(text).toContain("gpt-4o-mini");
    expect(text).toContain("macOS Keychain");
  });

  test("carries the measured token numbers from the benchmark report", () => {
    const text = host.querySelector("#tokens")?.textContent ?? "";
    for (const n of [HEADLINE.savingsPct, HEADLINE.promptCutPct, HEADLINE.cachedSharePct, HEADLINE.savingsIfLegacyCachedPct]) expect(text).toContain(String(n));
    expect(text).toContain(HEADLINE.legacyMaxPrompt.toLocaleString("en-US"));
    expect(text).toContain(HEADLINE.v2MaxPrompt.toLocaleString("en-US"));
    expect(host.querySelectorAll("#tokens .lp-chart-row").length).toBe(HEADLINE.scenarios);
  });

  test("security, answers, open source, credit and license", () => {
    expect(host.querySelectorAll("#security h3").length).toBe(SAFEGUARDS.length);
    expect(host.querySelectorAll("#faq .kit-faq-pair").length).toBe(QUESTIONS.length);
    const close = host.querySelector("#get")?.textContent ?? "";
    expect(close).toContain("Built by Adefebrian");
    expect(close).toContain("Apache-2.0");
    expect(close).toContain("open source");
  });

  test("every control has a name", () => {
    for (const b of Array.from(host.querySelectorAll<HTMLButtonElement>("button"))) {
      expect((b.getAttribute("aria-label") ?? b.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
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
