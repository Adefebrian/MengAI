// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The floor plan: every piece inside the slab, no two desks on one spot,
// and every walk between any two places stays on the lanes, clear of every
// desk, table, counter, shelf and easel, at every width and crew size.
// Visitors dock beside a desk's monitor and never stand over a name plate,
// a cat that stands up keeps its head clear of its plate, the furniture
// rows give the depth bands, and the narrow floor gets its camera window.
import { describe, expect, test } from "bun:test";
import { AGENT_ROLES } from "@mengai/shared";
import { CAMERA_RATIO, allDesks, bandOf, planOffice, route, type OfficePlan, type OfficeTheme, type OfficeVariant, type PlanAgent, type Pt, type Rect, type Spot } from "./geometry";

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

/**
 * Furniture in the three-quarter view: its floor footprint (feet never step
 * on it) and its drawn extent (a walker in front of it may cover it, a
 * walker behind it must not: walkers draw over the furniture).
 */
interface Obstacle {
  name: string;
  foot: Rect;
  draw: Rect;
}

function obstacles(plan: OfficePlan): Obstacle[] {
  const out: Obstacle[] = [];
  const block = (name: string, x: number, top: number, w: number, bottom: number, drawTop = top) =>
    out.push({ name, foot: { x, y: top, w, h: bottom - top }, draw: { x, y: drawTop, w, h: bottom - drawTop } });
  for (const d of allDesks(plan)) block(`desk ${d.agentId}`, d.rect.x, d.top, d.rect.w, d.rect.y + d.rect.h, d.monitor.y);
  if (plan.meeting) block("table", plan.meeting.table.x, plan.meeting.table.y, plan.meeting.table.w, plan.meeting.table.y + plan.meeting.table.h);
  const pan = plan.pantry;
  if (pan) {
    block("counter", pan.counter.x, pan.counter.y, pan.counter.w, pan.counter.y + pan.counter.h, pan.counter.y - 60);
    if (pan.fridge) block("fridge", pan.fridge.x, pan.fridge.y, pan.fridge.w, pan.fridge.y + pan.fridge.h);
    if (pan.table) block("pantry table", pan.table.x, pan.table.y, pan.table.w, pan.table.y + pan.table.h);
  }
  for (const c of plan.cells) if (c.kind !== "pantry") block(`cell ${c.kind}`, c.rect.x, c.top, c.rect.w, c.rect.y + c.rect.h, c.top - 70);
  if (plan.ceo.lounge) block("lounge", plan.ceo.lounge.x, plan.ceo.lounge.y, plan.ceo.lounge.w, plan.ceo.lounge.y + plan.ceo.lounge.h);
  if (plan.ceo.credenza) block("credenza", plan.ceo.credenza.x, plan.ceo.credenza.y, plan.ceo.credenza.w, plan.ceo.credenza.y + plan.ceo.credenza.h);
  for (const room of plan.rooms) {
    const r = room.rect;
    // the cutaway low front wall, but for its gap
    if (room.front !== null) {
      const y0 = room.front - plan.m.low - plan.m.cap;
      const g = room.gap;
      const segs = g ? [[r.x, g.x - g.w / 2], [g.x + g.w / 2, r.x + r.w]] : [[r.x, r.x + r.w]];
      for (const [a, b] of segs) if (b! - a! > 0.5) block(`${room.kind} front wall`, a!, y0, b! - a!, room.front);
    }
    // a back wall in the middle of the floor: its base line, but for the doorway
    if (room.doorway) {
      const d = room.doorway;
      for (const [a, b] of [[r.x, d.x], [d.x + d.w, r.x + r.w]]) if (b! - a! > 0.5) out.push({ name: `${room.kind} back wall`, foot: { x: a!, y: room.floorTop - 3, w: b! - a!, h: 3 }, draw: { x: a!, y: room.floorTop - 3, w: b! - a!, h: 3 } });
    }
  }
  // side walls between rooms side by side
  const band = plan.rooms.filter((r) => r.front !== null).sort((a, b) => a.rect.x - b.rect.x);
  for (let i = 1; i < band.length; i++) {
    const x = band[i]!.rect.x;
    block("partition", x - plan.m.cap / 2, band[i]!.floorTop, plan.m.cap, band[i]!.front!);
  }
  if (plan.nap) block("cat bed", plan.nap.bed.x, plan.nap.bed.y, plan.nap.bed.w, plan.nap.bed.y + plan.nap.bed.h);
  return out;
}

/** The box a walking cat's feet sweep along one straight segment, and the box its body sweeps. */
function sweep(a: Pt, b: Pt, plan: OfficePlan): { feet: Rect; body: Rect } {
  const s = plan.m.walker;
  const vertical = Math.abs(a.x - b.x) < 0.5;
  const half = vertical ? 11 * s : 26 * s;
  const x0 = Math.min(a.x, b.x) - half;
  const x1 = Math.max(a.x, b.x) + half;
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return {
    feet: { x: x0, y: y0 - 2, w: x1 - x0, h: y1 - y0 + 4 },
    body: { x: x0, y: y0 - 48 * s, w: x1 - x0, h: y1 - y0 + 48 * s },
  };
}

function spots(plan: OfficePlan): Spot[] {
  const out: Spot[] = [];
  for (const d of allDesks(plan)) out.push(d.home, ...d.visits);
  out.push(...plan.ceo.visitors, plan.ceo.board, ...plan.huddle);
  if (plan.meeting) out.push(...plan.meeting.seats.map((s) => s.spot), ...plan.meeting.stands);
  if (plan.pantry) out.push(...plan.pantry.spots);
  if (plan.door) out.push(plan.door.spot);
  if (plan.nap) out.push(plan.nap.spot);
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
            // the seated cat's cut line is the desk top's back edge
            expect(Math.abs(d.rig.y + (116 * d.cat) / 160 - d.top)).toBeLessThan(0.6);
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
  const cases: Array<[OfficeVariant, number, number, OfficeTheme]> = [];
  for (const variant of ["full", "hero"] as OfficeVariant[]) for (const width of [320, 375, 768, 1280]) for (const n of [4, 12]) cases.push([variant, width, n, "studio"]);
  for (const variant of ["full", "hero"] as OfficeVariant[]) for (const width of [375, 1024, 1280]) cases.push([variant, width, 8, "fund"]);
  for (const [variant, width, n, theme] of cases) {
    {
      {
        test(`${variant} ${theme} ${width}px, ${n} cats: every walk stays clear of the furniture`, () => {
          const plan = planOffice(crew(n), width, variant, { theme });
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
                const feetY = Math.max(p.y, q.y);
                for (const w of walls) {
                  const onIt = overlaps(box.feet, w.foot);
                  // furniture in front of the walker must stay clear of its body
                  const covers = w.draw.y + w.draw.h > feetY + 0.5 && overlaps(box.body, w.draw);
                  if (onIt || covers) throw new Error(`walk ${JSON.stringify(p)} to ${JSON.stringify(q)} ${onIt ? "steps on" : "is hidden by"} ${w.name} ${JSON.stringify(w.draw)} (${variant} ${width} ${n})`);
                }
              }
            }
          }
        });
      }
    }
  }
});

/** A cat sitting with its back to us at a spot (the visitor pose): its drawn box. */
function backCat(p: Pt, plan: OfficePlan): Rect {
  const bu = 0.56 * plan.m.walker;
  return { x: p.x - 40 * bu, y: p.y - 92 * bu, w: 80 * bu, h: 92 * bu };
}

/** A standing walker at a spot, side view: its drawn box. */
function standing(p: Pt, plan: OfficePlan): Rect {
  const wu = 0.6 * plan.m.walker;
  return { x: p.x - 42 * wu, y: p.y - 84 * wu, w: 92 * wu, h: 84 * wu };
}

describe("docks and plates", () => {
  for (const variant of ["full", "hero"] as OfficeVariant[]) {
    for (const width of [288, 343, 382, 560, 736, 1024, 1248]) {
      for (const n of [4, 8, 12]) {
        test(`${variant} ${width}px, ${n} cats: visitors dock beside a monitor, never over a name plate in front of it`, () => {
          const plan = planOffice(crew(n), width, variant);
          const desks = allDesks(plan);
          for (const d of desks) {
            for (const v of d.visits) {
              const box = backCat(v.p, plan);
              expect(v.lean === "left" || v.lean === "right").toBe(true);
              for (const other of desks) {
                // a desk whose front edge is behind the cat's feet is drawn under the cat: its plate must stay clear
                if (other.rect.y + other.rect.h > v.p.y) continue;
                expect({ desk: d.agentId, over: other.agentId, hit: overlaps(box, other.card) }).toEqual({ desk: d.agentId, over: other.agentId, hit: false });
              }
            }
          }
        });

        test(`${variant} ${width}px, ${n} cats: a cat that stands up keeps its head clear of its own plate`, () => {
          const plan = planOffice(crew(n), width, variant);
          for (const d of allDesks(plan)) {
            const box = standing(d.home.p, plan);
            const clearBelow = box.y >= d.card.y + d.card.h - 1;
            const clearBeside = box.x >= d.card.x + d.card.w - 2 || box.x + box.w <= d.card.x + 2;
            expect({ desk: d.agentId, clear: clearBelow || clearBeside }).toEqual({ desk: d.agentId, clear: true });
          }
        });
      }
    }
  }

  test("two desks that share a spine share its docks", () => {
    const plan = planOffice(crew(8), 343, "full");
    const [a, b] = plan.desks;
    expect(a!.rect.y).toBe(b!.rect.y);
    expect(a!.visits.map((v) => v.key)).toEqual(b!.visits.map((v) => v.key));
    // beside the first column's desk on its right, beside the second column's monitor on its left
    expect(a!.visits[0]!.lean).toBe("left");
    expect(b!.visits[0]!.lean).toBe("right");
    expect(a!.visits[0]!.p.x).toBeGreaterThan(a!.rect.x + a!.rect.w);
    expect(b!.visits[0]!.p.x).toBeLessThan(b!.monitor.x);
  });

  test("the CEO's visitors dock left of the lead's desk, by its monitor", () => {
    const plan = planOffice(crew(8), 1248, "full");
    const lead = plan.ceo.desk!;
    for (const v of plan.ceo.visitors) {
      expect(v.p.x).toBeLessThan(lead.rect.x);
      expect(v.lean).toBe("right");
    }
  });
});

describe("depth and camera", () => {
  test("the furniture rows are the occluders, back to front, each block inside the floor", () => {
    for (const width of [343, 768, 1248]) {
      const plan = planOffice(crew(8), width, "full");
      expect(plan.occluders.length).toBeGreaterThan(2);
      for (let i = 1; i < plan.occluders.length; i++) expect(plan.occluders[i]!.front).toBeGreaterThan(plan.occluders[i - 1]!.front);
      for (const o of plan.occluders) for (const r of o.rects) expect(inside(r, plan)).toBe(true);
      // every desk's front edge is a row
      for (const d of allDesks(plan)) expect(plan.occluders.some((o) => Math.abs(o.front - (d.rect.y + d.rect.h)) < 1)).toBe(true);
    }
  });

  test("a cat docked beside a desk is behind its row, a cat on the aisle is in front of it", () => {
    const plan = planOffice(crew(8), 1248, "full");
    const d = plan.desks[0]!;
    const front = d.rect.y + d.rect.h;
    const row = plan.occluders.findIndex((o) => Math.abs(o.front - front) < 1);
    expect(bandOf(plan, d.visits[0]!.p.y)).toBe(row);
    expect(bandOf(plan, d.home.p.y)).toBe(row + 1);
  });

  test("below 640px the full floor is seen through a camera window about three widths tall", () => {
    const narrow = planOffice(crew(8), 343, "full");
    expect(narrow.camera).not.toBeNull();
    expect(narrow.camera!.h).toBe(Math.round(343 * CAMERA_RATIO));
    expect(narrow.camera!.h).toBeLessThan(narrow.height);
    expect(planOffice(crew(8), 768, "full").camera).toBeNull();
    expect(planOffice(crew(8), 343, "hero").camera).toBeNull();
    // a tiny crew that fits the window shows the whole floor
    expect(planOffice(crew(1), 343, "full").camera === null || planOffice(crew(1), 343, "full").camera!.h < planOffice(crew(1), 343, "full").height).toBe(true);
  });

  test("the corridor is a halved walk lane, no taller than a lane pair", () => {
    const plan = planOffice(crew(8), 1248, "full");
    expect(plan.corridor!.h).toBeLessThanOrEqual(40);
    const lane = plan.lanes[0]!;
    expect(lane.yR).toBeGreaterThan(plan.corridor!.y);
    expect(lane.yL).toBeLessThanOrEqual(plan.corridor!.y + plan.corridor!.h);
  });
});
