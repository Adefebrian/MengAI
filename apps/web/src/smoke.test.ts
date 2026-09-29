// Browser smoke test: does the built SPA actually render in a real browser.
// Uses puppeteer-core against the OS's installed Chromium/Chrome, never the
// heavy bundled Puppeteer download. Gated: when no system Chromium and no
// CHROME_PATH are available, every test in this file is skipped so
// `bun test` still passes in an environment with no browser installed
// (e.g. this template's own CI verification, or a bare dev container).
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Browser } from "puppeteer-core";

function findChromePath(): string | undefined {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const candidates = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

const chromePath = findChromePath();

describe.skipIf(!chromePath)("smoke: built SPA renders", () => {
  let browser: Browser;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    // The happy-dom preload (required for App.test.tsx) patches globals like
    // fetch/WebSocket in this same process. puppeteer-core needs the real
    // Bun implementations to talk to the browser's remote debugging
    // protocol, so undo the patch for the lifetime of this suite.
    GlobalRegistrator.unregister();

    const distIndex = new URL("../dist/index.html", import.meta.url);
    if (!existsSync(distIndex)) {
      // Build once if a previous `bun run build` has not populated dist/ yet.
      await import("../build");
    }

    const puppeteer = (await import("puppeteer-core")).default;
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });

    const { default: app } = await import("../server");
    server = Bun.serve({ fetch: app.fetch, port: 0 });
  });

  afterAll(async () => {
    await browser?.close();
    server?.stop();
    GlobalRegistrator.register();
  });

  test("renders the cat company at work on the sample run", async () => {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${server.port}/app/runs/demo?demo=1`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".run-office");
    const heading = await page.$eval("h1", (el) => el.textContent);
    expect(heading).toContain("CSV export");
    const office = await page.$eval(".run-office", (el) => el.textContent ?? "");
    for (const name of ["Kopi", "Mochi", "Klepon", "Tempe", "Onde", "Cilok"]) expect(office).toContain(name);
    const now = await page.$eval(".status-now", (el) => el.textContent ?? "");
    expect(now.length).toBeGreaterThan(0);
    await page.close();
  });
});
