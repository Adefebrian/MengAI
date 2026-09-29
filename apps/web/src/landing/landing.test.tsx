import { afterAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readPageLedger, toLedgerEntry, validatePageRecipe } from "@mengai/ui";
import { BYOK, LANDING_LEDGER, LEAD, Landing, TAGLINE } from "./index";
import { LOGO_SRC } from "./brand";
import { HEADLINE } from "./data/bench";
import { DOWNLOAD_URL, REPO_URL, WEB_APP_URL } from "./links";
import { KEY_PROMISES, NAMED_PROVIDERS } from "./sections/Keys";
import { LIFE_TITLE, STATE_WORD } from "./sections/Lifecycle";
import { QUESTIONS } from "./sections/Questions";
import { SAFEGUARDS } from "./sections/Security";
import { FOOTER_LINKS } from "./sections/SiteFooter";
import { FUND, STUDIO } from "./story/lifecycle";

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
const life = () => host.querySelector<HTMLElement>("#company")!;
const status = () => life().querySelector(".lp-track-status")?.textContent;
const cells = () => Array.from(life().querySelectorAll<HTMLElement>(".lp-cell"));

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

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

  test("the paw logo and the wordmark sit in the header and the footer", () => {
    for (const where of [".shell-header", ".kit-footer"]) {
      const mark = host.querySelector(`${where} .lp-mark`);
      expect(mark).not.toBeNull();
      expect(mark!.querySelector("img")?.getAttribute("src")).toBe(LOGO_SRC);
      expect(mark!.querySelector("img")?.getAttribute("alt")).toBe("");
      expect(mark!.textContent).toBe("MengAI");
    }
    expect(LOGO_SRC).toBe("/brand/mengai-logo-192.png");
  });

  test("the hero is the living office: the hero Office scene and the story bar, no chapter row", () => {
    const hero = host.querySelector("#top .lp-hero-office");
    expect(hero).not.toBeNull();
    const office = hero!.querySelector('.office[data-variant="hero"]');
    expect(office).not.toBeNull();
    const stage = office!.querySelector('[role="group"]');
    expect(stage?.getAttribute("aria-label")).toContain("Sample story");
    expect(office!.querySelectorAll(".cat").length).toBeGreaterThan(0);
    const toggle = hero!.querySelector<HTMLButtonElement>(".lp-story .jal-icon-btn");
    expect(toggle?.getAttribute("aria-label")).toMatch(/^(Pause|Play) the story$/);
    expect(hero!.querySelector(".lp-story-caption")?.textContent?.length).toBeGreaterThan(0);
    expect(hero!.textContent).toContain("Sample story, scripted for this page");
    expect(hero!.querySelector(".lp-chapters")).toBeNull();
  });

  test("the lifecycle opens with Oyen alone, the tracker on its first stage and the full floor", () => {
    expect(life().querySelector("h2")?.textContent).toBe(LIFE_TITLE);
    const office = life().querySelector('.office[data-variant="full"]');
    expect(office).not.toBeNull();
    expect(status()).toBe(STUDIO.steps[0]!.caption);
    expect(cells().map((c) => c.querySelector(".lp-cell-label")?.textContent)).toEqual(STUDIO.stages.map((s) => s.label));
    expect(cells().map((c) => c.dataset.state)).toEqual(["now", "next", "next", "next", "next", "next", "next"]);
    expect(life().querySelectorAll('.lp-cell[aria-current="step"]').length).toBe(1);
    expect(life().querySelector(".lp-head h3")?.textContent).toBe("What is in Cemong's head");
    expect(life().querySelectorAll(".lp-scene").length).toBe(STUDIO.steps.length);
  });

  test("a scene plays at a tap: the review bounce sends the tracker back to Working", async () => {
    const bounce = STUDIO.steps.findIndex((s) => s.id === "bounce");
    const button = life().querySelectorAll<HTMLButtonElement>(".lp-scene")[bounce]!;
    await click(button);
    expect(button.getAttribute("aria-current")).toBe("step");
    expect(status()).toBe(STUDIO.steps[bounce]!.caption);
    const states = cells().map((c) => c.dataset.state);
    expect(states[3]).toBe("now");
    expect(states[4]).toBe("back");
    expect(cells()[4]!.querySelector(".lp-cell-state")?.textContent).toBe(STATE_WORD.back);
    const fresh = Array.from(life().querySelectorAll(".lp-head-row[data-fresh] .lp-head-key span:first-child")).map((e) => e.textContent);
    expect(fresh).toEqual(["Strategy", "Memory", "Trust"]);
    expect(life().querySelector(".lp-head")?.textContent).toContain("JEV adopted v4");
    expect(life().querySelector(".lp-track .jal-icon-btn")?.getAttribute("aria-label")).toBe("Pause the story");
  });

  test("the shipped scene reads every stage done", async () => {
    const buttons = life().querySelectorAll<HTMLButtonElement>(".lp-scene");
    await click(buttons[buttons.length - 1]!);
    expect(cells().every((c) => c.dataset.state === "done")).toBe(true);
    expect(life().querySelectorAll('.lp-cell[aria-current="step"]').length).toBe(0);
  });

  test("the switch turns the company into a hedge fund", async () => {
    const kinds = Array.from(life().querySelectorAll<HTMLButtonElement>(".lp-kinds button"));
    expect(kinds.map((b) => b.textContent)).toEqual(["Software studio", "Hedge fund"]);
    expect(kinds[0]!.getAttribute("aria-pressed")).toBe("true");
    await click(kinds[1]!);
    expect(kinds[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(kinds[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(cells().map((c) => c.querySelector(".lp-cell-label")?.textContent)).toEqual(FUND.stages.map((s) => s.label));
    expect(status()).toBe(FUND.steps[0]!.caption);
    expect(life().querySelector(".lp-head h3")?.textContent).toBe("What is in Jahe's head");
    expect(life().querySelector(".office")?.getAttribute("data-variant")).toBe("full");
    expect(life().querySelectorAll(".lp-scene").length).toBe(FUND.steps.length);
    await click(kinds[0]!);
  });

  test("names: Oyen runs the company, every other cat has an Indonesian cat name", () => {
    const text = host.textContent ?? "";
    expect(text).toContain("Oyen");
    for (const old of ["Kopi", "Mochi"]) expect(text.includes(old)).toBe(false);
  });

  test("both calls to action reach the app and the Mac download", () => {
    expect(links(WEB_APP_URL).some((a) => a.textContent === "Open the app")).toBe(true);
    expect(links(WEB_APP_URL).length).toBeGreaterThanOrEqual(3);
    expect(links(DOWNLOAD_URL).filter((a) => a.textContent === "Download for Mac").length).toBeGreaterThanOrEqual(2);
  });

  test("the code editor and the timeline are real UI", () => {
    const bench = host.querySelector("#workbench");
    expect(bench?.querySelector(".lp-editor .lp-code")).not.toBeNull();
    expect(bench?.textContent).toContain("src/report/export.ts");
    expect(bench?.querySelector('[aria-label="Timeline"]')).not.toBeNull();
    const labels = Array.from(bench?.querySelectorAll("[aria-label]") ?? []).map((el) => el.getAttribute("aria-label"));
    expect(labels).toContain("Oyen's decisions");
  });

  test("keys: keychain, providers, the default model, MCP and the trading safety defaults", () => {
    const text = host.querySelector("#keys")?.textContent ?? "";
    expect(host.querySelectorAll("#keys .kit-row").length).toBe(KEY_PROMISES.length);
    expect(NAMED_PROVIDERS.length).toBeGreaterThan(10);
    expect(text).toContain(`${NAMED_PROVIDERS.length} presets`);
    for (const part of ["macOS Keychain", "gpt-4o-mini", "MCP servers", "APIs", "paper", "live trading on", "approval", "hard limits"]) expect(text).toContain(part);
  });

  test("carries the measured token numbers from the benchmark report", () => {
    const text = host.querySelector("#tokens")?.textContent ?? "";
    for (const n of [HEADLINE.savingsPct, HEADLINE.promptCutPct, HEADLINE.cachedSharePct, HEADLINE.savingsIfLegacyCachedPct]) expect(text).toContain(String(n));
    expect(text).toContain(HEADLINE.legacyMaxPrompt.toLocaleString("en-US"));
    expect(text).toContain(HEADLINE.v2MaxPrompt.toLocaleString("en-US"));
    expect(host.querySelectorAll("#tokens .lp-chart-row").length).toBe(HEADLINE.scenarios);
  });

  test("security, answers, and the footer: links, open source, credit and license", () => {
    expect(host.querySelectorAll("#security h3").length).toBe(SAFEGUARDS.length);
    expect(host.querySelectorAll("#faq details").length).toBe(QUESTIONS.length);
    const footer = host.querySelector(".kit-footer");
    const text = footer?.textContent ?? "";
    expect(text).toContain("Built by Adefebrian");
    expect(text).toContain("Apache-2.0");
    expect(text).toContain("Open source");
    const hrefs = Array.from(footer?.querySelectorAll(".kit-footer-links a") ?? []).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(FOOTER_LINKS.map((l) => l.href));
    expect(hrefs).toContain(REPO_URL);
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
