// Office floor plan: a pure function of the crew, the container width and
// the variant, so the scene, the director and the tests share one plan.
// Units are CSS pixels at the planned width (the world is planned at the
// container's own width up to 1280, then scaled), so text in the art is
// drawn at the real token sizes.
//
// The floor is a straight-on flat cross-section (JEV imm.concept d1):
//   rooms band   the CEO office (walled room: whiteboard on the back wall,
//                the lead's desk, visitor spots) and, from 1100px, the
//                meeting room beside it
//   corridor     the walkway in front of the rooms
//   pods         open zone: desk rows grouped by role, an aisle in front
//                of every row, spines (vertical walkways) at the side or
//                the middle; the pantry nook fills the last row's spare slots
//   meeting      below 1100px the meeting room closes the floor, entered
//                through a doorway in its back wall
// Every walk runs on lanes (horizontal) and spines (vertical), each with two
// sub-lanes by direction, so cats never cut through furniture.
import { AGENT_ROLES, type AgentRole } from "@mengai/shared";

export type OfficeVariant = "full" | "hero";

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Metrics {
  pad: number;
  /** seated rig size at a crew desk */
  cat: number;
  /** seated rig size at the lead's desk */
  lead: number;
  bubble: number;
  /** cell top to the desk top line */
  deskTop: number;
  band: number;
  front: number;
  deskMin: number;
  deskMax: number;
  leadDesk: number;
  aisle: number;
  corridor: number;
  spine: number;
  gutter: number;
  /** walker scale, 1 draws the walker 72 x 54 */
  walker: number;
  /** seated rig size at the meeting table and on the floor */
  floorCat: number;
  seatPitch: number;
  wall: number;
  meetWall: number;
  /** walking speed, px per second */
  speed: number;
  /** text size tier inside the art: "n1" 13px or "n2" 11px */
  text: "n1" | "n2";
}

const FULL: Metrics = {
  pad: 16,
  cat: 80,
  lead: 92,
  bubble: 28,
  deskTop: 112,
  band: 8,
  front: 52,
  deskMin: 196,
  deskMax: 320,
  leadDesk: 250,
  aisle: 64,
  corridor: 64,
  spine: 56,
  gutter: 12,
  walker: 1,
  floorCat: 64,
  seatPitch: 76,
  wall: 176,
  meetWall: 96,
  speed: 150,
  text: "n1",
};

const NARROW: Metrics = {
  ...FULL,
  pad: 12,
  cat: 56,
  lead: 68,
  bubble: 26,
  deskTop: 96,
  front: 48,
  deskMin: 124,
  deskMax: 300,
  leadDesk: 240,
  aisle: 58,
  corridor: 58,
  spine: 36,
  gutter: 8,
  walker: 0.86,
  floorCat: 54,
  seatPitch: 62,
  wall: 132,
  meetWall: 84,
  speed: 128,
};

const HERO: Metrics = {
  ...NARROW,
  cat: 58,
  lead: 70,
  bubble: 26,
  deskTop: 96,
  front: 44,
  deskMin: 140,
  deskMax: 260,
  leadDesk: 220,
  aisle: 56,
  corridor: 56,
  spine: 42,
  walker: 0.85,
  floorCat: 54,
  seatPitch: 62,
  wall: 116,
  meetWall: 78,
  speed: 120,
  text: "n2",
};

export const MIN_WIDTH = 280;
export const MAX_WIDTH = 1280;

export function metricsFor(width: number, variant: OfficeVariant): Metrics {
  if (variant === "hero") return HERO;
  return width < 640 ? NARROW : FULL;
}

export interface HLane {
  /** feet y moving right, feet y moving left */
  yR: number;
  yL: number;
  x0: number;
  x1: number;
}

export interface VLane {
  /** feet x moving down, feet x moving up */
  xD: number;
  xU: number;
  /** lanes it connects, by index */
  lanes: number[];
}

/** A place a cat can walk to: the point, its lane, and the path from the lane to it. */
export interface Spot {
  p: Pt;
  lane: number;
  /** x where the spot's path meets its lane */
  attach: number;
  /** waypoints from the lane (exclusive) to the spot (exclusive) */
  inner: Pt[];
}

export interface Desk {
  agentId: string;
  lead: boolean;
  role: AgentRole;
  /** the whole cell: bubble lane to the floor */
  rect: Rect;
  /** desk top line */
  top: number;
  cat: number;
  /** seated rig box, top-left */
  rig: Pt;
  monitor: Rect;
  bubble: Rect;
  card: Rect;
  /** where a mug or plant stands on the desk top (bottom centre), null when there is no room */
  item: Pt | null;
  /** chair back behind the cat */
  chair: Rect;
  /** where this cat stands when it gets up */
  home: Spot;
  /** where visitors sit in front of this desk, two slots */
  visits: Spot[];
}

export interface Seat {
  side: "far" | "near";
  /** feet point */
  p: Pt;
  spot: Spot;
}

export interface CeoRoom {
  /** "room": the walled CEO office; "corner": the hero's open CEO corner with a whiteboard easel */
  kind: "room" | "corner";
  rect: Rect;
  floorTop: number;
  whiteboard: Rect;
  desk: Desk | null;
  visitors: Spot[];
  board: Spot;
  door: number;
  /** a visitor sofa on the free floor of a stacked CEO office, clear of every walk */
  lounge: Rect | null;
}

export interface MeetingRoom {
  rect: Rect;
  floorTop: number;
  agenda: Rect;
  /** a window on the back wall, when the wall has room beside the agenda board */
  window: Rect | null;
  table: Rect;
  seats: Seat[];
  /** overflow standing spots when the crew outnumbers the seats */
  stands: Spot[];
  door: { x: number; inWall: boolean };
}

export interface Pantry {
  /** the union of the spare slots */
  rect: Rect;
  /** each spare slot: the counter stands in the first, a lounge in the rest */
  slots: Rect[];
  top: number;
  spots: Spot[];
}

export interface Zone {
  kind: "floor" | "room" | "pods";
  rect: Rect;
}

export interface OfficePlan {
  width: number;
  height: number;
  variant: OfficeVariant;
  m: Metrics;
  ceo: CeoRoom;
  /** null in the hero (JEV ui.region_gate hero_meeting 0.18): meetings huddle at the easel */
  meeting: MeetingRoom | null;
  /** null in the hero (JEV ui.region_gate hero_pantry relevance 1.14) */
  pantry: Pantry | null;
  /** where a meeting sits when there is no meeting room, in front of the easel */
  huddle: Spot[];
  /** spare hero cells: a plant and a shelf, so no row ends in an empty cell */
  nooks: Rect[];
  /** team pods: a floor tone step under two or more same-role desks side by side */
  zones: Rect[];
  desks: Desk[];
  lanes: HLane[];
  spines: VLane[];
  pods: Rect;
  corridor: Rect | null;
  /** crew beyond what the hero shows (the hero keeps at most three rows) */
  hidden: string[];
}

export interface PlanAgent {
  id: string;
  role: AgentRole;
  parentId: string | null;
}

const ROLE_ORDER: Record<AgentRole, number> = Object.fromEntries(AGENT_ROLES.map((r, i) => [r, i])) as Record<AgentRole, number>;

/** The lead sits in the CEO office: the lead role first, else the root of the tree, else the first agent. */
export function pickLead(agents: PlanAgent[]): PlanAgent | null {
  return agents.find((a) => a.role === "lead") ?? agents.find((a) => a.parentId === null) ?? agents[0] ?? null;
}

/** Crew desks grouped by role (the pods), then by arrival order inside a role. */
export function crewOrder(agents: PlanAgent[], leadId: string | null): PlanAgent[] {
  return agents
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.id !== leadId)
    .sort((x, y) => ROLE_ORDER[x.a.role] - ROLE_ORDER[y.a.role] || x.i - y.i)
    .map(({ a }) => a);
}

interface DeskOpts {
  agentId: string;
  role: AgentRole;
  lead: boolean;
  x: number;
  y: number;
  w: number;
  m: Metrics;
}

/** Everything inside one desk cell, from its top-left corner and width. */
function deskCell(o: DeskOpts): Omit<Desk, "home" | "visits"> {
  const { m, x, y, w } = o;
  const cat = o.lead ? m.lead : m.cat;
  const s = cat / 160;
  const top = y + m.deskTop + Math.round((cat - m.cat) * 0.9);
  const h = top - y + m.band + m.front;
  const rig = { x: x + w - 6 - cat, y: top + m.band / 2 - 150 * s };
  const catLeft = rig.x + 40 * s;
  const bubble = { x: x + 8, y: y + 4, w: w - 16, h: m.bubble };
  const monTop = bubble.y + bubble.h + 6;
  const monBottom = top - 12;
  const monW = Math.max(56, Math.min(o.lead ? 150 : 132, catLeft - 10 - (x + 10)));
  const monH = Math.max(36, Math.min(monBottom - monTop, Math.round(monW * 0.7)));
  const monitor = { x: x + 10, y: monBottom - monH, w: monW, h: monH };
  const card = { x: x + 8, y: top + m.band + 5, w: w - 16, h: m.front - 10 };
  const gap = catLeft - (monitor.x + monitor.w);
  const item = gap >= 22 ? { x: monitor.x + monitor.w + gap / 2 - 2, y: top } : null;
  const chairW = Math.round(cat * 0.62);
  const chair = { x: rig.x + cat / 2 - chairW / 2, y: rig.y + cat * 0.42, w: chairW, h: top - (rig.y + cat * 0.42) };
  return { agentId: o.agentId, role: o.role, lead: o.lead, rect: { x, y, w, h }, top, cat, rig, monitor, bubble, card, item, chair };
}

/** Desk rows: how many columns, and the pantry's span in the last row. */
function podGrid(crew: number, podsW: number, m: Metrics): { cols: number; dw: number; rows: number; spare: number } {
  const g = m.spine;
  const maxCols = Math.max(1, Math.floor((podsW + g) / (m.deskMin + g)));
  const slots = crew + 1;
  let best = { cols: 1, score: Infinity };
  for (let cols = 1; cols <= maxCols; cols++) {
    const dw = (podsW - (cols - 1) * g) / cols;
    if (dw > m.deskMax && cols < maxCols) continue;
    const rows = Math.ceil(slots / cols);
    const spare = rows * cols - crew;
    // fewer rows first, then a pantry of one or two slots, then more columns
    const score = rows * 10 + (spare > 2 ? spare - 2 : 0) * 3 - cols * 0.1;
    if (score < best.score) best = { cols, score };
  }
  const cols = best.cols;
  const dw = (podsW - (cols - 1) * g) / cols;
  const rows = Math.max(1, Math.ceil(slots / cols));
  return { cols, dw, rows, spare: rows * cols - crew };
}

/** The CEO office: whiteboard on the back wall, the lead's desk, visitor spots, the board spot. */
function ceoRoom(rect: Rect, lead: PlanAgent | null, m: Metrics, stacked: boolean, corridorLane: number): { room: CeoRoom; bottomNeed: number } {
  const inset = 16;
  // stacked: keep a clear strip left of the desk for the walk to the board
  const deskW = Math.min(m.leadDesk, rect.w - 2 * inset - (stacked ? 84 : 0));
  let whiteboard: Rect;
  let desk: Omit<Desk, "home" | "visits"> | null = null;
  const probe = deskCell({ agentId: "", role: "lead", lead: true, x: 0, y: 0, w: deskW, m });
  const deskH = probe.rect.h;
  let floorTop: number;
  if (stacked) {
    // narrow: the whiteboard spans the wall, the desk stands on the floor below it
    whiteboard = { x: rect.x + inset, y: rect.y + 12, w: rect.w - 2 * inset, h: m.wall - 24 };
    floorTop = rect.y + m.wall;
    if (lead) desk = deskCell({ agentId: lead.id, role: lead.role, lead: true, x: rect.x + rect.w - inset - deskW, y: floorTop + 4, w: deskW, m });
  } else {
    const wbW = rect.w - deskW - inset * 3;
    whiteboard = { x: rect.x + inset, y: rect.y + 14, w: wbW, h: m.wall - 28 };
    floorTop = rect.y + m.wall;
    if (lead) desk = deskCell({ agentId: lead.id, role: lead.role, lead: true, x: rect.x + rect.w - inset - deskW, y: floorTop + 40 - deskH, w: deskW, m });
  }
  const deskBottom = desk ? desk.rect.y + desk.rect.h : floorTop + 40;
  const visitY = deskBottom + Math.round(46 * m.walker);
  const door = stacked ? rect.x + Math.round(rect.w * 0.3) : whiteboard.x + whiteboard.w + inset;
  const bottomNeed = visitY + 14 - rect.y;
  const spot = (x: number, y: number, via: Pt[] = []): Spot => ({ p: { x, y }, lane: corridorLane, attach: door, inner: [{ x: door, y: visitY }, ...via] });
  const dx = desk ? desk.rect.x : rect.x + rect.w - inset - deskW;
  const visitors = [0.14, 0.42].map((f) => spot(dx + deskW * f, visitY));
  const boardX = stacked ? rect.x + inset + 30 : whiteboard.x + Math.min(whiteboard.w * 0.5, 90);
  const boardY = floorTop + Math.round(48 * m.walker);
  const board = spot(boardX, boardY, [{ x: boardX, y: visitY }]);
  const deskFull: Desk | null = desk
    ? {
        ...desk,
        home: spot(desk.rig.x + desk.cat / 2, visitY),
        visits: [visitors[0]!, visitors[1]!],
      }
    : null;
  // stacked: the floor between the walk strip and the desk takes a visitor sofa
  let lounge: Rect | null = null;
  if (stacked && desk) {
    const lx = rect.x + inset + 84 + 12;
    const lw = Math.min(200, desk.rect.x - 20 - lx);
    if (lw >= 140) lounge = { x: lx, y: floorTop + 24, w: lw, h: deskBottom - 6 - (floorTop + 24) };
  }
  return {
    room: { kind: "room", rect, floorTop, whiteboard, desk: deskFull, visitors, board, door, lounge },
    bottomNeed,
  };
}

interface MeetingOpts {
  rect: Rect;
  m: Metrics;
  attendees: number;
  /** lane the door opens onto */
  lane: number;
  /** true: the door is a doorway in the back wall (room below the pods) */
  inWall: boolean;
}

/** The meeting room: agenda board, table, far and near seats filled from the far end. */
function meetingRoom(o: MeetingOpts): { room: MeetingRoom; height: number } {
  const { rect, m } = o;
  const side = Math.round(64 * m.walker);
  const floorTop = rect.y + m.meetWall;
  const tableTop = floorTop + Math.round(56 * m.walker) + 4;
  const tableH = Math.round(40 * m.walker);
  const table = { x: rect.x + side, y: tableTop, w: rect.w - 2 * side, h: tableH };
  const perSide = Math.max(1, Math.min(6, Math.floor(table.w / m.seatPitch)));
  const pitch = table.w / perSide;
  const farY = tableTop - 4;
  const nearY = tableTop + tableH + Math.round(44 * m.walker);
  const doorX = rect.x + Math.round(side / 2);
  // the agenda board keeps clear of a doorway in the back wall
  const wallLeft = o.inWall ? doorX + 36 : rect.x + 24;
  const wallW = rect.x + rect.w - 24 - wallLeft;
  const agendaW = Math.min(300, wallW);
  const agenda = { x: wallLeft, y: rect.y + 12, w: agendaW, h: m.meetWall - 24 };
  const spare = rect.x + rect.w - 16 - (agenda.x + agenda.w);
  const winW = Math.min(96, spare - 16);
  const window = winW >= 56 ? { x: agenda.x + agenda.w + (spare - winW) / 2, y: rect.y + 16, w: winW, h: m.meetWall - 32 } : null;
  const spot = (p: Pt, via: Pt[]): Spot => {
    const entry: Pt[] = o.inWall ? [{ x: doorX, y: floorTop - 6 }] : [];
    return { p, lane: o.lane, attach: doorX, inner: [...entry, ...via] };
  };
  const seats: Seat[] = [];
  // far end first, far and near alternating, so later arrivals never pass a seated cat
  for (let i = perSide - 1; i >= 0; i--) {
    const x = table.x + pitch * (i + 0.5);
    seats.push({ side: "far", p: { x, y: farY }, spot: spot({ x, y: farY }, [{ x: doorX, y: farY }]) });
    seats.push({ side: "near", p: { x, y: nearY }, spot: spot({ x, y: nearY }, [{ x: doorX, y: nearY }]) });
  }
  const extra = Math.max(0, o.attendees - seats.length);
  const standY = nearY + Math.round(50 * m.walker);
  const standPitch = Math.round(46 * m.walker);
  const perRow = Math.max(1, Math.floor((rect.w - side - 16) / standPitch));
  const stands: Spot[] = [];
  for (let i = 0; i < extra; i++) {
    const row = Math.floor(i / perRow);
    const col = perRow - 1 - (i % perRow);
    const y = standY + row * Math.round(48 * m.walker);
    const x = rect.x + side + 8 + col * standPitch + standPitch / 2;
    stands.push(spot({ x, y }, [{ x: doorX, y }]));
  }
  const rows = extra ? Math.ceil(extra / perRow) : 0;
  const bottom = (rows ? standY + (rows - 1) * Math.round(48 * m.walker) : nearY) + 14;
  return {
    room: { rect: { ...rect, h: bottom - rect.y }, floorTop, agenda, window, table, seats, stands, door: { x: doorX, inWall: o.inWall } },
    height: bottom - rect.y,
  };
}

/**
 * The whole floor for a crew at a width. `width` is clamped to 320..1280; the
 * scene scales the plan to its container.
 */
export function planOffice(agents: PlanAgent[], rawWidth: number, variant: OfficeVariant = "full"): OfficePlan {
  const width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number.isFinite(rawWidth) ? rawWidth : MAX_WIDTH)));
  if (variant === "hero") return planHero(agents, width);
  const m = metricsFor(width, variant);
  const lead = pickLead(agents);
  const crew = crewOrder(agents, lead?.id ?? null);
  const inner = width - 2 * m.pad;
  const x0 = m.pad;
  const wide = width >= 1100;

  const lanes: HLane[] = [];
  const spines: VLane[] = [];

  // rooms band
  const bandY = m.pad;
  const ceoW = wide ? Math.round(inner * 0.62) : inner;
  const corridorLane = 0;
  // the whiteboard sits beside the lead's desk while it keeps room for titled cards
  const stackedCeo = ceoW - 48 - m.leadDesk < 380;
  const ceoProbe = ceoRoom({ x: x0, y: bandY, w: ceoW, h: 0 }, lead, m, stackedCeo, corridorLane);
  let bandH = ceoProbe.bottomNeed;
  let meetingTop: MeetingRoom | null = null;
  if (wide) {
    const mt = meetingRoom({ rect: { x: x0 + ceoW, y: bandY, w: inner - ceoW, h: 0 }, m, attendees: agents.length, lane: corridorLane, inWall: false });
    bandH = Math.max(bandH, mt.height);
    meetingTop = mt.room;
  }
  const ceoFinal = ceoRoom({ x: x0, y: bandY, w: ceoW, h: bandH }, lead, m, stackedCeo, corridorLane).room;
  ceoFinal.rect = { x: x0, y: bandY, w: ceoW, h: bandH };
  if (meetingTop) meetingTop.rect = { ...meetingTop.rect, h: bandH };

  // corridor
  const corridorY = bandY + bandH;
  const corridor = { x: x0, y: corridorY, w: inner, h: m.corridor };
  lanes.push({ yR: corridorY + m.corridor - Math.round(14 * m.walker), yL: corridorY + m.corridor - 4, x0, x1: x0 + inner });

  // pods: desk columns with a spine (walkway) in every gap between them, so
  // a cat walks straight between rows; one column keeps a spine at its right
  const podsTop = corridorY + m.corridor;
  let grid = podGrid(crew.length, inner, m);
  if (grid.cols === 1) grid = { cols: 1, dw: inner - m.spine, rows: crew.length + 1, spare: 1 };
  const gap = grid.cols === 1 ? 0 : m.spine;
  const cellH = deskCell({ agentId: "", role: "engineer", lead: false, x: 0, y: 0, w: grid.dw, m }).rect.h;
  const rowPitch = cellH + m.aisle;
  const colX = (c: number): number => x0 + c * (grid.dw + gap);

  const desks: Desk[] = [];
  crew.forEach((a, i) => {
    const r = Math.floor(i / grid.cols);
    const c = i % grid.cols;
    const cell = deskCell({ agentId: a.id, role: a.role, lead: false, x: colX(c), y: podsTop + r * rowPitch, w: grid.dw, m });
    const lane = 1 + r;
    const bottom = cell.rect.y + cell.rect.h;
    const visitY = bottom + Math.round(46 * m.walker);
    const at = (x: number): Spot => ({ p: { x, y: visitY }, lane, attach: x, inner: [] });
    desks.push({ ...cell, home: at(cell.rig.x + cell.cat / 2), visits: [at(cell.rect.x + cell.rect.w * 0.3), at(cell.rect.x + cell.rect.w * 0.58)] });
  });
  for (let r = 0; r < grid.rows; r++) {
    const y = podsTop + r * rowPitch + cellH;
    lanes.push({ yR: y + m.aisle - Math.round(12 * m.walker), yL: y + m.aisle - 3, x0, x1: x0 + inner });
  }

  // pantry: the spare slots at the end of the last row, one piece of furniture per slot
  const lastRow = grid.rows - 1;
  const firstSpare = Math.max(0, crew.length - lastRow * grid.cols);
  const rowY = podsTop + lastRow * rowPitch;
  const slots: Rect[] = [];
  for (let c = firstSpare; c < grid.cols; c++) slots.push({ x: colX(c), y: rowY, w: grid.dw, h: cellH });
  const first = slots[0]!;
  const last = slots[slots.length - 1]!;
  const pantryRect = { x: first.x, y: rowY, w: last.x + last.w - first.x, h: cellH };
  const pVisit = rowY + cellH + Math.round(46 * m.walker);
  const pLane = 1 + lastRow;
  const pantrySpots = [0.3, 0.62].map((f) => {
    const x = first.x + first.w * f;
    return { p: { x, y: pVisit }, lane: pLane, attach: x, inner: [] };
  });
  const pantry: Pantry = { rect: pantryRect, slots, top: rowY + m.deskTop, spots: pantrySpots };

  const podsBottom = podsTop + grid.rows * rowPitch;
  const podsRect = { x: x0, y: podsTop, w: inner, h: podsBottom - podsTop };

  // spines connect the corridor and every aisle
  const allLanes = lanes.map((_, i) => i);
  const spineAt = (left: number, w: number): VLane => ({ xD: left + w * 0.32, xU: left + w * 0.68, lanes: allLanes });
  if (grid.cols === 1) spines.push(spineAt(x0 + grid.dw, m.spine));
  for (let c = 0; c < grid.cols - 1; c++) spines.push(spineAt(colX(c) + grid.dw, gap));

  // meeting room: beside the CEO office when wide, else closing the floor
  let meeting: MeetingRoom;
  let height: number;
  if (meetingTop) {
    meeting = meetingTop;
    height = podsBottom + m.pad;
  } else {
    const mb = meetingRoom({ rect: { x: x0, y: podsBottom, w: inner, h: 0 }, m, attendees: agents.length, lane: lanes.length - 1, inWall: true });
    meeting = mb.room;
    height = podsBottom + mb.height + m.pad;
  }

  return {
    width,
    height: Math.round(height),
    variant,
    m,
    ceo: ceoFinal,
    meeting,
    pantry,
    huddle: [],
    nooks: [],
    zones: teamZones(desks, m),
    desks,
    lanes,
    spines,
    pods: podsRect,
    corridor,
    hidden: [],
  };
}

/** The most rows the hero shows; crew past them is left out of the hero (their beats finish at once). */
export const HERO_ROWS = 3;

/**
 * The hero: an open-plan floor. The CEO corner (the lead's desk and a
 * whiteboard easel) takes the first two cells of the first row, the crew
 * fills the rest; an aisle runs under every row and a spine up every gap
 * between columns. No meeting room and no pantry (JEV ui.region_gate): a
 * meeting huddles in front of the easel, which shows the agenda meanwhile.
 */
function planHero(agents: PlanAgent[], width: number): OfficePlan {
  const m = HERO;
  const lead = pickLead(agents);
  const allCrew = crewOrder(agents, lead?.id ?? null);
  const inner = width - 2 * m.pad;
  const x0 = m.pad;
  const maxCols = Math.max(1, Math.floor((inner + m.spine) / (m.deskMin + m.spine)));
  const cols = Math.max(1, Math.min(maxCols, Math.max(2, Math.ceil((allCrew.length + 2) / HERO_ROWS))));
  const gap = cols === 1 ? 0 : m.spine;
  const dw = cols === 1 ? inner - m.spine : (inner - (cols - 1) * gap) / cols;
  const span = Math.min(2, cols);
  const rows = Math.min(HERO_ROWS, Math.max(1, Math.ceil((allCrew.length + span) / cols)));
  const capacity = rows * cols - span;
  const crew = allCrew.slice(0, capacity);
  const hidden = allCrew.slice(capacity).map((a) => a.id);
  const cellH = deskCell({ agentId: "", role: "engineer", lead: false, x: 0, y: 0, w: dw, m }).rect.h;
  const rowPitch = cellH + m.aisle;
  const top = m.pad;
  const colX = (c: number): number => x0 + c * (dw + gap);
  const lanes: HLane[] = [];
  for (let r = 0; r < rows; r++) {
    const y = top + r * rowPitch + cellH;
    lanes.push({ yR: y + m.aisle - Math.round(12 * m.walker), yL: y + m.aisle - 3, x0, x1: x0 + inner });
  }
  const visitYFor = (r: number) => top + r * rowPitch + cellH + Math.round(46 * m.walker);
  const at = (x: number, r: number): Spot => ({ p: { x, y: visitYFor(r) }, lane: r, attach: x, inner: [] });

  // the CEO corner
  const cornerW = span * dw + (span - 1) * gap;
  const corner = { x: x0, y: top, w: cornerW, h: cellH };
  const leadW = Math.round(Math.min(m.leadDesk, cornerW * (span === 2 ? 0.5 : 0.58)));
  const leadCell = lead ? deskCell({ agentId: lead.id, role: lead.role, lead: true, x: corner.x + cornerW - leadW, y: top, w: leadW, m: { ...m, lead: m.cat } }) : null;
  const deskTopY = top + m.deskTop;
  const easelX = corner.x + 6;
  const easelW = cornerW - leadW - 18;
  const whiteboard = { x: easelX, y: top + 2, w: easelW, h: deskTopY - 4 - (top + 2) };
  const visitors = leadCell ? [0.14, 0.42].map((f) => at(leadCell.rect.x + leadW * f, 0)) : [at(corner.x + cornerW * 0.6, 0)];
  const board = at(easelX + easelW / 2, 0);
  const ceoDesk: Desk | null = leadCell ? { ...leadCell, home: at(leadCell.rig.x + leadCell.cat / 2, 0), visits: visitors } : null;
  const ceo: CeoRoom = { kind: "corner", rect: corner, floorTop: top, whiteboard, desk: ceoDesk, visitors, board, door: board.p.x, lounge: null };

  // huddle spots along the corner's aisle, far end first
  const pitch = Math.round(40 * m.walker);
  const huddle: Spot[] = [];
  for (let x = corner.x + cornerW - pitch / 2; x > corner.x + pitch / 2 && huddle.length < 10; x -= pitch) huddle.push(at(x, 0));

  const desks: Desk[] = [];
  crew.forEach((a, i) => {
    const slot = i + span;
    const r = Math.floor(slot / cols);
    const c = slot % cols;
    const cell = deskCell({ agentId: a.id, role: a.role, lead: false, x: colX(c), y: top + r * rowPitch, w: dw, m });
    desks.push({ ...cell, home: at(cell.rig.x + cell.cat / 2, r), visits: [at(cell.rect.x + cell.rect.w * 0.3, r), at(cell.rect.x + cell.rect.w * 0.58, r)] });
  });
  const nooks: Rect[] = [];
  for (let slot = crew.length + span; slot < rows * cols; slot++) {
    nooks.push({ x: colX(slot % cols), y: top + Math.floor(slot / cols) * rowPitch, w: dw, h: cellH });
  }
  const allLanes = lanes.map((_, i) => i);
  const spines: VLane[] = [];
  const spineAt = (left: number, w: number): VLane => ({ xD: left + w * 0.32, xU: left + w * 0.68, lanes: allLanes });
  if (cols === 1) spines.push(spineAt(x0 + dw, m.spine));
  for (let c = 0; c < cols - 1; c++) spines.push(spineAt(colX(c) + dw, gap));
  const podsBottom = top + rows * rowPitch;
  return {
    width,
    height: Math.round(podsBottom + m.pad),
    variant: "hero",
    m,
    ceo,
    meeting: null,
    pantry: null,
    huddle,
    nooks,
    zones: teamZones(desks, m),
    desks,
    lanes,
    spines,
    pods: { x: x0, y: top, w: inner, h: podsBottom - top },
    corridor: null,
    hidden,
  };
}

/** Same-role desks side by side in one row share a pod: one floor tone step under them. */
function teamZones(desks: Desk[], m: Metrics): Rect[] {
  const zones: Rect[] = [];
  let run: Desk[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const a = run[0]!.rect;
      const b = run[run.length - 1]!.rect;
      const top = a.y + m.bubble + 6;
      zones.push({ x: a.x - 6, y: top, w: b.x + b.w - a.x + 12, h: a.y + a.h + 10 - top });
    }
    run = [];
  };
  for (const d of desks) {
    const last = run[run.length - 1];
    if (last && (last.role !== d.role || last.rect.y !== d.rect.y)) flush();
    run.push(d);
  }
  flush();
  return zones;
}

/** All desks, the lead's first. */
export function allDesks(plan: OfficePlan): Desk[] {
  return plan.ceo.desk ? [plan.ceo.desk, ...plan.desks] : plan.desks;
}

export function deskOf(plan: OfficePlan, agentId: string): Desk | null {
  return allDesks(plan).find((d) => d.agentId === agentId) ?? null;
}

function laneY(lane: HLane, dir: number): number {
  return dir >= 0 ? lane.yR : lane.yL;
}

/**
 * The walk from one spot to another: out along the spot's own path, along
 * its lane (the sub-lane for the direction), up or down the nearest spine
 * that connects both lanes, along the other lane, and in. Consecutive
 * duplicates are dropped.
 */
export function route(plan: OfficePlan, from: Spot, to: Spot): Pt[] {
  const pts: Pt[] = [from.p, ...[...from.inner].reverse()];
  const la = plan.lanes[from.lane]!;
  const lb = plan.lanes[to.lane]!;
  if (from.lane === to.lane) {
    const y = laneY(la, to.attach - from.attach);
    pts.push({ x: from.attach, y }, { x: to.attach, y });
  } else {
    const spine = pickSpine(plan, from, to);
    const down = lb.yR > la.yR;
    const sx = spine ? (down ? spine.xD : spine.xU) : from.attach;
    const y1 = laneY(la, sx - from.attach);
    const y2 = laneY(lb, to.attach - sx);
    pts.push({ x: from.attach, y: y1 }, { x: sx, y: y1 }, { x: sx, y: y2 }, { x: to.attach, y: y2 });
  }
  pts.push(...to.inner, to.p);
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  }
  return out;
}

function pickSpine(plan: OfficePlan, from: Spot, to: Spot): VLane | null {
  let best: VLane | null = null;
  let cost = Infinity;
  for (const s of plan.spines) {
    if (!s.lanes.includes(from.lane) || !s.lanes.includes(to.lane)) continue;
    const c = Math.abs(from.attach - s.xD) + Math.abs(to.attach - s.xD);
    if (c < cost) {
      cost = c;
      best = s;
    }
  }
  return best;
}

export function pathLength(pts: Pt[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return d;
}

/** The facing for a segment: side view left or right, back view up, front view down. */
export type Facing = "right" | "left" | "up" | "down";

export function facingOf(a: Pt, b: Pt): Facing {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}
