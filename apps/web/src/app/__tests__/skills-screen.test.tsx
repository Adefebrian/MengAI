// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The Skills screen and the written skills in a cat's mind panel, from the
// bundled demo with no API: the built-in JAL-AIDev pack marked as shipped
// with MengAI, its switch and its text; the owner's skills written in the
// side sheet, checked inline, edited and deleted; the learned recipes; the
// empty and error states; and in the mind panel what each cat read, built
// in or yours, with its tokens. The form rules and the demo store are
// checked alone too, and the demo pack is held to the engine's pack.
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { AppRoot, type AppRouteId } from "../AppRoot";
import { AGENT_ROLES } from "@mengai/shared";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL_BODY_MAX, SKILL_SUMMARY_MAX, estimateTokens, promptTokens, roleWord, rolesWord, kindsWord, summaryFrom, validateSkill, type SkillDraft } from "../crewSkills";
import { WrittenSkills } from "../run/Mind";
import { DEMO_PACK, createCrewSkillState } from "../../demo/crewSkills";

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

/** happy-dom starts on about:blank, where pushState cannot set a query or hash; the demo reads both. */
const setUrl = (href: string) => (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(href);

async function mount(id: AppRouteId, path: string, params: Record<string, string> = {}) {
  const url = new URL(path, "http://localhost");
  setUrl(url.href);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AppRoot route={{ id, params }} location={{ pathname: url.pathname, search: url.search, hash: url.hash }} demo />);
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

const press = async (b: Element | null | undefined) => {
  expect(b).toBeTruthy();
  await act(async () => {
    (b as HTMLElement).click();
  });
  await settle(2);
};

const type = async (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const buttonIn = (scope: ParentNode, label: string) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
/** the side sheet that holds the write form */
const sheet = (el: HTMLElement) => el.querySelector<HTMLElement>('dialog[data-kind="drawer"]')!;
const sheetOpen = (el: HTMLElement) => sheet(el).hasAttribute("open") && !!sheet(el).querySelector(".cskill-form");
const mineRegion = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("section.app-region")].find((r) => r.querySelector("h2")?.textContent === "Your skills")!;
const checkbox = (scope: ParentNode, label: string) => [...scope.querySelectorAll('[role="checkbox"]')].find((b) => b.querySelector(".app-check-label")?.textContent === label);
const inputByLabel = (scope: HTMLElement, label: string) => {
  const l = [...scope.querySelectorAll("label")].find((x) => x.textContent?.trim() === label)!;
  return scope.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${CSS.escape(l.htmlFor)}`)!;
};

describe("skills screen, demo", () => {
  test("the built-in pack: every skill marked as shipped with MengAI, with roles, kinds, tokens, a switch and its text", async () => {
    const el = await mount("skills", "/app/skills?demo=1");
    expect(el.querySelector("h1")?.textContent).toBe("Skills");
    const list = el.querySelector('[aria-label="Built-in skills"]')!;
    const rows = list.querySelectorAll(".cskill-row");
    expect(rows.length).toBe(DEMO_PACK.length);
    for (const r of rows) {
      expect(r.textContent).toContain("Ships with MengAI");
      expect(r.textContent).toMatch(/\d+ tokens/);
      expect(r.querySelector('[role="switch"][aria-checked="true"]')).toBeTruthy();
    }
    const first = rows[0]!;
    expect(first.textContent).toContain("Design law and tidiness");
    expect(first.textContent).toContain("Designer, Engineer, Reviewer, QA");
    expect(first.textContent).toContain("Software studio");
    expect(el.textContent).toContain(`${DEMO_PACK.length} of ${DEMO_PACK.length} on`);

    // the text opens in place under the row: tidiness first
    expect(first.querySelector(".cskill-text")).toBeNull();
    await press(buttonIn(first, "Read the text"));
    expect(first.querySelector(".cskill-text")?.textContent ?? "").toContain("Tidy first: nothing overlaps");
    expect(first.querySelector('[aria-expanded="true"]')?.textContent).toContain("Hide the text");
    // and the system design skill keeps the project's stack, Bun and Hono only when nothing is set
    const sys = [...rows].find((r) => r.textContent?.includes("System design and architecture"))!;
    await press(buttonIn(sys, "Read the text"));
    const stack = sys.querySelector(".cskill-text")?.textContent ?? "";
    expect(stack).toContain("keep the project's stack and conventions");
    expect(stack).toContain("With nothing specified, recommend Bun, Hono, React and TypeScript");
    expect(el.textContent?.includes(LONG_DASH)).toBe(false);
  });

  test("switching a built-in skill off keeps it in the list, off", async () => {
    const el = await mount("skills", "/app/skills?demo=1");
    const row = () => [...el.querySelectorAll(".cskill-row")].find((r) => r.textContent?.includes("Motion and immersive craft"))!;
    const sw = () => row().querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(sw().getAttribute("aria-label")).toBe("Enabled, Motion and immersive craft");
    await press(sw());
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(row().hasAttribute("data-off")).toBe(true);
    expect(el.textContent).toContain(`${DEMO_PACK.length - 1} of ${DEMO_PACK.length} on`);
  });

  test("your skills and the learned recipes: the sample skill with its actions, the crew's recipes below", async () => {
    const el = await mount("skills", "/app/skills?demo=1");
    const mine = el.querySelector('[aria-label="Your skills"]')!;
    expect(mine.querySelectorAll('[data-kind="crew-skill"]').length).toBe(1);
    expect(mine.textContent).toContain("House commit style");
    expect(mine.textContent).toContain("Engineer, Reviewer");
    expect(mine.textContent).toContain("Edited 1 time");
    expect(mine.querySelector('[aria-label="Edit House commit style"]')).toBeTruthy();
    expect(mine.querySelector('[aria-label="Delete House commit style"]')).toBeTruthy();
    const text = el.textContent ?? "";
    expect(text).toContain("Learned by the crew");
    expect(text).toContain("Run the report tests");
    expect(text).toContain("Dependency audit");
  });

  test("the write form opens in the side sheet, checks inline, counts characters to 6,000, then saves a new skill for the ticked roles", async () => {
    const el = await mount("skills", "/app/skills?demo=1");
    expect(sheetOpen(el)).toBe(false);
    await press(buttonIn(mineRegion(el), "Write a skill"));
    expect(sheetOpen(el)).toBe(true);
    const f = sheet(el);
    expect(f.querySelector("h2")?.textContent).toBe("Write a skill");
    expect(f.textContent).toContain("0 of 6,000");
    expect(document.activeElement).toBe(inputByLabel(f, "Name"));

    await press(buttonIn(f, "Save skill"));
    expect(f.textContent).toContain("Name it, so you and the crew can tell skills apart.");
    expect(f.textContent).toContain("Write what the cats should do.");
    expect(inputByLabel(f, "Name").getAttribute("aria-invalid")).toBe("true");

    // a name already taken is caught before it is sent
    await type(inputByLabel(f, "Name"), "house commit style");
    await press(buttonIn(f, "Save skill"));
    expect(f.textContent).toContain("A skill called house commit style is there already.");

    // over the limit shows at once, the counter turns
    const body = inputByLabel(f, "Instructions") as HTMLTextAreaElement;
    await type(body, "x".repeat(SKILL_BODY_MAX + 5));
    expect(f.querySelector(".cskill-count")?.getAttribute("data-state")).toBe("over");
    expect(f.textContent).toContain("Too long by 5 characters.");

    const text = "Use pnpm and Vue 3 in this repo. Keep every component under 200 lines.";
    const tokens = promptTokens("Our stack", text);
    await type(inputByLabel(f, "Name"), "Our stack");
    await type(body, text);
    expect(f.textContent).toContain(`About ${tokens} tokens`);
    // every role is offered, the operator too; pick one: every role off, then QA
    await press(checkbox(f, "Every role"));
    expect([...f.querySelectorAll(".connector-roles .app-check-label")].map((x) => x.textContent)).toEqual(AGENT_ROLES.map(roleWord));
    await press(checkbox(f, "Engineer"));
    await press(buttonIn(f, "Save skill"));
    expect(f.textContent).toContain("Tick at least one role, or let every role read it.");
    await press(checkbox(f, "QA"));
    await press(buttonIn(f, "Save skill"));
    await settle();

    // the sheet closes, the new row and the confirmation show under Your skills
    expect(sheetOpen(el)).toBe(false);
    const mine = el.querySelector('[aria-label="Your skills"]')!;
    expect(mine.querySelectorAll('[data-kind="crew-skill"]').length).toBe(2);
    const row = [...mine.querySelectorAll('[data-kind="crew-skill"]')].find((r) => r.textContent?.includes("Our stack"))!;
    expect(row.textContent).toContain("QA");
    expect(row.textContent).toContain(`${tokens} tokens`);
    // no summary given: the first line of the text stands in, as the engine keeps it
    expect(row.textContent).toContain(summaryFrom(text));
    expect(mineRegion(el).querySelector(".app-form-status")?.textContent).toContain("Our stack saved.");

    // opened again, the form starts empty
    await press(buttonIn(mineRegion(el), "Write a skill"));
    expect((inputByLabel(sheet(el), "Name") as HTMLInputElement).value).toBe("");
    await press(buttonIn(sheet(el), "Cancel"));
    expect(sheetOpen(el)).toBe(false);
  });

  test("edit loads the skill into the form and saves it; delete asks first, then the empty state shows", async () => {
    const el = await mount("skills", "/app/skills?demo=1");
    const mine = () => el.querySelector('[aria-label="Your skills"]');
    await press(mine()!.querySelector('[aria-label="Edit House commit style"]'));
    const f = sheet(el);
    expect(sheetOpen(el)).toBe(true);
    expect(f.querySelector("h2")?.textContent).toBe("Edit House commit style");
    const name = inputByLabel(f, "Name") as HTMLInputElement;
    expect(name.value).toBe("House commit style");
    expect(document.activeElement).toBe(name);
    await type(name, "Commit style");
    await press(buttonIn(f, "Save changes"));
    await settle();
    expect(sheetOpen(el)).toBe(false);
    expect(mine()!.textContent).toContain("Commit style");
    expect(mine()!.textContent).toContain("Edited 2 times");
    expect(mineRegion(el).querySelector(".app-form-status")?.textContent).toContain("Commit style updated.");

    await press(mine()!.querySelector('[aria-label="Delete Commit style"]'));
    const confirm = document.querySelector('[role="alertdialog"]') ?? document.querySelector("dialog[open]");
    expect(confirm?.textContent).toContain("Delete Commit style?");
    await press(buttonIn(confirm!, "Delete"));
    await settle();
    expect(mine()).toBeNull();
    expect(el.textContent).toContain("No skills of your own yet");
    expect(mineRegion(el).querySelector(".app-form-status")?.textContent).toContain("Commit style deleted.");
  });

  test("empty and error states: the pack alone, and a list that did not load with Try again", async () => {
    const empty = await mount("skills", "/app/skills?demo=1&skills=empty");
    expect(empty.textContent).toContain("No skills of your own yet");
    expect(empty.querySelectorAll(".cskill-row").length).toBe(DEMO_PACK.length);
    await act(async () => root?.unmount());
    host?.remove();

    const failed = await mount("skills", "/app/skills?demo=1&skills=error");
    const alert = failed.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Skills did not load");
    expect(alert?.textContent).toContain("could not read the skills file");
    expect(buttonIn(alert!, "Try again")).toBeTruthy();
    // nothing to write into until the list loads
    expect(buttonIn(mineRegion(failed), "Write a skill")).toBeUndefined();
    // the learned recipes still load on their own
    expect(failed.textContent).toContain("Run the report tests");
  });
});

describe("mind panel, written skills", () => {
  test("a cat lists the written skills it read, built in first then yours, each with its tokens", async () => {
    const el = await mount("run", "/app/runs/demo?demo=1#cat=agent-mochi", { id: "demo" });
    await settle(6);
    const group = [...el.querySelectorAll(".mind-group")].find((g) => g.querySelector(".mind-h")?.textContent === "Written skills it read");
    expect(group).toBeTruthy();
    const items = [...group!.querySelectorAll(".mind-written-item")];
    // the engineer on a build goal (a CSV export with tests) reads the two build skills that rank highest, then yours
    const engineerReads = ["Security hardening and QA habits", "System design and architecture"];
    expect(items.length).toBe(engineerReads.length + 1);
    expect(items.map((i) => i.querySelector(".mind-written-name")?.textContent)).toEqual([...engineerReads, "House commit style"]);
    expect(items[0]!.textContent).toContain("Built in");
    const last = items.at(-1)!;
    expect(last.textContent).toContain("House commit style");
    expect(last.textContent).toContain("Yours");
    expect(last.textContent).toMatch(/\d+ tokens/);
    expect(group!.querySelector(".mind-meta")?.textContent).toContain(`${engineerReads.length} built in, then 1 of yours`);
    expect(group!.querySelector('a[href="/app/skills"]')).toBeTruthy();
    expect(el.querySelector(".mind-top .mind-meta")?.textContent).toContain(`and ${engineerReads.length + 1} written skills`);
    expect(el.textContent?.includes(LONG_DASH)).toBe(false);
  });

  test("with nothing read, the group says so", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<WrittenSkills skills={[]} />));
    expect(host.textContent).toContain("No written skill matched its role on its last step.");
    expect(host.querySelector(".mind-meta")).toBeNull();
  });
});

describe("written skill rules", () => {
  const draft = (over: Partial<SkillDraft> = {}): SkillDraft => ({ name: "Stack", summary: "", body: "Use Go.", everyRole: true, roles: [], everyKind: true, kinds: [], ...over });

  test("a draft needs a unique name, a body within 6,000 characters and at least one role and kind", () => {
    expect(validateSkill(draft(), [], null)).toEqual({});
    expect(validateSkill(draft({ name: "  " }), [], null).name).toBeTruthy();
    expect(validateSkill(draft({ body: "" }), [], null).body).toBeTruthy();
    expect(validateSkill(draft({ body: "x".repeat(SKILL_BODY_MAX) }), [], null).body).toBeUndefined();
    expect(validateSkill(draft({ body: "x".repeat(SKILL_BODY_MAX + 1) }), [], null).body).toContain("Too long by 1 character.");
    expect(validateSkill(draft({ everyRole: false }), [], null).roles).toBeTruthy();
    expect(validateSkill(draft({ everyKind: false }), [], null).kinds).toBeTruthy();
    expect(validateSkill(draft({ name: "STACK" }), [{ id: "a", name: "stack" }], null).name).toContain("is there already");
    expect(validateSkill(draft({ name: "STACK" }), [{ id: "a", name: "stack" }], "a").name).toBeUndefined();
  });

  test("words and the token estimate", () => {
    expect(rolesWord(null)).toBe("Every role");
    expect(rolesWord(["lead", "qa"])).toBe("CEO, QA");
    expect(kindsWord(null)).toBe("Every company");
    expect(kindsWord(["fund"])).toBe("Hedge fund");
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  test("the demo store answers like the engine: built-in skills only switch, owner skills count edits", () => {
    const s = createCrewSkillState();
    const pack = s.list().filter((x) => x.source === "builtin");
    expect(pack.length).toBe(DEMO_PACK.length);
    for (const p of pack) expect(p.body.length).toBeLessThanOrEqual(SKILL_BODY_MAX);
    expect(pack.every((p) => !p.body.includes(LONG_DASH) && !p.summary.includes(LONG_DASH))).toBe(true);
    const first = pack[0]!;
    expect(first.id).toBe("builtin-design-law");
    expect(s.update(first.id, { name: "Mine now" })).toMatchObject({ ok: false, status: 422, code: "invalid_body" });
    expect(s.update(first.id, { enabled: false })).toMatchObject({ ok: true, skill: { enabled: false } });
    expect(s.remove(first.id)).toMatchObject({ ok: false, status: 409, code: "conflict" });
    expect(s.create({ name: "House commit style", body: "x" })).toMatchObject({ ok: false, status: 409 });
    expect(s.create({ name: "design law AND tidiness", body: "x" })).toMatchObject({ ok: false, status: 409 });
    expect(s.create({ name: "Blank", body: "   " })).toMatchObject({ ok: false, status: 422 });
    const made = s.create({ name: "Stack", body: "Use Go.", roles: ["engineer"] });
    expect(made.ok).toBe(true);
    const id = made.ok ? made.skill.id : "";
    expect(s.update(id, { body: "Use Go 1.23." })).toMatchObject({ ok: true, skill: { version: 2 } });
    expect(s.readBy("engineer", "studio").map((x) => x.name)).toContain("Stack");
    expect(s.readBy("engineer", "studio").map((x) => x.name)).not.toContain(first.name);
    expect(s.readBy("qa", "studio").map((x) => x.name)).not.toContain("Stack");
    expect(s.readBy("engineer", "studio")[0]!.source).toBe("builtin");
    // a UI goal turns the designer to the whole UI pack, within its budget
    // (design law is off in this store): ties keep the pack order
    expect(s.readBy("designer", "studio", "Redesign the landing page").map((x) => x.name)).toEqual(["UI taste and composition", "Design system approach", "Frontend rules", "Motion and immersive craft"]);
    // a hedge fund run reads no studio-only skill
    expect(s.readBy("engineer", "fund").every((x) => x.source === "owner")).toBe(true);
  });

  test("tokens, summaries and limits follow the engine", () => {
    expect(promptTokens("Stack", "")).toBe(0);
    expect(promptTokens("Stack", "Use Go.")).toBe(Math.ceil(("## Stack\nUse Go.".length + 2) / 4));
    expect(summaryFrom("## Heading\n\n- **Use** Go")).toBe("Heading");
    expect(summaryFrom("")).toBe("");
    expect(SKILL_SUMMARY_MAX).toBe(200);
  });

  test("the demo pack is the engine's pack: the same ids, names and versions in the same order", () => {
    const dir = join(import.meta.dir, "../../../../api/src/modules/crew-skills/builtin");
    if (!existsSync(dir)) return;
    const engine = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const text = readFileSync(join(dir, f), "utf8");
        const field = (k: string) => text.match(new RegExp(`^${k}: (.+)$`, "m"))?.[1]?.trim() ?? "";
        return { slug: field("id"), name: field("name"), version: Number(field("version")) };
      });
    const demo = DEMO_PACK.map((p) => ({ slug: p.slug, name: p.name, version: p.version }));
    expect([...demo].sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([...engine].sort((a, b) => a.slug.localeCompare(b.slug)));
  });
});
