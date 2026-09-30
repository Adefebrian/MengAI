// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Demo mode's written skills: the built-in JAL-AIDev pack as the engine
// ships it (the same ids, text, role weights and topics as the markdown
// files in the engine's crew-skills module: design law and tidiness, UI
// taste, the design system, frontend rules, motion and immersive craft,
// system design, security and QA, on the project's own stack) and one
// sample skill of the owner's. The store answers like the engine: a
// built-in skill takes only { enabled } and is never deleted, an owner
// skill counts its edits in version, a name is unique among every skill,
// the text stops at 6,000 characters, and what a cat reads on a step is
// picked the engine's way: built-ins by relevance to its role and the run
// goal within its role's budget, then the owner's newest first.
import { AGENT_ROLES, type AgentRole, type CompanyKind, type CreateCrewSkillBody, type CrewSkillDTO, type UpdateCrewSkillBody } from "@mengai/shared";
import { SKILL_BODY_MAX, SKILL_NAME_MAX, SKILL_SUMMARY_MAX, bySource, promptTokens, summaryFrom } from "../app/crewSkills";
import { DEMO_T0 } from "./fixture";

const D = 86_400_000;

interface PackEntry {
  slug: string;
  name: string;
  /** bumped whenever the text changes */
  version: number;
  /** YYYY-MM-DD */
  updated: string;
  /** which kind of goal it serves first */
  focus: "ui" | "build";
  summary: string;
  /** 3: always read by that role; 2: when the goal fits its focus; 1: only when the goal also names a topic */
  weights: Partial<Record<AgentRole, number>>;
  kinds: CompanyKind[] | null;
  /** words that make it relevant to a goal */
  topics: string;
  body: string;
}

const lines = (...rows: string[]) => rows.join("\n");

/** The pack in the engine's display order (also the tie break between equally relevant skills). */
export const DEMO_PACK: readonly PackEntry[] = [
  {
    slug: "design-law",
    name: "Design law and tidiness",
    version: 1,
    updated: "2026-09-30",
    focus: "ui",
    summary: "The visual law for every screen: nothing overlapping, clipped or left as an empty gap, white-first flat surfaces, 44 px targets, mobile first and reduced motion.",
    weights: { designer: 3, engineer: 2, reviewer: 2, qa: 2 },
    kinds: ["studio"],
    topics: "ui ux page landing site website web app frontend css style layout component design hero dashboard form button mobile responsive theme html react screen visual interface halaman tampilan aplikasi situs desain",
    body: lines(
      "Every screen, any stack. An explicit owner request beats a default here.",
      "- Tidy first: nothing overlaps a sibling (only dialogs, menus, tooltips and popovers stack, in their own layer), no child pokes out of its parent, stacked regions share one left and right edge.",
      "- No clipped text: truncate only on purpose, with an ellipsis and the full value reachable.",
      "- No empty gaps: no dead grid cells, no void inside a card, no rows spread apart to fill height. A card is as tall as its content.",
      "- Fit 320 px: grid tracks minmax(0, 1fr), min-width: 0 on grid and flex children, border-box sizing, no fixed width wider than the screen. Too many fields wrap to fewer columns.",
      "- White-first: white or near-white background; dark only as a theme the owner asked for.",
      "- Flat: no gradients, glow, neon or blurred shadows. Depth is a tonal step plus a 1 px hairline. No colored side stripe on cards.",
      "- No emoji and no em-dash in copy. Icons are SVG from one family.",
      "- One restrained accent at most, never a purple default. Primary action: ink on white.",
      "- Targets and controls 44 px at least, 8 px apart. Text 12 px at least, inputs 16 px, AA contrast, visible focus.",
      "- Mobile first: phone layout first, no horizontal scroll at any width.",
      "- Motion only to explain a change; honor prefers-reduced-motion.",
      "- Run ui_check before you finish UI work and fix what it finds.",
    ),
  },
  {
    slug: "ui-taste",
    name: "UI taste and composition",
    version: 1,
    updated: "2026-09-30",
    focus: "ui",
    summary: "Hierarchy, rhythm, one type scale, one spacing scale and real content, so a screen reads as one careful product and never as an AI template.",
    weights: { designer: 3, engineer: 1, reviewer: 1 },
    kinds: ["studio"],
    topics: "ui ux page landing site website hero design redesign refresh polish layout typography brand marketing dashboard screen app frontend visual halaman tampilan desain",
    body: lines(
      "- Plan each section before markup: its job, one message, at most one primary action, its container. A section with no job is cut.",
      "- Lightest container that still groups: spacing, then a divider, then a card. No cards in cards. Records (orders, users, files) are rows, not card piles. Bento only for mixed summaries.",
      "- Hierarchy from weight, ink shade and position before size or color. One primary action per view.",
      "- One type scale (for example 12, 14, 16, 20, 24, 32, 40), weights 400 to 600, body line height near 1.5, prose 60 to 75 characters wide, two text colors for content.",
      "- One spacing scale on a 4 px grid: tight inside a group, generous between groups, one section rhythm per page.",
      "- Neighbor sections vary in structure. Avoid the template run: hero, three feature cards, CTA band, footer.",
      "- Real, specific copy from the brief. No lorem ipsum, filler stats, fake testimonials, kicker labels over headings or giant colored numbers.",
      "- Design the empty, loading and error state of every view: skeletons of the real shape, a useful empty message, an error with a next step.",
      "- Quiet confidence: mostly neutral, generous whitespace, nothing decorative without a job.",
    ),
  },
  {
    slug: "design-system",
    name: "Design system approach",
    version: 1,
    updated: "2026-09-30",
    focus: "ui",
    summary: "Tokens first, components built only from tokens, every state designed and dark mode as a real theme, all inside one design system.",
    weights: { designer: 3, engineer: 1 },
    kinds: ["studio"],
    topics: "token tokens theme theming dark system component components library palette color colors css variable tailwind style ui brand",
    body: lines(
      "- One design system per product. Reuse the project's tokens and components; extend them, never start a parallel set. Add no UI kit unless the owner asks.",
      "- Tokens first: color, type, spacing, radius, motion and control height are named tokens (CSS variables or the theme file). Components use token names only, no raw hex or one-off px.",
      "- Base when none exists: page #fafaf9, surface #ffffff, layers #f5f5f4 and #efefed, hairline #e5e5e3, control border #8f8e89, ink #1b1b1b, muted ink #474747, radius 8 for controls and 12 for cards, controls 44 px.",
      "- Color roles, not colors: page, surface, layer, border, ink, muted, accent, and status colors only for real state, always with an icon or a word.",
      "- Eight states per component: default, hover (hover devices only), focus-visible (instant outline), pressed, disabled, loading (width locked), error, success. Hover and pressed tint the fill, never lift it.",
      "- One radius per component tier; nested corners stay concentric.",
      "- Dark mode only as a deliberate theme: remap the same role tokens (warm near-black, near-white ink, never pure black or white), recompute tints, recheck contrast, never auto-switch unless the product ships it.",
    ),
  },
  {
    slug: "frontend-rules",
    name: "Frontend rules",
    version: 1,
    updated: "2026-09-30",
    focus: "ui",
    summary: "Accessibility, semantic HTML, a performance budget, images and forms done right, in whatever frontend stack the project uses.",
    weights: { engineer: 2, designer: 2, reviewer: 1, qa: 1 },
    kinds: ["studio"],
    topics: "frontend html css react vue svelte page form image accessibility a11y performance seo component ui web site website app mobile responsive halaman aplikasi situs",
    body: lines(
      "- Use the project's framework and conventions; when nothing is set, suggest React with TypeScript on Bun.",
      "- Semantic HTML: landmarks, one h1, headings in order, buttons for actions, links for navigation, real lists and tables.",
      "- Accessible: visible labels, full keyboard use in a sensible order, visible focus, color never the only signal, aria-label on icon-only buttons, dialogs trap and return focus.",
      "- Forms: label above, every control one 44 px height and one border style, 16 px input text, reserved helper and error rows so validation never shifts layout, right input types and autocomplete.",
      "- Images: width and height or aspect-ratio, alt text (empty for decoration), modern formats, lazy below the fold, the hero image eager.",
      "- Budget: LCP under 2.5 s, CLS under 0.1, INP under 200 ms. Little JavaScript, split heavy routes, self-hosted fonts with fallbacks.",
      "- Layout: min-width media queries, 100dvh over 100vh, safe-area insets on fixed bars, a sticky header and bottom tab bar on phone app screens.",
      "- Every async view handles loading, empty and error; long words wrap; changing numbers use tabular-nums.",
    ),
  },
  {
    slug: "motion-immersive",
    name: "Motion and immersive craft",
    version: 1,
    updated: "2026-09-30",
    focus: "ui",
    summary: "Purposeful motion on transform and opacity, scroll storytelling with GSAP or CSS, and 3D only with poster fallbacks, device tiers and reduced motion stills.",
    weights: { designer: 2, engineer: 1 },
    kinds: ["studio"],
    topics: "animation animate motion scroll transition 3d three webgl gsap parallax immersive interactive hero landing showcase canvas lenis framer",
    body: lines(
      "- Name the change an animation explains in one sentence, or cut it. Product UI motion is quiet; showcase pages may choreograph more.",
      "- Transform and opacity only. 100 to 300 ms for UI, 400 to 600 ms only for showcase, one easing curve, exits about 70 percent of entrances, never transition: all.",
      "- Smallest tool first: CSS, then the Web Animations API, then the project's motion library, then GSAP with ScrollTrigger for timelines and scroll scenes.",
      "- Scroll stories: one continuous story, at most one pinned or scrubbed section per page, content readable without it, triggers refreshed after fonts and media load.",
      "- Reduced motion: no travel, parallax or autoplay, just a still or a fade under 150 ms. Pending states use opacity so the page still renders without JavaScript.",
      "- Loops over 5 s get a pause control; nothing flashes more than three times a second.",
      "- 3D only when form, viewpoint or a transformation is the message: lazy loaded, a poster image first, the poster kept when WebGL is missing, the device is weak, data saver is on or motion is reduced.",
      "- Device tiers: pixel ratio capped at 2 (lower on phones), fewer effects on coarse pointers and low memory, one canvas per page, dispose everything on unmount.",
      "- In a canvas, natural light and soft contact shadows are fine; no bloom, glow or neon, and the page white shows through.",
    ),
  },
  {
    slug: "system-design",
    name: "System design and architecture",
    version: 1,
    updated: "2026-09-30",
    focus: "build",
    summary: "Modular boundaries, ports and adapters, clean API design, sound data models and observability, on the project's stack or the best fit.",
    weights: { lead: 3, engineer: 2, reviewer: 2, security: 1 },
    kinds: ["studio"],
    topics: "api endpoint service backend server database db schema migration migrate model architecture refactor module interface provider integration queue cache sql sqlite postgres storage plan stack",
    body: lines(
      "- Stack: keep the project's stack and conventions. With nothing specified, recommend Bun, Hono, React and TypeScript; choose another only when the goal needs it, and say why.",
      "- Modular monolith: one folder per domain with one public entry file that others import. No microservices without a real need.",
      "- Ports and adapters: databases, caches, storage, queues and outside APIs sit behind small interfaces wired at startup, so tests use fakes.",
      "- Routes parse and validate, services hold the rules, repositories own their tables. No business logic in handlers.",
      "- APIs: resource nouns, the right methods and status codes (201, 404, 409, 422), one error shape, paginated lists, idempotent retries for writes that may repeat.",
      "- Data: model the domain first, keys and constraints, indexes for real queries, timestamps on rows, additive migrations with a written rollback.",
      "- Observability: structured logs with a request id and no secrets, a health endpoint, errors that say what to do next.",
      "- Stay light: no framework or background process the goal does not need; measure before optimizing.",
    ),
  },
  {
    slug: "security-qa",
    name: "Security hardening and QA habits",
    version: 1,
    updated: "2026-09-30",
    focus: "build",
    summary: "Validate input, keep secrets out of code, harden headers and rate limits, test at the right level and self-check UI before calling work done.",
    weights: { security: 3, qa: 3, reviewer: 2, engineer: 2 },
    kinds: ["studio"],
    topics: "security secure auth login password token secret release test testing flaky ci qa validation input audit vulnerability payment checkout public deploy bug",
    body: lines(
      "- Validate every body, query and path parameter with a schema at the boundary; reject with a clear 4xx before any logic.",
      "- Secrets come from the environment or a vault only: never in code, commits, logs, prompts or errors. .env stays out of git; .env.example lists the keys.",
      "- Harden by default: secure headers (CSP, nosniff, frame-ancestors, referrer policy, HSTS behind TLS), an exact CORS allowlist, rate limits per route and client with 429 and Retry-After, stricter on login.",
      "- Parameterized queries, escaped output, authorization checked on every object, not only at login. Audit dependencies before release.",
      "- Test at the right level: unit tests for rules, API tests through the request handler, a few browser smoke tests for key flows. No real network, clock or shared state.",
      "- Cases come from acceptance criteria first, then edges: empty, limits, errors, permissions, concurrency.",
      "- A test you did not run did not pass: quote the real command and result.",
      "- UI self-check before done: ui_check, then 320, 375, 768 and 1280 px for overlap, clipped text, gaps and sideways scroll, plus keyboard focus and reduced motion.",
    ),
  },
];

export const BUILTIN_ID_PREFIX = "builtin-";

/** Built-in tokens per prompt by role, as the engine budgets them: the designer reads the whole UI pack, the rest two skills at most. */
export const BUILTIN_BUDGET_TOKENS: Readonly<Record<AgentRole, number>> = {
  designer: 1_600,
  engineer: 700,
  reviewer: 700,
  qa: 700,
  security: 400,
  lead: 400,
  researcher: 400,
  operator: 400,
};
/** Every written skill in one prompt, built in and owner together. */
export const CREW_SKILLS_TOTAL_TOKENS = 2_400;
const MIN_SCORE = 3;

/** Words that make a goal a UI goal (English and Indonesian); anything else is a build goal. */
const UI_WORDS = new Set(
  (
    "ui ux page pages landing site website web app apps frontend front-end screen screens dashboard design redesign hero css style styles styling " +
    "layout component components form forms button mobile responsive theme react vue svelte html interface view views visual animation " +
    "3d webgl portfolio homepage storefront halaman tampilan aplikasi situs desain antarmuka beranda dasbor formulir tombol"
  ).split(" "),
);

/** Lowercase words of a text, with a naive singular added (pages, page). */
function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (!w) continue;
    out.add(w);
    if (w.length > 3 && w.endsWith("s")) out.add(w.slice(0, -1));
    for (const part of w.split("-")) if (part && part !== w) out.add(part);
  }
  return out;
}

const SAMPLE_OWNER = {
  id: "cs-owner-1",
  name: "House commit style",
  summary: "Conventional commits, one change each, small pull requests.",
  roles: ["engineer", "reviewer"] as AgentRole[],
  kinds: null,
  version: 2,
  body: lines(
    "Commits in this company follow the house style.",
    "",
    "- Conventional commits with a scope: feat, fix, refactor, test, docs or chore, for example fix(export): quote fields that hold a comma.",
    "- One change per commit. Keep a pull request under 400 changed lines.",
    "- The body says why, in plain words, and links the task.",
    "- Never commit generated files, secrets or a lockfile change you did not mean.",
  ),
};

/** Roles that read a built-in, heaviest weight first. */
function rolesOf(e: PackEntry): AgentRole[] {
  return (Object.keys(e.weights) as AgentRole[]).sort((a, b) => e.weights[b]! - e.weights[a]! || AGENT_ROLES.indexOf(a) - AGENT_ROLES.indexOf(b));
}

function builtin(e: PackEntry): CrewSkillDTO {
  const at = Date.parse(`${e.updated}T00:00:00Z`);
  return {
    id: `${BUILTIN_ID_PREFIX}${e.slug}`,
    source: "builtin",
    name: e.name,
    summary: e.summary,
    body: e.body,
    roles: rolesOf(e),
    kinds: e.kinds,
    enabled: true,
    version: e.version,
    tokens: promptTokens(e.name, e.body),
    createdAt: at,
    updatedAt: at,
  };
}

export type CrewSkillResult = { ok: true; skill: CrewSkillDTO } | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): CrewSkillResult => ({ ok: false, status, code, message });
const invalid = (message: string) => fail(422, "invalid_body", message);
const oneLine = (s: string) => s.trim().replace(/\s+/g, " ");
const uniq = <T,>(xs: readonly T[] | null | undefined): T[] | null => (xs && xs.length ? [...new Set(xs)] : null);

/** ?skills=empty opens with the pack only; ?skills=error makes the list fail, to show the error state. */
export function createCrewSkillState(seed: "sample" | "empty" = "sample") {
  const skills: CrewSkillDTO[] = DEMO_PACK.map(builtin);
  if (seed === "sample") {
    skills.push({ ...SAMPLE_OWNER, source: "owner", enabled: true, tokens: promptTokens(SAMPLE_OWNER.name, SAMPLE_OWNER.body), createdAt: DEMO_T0 - 6 * D, updatedAt: DEMO_T0 - 2 * D });
  }
  let seq = 1;
  const nameKey = (s: string) => oneLine(s).toLowerCase();

  /** The engine's own checks on a create or an owner edit. */
  const check = (b: UpdateCrewSkillBody, selfId: string | null, creating: boolean): CrewSkillResult | null => {
    if (creating || b.name !== undefined) {
      const name = oneLine(b.name ?? "");
      if (!name) return invalid("name: required");
      if (name.length > SKILL_NAME_MAX) return invalid(`name: at most ${SKILL_NAME_MAX} characters`);
      const holder = skills.find((s) => nameKey(s.name) === nameKey(name));
      if (holder?.source === "builtin") return fail(409, "conflict", `"${name}" is the name of a built-in skill; pick another name`);
      if (holder && holder.id !== selfId) return fail(409, "conflict", `a skill named "${name}" already exists`);
    }
    if (creating || b.body !== undefined) {
      const body = b.body ?? "";
      if (!body.trim()) return invalid("body: required");
      if (body.length > SKILL_BODY_MAX) return invalid(`body: at most ${SKILL_BODY_MAX} characters`);
    }
    if ((b.summary ?? "").trim().length > SKILL_SUMMARY_MAX) return invalid(`summary: at most ${SKILL_SUMMARY_MAX} characters`);
    if (Array.isArray(b.roles) && b.roles.length === 0) return invalid("roles: list at least one role, or null for every role");
    if (Array.isArray(b.kinds) && b.kinds.length === 0) return invalid("kinds: list at least one company kind, or null for all");
    return null;
  };

  return {
    list: (): CrewSkillDTO[] => bySource(skills).map((s) => ({ ...s })),
    create(b: CreateCrewSkillBody): CrewSkillResult {
      const bad = check(b, null, true);
      if (bad) return bad;
      const now = Date.now();
      const name = oneLine(b.name);
      const body = b.body.trim();
      const skill: CrewSkillDTO = {
        id: `cs-owner-new-${(seq += 1)}`,
        source: "owner",
        name,
        summary: b.summary?.trim() || summaryFrom(body),
        body,
        roles: uniq(b.roles),
        kinds: uniq(b.kinds),
        enabled: b.enabled ?? true,
        version: 1,
        tokens: promptTokens(name, body),
        createdAt: now,
        updatedAt: now,
      };
      skills.push(skill);
      return { ok: true, skill: { ...skill } };
    },
    update(id: string, b: UpdateCrewSkillBody): CrewSkillResult {
      const s = skills.find((x) => x.id === id);
      if (!s) return fail(404, "not_found", "crew skill not found");
      const keys = (Object.keys(b) as Array<keyof UpdateCrewSkillBody>).filter((k) => b[k] !== undefined);
      if (keys.length === 0) return invalid("nothing to change");
      if (s.source === "builtin") {
        if (keys.some((k) => k !== "enabled")) return invalid("built-in skills accept only enabled: switch them off or on, they are never edited");
        s.enabled = b.enabled!;
        s.updatedAt = Date.now();
        return { ok: true, skill: { ...s } };
      }
      const bad = check(b, id, false);
      if (bad) return bad;
      const next: CrewSkillDTO = { ...s };
      if (b.name !== undefined) next.name = oneLine(b.name);
      if (b.body !== undefined) next.body = b.body.trim();
      if (b.summary !== undefined) next.summary = b.summary.trim() || summaryFrom(next.body);
      if (b.roles !== undefined) next.roles = uniq(b.roles);
      if (b.kinds !== undefined) next.kinds = uniq(b.kinds);
      if (typeof b.enabled === "boolean") next.enabled = b.enabled;
      const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
      const edited = next.name !== s.name || next.body !== s.body || next.summary !== s.summary || !same(next.roles, s.roles) || !same(next.kinds, s.kinds);
      if (!edited && next.enabled === s.enabled) return { ok: true, skill: { ...s } };
      if (edited) next.version = s.version + 1;
      next.tokens = promptTokens(next.name, next.body);
      next.updatedAt = Date.now();
      Object.assign(s, next);
      return { ok: true, skill: { ...s } };
    },
    remove(id: string): CrewSkillResult | { ok: true } {
      const i = skills.findIndex((x) => x.id === id);
      if (i >= 0 && skills[i]!.source === "builtin") return fail(409, "conflict", "built-in skills cannot be deleted; switch one off with enabled false");
      if (i < 0) return fail(404, "not_found", "crew skill not found");
      skills.splice(i, 1);
      return { ok: true };
    },
    /**
     * What one cat reads on a step, picked the engine's way: enabled
     * built-ins of the company kind ranked by relevance (its role's weight,
     * +2 when the goal's focus matches, +1 when the goal names a topic, kept
     * from 3) within its role's budget, then the owner's skills for its role,
     * newest first, within the total cap.
     */
    readBy(role: AgentRole, kind: CompanyKind, goal: string | null = null): Array<{ id: string; name: string; source: CrewSkillDTO["source"]; tokens: number }> {
      const said = words(goal ?? "");
      const focus = [...said].some((w) => UI_WORDS.has(w)) ? "ui" : "build";
      const kindOk = (kinds: readonly CompanyKind[] | null) => kinds === null || kinds.includes(kind);
      const out: Array<{ id: string; name: string; source: CrewSkillDTO["source"]; tokens: number }> = [];
      let used = 0;
      let builtinUsed = 0;
      const ranked = DEMO_PACK.map((e, order) => ({ e, order, s: skills.find((x) => x.id === `${BUILTIN_ID_PREFIX}${e.slug}`)! }))
        .filter((x) => x.s.enabled && kindOk(x.e.kinds))
        .map((x) => {
          const weight = x.e.weights[role] ?? 0;
          const hit = x.e.topics.split(" ").some((t) => said.has(t));
          return { ...x, score: weight > 0 ? weight + (x.e.focus === focus ? 2 : 0) + (hit ? 1 : 0) : 0 };
        })
        .filter((x) => x.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score || a.order - b.order);
      for (const { s } of ranked) {
        if (builtinUsed + s.tokens > BUILTIN_BUDGET_TOKENS[role] || used + s.tokens > CREW_SKILLS_TOTAL_TOKENS) continue;
        builtinUsed += s.tokens;
        used += s.tokens;
        out.push({ id: s.id, name: s.name, source: "builtin", tokens: s.tokens });
      }
      const mine = skills
        .filter((s) => s.source === "owner" && s.enabled && kindOk(s.kinds) && (s.roles === null || s.roles.includes(role)))
        .sort((a, b) => b.createdAt - a.createdAt);
      for (const s of mine) {
        if (used + s.tokens > CREW_SKILLS_TOTAL_TOKENS) continue;
        used += s.tokens;
        out.push({ id: s.id, name: s.name, source: "owner", tokens: s.tokens });
      }
      return out;
    },
  };
}

export type CrewSkillState = ReturnType<typeof createCrewSkillState>;
