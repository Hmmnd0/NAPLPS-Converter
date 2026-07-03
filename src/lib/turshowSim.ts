// TURSHOW-faithful raster preview: renders shapes the way the period viewer
// draws them, so editors/preview panes show what the real 1993 stack shows.
//
// Model (validated shot-by-shot against TURSHOW.EXE in DOSBox-X, 2026-07):
//  - 640×480 VGA; field X∈[0,1] → 0..639, Y∈[0,0.75] → 479..0.
//  - Painter's order = shape array order (byte-stream order).
//  - Filled polygons: even-odd scanline fill at pixel centres + Bresenham
//    boundary. No seam healing — gaps are real and should be visible.
//  - Lines draw 1px (the encoder emits the pel-0 pen).
// See docs/turshow-renderer-limits.md for the underlying findings.
import type { NapShape, NapColor, NapPoint } from './naplps-std-decoder';
import { traceMaskToPolygons } from './regionTrace';

export interface SimFrame {
  width: number;
  height: number;
  /** RGBA, row-major */
  pixels: Uint8ClampedArray;
}

export const SIM_W = 640;
export const SIM_H = 480;

export function renderTurshowSim(shapes: NapShape[]): SimFrame {
  const W = SIM_W, H = SIM_H;
  const pixels = new Uint8ClampedArray(W * H * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255; // opaque black

  const put = (x: number, y: number, c: NapColor) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    pixels[i] = c.r; pixels[i + 1] = c.g; pixels[i + 2] = c.b;
  };
  const line = (ax: number, ay: number, bx: number, by: number, c: NapColor) => {
    let x0 = Math.round(ax), y0 = Math.round(ay);
    const x1 = Math.round(bx), y1 = Math.round(by);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      put(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const project = (p: { x: number; y: number }) => ({
    x: p.x * (W - 1),
    y: (1 - p.y / 0.75) * (H - 1),
  });
  const fillPolygon = (poly: Array<{ x: number; y: number }>, c: NapColor) => {
    if (poly.length < 3) return;
    let yMin = Infinity, yMax = -Infinity;
    for (const p of poly) { if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y; }
    const y0 = Math.max(0, Math.floor(yMin)), y1 = Math.min(H - 1, Math.ceil(yMax));
    const xs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j], b = poly[i];
        if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
          xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xStart = Math.round(xs[k]), xEnd = Math.round(xs[k + 1]);
        for (let x = xStart; x <= xEnd; x++) put(x, y, c);
      }
    }
  };

  for (const s of shapes) {
    const proj = s.points.map(project);
    if (s.type === 'polygon') {
      if (s.filled) fillPolygon(proj, s.color);
      for (let i = 0; i < proj.length; i++) {
        const a = proj[i], b = proj[(i + 1) % proj.length];
        line(a.x, a.y, b.x, b.y, s.color);
      }
    } else if (s.type === 'polyline') {
      for (let i = 0; i + 1 < proj.length; i++) {
        line(proj[i].x, proj[i].y, proj[i + 1].x, proj[i + 1].y, s.color);
      }
    } else if (s.type === 'point') {
      const p = proj[0];
      put(Math.round(p.x), Math.round(p.y), s.color);
    }
  }

  return { width: W, height: H, pixels };
}

// ── Hardware linter ───────────────────────────────────────────────────────────
// TURSHOW limits (docs/turshow-renderer-limits.md): filled polygons mis-fill
// beyond ~16 scanline crossings and are only proven to 63 wire vertices.
export const LINT_MAX_CROSSINGS = 12;
export const LINT_MAX_VERTS = 60;

export interface ShapeLint {
  index: number;
  verts: number;
  maxCrossings: number;
  overVerts: boolean;
  overCrossings: boolean;
}

// Repair an over-limit filled polygon: rasterize onto the VGA grid (even-odd
// fill + boundary) and re-trace into hardware-safe pieces via regionTrace's
// splitting tracer. Returns field-coordinate rings; empty → keep the original.
export function splitPolygonForHardware(pts: NapPoint[]): NapPoint[][] {
  if (pts.length < 3) return [];
  const W = SIM_W, H = SIM_H;
  const px = pts.map(p => ({ x: p.x * W, y: (1 - p.y / 0.75) * H }));
  const mask = new Uint8Array(W * H);
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = 1;
  };
  let yMin = Infinity, yMax = -Infinity;
  for (const p of px) { if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y; }
  const xs: number[] = [];
  for (let y = Math.max(0, Math.floor(yMin)); y <= Math.min(H - 1, Math.ceil(yMax)); y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = px.length - 1; i < px.length; j = i++) {
      const a = px[j], b = px[i];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
        xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.round(xs[k]); x <= Math.round(xs[k + 1]); x++) set(x, y);
    }
  }
  for (let i = 0, j = px.length - 1; i < px.length; j = i++) {
    const a = px[j], b = px[i];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))));
    for (let t = 0; t <= steps; t++) {
      set(Math.round(a.x + ((b.x - a.x) * t) / steps), Math.round(a.y + ((b.y - a.y) * t) / steps));
    }
  }
  const pieces = traceMaskToPolygons(mask, W, H);
  return pieces.map(piece => piece.map(q => ({ x: q.x / W, y: (1 - q.y / H) * 0.75 })));
}

export function lintShapes(shapes: NapShape[]): ShapeLint[] {
  const out: ShapeLint[] = [];
  shapes.forEach((s, index) => {
    if (s.type !== 'polygon' || !s.filled) return;
    const pts = s.points.map(p => ({ x: p.x * (SIM_W - 1), y: (1 - p.y / 0.75) * (SIM_H - 1) }));
    let yMin = Infinity, yMax = -Infinity;
    for (const p of pts) { if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y; }
    let maxCrossings = 0;
    for (let y = Math.floor(yMin); y <= Math.ceil(yMax); y++) {
      const yc = y + 0.5;
      let c = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[j], b = pts[i];
        if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) c++;
      }
      if (c > maxCrossings) maxCrossings = c;
    }
    const overVerts = s.points.length > LINT_MAX_VERTS;
    const overCrossings = maxCrossings > LINT_MAX_CROSSINGS;
    if (overVerts || overCrossings) {
      out.push({ index, verts: s.points.length, maxCrossings, overVerts, overCrossings });
    }
  });
  return out;
}
