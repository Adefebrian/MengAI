// A readable word diff between two versions of a short text (a strategy
// addendum is 120 tokens at most): the longest common subsequence over
// words, whitespace kept with the word before it, so the parts read back
// as the original sentences. Runs of one kind are merged.
export type DiffPart = { kind: "same" | "add" | "del"; text: string };

function words(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/** Word diff of `before` into `after`. Long inputs fall back to a whole replace. */
export function wordDiff(before: string, after: string, maxWords = 600): DiffPart[] {
  const a = words(before);
  const b = words(after);
  if (a.length > maxWords || b.length > maxWords) {
    return [...(before ? [{ kind: "del" as const, text: before }] : []), ...(after ? [{ kind: "add" as const, text: after }] : [])];
  }
  const key = (w: string) => w.trim();
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = key(a[i]!) === key(b[j]!) ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out.at(-1);
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (key(a[i]!) === key(b[j]!)) {
      push("same", b[j]!);
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      push("del", a[i]!);
      i += 1;
    } else {
      push("add", b[j]!);
      j += 1;
    }
  }
  while (i < a.length) push("del", a[i++]!);
  while (j < b.length) push("add", b[j++]!);
  return out;
}

/** Counts of words added and removed, for the one-line summary above a diff. */
export function diffCounts(parts: DiffPart[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    const n = words(p.text).length;
    if (p.kind === "add") added += n;
    if (p.kind === "del") removed += n;
  }
  return { added, removed };
}
