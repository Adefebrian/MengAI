// The floor plan: every piece inside the slab, no two desks on one spot,
// and every walk between any two places stays on the lanes, clear of every
// desk, table, counter, shelf and easel, at every width and crew size.
import { describe, expect, test } from "bun:test";
import { AGENT_ROLES } from "@mengai/shared";
import { allDesks, planOffice, route, type OfficePlan, type OfficeVariant, type PlanAgent, type Pt, type Rect, type Spot } from "./geometry";

function crew(n: number): PlanAgent[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    role: i === 0 ? "lead" : AGENT_ROLES[1 + ((i - 1) % (AGENT_ROLES.length - 1))]!,
    parentId: i === 0 ? null : "a0",
  }));
}

const WIDTHS = [280, 320, 343, 375, 414, 560, 640, 768, 900, 1024, 1100, 1248, 1280];
const SIZES = [1, 2, 4, 8, 12];

function inside(r: Rect, plan: OfficePlan): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= plan.width + 0.5 && r.y + r.h <= plan.height + 0.5;
}

function overlaps(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
}

/** Furniture a walking cat must never cross: desk bodies (below the bubble lane), tables, counters, shelves, the easel. */
function obstacles(plan: OfficePlan): Rect[] {
  const out: Rect[] = [];
  for (const d of allDesks(plan)) out.push({ x: d.rect.x, y: d.monitor.y, w: d.rect.w, h: d.rect.y + d.rect.h - d.monitor.y });
  if (plan.meeting) out.push(plan.meeting.table);
  if (plan.pantry) for (const s of plan.pantry.slots) out.push({ x: s.x, y: s.y + plan.m.deskTop - 60, w: s.w, h: s.h - plan.m.deskTop + 60 });
  for (const n of plan.nooks) out.push({ x: n.x, y: n.y + plan.m.deskTop - 30, w: n.w, h: n.h - plan.m.deskTop + 30 });
  if (plan.ceo.kind === "corner") out.push({ ...plan.ceo.whiteboard, h: plan.ceo.rect.y + plan.ceo.rect.h - plan.ceo.whiteboard.y });
  if (plan.ceo.lounge) out.push(plan.ceo.lounge);
  return out;
}

/** The box a walking cat sweeps along one straight segment (feet on the line). */
function sweep(a: Pt, b: Pt, plan: OfficePlan): Rect {
  const s = plan.m.walker;
  const h = 44 * s;
  const vertical = Math.abs(a.x - b.x) < 0.5;
  const half = vertical ? 11 * s : 26 * s;
  const x0 = Math.min(a.x, b.x) - half;
  const x1 = Math.max(a.x, b.x) + half;
  const y0 = Math.min(a.y, b.y) - h;
  const y1 = Math.max(a.y, b.y);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function spots(plan: OfficePlan): Spot[] {
  const out: Spot[] = [];
  for (const d of allDesks(plan)) out.push(d.home, ...d.visits);
  out.push(...plan.ceo.visitors, plan.ceo.board, ...plan.huddle);
  if (plan.meeting) out.push(...plan.meeting.seats.map((s) => s.spot), ...plan.meeting.stands);
  if (plan.pantry) out.push(...plan.pantry.spots);
  return out;
}

describe("planOffice", () => {
  for (const variant of ["full", "hero"] as OfficeVariant[]) {
    for (const width of WIDTHS) {
      for (const n of SIZES) {
        test(`${variant} ${width}px, ${n} cats: everything inside, desks apart`, () => {
          const plan = planOffice(crew(n), width, variant);
          const desks = allDesks(plan);
          const hidden = new Set(plan.hidden);
          expect(desks.length + hidden.size).toBe(n);
          for (const d of desks) {
            expect({ id: d.agentId, inside: inside(d.rect, plan) }).toEqual({ id: d.agentId, inside: true });
            expect(d.monitor.x).toBeGreaterThanOrEqual(d.rect.x);
            // the monitor stands clear of the cat (its visible left edge is 40 of 160 rig units in)
            expect(d.monitor.x + d.monitor.w).toBeLessThanOrEqual(d.rig.x + (d.cat * 40) / 160 - 6 + 0.5);
            expect(d.rig.x + d.cat).toBeLessThanOrEqual(d.rect.x + d.rect.w + 0.5);
            expect(d.card.x + d.card.w).toBeLessThanOrEqual(d.rect.x + d.rect.w);
          }
          for (let i = 0; i < desks.length; i++) {
            for (let j = i + 1; j < desks.length; j++) {
              expect({ a: desks[i]!.agentId, b: desks[j]!.agentId, overlap: overlaps(desks[i]!.rect, desks[j]!.rect) }).toEqual({ a: desks[i]!.agentId, b: desks[j]!.agentId, overlap: false });
            }
          }
          if (plan.meeting) {
            expect(inside(plan.meeting.rect, plan)).toBe(true);
            expect(inside(plan.meeting.table, plan)).toBe(true);
          }
          expect(inside(plan.ceo.whiteboard, plan)).toBe(true);
          if (plan.pantry) for (const s of plan.pantry.slots) expect(inside(s, plan)).toBe(true);
        });
      }
    }
  }

  test("the hero has no meeting room and no pantry, the full floor has both", () => {
    const hero = planOffice(crew(8), 560, "hero");
    expect(hero.meeting).toBeNull();
    expect(hero.pantry).toBeNull();
    expect(hero.huddle.length).toBeGreaterThan(0);
    expect(hero.ceo.kind).toBe("corner");
    const full = planOffice(crew(8), 1280, "full");
    expect(full.meeting).not.toBeNull();
    expect(full.pantry).not.toBeNull();
    expect(full.ceo.kind).toBe("room");
  });

  test("the wide floor seats a crew of 12 at the table", () => {
    const plan = planOffice(crew(12), 1280, "full");
    expect(plan.meeting!.seats.length + plan.meeting!.stands.length).toBeGreaterThanOrEqual(12);
  });

  test("at 375 the pods have two columns, so the first screen holds the CEO office and two desks", () => {
    const plan = planOffice(crew(8), 343, "full");
    const first = plan.desks.filter((d) => d.rect.y === plan.desks[0]!.rect.y);
    expect(first.length).toBe(2);
  });

  test("the lead sits in the CEO office, the crew grouped by role", () => {
    const agents: PlanAgent[] = [
      { id: "q", role: "qa", parentId: "l" },
      { id: "e1", role: "engineer", parentId: "l" },
      { id: "l", role: "lead", parentId: null },
      { id: "e2", role: "engineer", parentId: "l" },
    ];
    const plan = planOffice(agents, 1280);
    expect(plan.ceo.desk?.agentId).toBe("l");
    expect(plan.desks.map((d) => d.agentId)).toEqual(["e1", "e2", "q"]);
  });
});

describe("route", () => {
  for (const variant of ["full", "hero"] as OfficeVariant[]) {
    for (const width of [320, 375, 768, 1280]) {
      for (const n of [4, 12]) {
        test(`${variant} ${width}px, ${n} cats: every walk stays clear of the furniture`, () => {
          const plan = planOffice(crew(n), width, variant);
          const all = spots(plan);
          const walls = obstacles(plan);
          for (const a of all) {
            for (const b of all) {
              const pts = route(plan, a, b);
              expect(pts[0]).toEqual({ x: Math.round(a.p.x * 10) / 10, y: Math.round(a.p.y * 10) / 10 });
              expect(pts[pts.length - 1]).toEqual({ x: Math.round(b.p.x * 10) / 10, y: Math.round(b.p.y * 10) / 10 });
              for (let i = 1; i < pts.length; i++) {
                const p = pts[i - 1]!;
                const q = pts[i]!;
                // every step is straight along a lane or a spine
                expect(Math.abs(p.x - q.x) < 0.5 || Math.abs(p.y - q.y) < 0.5).toBe(true);
                const box = sweep(p, q, plan);
                for (const w of walls) {
                  if (overlaps(box, w)) throw new Error(`walk ${JSON.stringify(p)} to ${JSON.stringify(q)} crosses ${JSON.stringify(w)} (${variant} ${width} ${n})`);
                }
              }
            }
          }
        });
      }
    }
  }
});
