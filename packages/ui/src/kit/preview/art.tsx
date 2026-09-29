// Preview-only views for the kit preview: live-looking data views of the
// sample product (a desk air monitor) built from kit roles, and an authored
// SVG wordmark. No drawn product: a product shot is a real photo or an
// honest placeholder (blocks.md), so these are the product's data, not its
// likeness.
import { useLayoutEffect, useRef, useState } from "react";
import { Figure } from "../Page";

// A workday of CO2 readings, every 30 minutes from 08:00 to 18:00.
const DAY = [520, 560, 610, 680, 740, 790, 820, 860, 900, 880, 760, 800, 930, 1080, 1240, 980, 820, 760, 700, 650, 612];
const MAX = 1500;

/** A live-looking readout of one day, built from kit roles and a flat SVG plot. */
export function DayReadout({ compact = false }: { compact?: boolean }) {
  const n = DAY.length - 1;
  const pts = DAY.map((v, i) => `${((i / n) * 100).toFixed(2)},${(100 - (v / MAX) * 100).toFixed(2)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L100,100 L0,100 Z`;
  const limit = 100 - (1000 / MAX) * 100;
  return (
    <div className="pv-readout" role="group" aria-label="CO2 today: from 520 to a peak of 1240 ppm at 15:00, then down to 612 ppm by 18:00" data-compact={compact ? "" : undefined}>
      <div className="pv-readout-head">
        <p className="kit-meta">CO2 today, desk by the window</p>
        <p className="pv-readout-now">
          <Figure value="612" unit="ppm" />
        </p>
      </div>
      <div className="pv-axis" aria-hidden="true">
        <span className="kit-meta kit-num">1500</span>
        <span className="kit-meta kit-num">1000</span>
        <span className="kit-meta kit-num">500</span>
      </div>
      <div className="pv-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <line x1="0" x2="100" y1="33.33" y2="33.33" className="pv-grid" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2="100" y1="66.67" y2="66.67" className="pv-grid" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2="100" y1={limit} y2={limit} className="pv-limit" vectorEffect="non-scaling-stroke" />
          <path d={area} className="pv-area" />
          <path d={line} className="pv-line" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="pv-ticks" aria-hidden="true">
        {["08", "10", "12", "14"].map((t) => (
          <span key={t} className="kit-meta kit-num">
            {t}:00
          </span>
        ))}
        <span className="pv-ticks-last">
          <span className="kit-meta kit-num">16:00</span>
          <span className="kit-meta kit-num">18:00</span>
        </span>
      </div>
      {compact ? null : (
        <p className="kit-meta pv-readout-note">Peak 1240 ppm at 15:00. Window opened 15:05, back under 800 by 15:40.</p>
      )}
    </div>
  );
}

const WEEK = [
  { d: "Mon", h: 2.5 },
  { d: "Tue", h: 1.8 },
  { d: "Wed", h: 3.1 },
  { d: "Thu", h: 1.2 },
  { d: "Fri", h: 0.6 },
  { d: "Sat", h: 0.2 },
  { d: "Sun", h: 0.4 },
];

/** Hours above 1000 ppm per day this week. */
export function WeekStrip() {
  return (
    <div className="pv-week" role="img" aria-label="Hours above 1000 ppm this week: highest Wednesday at 3.1 hours, lowest Saturday at 0.2">
      <div className="pv-week-bars" aria-hidden="true">
        {WEEK.map((w, i) => (
          <div key={w.d} className="pv-week-col">
            <span className="kit-meta kit-num">{w.h.toFixed(1)}</span>
            <span className="pv-bar" data-today={i === 4 ? "" : undefined} style={{ blockSize: `${(w.h / 3.2) * 100}%` }} />
            <span className="kit-meta">{w.d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** An authored wordmark: set once, then the viewBox is fitted to the drawn
    glyphs so it scales to its region without stretching a letter. */
export function Wordmark({ label }: { label: string }) {
  const ref = useRef<SVGTextElement | null>(null);
  const [box, setBox] = useState("0 0 640 250");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.getBBox !== "function") return;
    const b = el.getBBox();
    if (b.width > 0) setBox(`${Math.floor(b.x) - 2} ${Math.floor(b.y) - 2} ${Math.ceil(b.width) + 4} ${Math.ceil(b.height) + 4}`);
  }, []);
  return (
    <svg className="kit-wordmark" viewBox={box} role="img" aria-label={label}>
      <text ref={ref} x="0" y="220" fill="currentColor" fontSize="300" fontWeight="600" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="-14">
        hawa
      </text>
    </svg>
  );
}

const ROOMS = [
  { room: "Meeting room 2", ppm: 1240, state: "Open a window" },
  { room: "Phone booth", ppm: 1020, state: "Step out soon" },
  { room: "Kitchen", ppm: 880, state: "Getting stuffy" },
  { room: "Studio", ppm: 640, state: "Fine for focus" },
];

/** A live-looking room list for the office view, built from kit roles. */
export function RoomList() {
  return (
    <div className="pv-rooms" role="group" aria-label="Four rooms right now: meeting room 2 at 1240 ppm, phone booth 1020, kitchen 880, studio 640">
      <p className="kit-meta pv-rooms-head">Rooms right now</p>
      <ul className="pv-rooms-list">
        {ROOMS.map((r) => (
          <li key={r.room} className="pv-room" data-alert={r.ppm >= 1000 ? "" : undefined}>
            <span className="pv-room-name">{r.room}</span>
            <span className="pv-room-value">
              <Figure value={String(r.ppm)} unit="ppm" />
            </span>
            <span className="kit-meta pv-room-state">{r.state}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SENSORS = [
  { label: "CO2", value: "612", unit: "ppm", state: "Fine for focus" },
  { label: "Fine dust", value: "4", unit: "µg/m³", state: "Clean" },
  { label: "Temperature", value: "24.1", unit: "°C", state: "Comfortable" },
  { label: "Humidity", value: "48", unit: "% RH", state: "In range" },
];

/** The four live readings, as the device reports them. */
export function SensorGrid() {
  return (
    <div className="pv-sensors" role="group" aria-label="Now: CO2 612 ppm, fine dust 4, 24.1 degrees, 48 percent humidity">
      <p className="kit-meta pv-sensors-head">Desk by the window, now</p>
      <dl className="pv-sensor-grid">
        {SENSORS.map((x) => (
          <div key={x.label} className="pv-sensor">
            <dt className="kit-meta">{x.label}</dt>
            <dd className="pv-sensor-value">
              <Figure value={x.value} unit={x.unit} />
            </dd>
            <dd className="kit-meta">{x.state}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const EVENTS = [
  { t: "14:00", what: "Eight people, door closed", v: "820 ppm" },
  { t: "15:00", what: "Advice on the display: open a window", v: "1240 ppm", alert: true },
  { t: "15:05", what: "Window opened", v: "1180 ppm" },
  { t: "15:40", what: "Back under 800, the display goes quiet", v: "790 ppm" },
];

/** One afternoon of one room, as the hub logs it. */
export function EventLog() {
  return (
    <div className="pv-log" role="group" aria-label="Meeting room 2, one afternoon: 820 ppm at 14:00, advice at 1240 ppm at 15:00, window opened 15:05, under 800 by 15:40">
      <p className="kit-meta pv-log-head">Meeting room 2, Tuesday</p>
      <ol className="pv-log-list">
        {EVENTS.map((e) => (
          <li key={e.t} className="pv-log-row" data-alert={e.alert ? "" : undefined}>
            <span className="kit-num pv-log-time">{e.t}</span>
            <span className="pv-log-what">{e.what}</span>
            <span className="kit-num kit-meta pv-log-value">{e.v}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The air outside against the air at the desk, on one scale. */
export function ContrastView() {
  const rows = [
    { label: "Outside, the city report", v: 420 },
    { label: "At the desk, door closed", v: 1240, here: true },
    { label: "At the desk, window open", v: 780 },
  ];
  return (
    <div className="pv-contrast" role="img" aria-label="CO2 outside 420 ppm, at the desk with the door closed 1240 ppm, above the 1000 ppm focus line, and 780 ppm with the window open">
      <p className="kit-meta">CO2 at 15:00, same street</p>
      <div className="pv-contrast-rows" aria-hidden="true">
        {rows.map((r) => (
          <div key={r.label} className="pv-contrast-row" data-here={r.here ? "" : undefined}>
            <div className="pv-contrast-label">
              <span className="pv-contrast-name">{r.label}</span>
              <span className="pv-contrast-value">
                <Figure value={String(r.v)} unit="ppm" />
              </span>
            </div>
            <svg className="pv-contrast-track" viewBox="0 0 100 10" preserveAspectRatio="none" focusable="false">
              <rect x="0" y="0" width={(r.v / 1500) * 100} height="10" className="pv-contrast-bar" />
              <rect x={(r.v / 1500) * 100} y="0" width={100 - (r.v / 1500) * 100} height="10" className="pv-contrast-ground" />
              <line x1={(1000 / 1500) * 100} x2={(1000 / 1500) * 100} y1="-2" y2="12" className="pv-limit" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        ))}
      </div>
      <p className="kit-meta">The dashed line is 1000 ppm, where focus starts to drop.</p>
    </div>
  );
}
