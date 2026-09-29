// fs_search matcher. The model's pattern always matches as literal text. It
// also matches as a regular expression, but only when the regex passes a
// safety check, because JavaScript regexes backtrack and one bad pattern on
// one long line can hold the event loop for seconds (measured on Bun 1.3:
// (a+)+b is exponential, \s*\s*x on a 2000 char line takes 1.2 s, on a 500
// char line 18 ms).
//
// Safety check, all required:
//   - at most REGEX_MAX_LENGTH chars and it compiles (no flags)
//   - no backreferences (\1, \k<name>)
//   - no quantifier applied to a group that contains a quantifier or an
//     alternation: (a+)+, (a|aa)*, (?:x*y){2,}
//   - repeat bounds at most REGEX_MAX_REPEAT
//   - at most 3 variable quantifiers (* + ? {n,m} {n,})
// Adjacent variable quantifiers still cost about len^(count+1), so the regex
// is only tried on lines up to REGEX_LINE_LIMIT[count] chars; longer lines get
// the literal test only.

export const REGEX_MAX_LENGTH = 200;
export const REGEX_MAX_REPEAT = 100;
/** max line length the regex is tried on, by number of variable quantifiers */
export const REGEX_LINE_LIMIT = [2000, 2000, 500, 120] as const;

export type RegexSafety = { ok: true; variable: number } | { ok: false; reason: string };

const no = (reason: string): RegexSafety => ({ ok: false, reason });

/** Structural check of a regex source; see the header for the rules. */
export function regexSafety(pattern: string): RegexSafety {
  if (pattern.length > REGEX_MAX_LENGTH) return no("longer than the regex limit");
  try {
    new RegExp(pattern);
  } catch {
    return no("not a valid regular expression");
  }
  // one frame per open group: does its body hold a quantifier or an alternation
  const groups: boolean[] = [];
  let variable = 0;
  // what a quantifier at this point would apply to
  let prev: "none" | "atom" | "safe_group" | "risky_group" | "quantifier" = "none";
  const markRisky = () => {
    if (groups.length) groups[groups.length - 1] = true;
  };
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\") {
      const n = pattern[i + 1] ?? "";
      if (/[1-9]/.test(n) || n === "k") return no("backreferences are not allowed");
      i++;
      prev = "atom";
      continue;
    }
    if (c === "[") {
      let j = i + 1;
      if (pattern[j] === "^") j++;
      if (pattern[j] === "]") j++;
      while (j < pattern.length && pattern[j] !== "]") j += pattern[j] === "\\" ? 2 : 1;
      i = j;
      prev = "atom";
      continue;
    }
    if (c === "(") {
      groups.push(false);
      if (pattern[i + 1] === "?") {
        // (?: (?= (?! (?<= (?<! (?<name>
        i++;
        if (pattern[i + 1] === "<" && pattern[i + 2] !== "=" && pattern[i + 2] !== "!") {
          const close = pattern.indexOf(">", i);
          i = close === -1 ? i : close;
        } else if (pattern[i + 1] === "<") i += 2;
        else i++;
      }
      prev = "none";
      continue;
    }
    if (c === ")") {
      const risky = groups.pop() ?? false;
      if (risky) markRisky();
      prev = risky ? "risky_group" : "safe_group";
      continue;
    }
    if (c === "|") {
      markRisky();
      prev = "none";
      continue;
    }
    let quant: { min: number; max: number | null; len: number } | null = null;
    if (c === "*") quant = { min: 0, max: null, len: 1 };
    else if (c === "+") quant = { min: 1, max: null, len: 1 };
    else if (c === "?") quant = { min: 0, max: 1, len: 1 };
    else if (c === "{") {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
      if (m) quant = { min: Number(m[1]), max: m[2] === undefined ? Number(m[1]) : m[3] === "" ? null : Number(m[3]), len: m[0].length };
    }
    if (!quant) {
      prev = "atom";
      continue;
    }
    if (prev === "none" || prev === "quantifier") return no("a quantifier has nothing to repeat");
    if (quant.min > REGEX_MAX_REPEAT || (quant.max !== null && quant.max > REGEX_MAX_REPEAT)) return no("repeat count too large");
    if (prev === "risky_group") return no("nested quantifier or quantified alternation");
    if (quant.max === null || quant.max > quant.min) variable++;
    markRisky();
    i += quant.len - 1;
    if (pattern[i + 1] === "?") i++; // lazy form costs the same
    prev = "quantifier";
  }
  if (variable >= REGEX_LINE_LIMIT.length) return no("too many variable quantifiers");
  return { ok: true, variable };
}

export interface Matcher {
  /** true when the pattern is also applied as a regex */
  regex: boolean;
  test(line: string): boolean;
}

/** Literal match always; regex match too when safe and the line is short enough for it. */
export function compileMatcher(pattern: string): Matcher {
  const safety = regexSafety(pattern);
  if (!safety.ok) return { regex: false, test: (line) => line.includes(pattern) };
  const re = new RegExp(pattern);
  const maxLine = REGEX_LINE_LIMIT[safety.variable]!;
  return { regex: true, test: (line) => line.includes(pattern) || (line.length <= maxLine && re.test(line)) };
}
