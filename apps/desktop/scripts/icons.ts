// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Renders the MengAI app mark (flat cat head, white tile, no gradients) to
// PNG with a tiny zero-dependency rasterizer, then lets the Tauri CLI derive
// the macOS icon set. Run: bun run scripts/icons.ts
// The committed files under src-tauri/icons are the output; rerun only when
// the mark changes.
import { deflateSync } from "node:zlib";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tauri, tauriDir } from "./lib";

type Rgba = [number, number, number, number];
type Shape = (x: number, y: number) => boolean;

const INK: Rgba = [17, 17, 17, 255];
const TILE: Rgba = [255, 255, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

const ellipse = (cx: number, cy: number, rx: number, ry: number): Shape => (x, y) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

function triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): Shape {
  const sign = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  return (x, y) => {
    const d1 = sign(x, y, ax, ay, bx, by);
    const d2 = sign(x, y, bx, by, cx, cy);
    const d3 = sign(x, y, cx, cy, ax, ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
}

function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): Shape {
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
    const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
    return dx * dx + dy * dy <= r * r;
  };
}

// Cat head in unit space (0..1), centered on the tile.
const head = ellipse(0.5, 0.57, 0.27, 0.21);
const leftEar = triangle(0.255, 0.5, 0.3, 0.23, 0.46, 0.4);
const rightEar = triangle(0.745, 0.5, 0.7, 0.23, 0.54, 0.4);
const leftEye = ellipse(0.405, 0.56, 0.035, 0.052);
const rightEye = ellipse(0.595, 0.56, 0.035, 0.052);
const cat: Shape = (x, y) => (head(x, y) || leftEar(x, y) || rightEar(x, y)) && !leftEye(x, y) && !rightEye(x, y);
const tile = roundedRect(0.1, 0.1, 0.9, 0.9, 0.18);

function render(size: number, paint: (x: number, y: number) => Rgba, box = { x0: 0, y0: 0, x1: 1, y1: 1 }): Uint8Array {
  const ss = 4;
  const out = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = box.x0 + ((px + (sx + 0.5) / ss) / size) * (box.x1 - box.x0);
          const v = box.y0 + ((py + (sy + 0.5) / ss) / size) * (box.y1 - box.y0);
          const c = paint(u, v);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const i = (py * size + px) * 4;
      out[i] = a ? Math.round(r / a) : 0;
      out[i + 1] = a ? Math.round(g / a) : 0;
      out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round(a / (ss * ss));
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(size: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

if (import.meta.main) {
  const icons = join(tauriDir, "icons");
  const source = join(icons, "source.png");
  await Bun.write(source, encodePng(1024, render(1024, (x, y) => (cat(x, y) ? INK : tile(x, y) ? TILE : CLEAR))));
  // Tray: template image (black plus alpha), cropped to the head so it reads at 22 pt.
  await Bun.write(
    join(icons, "tray.png"),
    encodePng(44, render(44, (x, y) => (cat(x, y) ? [0, 0, 0, 255] : CLEAR), { x0: 0.2, y0: 0.18, x1: 0.8, y1: 0.8 })),
  );
  await tauri(["icon", source, "--output", icons]);
  // Keep only what the macOS bundle and the Rust codegen read.
  for (const extra of ["android", "ios", "icon.ico", "StoreLogo.png", "64x64.png"]) await rm(join(icons, extra), { recursive: true, force: true });
  const glob = new Bun.Glob("Square*Logo.png");
  for await (const f of glob.scan(icons)) await rm(join(icons, f), { force: true });
  await rm(source, { force: true });
  console.log(`icons written to ${icons}`);
}
