// Page recipes and the anti-repetition law, as data an agent can check
// before it writes markup (identity.md section 5). A page is the ordered
// list of its compositions; validatePageRecipe returns every broken rule.
//   1. A marketing page opens on a Masthead (any variant). Nothing else is a hero.
//   2. No two adjacent sections share a composition.
//   3. No composition appears more than twice on a page (Masthead and Footer once).
//   4. A marketing page carries the data identity: at least one BentoGrid,
//      SpecTable, SpecRail section, or StatRow.
//   5. A StatRow never directly follows the Masthead (no big-number hero).
//   6. The Footer, when present, is last.
// The variety ledger (validateVarietyLedger) works one level down, on
// composition plus structural variant ("split.bleed", "stat-row.lead"):
//   7. No two adjacent sections share composition and variant.
//   8. No composition and variant appears more than twice on a page.
//   9. A marketing page uses at least 3 different compositions (the Footer
//      does not count).
// validatePageRecipe accepts plain ids, "id.variant" strings, or
// { composition, variant } entries and runs both; readPageLedger builds the
// entries from rendered markup (data-kit-composition and data-variant).
export type CompositionId =
  | "masthead"
  | "logo-row"
  | "split"
  | "bento"
  | "stat-row"
  | "spec-table"
  | "spec-rail"
  | "feature-grid"
  | "media"
  | "sticky-story"
  | "quote"
  | "pricing"
  | "faq"
  | "cta-band"
  | "footer"
  /** Hand-written layout on the kit grid, recorded in docs/design/direction.md. */
  | "custom";

export type PageKind = "marketing" | "product";

const DATA_IDENTITY: CompositionId[] = ["bento", "spec-table", "spec-rail", "stat-row"];
const ONCE: CompositionId[] = ["masthead", "footer"];

export interface LedgerEntry {
  composition: CompositionId;
  variant?: string;
}

export type RecipeEntry = CompositionId | `${CompositionId}.${string}` | LedgerEntry;

export function toLedgerEntry(e: RecipeEntry): LedgerEntry {
  if (typeof e !== "string") return e;
  const dot = e.indexOf(".");
  return dot === -1 ? { composition: e as CompositionId } : { composition: e.slice(0, dot) as CompositionId, variant: e.slice(dot + 1) };
}

const key = (e: LedgerEntry) => (e.variant ? `${e.composition}.${e.variant}` : e.composition);

/** A hand-written custom section carries no structural variant of its own:
 *  Section writes data-variant="default" when none is given, so an unnamed
 *  custom and custom.default are one thing, and both are exempt from the
 *  repeat rules. A custom section with a named variant is counted. */
const unnamedCustom = (e: LedgerEntry) => e.composition === "custom" && (!e.variant || e.variant === "default");

/** Rules 7 to 9: variety at the composition plus variant level. */
export function validateVarietyLedger(entries: RecipeEntry[], kind: PageKind = "marketing"): string[] {
  const list = entries.map(toLedgerEntry);
  const errors: string[] = [];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    if (unnamedCustom(b)) continue;
    if (key(a) === key(b)) errors.push(`sections ${i} and ${i + 1} are both ${key(b)}; neighbors must change structure`);
  }
  const uses = new Map<string, number>();
  for (const e of list) {
    if (unnamedCustom(e)) continue;
    uses.set(key(e), (uses.get(key(e)) ?? 0) + 1);
  }
  for (const [k, n] of uses) if (n > 2) errors.push(`${k} appears ${n} times; a composition and variant at most twice`);
  if (kind === "marketing") {
    const distinct = new Set(list.map((e) => e.composition).filter((c) => c !== "footer"));
    if (distinct.size < 3) errors.push(`a marketing page uses ${distinct.size} different compositions; at least 3`);
  }
  return errors;
}

/** The ledger of a rendered page, in document order, from the attributes
 *  every kit section writes. Nested kit sections are not counted. */
export function readPageLedger(root: ParentNode): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-kit-composition]"))) {
    if (el.parentElement?.closest("[data-kit-composition]")) continue;
    out.push({ composition: el.dataset.kitComposition as CompositionId, variant: el.dataset.variant || undefined });
  }
  return out;
}

export function validatePageRecipe(entries: RecipeEntry[], kind: PageKind = "marketing"): string[] {
  const sections = entries.map((e) => toLedgerEntry(e).composition);
  const errors: string[] = [];
  if (sections.length === 0) return ["the page has no sections"];
  if (kind === "marketing" && sections[0] !== "masthead") {
    errors.push(`a marketing page opens on a masthead, not ${sections[0]}`);
  }
  for (let i = 1; i < sections.length; i++) {
    if (sections[i] === sections[i - 1] && sections[i] !== "custom") {
      errors.push(`sections ${i} and ${i + 1} are both ${sections[i]}; neighbors must differ`);
    }
  }
  const counts = new Map<CompositionId, number>();
  for (const s of sections) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const [s, n] of counts) {
    if (s === "custom") continue;
    const cap = ONCE.includes(s) ? 1 : 2;
    if (n > cap) errors.push(`${s} appears ${n} times; at most ${cap}`);
  }
  if (kind === "marketing" && !sections.some((s) => DATA_IDENTITY.includes(s))) {
    errors.push("a marketing page needs a bento, spec-table, spec-rail, or stat-row to carry the data identity");
  }
  const m = sections.indexOf("masthead");
  if (m !== -1 && sections[m + 1] === "stat-row") errors.push("a stat-row directly under the masthead reads as a big-number hero");
  const f = sections.indexOf("footer");
  if (f !== -1 && f !== sections.length - 1) errors.push("the footer must be last");
  // Rules 7 and 8 are implied by 2 and 3 for every composition but custom,
  // so only custom repeats and rule 9 add a message here.
  for (const e of validateVarietyLedger(entries, kind)) {
    if (/^a marketing page uses/.test(e) || /\bcustom\./.test(e)) errors.push(e);
  }
  return errors;
}

/** The page recipes in identity.md, in section order. JEV still gates each region. */
export const PAGE_RECIPES: Record<string, CompositionId[]> = {
  product_landing: ["masthead", "logo-row", "split", "stat-row", "sticky-story", "bento", "spec-table", "quote", "feature-grid", "pricing", "faq", "cta-band", "footer"],
  saas_landing: ["masthead", "logo-row", "bento", "sticky-story", "split", "quote", "pricing", "faq", "cta-band", "footer"],
  company_profile: ["masthead", "split", "stat-row", "feature-grid", "quote", "split", "cta-band", "footer"],
  portfolio: ["masthead", "bento", "split", "quote", "media", "cta-band", "footer"],
  docs_home: ["masthead", "feature-grid", "spec-table", "faq", "footer"],
  pricing: ["masthead", "pricing", "spec-table", "faq", "cta-band", "footer"],
  app_dashboard_entry: ["custom", "bento", "spec-table"],
};
