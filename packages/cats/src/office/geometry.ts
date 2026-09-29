// Office floor plan: a pure function of the crew, the container width, the
// variant and the theme, so the scene, the director and the tests share one
// plan. Units are CSS pixels at the planned width (the world is planned at
// the container's own width up to 1280, then scaled), so text in the art is
// drawn at the real token sizes.
//
// The world is a three-quarter dollhouse cutaway: an orthographic view from
// the front and above. Every room has a back wall seen face on (its cap,
// its face, a skirting line), a floor seen from above, and cutaway low walls
// at its sides and front with a gap to walk through. Furniture is a block
// with a top face and a front face. The plan board comes first (JEV
// imm.concept c4): the CEO office leads the floor at every width and its
// back wall gives the board the room for titled columns. Top to bottom:
//   rooms band   the CEO office (entrance door, plan whiteboard, the lead's
//                desk on a carpet, a lounge), then from 960px the meeting
//                room, and from 1120px the pantry, side by side under one
//                back wall; the fund adds a ticker band along its top
//   corridor     the walkway in front of the rooms
//   pods         one grid of cells: a desk per crew cat (grouped by role on
//                the first plan, then kept as hires join), then the test
//                rack, then the pantry counter when it has no room of its
//                own, then nooks (the cat bed, a bookshelf, a printer,
//                lockers) so no row ends in an empty cell; a rug under each
//                row of desks, an aisle in front of every row, spines
//                (walkways) between the columns
//   meeting      below 960px the meeting room closes the floor, entered
//                through a doorway in its back wall
// Every walk runs on lanes (horizontal) and spines (vertical), each with two
// sub-lanes by direction, and a spot's own path in or out of its room, so a
// cat never cuts through furniture. Visitors stand in front of a desk,
// clear of both sub-lanes; walkers are depth sorted by their feet, so two
// cats pass in front of each other, never through.
import { AGENT_ROLES, type AgentRole } from "@mengai/shared";

export type OfficeVariant = "full" | "hero";
export type OfficeTheme = "studio" | "fund";

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
  /** exterior side wall, seen from above */
  pad: number;
  /** a wall's top cap, seen from above */
  cap: number;
  /** a back wall's face */
  wall: number;
  /** a cutaway low wall's face */
  low: number;
  /** the floor slab's front face at the bottom */
  slab: number;
  /** seated rig size at a crew desk (the most; narrow desks take less) */
  cat: number;
  /** seated rig size at the lead's desk */
  lead: number;
  bubble: number;
  monMax: number;
  stand: number;
  /** a desk's top face depth and front face height */
  topDepth: number;
  front: number;
  deskMin: number;
  /** the most desk columns, so desks stay wide enough for a big cat */
  maxCols: number;
  leadDesk: number;
  aisle: number;
  corridor: number;
  spine: number;
  /** walker scale, 1 draws the walker 72 x 54 */
  walker: number;
  /** seated rig size at the meeting table and on the floor */
  floorCat: number;
  seatPitch: number;
  door: number;
  /** walking speed, px per second */
  speed: number;
  /** the fund's ticker band along the top of the back wall (0 in the studio) */
  ticker: number;
  /** text size tier inside the art: "n1" 13px or "n2" 11px */
  text: "n1" | "n2";
}

const FULL: Metrics = {
  pad: 16,
  cap: 8,
  wall: 120,
  low: 14,
  slab: 12,
  cat: 136,
  lead: 148,
  bubble: 28,
  monMax: 150,
  stand: 10,
  topDepth: 22,
  front: 46,
  deskMin: 196,
  maxCols: 4,
  leadDesk: 290,
  aisle: 64,
  corridor: 70,
  spine: 48,
  walker: 1.25,
  floorCat: 96,
  seatPitch: 74,
  door: 56,
  speed: 150,
  ticker: 0,
  text: "n1",
};

const NARROW: Metrics = {
  pad: 12,
  cap: 6,
  wall: 112,
  low: 12,
  slab: 10,
  cat: 92,
  lead: 104,
  bubble: 26,
  monMax: 112,
  stand: 8,
  topDepth: 16,
  front: 44,
  deskMin: 130,
  maxCols: 2,
  leadDesk: 236,
  aisle: 54,
  corridor: 60,
  spine: 36,
  walker: 1.02,
  floorCat: 76,
  seatPitch: 60,
  door: 46,
  speed: 128,
  ticker: 0,
  text: "n1",
};

const HERO: Metrics = {
  ...NARROW,
  wall: 96,
  cat: 88,
  lead: 96,
  bubble: 24,
  monMax: 104,
  topDepth: 16,
  front: 40,
  deskMin: 140,
  maxCols: 3,
  leadDesk: 220,
  aisle: 64,
  corridor: 64,
  spine: 42,
  walker: 0.95,
  floorCat: 72,
  seatPitch: 62,
  door: 42,
  speed: 120,
  text: "n2",
};

export const MIN_WIDTH = 280;
export const MAX_WIDTH = 1280;
/** From here the pantry is a room of its own beside the meeting room. */
export const WIDE = 1120;
/** From here the meeting room sits in the rooms band beside the CEO office. */
export const MEDIUM = 960;

export function metricsFor(width: number, variant: OfficeVariant, theme: OfficeTheme = "studio"): Metrics {
  const base = variant === "hero" ? HERO : width < 640 ? NARROW : FULL;
  return theme === "fund" ? { ...base, ticker: variant === "hero" ? 24 : 26 } : base;
}

/** Where the desk top hides a seated cat, in rig units (the rig is 160 tall). */
export const CUT = 116;

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

/** A place a cat can walk to: the point, its lane, and the path between the lane and it. */
export interface Spot {
  p: Pt;
  lane: number;
  /** x where the path in meets its lane */
  attach: number;
  /** waypoints from the lane (exclusive) to the spot (exclusive) */
  inner: Pt[];
  /** the way out when it differs (a room's other sub-lane): waypoints from the spot outward, then exitAttach on the lane */
  exit?: Pt[];
  exitAttach?: number;
}

export interface Desk {
  agentId: string;
  lead: boolean;
  role: AgentRole;
  /** the whole cell: bubble lane to the floor */
  rect: Rect;
  /** desk top face, back edge */
  top: number;
  /** desk front face, top edge */
  face: number;
  cat: number;
  /** seated rig box, top-left */
  rig: Pt;
  monitor: Rect;
  keyboard: Rect;
  bubble: Rect;
  /** the name plate on the desk front */
  card: Rect;
  /** a drawer beside the name plate on wide desks */
  drawer: Rect | null;
  /** where a mug stands on the desk top (bottom centre) */
  mug: Pt;
  /** a plant and, on wide desks, a lamp or books at the back of the desk top (bottom centre) */
  plant: Pt | null;
  extra: Pt | null;
  /** chair back behind the cat */
  chair: Rect;
  /** where this cat stands when it gets up */
  home: Spot;
  /** where visitors stand in front of this desk, two slots */
  visits: Spot[];
}

export interface Seat {
  side: "far" | "near";
  /** feet point */
  p: Pt;
  spot: Spot;
}

export interface Room {
  kind: "ceo" | "meeting" | "pantry";
  rect: Rect;
  /** back wall base: the floor starts here */
  floorTop: number;
  /** the cutaway low front wall's base line, null when the room opens onto nothing below */
  front: number | null;
  /** the walk-through gap in the front wall */
  gap: { x: number; w: number } | null;
  /** a doorway in the back wall (the meeting room below the pods) */
  doorway: Rect | null;
}

export interface CeoRoom {
  /** "room": the walled CEO office; "corner": the hero's open CEO corner under the wall board */
  kind: "room" | "corner";
  rect: Rect;
  floorTop: number;
  whiteboard: Rect;
  desk: Desk | null;
  visitors: Spot[];
  board: Spot;
  /** the walkway's centre line from the door to the front gap */
  door: number;
  /** a sofa on the free floor between the walkway and the lead's desk */
  lounge: Rect | null;
  /** the free floor below the visitors' row when the rooms band runs tall: a credenza and a plant, clear of every walk */
  credenza: Rect | null;
}

export interface MeetingRoom {
  rect: Rect;
  floorTop: number;
  agenda: Rect;
  window: Rect | null;
  table: Rect;
  seats: Seat[];
  /** overflow standing spots when the crew outnumbers the seats */
  stands: Spot[];
  door: { x: number; inWall: boolean };
}

export interface Pantry {
  kind: "room" | "cell";
  /** the room or the cell */
  rect: Rect;
  /** the counter block: its top face back edge and its footprint */
  counter: Rect;
  top: number;
  /** a fridge beside the counter (room) */
  fridge: Rect | null;
  /** a small table with two stools (room) */
  table: Rect | null;
  window: Rect | null;
  spots: Spot[];
  /** kept for older callers: the pantry cell or room */
  slots: Rect[];
}

export type CellKind = "rack" | "pantry" | "shelf" | "bed" | "printer" | "lockers";

/** Nooks that fill a row's spare cells, in order: the cat bed first, never two alike side by side. */
export const NOOKS: CellKind[] = ["bed", "shelf", "printer", "lockers"];

export interface Cell {
  kind: CellKind;
  rect: Rect;
  /** the furniture line: desk top height in the row, so every cell stands on one line */
  top: number;
  face: number;
}

export interface OfficePlan {
  width: number;
  height: number;
  variant: OfficeVariant;
  m: Metrics;
  rooms: Room[];
  ceo: CeoRoom;
  /** null in the hero (JEV ui.region_gate hero_meeting 0.18): meetings huddle at the board */
  meeting: MeetingRoom | null;
  /** null in the hero (JEV ui.region_gate hero_pantry relevance 1.14) */
  pantry: Pantry | null;
  /** the entrance door on a back wall, and the spot a new hire steps out at */
  door: { rect: Rect; spot: Spot } | null;
  /** windows on back walls (their sky follows the local hour) */
  windows: Rect[];
  /** where a meeting sits when there is no meeting room, in front of the board */
  huddle: Spot[];
  /** the rack, the pantry counter and the nooks in the desk grid */
  cells: Cell[];
  /** a cat bed an idle cat may nap in, and the spot in front of it */
  nap: { bed: Rect; spot: Spot } | null;
  /** kept for older callers: the nook cells */
  nooks: Rect[];
  /** team pods: a rug under two or more same-role desks side by side */
  zones: Rect[];
  desks: Desk[];
  lanes: HLane[];
  spines: VLane[];
  pods: Rect;
  corridor: Rect | null;
  /** crew beyond what the hero shows (the hero keeps at most three rows) */
  hidden: string[];
  theme: OfficeTheme;
  /** the fund's ticker board along the top of the rooms' back wall, null in the studio */
  ticker: Rect | null;
}

export interface PlanOptions {
  theme?: OfficeTheme;
  /**
   * Keep the crew in the given order instead of grouping it by role: the
   * scene passes the order desks were first handed out in, so a hire takes
   * the next free desk and nobody else moves.
   */
  keepOrder?: boolean;
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
export function crewOrder(agents: PlanAgent[], leadId: string | null, keep = false): PlanAgent[] {
  if (keep) return agents.filter((a) => a.id !== leadId);
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

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Everything inside one desk cell, from its top-left corner and width. Left
 * to right on the desk top: the monitor, the cat behind the keyboard, then
 * a mug and a plant; the name plate (and a drawer) on the front face.
 */
function deskCell(o: DeskOpts): Omit<Desk, "home" | "visits"> {
  const { m, x, y, w } = o;
  const cat = Math.min(o.lead ? m.lead : m.cat, Math.round(w * (o.lead ? 0.5 : 0.62)));
  const s = cat / 160;
  const inset = w < 200 ? 5 : 10;
  const monX = x + inset;
  // the cat's body starts 40 rig units in, its tail ends near 140, its box at 160
  const visL = 40 * s;
  const tailEnd = 140 * s;
  const itemsW = w >= 236 ? 30 : 0;
  const byItems = x + w - inset - itemsW - (6 - visL + tailEnd) - monX;
  const byBox = x + w - 1 - monX - 6 - (cat - visL);
  const monW = Math.max(40, Math.min(m.monMax, byItems, byBox));
  const monH = Math.round(monW * 0.62);
  const rigX = monX + monW + 6 - visL;
  const top = y + Math.max(m.bubble + 4 + monH + m.stand, m.bubble + 2 + (CUT - 18) * s);
  const face = top + m.topDepth;
  const h = face + m.front - y;
  const rig = { x: r1(rigX), y: r1(top - CUT * s) };
  const monitor = { x: monX, y: r1(top - m.stand - monH), w: r1(monW), h: monH };
  const bubble = { x: x + 6, y: y + 2, w: w - 12, h: m.bubble - 2 };
  const drawerW = w >= 240 ? 56 : 0;
  const card = { x: x + 8, y: face + 5, w: w - 16 - (drawerW ? drawerW + 6 : 0), h: m.front - 10 };
  const drawer = drawerW ? { x: x + w - 8 - drawerW, y: face + 5, w: drawerW, h: m.front - 10 } : null;
  const keyboard = { x: r1(rigX + 46 * s), y: r1(top + m.topDepth * 0.28), w: r1(68 * s), h: Math.max(4, Math.round(m.topDepth * 0.32)) };
  const tailX = rigX + tailEnd;
  const room = x + w - inset - tailX;
  const mug = room >= 18 ? { x: r1(tailX + Math.min(12, room / 2)), y: face - 3 } : { x: monX + 9, y: face - 3 };
  const plant = room >= 30 ? { x: r1(x + w - inset - 9), y: top + 4 } : null;
  // a wide desk keeps a lamp or a stack of books between the mug and the plant
  const extra = w >= 330 && plant && plant.x - mug.x > 60 ? { x: r1((mug.x + plant.x) / 2), y: top + 5 } : null;
  const chairW = Math.round(cat * 0.66);
  const chair = { x: r1(rigX + 80 * s - chairW / 2), y: r1(rig.y + 62 * s), w: chairW, h: r1(top - (rig.y + 62 * s)) };
  return { agentId: o.agentId, role: o.role, lead: o.lead, rect: { x, y, w, h }, top, face, cat, rig, monitor, keyboard, bubble, card, drawer, mug, plant, extra, chair };
}

/** Columns that fit a width at a desk size, at least one. */
function columnsFor(inner: number, m: Metrics): number {
  return Math.max(1, Math.min(m.maxCols, Math.floor((inner + m.spine) / (m.deskMin + m.spine))));
}

function subLanes(center: number): { inX: number; outX: number } {
  return { inX: center - 9, outX: center + 9 };
}

/** A spot inside a room reached through the gap at gx: up the in sub-lane, across, and out by the other. */
function roomSpot(p: Pt, lane: number, gx: number, entry: Pt[] = []): Spot {
  const { inX, outX } = subLanes(gx);
  const enterVia = entry.map((q) => ({ x: inX, y: q.y }));
  const exitVia = [...entry].reverse().map((q) => ({ x: outX, y: q.y }));
  return {
    p,
    lane,
    attach: inX,
    inner: [...enterVia, { x: inX, y: p.y }],
    exit: [{ x: outX, y: p.y }, ...exitVia],
    exitAttach: outX,
  };
}

interface CeoOut {
  room: CeoRoom;
  shape: Room;
  door: { rect: Rect; spot: Spot };
  windows: Rect[];
  need: number;
}

/**
 * The CEO office: the entrance door and the plan whiteboard on the back wall
 * (and a window when there is room), the walkway from the door to the front
 * gap, the lead's desk at the right, visitors in front of it, the board spot
 * under the board's left end, a lounge on the free floor between them.
 */
function ceoRoom(rect: Rect, lead: PlanAgent | null, m: Metrics, lane: number, frontAt: number | null): CeoOut {
  const inset = 14;
  const wallTop = rect.y + m.cap + m.ticker;
  const floorTop = wallTop + m.wall;
  const doorH = m.wall - 14;
  const door = { x: rect.x + inset, y: floorTop - doorH, w: m.door, h: doorH };
  const wx = door.x + door.w / 2;
  const boardX = door.x + door.w + 16;
  // the plan board comes first (JEV imm.concept c4): a window only when the board keeps room for titled columns
  const winW = rect.w >= 640 ? 88 : 0;
  const boardRight = rect.x + rect.w - inset - (winW ? winW + 14 : 0);
  const whiteboard = { x: boardX, y: wallTop + 10, w: Math.min(560, boardRight - boardX), h: m.wall - 22 };
  const window = winW ? { x: rect.x + rect.w - inset - winW, y: wallTop + 14, w: winW, h: m.wall - 38 } : null;
  const boardSpotX = boardX + 30;
  const boardY = floorTop + Math.round(40 * m.walker);
  // the lead's desk at the right, clear of the board spot
  const deskLeft = Math.max(boardSpotX + 44, rect.x + rect.w - inset - m.leadDesk);
  const deskW = rect.x + rect.w - inset - deskLeft;
  const cellTop = floorTop - m.bubble + 4;
  const desk = lead ? deskCell({ agentId: lead.id, role: lead.role, lead: true, x: deskLeft, y: cellTop, w: deskW, m }) : null;
  const deskBottom = desk ? desk.rect.y + desk.rect.h : floorTop + 120;
  const visitY = deskBottom + Math.round(30 * m.walker);
  const minFront = visitY + 30;
  const front = frontAt ?? minFront;
  const catX = desk ? desk.rig.x + desk.cat / 2 : deskLeft + deskW / 2;
  const visitors = [catX - 22, catX + 22].map((x) => roomSpot({ x: r1(x), y: visitY }, lane, wx));
  const board = roomSpot({ x: boardSpotX, y: boardY }, lane, wx);
  const deskFull: Desk | null = desk ? { ...desk, home: roomSpot({ x: r1(catX), y: visitY }, lane, wx), visits: visitors } : null;
  // the lounge: between the walkway and the desk, between the board row and the visitors' row
  let lounge: Rect | null = null;
  const lx = wx + 32;
  const lw = Math.min(180, deskLeft - 14 - lx);
  const ly = boardY + 22;
  const lh = Math.min(64, visitY - 64 * m.walker * 0.9 - 12 - ly);
  if (lw >= 48 && lh >= 40) lounge = { x: r1(lx), y: r1(ly), w: r1(lw), h: r1(lh) };
  // a tall band (a big crew's meeting room sets it) leaves floor below the visitors' row: nobody walks there
  const credTop = visitY + 18;
  const credBottom = front - m.low - m.cap - 8;
  const credX = wx + 34;
  const credW = rect.x + rect.w - 14 - credX;
  const credenza = credBottom - credTop >= 54 && credW >= 120 ? { x: r1(credX), y: r1(credTop), w: r1(credW), h: r1(credBottom - credTop) } : null;
  const { outX } = subLanes(wx);
  const doorSpot: Spot = {
    p: { x: wx, y: floorTop + 6 },
    lane,
    attach: subLanes(wx).inX,
    inner: [{ x: subLanes(wx).inX, y: floorTop + 6 }],
    exit: [{ x: outX, y: floorTop + 6 }],
    exitAttach: outX,
  };
  const shapeRect = { ...rect, h: front - rect.y };
  return {
    room: { kind: "room", rect: shapeRect, floorTop, whiteboard, desk: deskFull, visitors, board, door: wx, lounge, credenza },
    shape: { kind: "ceo", rect: shapeRect, floorTop, front, gap: { x: wx, w: 64 }, doorway: null },
    door: { rect: door, spot: doorSpot },
    windows: window ? [window] : [],
    need: minFront - rect.y,
  };
}

interface MeetingOpts {
  rect: Rect;
  m: Metrics;
  attendees: number;
  /** lane the room opens onto */
  lane: number;
  /** true: entered through a doorway in its back wall (room below the pods) */
  inWall: boolean;
  frontAt: number | null;
}

/** The meeting room: agenda board and window, the table, far and near seats filled from the far end. */
function meetingRoom(o: MeetingOpts): { room: MeetingRoom; shape: Room; windows: Rect[]; need: number } {
  const { rect, m } = o;
  const wall = o.inWall ? m.wall - 12 : m.wall;
  const wallTop = rect.y + m.cap + (o.inWall ? 0 : m.ticker);
  const floorTop = wallTop + wall;
  const sF = m.floorCat / 160;
  const gx = rect.x + Math.round(40 * m.walker);
  const tableX = gx + 30;
  const table = { x: tableX, y: r1(floorTop + 14 + (CUT - 18) * sF), w: rect.x + rect.w - 24 - tableX, h: Math.round(62 * m.walker) };
  const perSide = Math.max(1, Math.min(6, Math.floor(table.w / m.seatPitch)));
  const pitch = table.w / perSide;
  const farY = table.y - 4;
  const nearY = r1(table.y + table.h + 34 * m.walker);
  const doorway = o.inWall ? { x: gx - 26, y: floorTop - (wall - 12), w: 52, h: wall - 12 } : null;
  const wallLeft = o.inWall ? gx + 38 : rect.x + 16;
  const winW = rect.x + rect.w - 16 - wallLeft >= 360 ? 86 : 0;
  const agendaW = Math.min(320, rect.x + rect.w - 16 - wallLeft - (winW ? winW + 14 : 0));
  const agenda = { x: wallLeft, y: wallTop + 10, w: agendaW, h: wall - 22 };
  const window = winW ? { x: agenda.x + agenda.w + 14, y: wallTop + 14, w: winW, h: wall - 38 } : null;
  const entry: Pt[] = o.inWall ? [{ x: gx, y: floorTop + 6 }] : [];
  const spot = (p: Pt): Spot => roomSpot(p, o.lane, gx, entry);
  const seats: Seat[] = [];
  // far end first, far and near alternating, so later arrivals never pass a seated cat
  for (let i = perSide - 1; i >= 0; i--) {
    const x = r1(table.x + pitch * (i + 0.5));
    seats.push({ side: "far", p: { x, y: farY }, spot: spot({ x, y: farY }) });
    seats.push({ side: "near", p: { x, y: nearY }, spot: spot({ x, y: nearY }) });
  }
  const extra = Math.max(0, o.attendees - seats.length);
  const standY = r1(nearY + 52 * m.walker);
  const standPitch = Math.round(46 * m.walker);
  const perRow = Math.max(1, Math.floor((rect.x + rect.w - 24 - (gx + 30)) / standPitch));
  const stands: Spot[] = [];
  for (let i = 0; i < extra; i++) {
    const row = Math.floor(i / perRow);
    const col = perRow - 1 - (i % perRow);
    const y = r1(standY + row * 52 * m.walker);
    const x = r1(gx + 30 + col * standPitch + standPitch / 2);
    stands.push(spot({ x, y }));
  }
  const rows = extra ? Math.ceil(extra / perRow) : 0;
  const lastY = rows ? standY + (rows - 1) * 52 * m.walker : nearY;
  const minFront = Math.round(lastY + 30);
  const front = o.frontAt ?? minFront;
  const shapeRect = { ...rect, h: front - rect.y };
  return {
    room: { rect: shapeRect, floorTop, agenda, window, table, seats, stands, door: { x: gx, inWall: o.inWall } },
    shape: { kind: "meeting", rect: shapeRect, floorTop, front: o.inWall ? null : front, gap: o.inWall ? null : { x: gx, w: 64 }, doorway },
    windows: window ? [window] : [],
    need: minFront - rect.y,
  };
}

/** The pantry as a room: window and shelf on the wall, the counter with the coffee machine against it, a fridge, a small table. */
function pantryRoom(rect: Rect, m: Metrics, lane: number, frontAt: number | null): { pantry: Pantry; shape: Room; windows: Rect[]; need: number } {
  const wallTop = rect.y + m.cap + m.ticker;
  const floorTop = wallTop + m.wall;
  // the gap sits a walker's half width plus a sub-lane clear of the side wall
  const gx = rect.x + Math.round(40 * m.walker);
  const fridgeW = 52;
  const counter = { x: rect.x + 50, y: floorTop - 40, w: Math.min(170, rect.w - 50 - fridgeW - 30), h: 66 };
  const fridge = { x: rect.x + rect.w - 16 - fridgeW, y: floorTop - 96, w: fridgeW, h: 120 };
  // the window over the counter, clear of the coffee machine at its left end
  const winW = Math.min(96, counter.w - 64);
  const window = { x: r1(counter.x + counter.w - winW - 6), y: wallTop + 12, w: winW, h: 44 };
  const spotY = r1(floorTop + 26 + 30 * m.walker);
  const spots = [0.3, 0.72].map((f) => roomSpot({ x: r1(counter.x + counter.w * f), y: spotY }, lane, gx));
  const minFront = Math.round(spotY + 30 + 70);
  const front = frontAt ?? minFront;
  const table = { x: rect.x + rect.w - 118, y: Math.max(spotY + 26, front - 86), w: 76, h: 54 };
  const shapeRect = { ...rect, h: front - rect.y };
  return {
    pantry: { kind: "room", rect: shapeRect, counter, top: counter.y, fridge, table, window, spots, slots: [shapeRect] },
    shape: { kind: "pantry", rect: shapeRect, floorTop, front, gap: { x: gx, w: 64 }, doorway: null },
    windows: [window],
    need: minFront - rect.y,
  };
}

interface GridOut {
  desks: Desk[];
  cells: Cell[];
  lanes: HLane[];
  spines: VLane[];
  bottom: number;
  pantry: Pantry | null;
  nap: OfficePlan["nap"];
}

/**
 * The desk grid: crew desks, then the rack, then the pantry counter (when it
 * has no room), then nooks to fill the last row. `skip` leaves the first
 * cells of the first row to the caller (the hero's CEO corner).
 */
function podGrid(o: {
  crew: PlanAgent[];
  x0: number;
  inner: number;
  top: number;
  m: Metrics;
  laneBase: number;
  pantryCell: boolean;
  rack: boolean;
  skip: number;
  maxRows?: number;
}): GridOut & { cols: number; dw: number; cellH: number; rowPitch: number; colX: (c: number) => number; shown: number } {
  const { m, x0, inner, top } = o;
  const cols = columnsFor(inner, m);
  const gap = cols === 1 ? 0 : m.spine;
  const dw = cols === 1 ? inner - m.spine : (inner - (cols - 1) * gap) / cols;
  const probe = deskCell({ agentId: "", role: "engineer", lead: false, x: 0, y: 0, w: dw, m });
  const cellH = probe.rect.h;
  const rowPitch = cellH + m.aisle;
  const colX = (c: number): number => r1(x0 + c * (dw + gap));
  const kinds: Array<{ agent?: PlanAgent; kind?: CellKind }> = [];
  for (let i = 0; i < o.skip; i++) kinds.push({});
  for (const a of o.crew) kinds.push({ agent: a });
  if (o.rack) kinds.push({ kind: "rack" });
  if (o.pantryCell) kinds.push({ kind: "pantry" });
  let rows = Math.max(1, Math.ceil(kinds.length / cols));
  if (o.maxRows !== undefined && rows > o.maxRows) {
    rows = o.maxRows;
    kinds.length = rows * cols;
  }
  // nooks fill the last row: a cat bed first, then bookshelves
  let nook = 0;
  while (kinds.length < rows * cols) kinds.push({ kind: NOOKS[nook++ % NOOKS.length]! });
  const desks: Desk[] = [];
  const cells: Cell[] = [];
  let pantry: Pantry | null = null;
  let nap: OfficePlan["nap"] = null;
  let shown = 0;
  kinds.forEach((k, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = colX(c);
    const y = r1(top + r * rowPitch);
    const lane = o.laneBase + r;
    const cellTop = y + probe.top;
    const cellFace = y + probe.face;
    const bottom = y + cellH;
    const visitY = r1(bottom + 30 * m.walker);
    const at = (px: number): Spot => ({ p: { x: r1(px), y: visitY }, lane, attach: r1(px), inner: [] });
    if (k.agent) {
      const cell = deskCell({ agentId: k.agent.id, role: k.agent.role, lead: false, x, y, w: dw, m });
      const catX = cell.rig.x + cell.cat / 2;
      desks.push({ ...cell, home: at(catX), visits: [at(x + dw * 0.26), at(x + dw * 0.26 + Math.max(44 * m.walker, dw * 0.22))] });
      shown++;
      return;
    }
    if (!k.kind) return;
    const rect = { x, y, w: dw, h: cellH };
    cells.push({ kind: k.kind, rect, top: cellTop, face: cellFace });
    if (k.kind === "pantry") {
      const counter = { x: x + 4, y: cellTop, w: dw - 8, h: bottom - cellTop };
      // coffee drinkers stand at the counter's right half, clear of its label
      const spots = [0.66, 0.88].map((f) => at(x + dw * f));
      pantry = { kind: "cell", rect, counter, top: cellTop, fridge: null, table: null, window: null, spots, slots: [rect] };
    }
    if (k.kind === "bed" && !nap) {
      const bedW = Math.min(96, dw * 0.56);
      const bed = { x: r1(x + (dw - bedW) / 2), y: r1(bottom - 36), w: r1(bedW), h: 30 };
      nap = { bed, spot: at(x + dw / 2) };
    }
  });
  const lanes: HLane[] = [];
  for (let r = 0; r < rows; r++) {
    const y = top + r * rowPitch + cellH;
    lanes.push({ yR: r1(y + m.aisle - 14 * m.walker), yL: r1(y + m.aisle - 3), x0, x1: x0 + inner });
  }
  const spines: VLane[] = [];
  const spineAt = (left: number, w: number): VLane => ({ xD: r1(left + w * 0.32), xU: r1(left + w * 0.68), lanes: [] });
  if (cols === 1) spines.push(spineAt(x0 + dw, m.spine));
  for (let c = 0; c < cols - 1; c++) spines.push(spineAt(colX(c) + dw, gap));
  return { desks, cells, lanes, spines, bottom: top + rows * rowPitch, pantry, nap, cols, dw, cellH, rowPitch, colX, shown };
}

/**
 * The whole floor for a crew at a width. `width` is clamped to 280..1280;
 * the scene scales the plan to its container.
 */
export function planOffice(agents: PlanAgent[], rawWidth: number, variant: OfficeVariant = "full", opts: PlanOptions = {}): OfficePlan {
  const width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number.isFinite(rawWidth) ? rawWidth : MAX_WIDTH)));
  const theme = opts.theme ?? "studio";
  if (variant === "hero") return planHero(agents, width, theme, opts.keepOrder ?? false);
  const m = metricsFor(width, variant, theme);
  const lead = pickLead(agents);
  const crew = crewOrder(agents, lead?.id ?? null, opts.keepOrder ?? false);
  const inner = width - 2 * m.pad;
  const x0 = m.pad;
  const medium = width >= MEDIUM;
  const wide = width >= WIDE;

  // rooms band: the CEO office, then the meeting room and the pantry when they fit beside it
  const ceoW = medium ? Math.max(520, Math.round(inner * (wide ? 0.42 : 0.54))) : inner;
  const pantryW = wide ? Math.max(256, Math.round(inner * 0.23)) : 0;
  const meetW = medium ? inner - ceoW - pantryW : 0;
  const band = (frontAt: number | null) => {
    const ceo = ceoRoom({ x: x0, y: 0, w: ceoW, h: 0 }, lead, m, 0, frontAt);
    const meet = medium ? meetingRoom({ rect: { x: x0 + ceoW, y: 0, w: meetW, h: 0 }, m, attendees: agents.length, lane: 0, inWall: false, frontAt }) : null;
    const pan = wide ? pantryRoom({ x: x0 + ceoW + meetW, y: 0, w: pantryW, h: 0 }, m, 0, frontAt) : null;
    return { ceo, meet, pan };
  };
  const probe = band(null);
  const front = Math.max(probe.ceo.need, probe.meet?.need ?? 0, probe.pan?.need ?? 0);
  const { ceo, meet, pan } = band(front);

  // corridor
  const corridorY = front;
  const corridor = { x: x0, y: corridorY, w: inner, h: m.corridor };
  const lanes: HLane[] = [{ yR: r1(corridorY + m.corridor - 14 * m.walker), yL: r1(corridorY + m.corridor - 3), x0, x1: x0 + inner }];

  // pods
  const podsTop = corridorY + m.corridor;
  const grid = podGrid({ crew, x0, inner, top: podsTop, m, laneBase: 1, pantryCell: !wide, rack: true, skip: 0 });
  lanes.push(...grid.lanes);
  const allLanes = lanes.map((_, i) => i);
  const spines = grid.spines.map((s) => ({ ...s, lanes: allLanes }));
  const rooms: Room[] = [ceo.shape];
  const windows = [...ceo.windows];
  let meeting: MeetingRoom;
  let height: number;
  if (meet) {
    meeting = meet.room;
    rooms.push(meet.shape);
    windows.push(...meet.windows);
    height = grid.bottom + m.slab;
  } else {
    const mb = meetingRoom({ rect: { x: x0, y: grid.bottom, w: inner, h: 0 }, m, attendees: agents.length, lane: lanes.length - 1, inWall: true, frontAt: null });
    meeting = mb.room;
    rooms.push(mb.shape);
    windows.push(...mb.windows);
    height = mb.room.rect.y + mb.room.rect.h + m.slab;
  }
  if (pan) {
    rooms.push(pan.shape);
    windows.push(...pan.windows);
  }
  return {
    width,
    height: Math.round(height),
    variant,
    m,
    rooms,
    ceo: ceo.room,
    meeting,
    pantry: pan ? pan.pantry : grid.pantry,
    door: ceo.door,
    windows,
    huddle: [],
    cells: grid.cells,
    nap: grid.nap,
    nooks: grid.cells.filter((c) => NOOKS.includes(c.kind)).map((c) => c.rect),
    zones: teamZones(grid.desks, m),
    desks: grid.desks,
    lanes,
    spines,
    pods: { x: x0, y: podsTop, w: inner, h: grid.bottom - podsTop },
    corridor,
    hidden: [],
    theme,
    ticker: m.ticker ? { x: x0, y: m.cap + 3, w: inner, h: m.ticker - 6 } : null,
  };
}

/** The most rows the hero shows; crew past them is left out of the hero (their beats finish at once). */
export const HERO_ROWS = 3;

/**
 * The hero: an open-plan floor under one back wall. The plan board hangs on
 * the wall over the CEO corner (the first cell, a rug to stand on), the lead
 * sits in the second, the crew fills the rest; the entrance door opens over
 * the first spine, a window beside it. No meeting room and no pantry (JEV
 * ui.region_gate): a meeting huddles in front of the board.
 */
function planHero(agents: PlanAgent[], width: number, theme: OfficeTheme, keep: boolean): OfficePlan {
  const m = metricsFor(width, "hero", theme);
  const lead = pickLead(agents);
  const allCrew = crewOrder(agents, lead?.id ?? null, keep);
  const inner = width - 2 * m.pad;
  const x0 = m.pad;
  const wallTop = m.cap + m.ticker;
  const floorTop = wallTop + m.wall;
  const top = floorTop - m.bubble + 4;
  const cols = columnsFor(inner, m);
  const span = cols >= 2 ? 2 : 1;
  // rows: the corner, the lead and the crew, at most HERO_ROWS
  const grid = podGrid({
    crew: allCrew,
    x0,
    inner,
    top,
    m,
    laneBase: 0,
    pantryCell: false,
    rack: cols >= 3,
    skip: span - 1 + 1,
    maxRows: HERO_ROWS,
  });
  const shownIds = new Set(grid.desks.map((d) => d.agentId));
  const hidden = allCrew.filter((a) => !shownIds.has(a.id)).map((a) => a.id);
  const { dw, cellH, colX } = grid;
  const at = (x: number, r: number): Spot => ({ p: { x: r1(x), y: r1(top + r * grid.rowPitch + cellH + 30 * m.walker) }, lane: r, attach: r1(x), inner: [] });
  // the lead's desk fills the corner (JEV ui.region_gate hero_lounge 0.84: no lounge, and no cell stays empty)
  const cornerW = span * dw + (span - 1) * (cols === 1 ? 0 : m.spine);
  const cornerX = colX(0);
  const leadCell = lead ? deskCell({ agentId: lead.id, role: lead.role, lead: true, x: cornerX, y: top, w: cornerW, m }) : null;
  const catX = leadCell ? leadCell.rig.x + leadCell.cat / 2 : cornerX + cornerW / 2;
  const visitors = [at(catX - 20, 0), at(catX + 20, 0)];
  const ceoDesk: Desk | null = leadCell ? { ...leadCell, home: at(catX, 0), visits: visitors } : null;
  // the board hangs on the wall over the corner
  const whiteboard = { x: x0 + 8, y: wallTop + 8, w: r1(Math.min(cornerW - 16, span === 2 ? cornerW - 16 : cornerW * 0.9)), h: m.wall - 18 };
  const board = at(cornerX + Math.min(cornerW * 0.25, 60), 0);
  const corner = { x: x0, y: top, w: cornerW, h: cellH };
  const ceo: CeoRoom = { kind: "corner", rect: corner, floorTop, whiteboard, desk: ceoDesk, visitors, board, door: board.p.x, lounge: null, credenza: null };
  // huddle spots along the corner's aisle, far end first
  const pitch = Math.round(40 * m.walker);
  const huddle: Spot[] = [];
  for (let x = corner.x + cornerW - pitch / 2; x > corner.x + pitch / 2 && huddle.length < 10; x -= pitch) huddle.push(at(x, 0));
  const lanes = grid.lanes;
  const allLanes = lanes.map((_, i) => i);
  const spines = grid.spines.map((s) => ({ ...s, lanes: allLanes }));
  // no entrance door in the hero (JEV ui.region_gate hero_door 0.46): a window beside the board
  const door: OfficePlan["door"] = null;
  const windows: Rect[] = [];
  const wx = whiteboard.x + whiteboard.w + 16;
  const ww = Math.min(140, x0 + inner - 12 - wx);
  if (ww >= 54) windows.push({ x: r1(wx), y: wallTop + 12, w: r1(ww), h: m.wall - 34 });
  const rooms: Room[] = [];
  return {
    width,
    height: Math.round(grid.bottom + m.slab),
    variant: "hero",
    m,
    rooms,
    ceo,
    meeting: null,
    pantry: null,
    door,
    windows,
    huddle,
    cells: grid.cells,
    nap: grid.nap,
    nooks: grid.cells.map((c) => c.rect),
    zones: teamZones(grid.desks, m),
    desks: grid.desks,
    lanes,
    spines,
    pods: { x: x0, y: top, w: inner, h: grid.bottom - top },
    corridor: null,
    hidden,
    theme,
    ticker: m.ticker ? { x: x0, y: m.cap + 3, w: inner, h: m.ticker - 6 } : null,
  };
}

/** Desks side by side in one row share a pod: a rug under them, so each team row stands on its own floor. */
function teamZones(desks: Desk[], m: Metrics): Rect[] {
  const zones: Rect[] = [];
  let run: Desk[] = [];
  const flush = () => {
    if (run.length >= 1) {
      const a = run[0]!.rect;
      const b = run[run.length - 1]!.rect;
      const top = a.y + m.bubble + 4;
      zones.push({ x: a.x - 8, y: top, w: b.x + b.w - a.x + 16, h: a.y + a.h + Math.round(26 * m.walker) - top });
    }
    run = [];
  };
  for (const d of desks) {
    const last = run[run.length - 1];
    // a run breaks at a new row, or where a cell (the rack, a nook) sits between two desks
    if (last && (last.rect.y !== d.rect.y || Math.abs(last.rect.x + last.rect.w - d.rect.x) > m.spine + 1)) flush();
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
 * The walk from one spot to another: out along the spot's own way out,
 * along its lane (the sub-lane for the direction), up or down the nearest
 * spine that connects both lanes, along the other lane, and in. Consecutive
 * duplicates are dropped.
 */
export function route(plan: OfficePlan, from: Spot, to: Spot): Pt[] {
  const out0 = from.exit ?? [...from.inner].reverse();
  const fromAttach = from.exitAttach ?? from.attach;
  const pts: Pt[] = [from.p, ...out0];
  const la = plan.lanes[from.lane]!;
  const lb = plan.lanes[to.lane]!;
  if (from.lane === to.lane) {
    const y = laneY(la, to.attach - fromAttach);
    pts.push({ x: fromAttach, y }, { x: to.attach, y });
  } else {
    const spine = pickSpine(plan, fromAttach, from.lane, to);
    const down = lb.yR > la.yR;
    const sx = spine ? (down ? spine.xD : spine.xU) : fromAttach;
    const y1 = laneY(la, sx - fromAttach);
    const y2 = laneY(lb, to.attach - sx);
    pts.push({ x: fromAttach, y: y1 }, { x: sx, y: y1 }, { x: sx, y: y2 }, { x: to.attach, y: y2 });
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

function pickSpine(plan: OfficePlan, fromX: number, fromLane: number, to: Spot): VLane | null {
  let best: VLane | null = null;
  let cost = Infinity;
  for (const s of plan.spines) {
    if (!s.lanes.includes(fromLane) || !s.lanes.includes(to.lane)) continue;
    const c = Math.abs(fromX - s.xD) + Math.abs(to.attach - s.xD);
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
