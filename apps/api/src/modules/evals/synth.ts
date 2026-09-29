// Deterministic synthetic tool outputs of an exact size. The text looks like
// what the tool returns (code, test runs, search hits, prose) so truncation,
// line-based digests and token estimates behave as they do on real output.
// The vocabulary avoids anything the secret redactor would rewrite.
import { hash32 } from "@mengai/shared";

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IDENTS = ["cart", "total", "item", "price", "user", "order", "store", "config", "entry", "result", "value", "row", "note", "query", "handler", "record"];
const VERBS = ["compute", "load", "save", "apply", "render", "parse", "format", "validate", "resolve", "merge", "update", "build"];
const WORDS = [
  "the", "index", "search", "page", "build", "time", "query", "latency", "size", "static", "server", "memory", "shard", "rank",
  "document", "field", "match", "score", "cost", "plan", "free", "tier", "request", "month", "result", "update", "support", "large",
];

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)]!;
}

function codeLine(r: () => number, n: number): string {
  const indent = "  ".repeat(Math.floor(r() * 3));
  const a = pick(r, IDENTS);
  const v = pick(r, VERBS);
  switch (Math.floor(r() * 5)) {
    case 0:
      return `${indent}const ${a}${n % 97} = ${v}${a[0]!.toUpperCase()}${a.slice(1)}(${pick(r, IDENTS)}, ${Math.floor(r() * 100)});`;
    case 1:
      return `${indent}if (!${a}) return ${v}Default(${pick(r, IDENTS)});`;
    case 2:
      return `${indent}export function ${v}${a[0]!.toUpperCase()}${a.slice(1)}(input: ${a[0]!.toUpperCase()}${a.slice(1)}Input): number {`;
    case 3:
      return `${indent}// ${pick(r, WORDS)} ${pick(r, WORDS)} ${pick(r, WORDS)} for the ${a} ${pick(r, WORDS)}`;
    default:
      return `${indent}}`;
  }
}

function testLine(r: () => number, n: number, failing: boolean): string {
  const suite = `${pick(r, IDENTS)} ${pick(r, VERBS)}`;
  if (failing && r() < 0.06) return `(fail) ${suite} > case ${n} [${(r() * 9).toFixed(2)}ms]\n  expected ${Math.floor(r() * 900)} received ${Math.floor(r() * 900)}`;
  return `(pass) ${suite} > case ${n} [${(r() * 9).toFixed(2)}ms]`;
}

function searchLine(r: () => number, n: number): string {
  return `src/${pick(r, IDENTS)}/${pick(r, VERBS)}_${n % 13}.ts:${1 + Math.floor(r() * 400)}: ${codeLine(r, n).trim()}`;
}

function listLine(r: () => number, n: number): string {
  return `${pick(r, ["src", "tests", "web", "server"])}/${pick(r, IDENTS)}/${pick(r, VERBS)}_${n % 17}.ts  ${(r() * 12).toFixed(1)} KB`;
}

function proseLine(r: () => number): string {
  const len = 10 + Math.floor(r() * 14);
  const words: string[] = [];
  for (let i = 0; i < len; i++) words.push(pick(r, WORDS));
  const s = words.join(" ");
  return `${s[0]!.toUpperCase()}${s.slice(1)}.`;
}

function scanLine(r: () => number, n: number): string {
  return `${pick(r, ["low", "medium", "info"])}  ${pick(r, IDENTS)}-${pick(r, VERBS)}@${1 + Math.floor(r() * 4)}.${Math.floor(r() * 20)}.${Math.floor(r() * 9)}  advisory ${1000 + n}`;
}

/** Output of `tool` with exactly `chars` characters, stable for (scenario, step, index). */
export function synthOutput(key: string, tool: string, chars: number, ok = true): string {
  if (chars <= 0) return "";
  const r = prng(hash32(`${key}:${tool}`));
  const lines: string[] = [];
  let len = 0;
  let n = 0;
  if (tool === "shell_run") {
    lines.push(`$ exit ${ok ? 0 : 1}`);
    len += lines[0]!.length + 1;
  }
  while (len < chars) {
    n++;
    let line: string;
    switch (tool) {
      case "fs_read":
        line = codeLine(r, n);
        break;
      case "shell_run":
        line = testLine(r, n, !ok);
        break;
      case "fs_search":
        line = searchLine(r, n);
        break;
      case "fs_list":
        line = listLine(r, n);
        break;
      case "scan_deps":
      case "scan_secrets":
      case "scan_config":
        line = scanLine(r, n);
        break;
      case "web_fetch":
      case "web_search":
        line = proseLine(r);
        break;
      default:
        line = n === 1 ? `ok: ${tool} done` : proseLine(r);
    }
    lines.push(line);
    len += line.length + 1;
  }
  return lines.join("\n").slice(0, chars);
}
