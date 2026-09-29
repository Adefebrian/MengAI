import { describe, expect, test } from "bun:test";
import { CAT_NAMES } from "@mengai/shared";
import { COMPANIES, COMPANY_KINDS, HEAD_KEYS, LIFE_LABEL, cellsAt, lifeAt, lifeBeats, lifeEnergy, lifeLabel, stageWords, type Company } from "./lifecycle";
import { nextDelay, openingStep, type StoryScript } from "./useStory";

const EMDASH = String.fromCharCode(0x2014);
const script = (c: Company): StoryScript => ({ steps: c.steps, total: c.total, start: 0, poster: c.poster, loop: false, beats: (i, p) => lifeBeats(c, i, p) });
const idx = (c: Company, id: string) => c.steps.findIndex((s) => s.id === id);

for (const kind of COMPANY_KINDS) {
  const c = COMPANIES[kind];
  const ids = new Set(c.cats.map((x) => x.id));
  const onFloor = (i: number) => lifeAt(c, i).agents.map((a) => a.id);

  describe(`the ${kind} lifecycle`, () => {
    test("steps run in order inside one play, with unique ids and scene names", () => {
      expect(c.steps[0]!.at).toBe(0);
      for (let i = 1; i < c.steps.length; i++) expect(c.steps[i]!.at).toBeGreaterThan(c.steps[i - 1]!.at);
      expect(c.steps.at(-1)!.at).toBeLessThan(c.total);
      expect(new Set(c.steps.map((s) => s.id)).size).toBe(c.steps.length);
      expect(new Set(c.steps.map((s) => s.scene)).size).toBe(c.steps.length);
      expect(c.stages.length).toBe(7);
    });

    test("Oyen the CEO starts alone, then the hires walk in", () => {
      const ceo = c.cats.find((x) => x.role === "lead")!;
      expect(ceo.name).toBe("Oyen");
      expect(ceo.title).toBe("CEO");
      expect(onFloor(0)).toEqual(["oyen"]);
      const hire = idx(c, "hire");
      expect(hire).toBeGreaterThan(0);
      expect(onFloor(hire).length).toBeGreaterThanOrEqual(6);
      for (let i = 0; i < hire; i++) expect(onFloor(i)).toEqual(["oyen"]);
    });

    test("one hire is a dynamic role the company never had", () => {
      const hired = c.steps[idx(c, "hire")]!.hire!.map((id) => c.cats.find((x) => x.id === id)!);
      const roleWords = ["Lead", "Engineer", "Designer", "Reviewer", "QA", "Security", "Researcher"];
      expect(hired.some((x) => !roleWords.includes(x.title))).toBe(true);
      expect(c.steps[idx(c, "hire")]!.caption).toContain("a new role");
    });

    test("every cat has an Indonesian snack name from the product's own pool", () => {
      for (const x of c.cats) expect((CAT_NAMES as readonly string[]).includes(x.name) || x.name === "Oyen" || x.name === "Cemong").toBe(true);
    });

    test("a review bounces: the tracker steps back one stage and marks the bounced stage", () => {
      const b = c.steps[idx(c, "bounce")]!;
      expect(b.back).toBe(b.stage + 1);
      const beat = b.beats?.find((x) => x.kind === "review");
      expect(beat && beat.kind === "review" && beat.passed).toBe(false);
      const cells = lifeAt(c, idx(c, "bounce")).cells;
      expect(cells[b.stage]).toBe("now");
      expect(cells[b.back!]).toBe("back");
      const before = c.steps[idx(c, "bounce") - 1]!;
      expect(before.stage).toBe(b.back!);
      const pass = c.steps.find((s) => s.beats?.some((x) => x.kind === "review" && x.passed));
      expect(pass).toBeDefined();
      expect(pass!.stage).toBeGreaterThan(b.back!);
      expect(pass!.back).toBeUndefined();
    });

    test("a cat that keeps failing is let go and leaves as its replacement walks in", () => {
      const strikes = c.steps[idx(c, "strikes")]!;
      const letgo = c.steps[idx(c, "letgo")]!;
      const gone = letgo.leave![0]!;
      const fresh = letgo.hire![0]!;
      expect(strikes.agents?.[gone]?.status).toBe("error");
      expect(strikes.caption).toMatch(/third/);
      expect(onFloor(idx(c, "strikes"))).toContain(gone);
      expect(onFloor(idx(c, "letgo"))).not.toContain(gone);
      expect(onFloor(idx(c, "letgo"))).toContain(fresh);
      expect(c.cats.find((x) => x.id === gone)!.role).toBe(c.cats.find((x) => x.id === fresh)!.role);
      expect(letgo.caption).toMatch(/box/);
      expect(letgo.head?.strategy?.evidence).toContain(c.cats.find((x) => x.id === fresh)!.name);
    });

    test("the funny beats play: a coffee queue, a nap and a yawn", () => {
      const all = c.steps.flatMap((s) => Object.values(s.agents ?? {}));
      expect(c.steps.some((s) => /coffee/i.test(s.caption))).toBe(true);
      expect(c.steps.some((s) => /naps/i.test(s.caption))).toBe(true);
      expect(all.some((a) => a.mood === "tired")).toBe(true);
      expect(all.filter((a) => a.activity === "rest" && a.status === "idle").length).toBeGreaterThanOrEqual(3);
    });

    test("a meeting starts, ends, and only one runs at a time", () => {
      const started = c.steps.flatMap((s) => (s.meetingStart ? [s.meetingStart.id] : []));
      const ended = c.steps.flatMap((s) => (s.meetingEnd ? [s.meetingEnd.id] : []));
      expect(started.length).toBeGreaterThanOrEqual(1);
      expect(ended.sort()).toEqual(started.sort());
      for (let i = 0; i < c.steps.length; i++) expect(lifeAt(c, i).meetings.filter((m) => m.endedAt === null).length).toBeLessThanOrEqual(1);
    });

    test("it ends shipped and celebrating, every stage done", () => {
      const last = c.steps.length - 1;
      expect(c.steps[last]!.complete).toBe(true);
      expect(c.steps[last]!.beats?.some((b) => b.kind === "celebrate")).toBe(true);
      expect(lifeAt(c, last).cells.every((s) => s === "done")).toBe(true);
      expect(lifeAt(c, last).plan.every((p) => p.status === "done")).toBe(true);
    });

    test("the tracker moves forward except for the bounce, and names its position", () => {
      let stage = 0;
      for (const s of c.steps) {
        if (s.back === undefined) expect(s.stage).toBeGreaterThanOrEqual(stage);
        stage = s.back === undefined ? s.stage : stage;
      }
      expect(stageWords(c, c.steps[0]!)).toBe(`1 of 7: ${c.stages[0]!.label}`);
      expect(stageWords(c, c.steps.at(-1)!)).toBe(`7 of 7: ${c.stages[6]!.label}`);
    });

    test("every beat, meeting and patch names a cat on the floor at that step", () => {
      for (let i = 0; i < c.steps.length; i++) {
        const s = c.steps[i]!;
        const floor = new Set(onFloor(i));
        for (const b of s.beats ?? []) {
          const refs = Object.entries(b).filter(([k]) => k.endsWith("Id")).map(([, v]) => v as string);
          for (const r of refs) expect(floor.has(r)).toBe(true);
          if (b.kind === "celebrate") for (const r of b.agentIds) expect(floor.has(r)).toBe(true);
        }
        for (const r of s.meetingStart?.agentIds ?? []) expect(floor.has(r)).toBe(true);
        for (const r of Object.keys(s.agents ?? {})) expect(floor.has(r) || (s.leave ?? []).includes(r)).toBe(true);
        for (const r of [...(s.hire ?? []), ...(s.leave ?? [])]) expect(ids.has(r)).toBe(true);
        for (const p of Object.keys(s.plan ?? {})) expect(c.plan.some((x) => x.id === p)).toBe(true);
      }
    });

    test("the head card: every row filled, updates marked fresh, evidence behind each injection", () => {
      const first = lifeAt(c, 0);
      expect(first.focusHired).toBe(false);
      for (const k of HEAD_KEYS) expect(first.head.rows[k].value.length).toBeGreaterThan(0);
      expect(first.head.rows.charter.value).toMatch(/charter v\d/);
      expect(first.head.rows.skills.evidence).toContain("JEV");
      const bounce = lifeAt(c, idx(c, "bounce"));
      expect(bounce.focusHired).toBe(true);
      expect(bounce.fresh).toEqual(["strategy", "memory", "trust"]);
      expect(bounce.head.rows.strategy.evidence).toMatch(/JEV adopted/);
      expect(bounce.head.rows.strategy.evidence).toMatch(/offline eval/);
      expect(lifeAt(c, idx(c, "bounce") + 1).fresh).toEqual([]);
    });

    test("walking beats and meetings get time to finish before the next scene", () => {
      const s = script(c);
      for (let i = 0; i < c.steps.length; i++) {
        const walks = (c.steps[i]!.beats ?? []).some((b) => b.kind !== "celebrate" && b.kind !== "decided");
        const room = nextDelay(i, c.steps[i]!.at, s);
        if (walks || c.steps[i]!.hire || c.steps[i]!.leave) expect(room).toBeGreaterThanOrEqual(5_000);
        if (c.steps[i]!.meetingStart) expect(room).toBeGreaterThanOrEqual(8_000);
      }
      expect(openingStep(true, s)).toBe(c.poster);
      expect(openingStep(false, s)).toBe(0);
      const poster = lifeAt(c, c.poster);
      expect(poster.cells[poster.step.stage]).toBe("now");
      expect(poster.agents.length).toBeGreaterThanOrEqual(6);
      expect(poster.meetings.every((m) => m.endedAt !== null)).toBe(true);
    });

    test("beat ids stay unique across plays and companies", () => {
      const all = [0, 1].flatMap((play) => c.steps.flatMap((_, i) => lifeBeats(c, i, play).map((b) => b.id)));
      expect(new Set(all).size).toBe(all.length);
      expect(all.every((id) => id.startsWith(`${kind}-`))).toBe(true);
    });

    test("energy climbs and stays in 0..1", () => {
      let prev = -1;
      for (const s of c.steps) {
        const e = lifeEnergy(c, s.at);
        expect(e).toBeGreaterThan(prev);
        expect(e).toBeLessThanOrEqual(1);
        prev = e;
      }
    });

    test("every status line fits one line on a laptop: 90 characters at most", () => {
      for (const s of c.steps) expect(s.caption.length).toBeLessThanOrEqual(90);
    });

    test("every line is plain copy and labelled as a sample", () => {
      for (const s of c.steps) {
        const texts = [s.caption, s.scene, ...(s.meetingStart?.agenda ?? []), ...(s.meetingEnd?.notes ?? []), ...Object.values(s.agents ?? {}).map((a) => a.statusText ?? "")];
        for (const k of HEAD_KEYS) if (s.head?.[k]) texts.push(s.head[k]!.value, s.head[k]!.evidence);
        for (const t of texts) {
          expect(t.includes(EMDASH)).toBe(false);
          expect(/\p{Extended_Pictographic}/u.test(t)).toBe(false);
        }
        expect(lifeLabel(c, s)).toContain(LIFE_LABEL);
      }
    });
  });
}

describe("tracker cells", () => {
  test("done before the stage, now on it, next after, back where a review bounced", () => {
    const base = { id: "x", scene: "x", at: 0, clock: "09:00", caption: "x" };
    expect(cellsAt({ ...base, stage: 2 }, 4)).toEqual(["done", "done", "now", "next"]);
    expect(cellsAt({ ...base, stage: 1, back: 2 }, 4)).toEqual(["done", "now", "back", "next"]);
    expect(cellsAt({ ...base, stage: 3, complete: true }, 4)).toEqual(["done", "done", "done", "done"]);
  });

  test("the studio and the fund dress the floor differently", () => {
    expect(COMPANIES.studio.theme).toBe("studio");
    expect(COMPANIES.fund.theme).toBe("fund");
    expect(COMPANIES.fund.stages.map((s) => s.label)).toEqual(["Thesis", "Data research", "Backtest", "Risk review", "Paper trade", "Live trade", "P&L report"]);
    expect(COMPANIES.studio.stages.map((s) => s.label)).toEqual(["Goal received", "Oyen plans", "Team hired", "Working", "Review", "Testing", "Shipped"]);
  });
});
