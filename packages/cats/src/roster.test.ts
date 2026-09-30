// The shared crew roster: one name wears one coat everywhere. The Office
// preview and the crew board read it, so Cemong is the tuxedo engineer on
// the landing and in the preview alike.
import { describe, expect, test } from "bun:test";
import { COATS, catLook } from "@mengai/shared";
import { OFFICE_CREW, HIRE } from "../preview/office-story";
import { CREW } from "../preview/timeline";
import { ROSTER, lookFor, rosterCat, rosterCrew } from "./roster";

describe("crew roster", () => {
  test("every name once, a real coat and a seed each, the CEO first", () => {
    const names = ROSTER.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of ROSTER) {
      expect(COATS).toContain(c.coat);
      expect(Number.isInteger(c.seed) && c.seed > 0).toBe(true);
      expect(c.id).toBe(c.name.toLowerCase());
    }
    expect(ROSTER[0]!.role).toBe("lead");
    expect(ROSTER[0]!.name).toBe("Oyen");
  });

  test("the cats the landing shows keep their coats: Cemong the tuxedo engineer, Tempe the gray reviewer", () => {
    expect(rosterCat("Cemong")).toMatchObject({ coat: "tuxedo", role: "engineer", seed: 88213 });
    expect(rosterCat("tempe")).toMatchObject({ coat: "gray", role: "reviewer", seed: 71002 });
    expect(rosterCat(" Oyen ")).toMatchObject({ coat: "ginger", seed: 1204 });
  });

  test("a look by name: the roster's coat, else the agent id's own", () => {
    expect(lookFor("Cemong", "any-agent")).toEqual({ coat: "tuxedo", seed: 88213 });
    expect(lookFor("Nobody", "agent-42")).toEqual(catLook("agent-42"));
  });

  test("a crew by name, with a role a story casts differently; an unknown name is an error", () => {
    const crew = rosterCrew(["Oyen", "Cemong"], { Cemong: "reviewer" });
    expect(crew.map((c) => [c.name, c.role, c.coat])).toEqual([
      ["Oyen", "lead", "ginger"],
      ["Cemong", "reviewer", "tuxedo"],
    ]);
    expect(() => rosterCrew(["Nobody"])).toThrow();
  });

  test("the Office preview and the crew board read the roster", () => {
    for (const m of [...OFFICE_CREW, HIRE, ...CREW]) {
      const c = rosterCat(m.name)!;
      expect({ name: m.name, coat: m.coat, seed: m.seed }).toEqual({ name: c.name, coat: c.coat, seed: c.seed });
    }
    const cemong = OFFICE_CREW.find((m) => m.name === "Cemong")!;
    expect(cemong.coat).toBe("tuxedo");
    expect(cemong.role).toBe("engineer");
  });
});
