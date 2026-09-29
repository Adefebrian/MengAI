// Retrieval and near-duplicate math for lessons and skills. Zero-dependency:
// a tokenizer with a light suffix stemmer, Okapi BM25 over a small corpus,
// and word 3-shingle Jaccard similarity for merging near duplicates.

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can do does for from has have how i if in into is it its of on or " +
    "so than that the their them then there these they this to was we were what when where which while who " +
    "why with you your our us he she his her not no yes all any each more most other some such only own same " +
    "too very just also about after before again once here out up down over under off via per"
  ).split(" "),
);

function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/** Lowercased, camelCase and snake_case split, stopwords dropped, stemmed. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  for (const raw of spaced.split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export interface Ranked<T> {
  item: T;
  score: number;
}

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

/**
 * Okapi BM25 of `query` against `docs` (idf over this corpus only, so the
 * caller decides the scope). Returns only documents with a positive score,
 * best first; ties keep the input order.
 */
export function bm25<T>(query: string, docs: Array<{ item: T; text: string }>): Array<Ranked<T>> {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || docs.length === 0) return [];
  const tokenized = docs.map((d) => tokenize(d.text));
  const n = docs.length;
  const avgdl = tokenized.reduce((s, t) => s + t.length, 0) / n || 1;
  const df = new Map<string, number>();
  for (const toks of tokenized) for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);

  const ranked: Array<Ranked<T> & { i: number }> = [];
  tokenized.forEach((toks, i) => {
    if (toks.length === 0) return;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const f = tf.get(term);
      if (!f) continue;
      const d = df.get(term) ?? 0;
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
      score += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * toks.length) / avgdl)));
    }
    if (score > 0) ranked.push({ item: docs[i]!.item, score, i });
  });
  ranked.sort((a, b) => b.score - a.score || a.i - b.i);
  return ranked.map(({ item, score }) => ({ item, score }));
}

/** Word 3-shingles over normalized text (texts under 3 words become one shingle). */
export function shingles(text: string, k = 3): Set<string> {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return new Set();
  if (words.length < k) return new Set([words.join(" ")]);
  const out = new Set<string>();
  for (let i = 0; i + k <= words.length; i++) out.add(words.slice(i, i + k).join(" "));
  return out;
}

/** 0 when either side has no words: wordless text is never a near duplicate of anything. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export const NEAR_DUPLICATE = 0.8;

export function similarity(a: string, b: string): number {
  return jaccard(shingles(a), shingles(b));
}
