// The site root files (public/, copied to dist/ by build.ts) and the page
// head: AI training crawlers are turned away while search and AI search
// retrieval still find MengAI, text and data mining rights are reserved,
// llms.txt matches the repo root, and every page carries the credit and
// the license.
import { describe, expect, test } from "bun:test";
import { CONSOLE_CREDIT, CREDIT, LICENSE_URL, TERMS } from "./credit";

const read = (rel: string) => Bun.file(new URL(rel, import.meta.url)).text();

const TRAINING = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
  "cohere-training-data-crawler",
  "Diffbot",
  "omgili",
  "ImagesiftBot",
  "Timpibot",
];
const SEARCH = ["Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot"];

/** robots.txt groups: each agent name to the rules of its own group. */
function groups(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [key, ...rest] = line.split(":");
    const field = key!.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (field === "user-agent") {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value);
      out.set(value, out.get(value) ?? []);
    } else {
      inRules = true;
      for (const a of agents) out.get(a)!.push(`${field}: ${value}`);
    }
  }
  return out;
}

describe("site root files", () => {
  test("robots.txt disallows every AI training crawler and allows search and AI search", async () => {
    const g = groups(await read("../public/robots.txt"));
    for (const bot of TRAINING) expect(g.get(bot)).toEqual(["disallow: /"]);
    for (const bot of SEARCH) expect(g.get(bot)).toEqual(["allow: /"]);
    expect(g.get("*")).toEqual(["allow: /"]);
  });

  test("tdmrep.json reserves text and data mining rights with the brand policy", async () => {
    const rules = JSON.parse(await read("../public/.well-known/tdmrep.json"));
    expect(rules).toEqual([{ location: "/", "tdm-reservation": 1, "tdm-policy": "https://github.com/Adefebrian/MengAI/blob/main/BRAND.md" }]);
  });

  test("llms.txt is the repo root's own file", async () => {
    expect(await read("../public/llms.txt")).toBe(await read("../../../llms.txt"));
  });
});

describe("page head and console credit", () => {
  test("index.html names the author, the copyright and the TDM reservation, with the credit in a comment", async () => {
    const html = await read("./index.html");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="author" content="Adefebrian" />');
    expect(html).toMatch(/<meta name="copyright" content="Copyright 2026 Adefebrian \(https:\/\/adefebrian\.com\)\. Source available under the PolyForm Noncommercial License 1\.0\.0\./);
    expect(html).toContain('<meta name="tdm-reservation" content="1" />');
    expect(html).toContain('<meta name="tdm-policy" content="https://github.com/Adefebrian/MengAI/blob/main/BRAND.md" />');
    const comment = html.match(/<!--([\s\S]*?)-->/)?.[1] ?? "";
    expect(comment).toContain("Built by Adefebrian (https://adefebrian.com).");
    expect(comment).toContain("PolyForm Noncommercial License 1.0.0");
    expect(comment).toContain("adefebrianpro@gmail.com");
  });

  test("the console line carries the credit and the license", () => {
    expect(CREDIT).toBe("Built by Adefebrian (https://adefebrian.com)");
    expect(TERMS).toContain("PolyForm Noncommercial License 1.0.0, free for personal and noncommercial use");
    expect(CONSOLE_CREDIT).toContain(CREDIT);
    expect(CONSOLE_CREDIT).toContain(LICENSE_URL);
    expect(CONSOLE_CREDIT).toContain("adefebrianpro@gmail.com");
    expect(LICENSE_URL).toBe("https://github.com/Adefebrian/MengAI/blob/main/LICENSE");
  });

  test("the site files and the head carry no em-dash and none of the old license words", async () => {
    const all = [await read("./index.html"), await read("../public/robots.txt"), await read("../public/llms.txt"), CONSOLE_CREDIT].join("\n");
    expect(all.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(all).not.toMatch(/open.?source|apache/i);
  });
});
