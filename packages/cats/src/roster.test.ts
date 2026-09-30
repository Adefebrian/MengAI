// The shared crew roster: one name wears one coat everywhere. The Office
// preview and the crew board read it, so Cemong is the tuxedo engineer on
// the landing and in the preview alike.
import { describe, expect, test } from "bun:test";
import { COATS, catLook } from "@mengai/shared";
import { LOOP_S, OFFICE_CREW, HIRE, agentsAt } from "../preview/office-story";
import { CREW } from "../preview/timeline";
import { CEO_COAT, ROSTER, crewLooks, lookFor, rosterCat, rosterCrew } from "./roster";

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

describe("crew looks", () => {
  test("Oyen is always the ginger tabby, and nobody else wears ginger", () => {
    const names = ["Belang", "Oyen", "Tempe", "Klepon", "Pukis"];
    const looks = crewLooks(names);
    expect(looks[1]!.coat).toBe(CEO_COAT);
    expect(crewLooks(["Oyen"])[0]!.coat).toBe("ginger");
    for (const [i, l] of looks.entries()) if (i !== 1) expect(l.coat).not.toBe("ginger");
  });

  test("no coat repeats inside a crew while the palette lasts, and the first cat of a coat keeps its roster coat", () => {
    const names = ["Oyen", "Belang", "Klepon", "Pukis", "Cemong", "Garong", "Tempe", "Kencur"];
    const looks = crewLooks(names);
    expect(new Set(looks.map((l) => l.coat)).size).toBe(names.length);
    expect(looks[1]!.coat).toBe("calico");
    expect(looks[4]!.coat).toBe("tuxedo");
    expect(looks[6]!.coat).toBe("gray");
    // seeds stay the roster's, so a cat keeps its markings
    expect(looks[4]!.seed).toBe(rosterCat("Cemong")!.seed);
  });

  test("keyed by name: the same crew gives the same looks, a name off the roster still gets a free coat", () => {
    const names = ["Oyen", "Nobody", "Belang"];
    expect(crewLooks(names)).toEqual(crewLooks([...names]));
    const looks = crewLooks(names);
    expect(COATS).toContain(looks[1]!.coat);
    expect(new Set(looks.map((l) => l.coat)).size).toBe(3);
  });

  test("a crew larger than the palette repeats only the least worn coats", () => {
    const names = ROSTER.slice(0, 12).map((c) => c.name);
    const looks = crewLooks(names);
    const counts = new Map<string, number>();
    for (const l of looks) counts.set(l.coat, (counts.get(l.coat) ?? 0) + 1);
    expect(counts.get("ginger")).toBe(1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });

  test("the Office preview floor never shows two cats in one coat at once, Oyen in ginger", () => {
    for (const size of [4, 8] as const) {
      for (let t = 0; t < LOOP_S; t += 0.5) {
        const floor = agentsAt(t, size);
        expect(new Set(floor.map((a) => a.look.coat)).size).toBe(floor.length);
        expect(floor.find((a) => a.name === "Oyen")!.look.coat).toBe("ginger");
      }
    }
  });
});
