// The editor's highlighter and line diff: keywords and strings are marked,
// a regex holding a quote never swallows the rest of the line, a block
// comment spans lines, and only the lines the crew changed are fresh.
import { describe, expect, test } from "bun:test";
import { DEMO_FILE_CONTENT } from "../../demo/fixture";
import { changedLines, highlight, langOf } from "../run/highlight";

const text = (line: Array<{ text: string }>) => line.map((s) => s.text).join("");

describe("highlight", () => {
  test("picks the language from the path", () => {
    expect(["a.ts", "b.tsx", "c.json", "d.css", "e.html", "f.md", "g.lock"].map(langOf)).toEqual(["js", "js", "json", "css", "html", "md", "text"]);
  });

  test("keeps every character and every line of a real file", () => {
    const src = DEMO_FILE_CONTENT["src/report/csv.ts"]!;
    const lines = highlight(src, "js");
    expect(lines.map(text).join("\n")).toBe(src.replace(/\n$/, ""));
  });

  test("marks keywords, strings, comments, and a regex with a quote in it", () => {
    const [line] = highlight('if (!/[",\\r\\n]/.test(v)) return "x"; // done', "js");
    const toks = line!.map((s) => [s.text, s.tok ?? ""]);
    expect(toks).toContainEqual(["if", "kw"]);
    expect(toks).toContainEqual(['/[",\\r\\n]/', "str"]);
    expect(toks).toContainEqual(['"x"', "str"]);
    expect(toks).toContainEqual(["// done", "com"]);
  });

  test("a block comment spans lines", () => {
    const lines = highlight("/* one\ntwo */ const a = 1;", "js");
    expect(lines[0]![0]).toEqual({ text: "/* one", tok: "com" });
    expect(lines[1]![0]).toEqual({ text: "two */", tok: "com" });
  });

  test("json keys, css properties, html tags and markdown headings", () => {
    expect(highlight('{ "a": 1 }', "json")[0]).toContainEqual({ text: '"a"', tok: "prop" });
    expect(highlight("a { color: red; }", "css")[0]).toContainEqual({ text: "color", tok: "prop" });
    expect(highlight('<a href="/x">x</a>', "html")[0]).toContainEqual({ text: "a", tok: "kw" });
    expect(highlight("# Title", "md")[0]).toEqual([{ text: "# Title", tok: "head" }]);
  });
});

describe("changedLines", () => {
  test("only the new and edited lines are fresh", () => {
    expect(changedLines("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([1, 3]);
    expect(changedLines("same\n", "same\n")).toEqual([]);
    expect(changedLines("", "one\ntwo\n")).toEqual([0, 1]);
  });
});
