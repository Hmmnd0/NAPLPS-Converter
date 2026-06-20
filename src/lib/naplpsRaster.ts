// Faithful raster renderer for standard NAPLPS — ports the period tool's
// rendering *model* (not just its decoder).
//
// The original viewers (TURSHOW etc.) scan-filled polygons into a low-resolution
// VGA framebuffer and *set the boundary pixels* of every shape. Two consequences
// fall out of that for free, and they are exactly what our SVG path lacked:
//   1. Low resolution merges the hand-drawn source's near-but-not-coincident
//      region edges onto the same pixels, so adjacent fills never leave a gap.
//   2. Drawing each polygon's own outline (its boundary pixels) in the fill
//      colour closes any residual single-pixel seam between neighbours.
// Rendering into a small pixel buffer and scaling it up reproduces the period
// look (including the chunky CRT feel) without the seams the vector output shows.
import { decodeNaplpsStandard, NapPoint, NapShape, NapColor } from './naplps-std-decoder';

export interface RasterOptions {
  /** internal framebuffer height in pixels (width follows the content aspect). */
  height?: number;
  /** background colour (period art is on black); null leaves it transparent. */
  background?: NapColor | null;
}

export interface RasterResult {
  width: number;
  height: number;
  /** RGBA pixel buffer, row-major, length width*height*4. */
  pixels: Uint8ClampedArray;
  shapeCount: number;
  commandCounts: Record<string, number>;
}

// Map the content bounding box into the framebuffer, preserving aspect ratio and
// flipping Y (NAPLPS axes point up). Returns a point→pixel projection.
function makeProjection(shapes: NapShape[], W: number, H: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) for (const p of s.points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const pad = 0.5; // half a pixel of breathing room at the edges
  return (p: NapPoint) => ({
    x: pad + ((p.x - minX) / spanX) * (W - 1 - 2 * pad),
    y: pad + (1 - (p.y - minY) / spanY) * (H - 1 - 2 * pad),
  });
}

export function rasterizeNaplps(bytes: Uint8Array | number[], opts: RasterOptions = {}): RasterResult {
  const { shapes, commandCounts } = decodeNaplpsStandard(bytes);
  const bg = opts.background === undefined ? { r: 0, g: 0, b: 0 } : opts.background;

  // Choose framebuffer dimensions from the content aspect ratio. The height is
  // the resolution lever: lower merges more seams but loses detail. ~256 matches
  // the period VGA feel while keeping the eagle's eye legible.
  const H = Math.max(32, Math.round(opts.height ?? 256));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) for (const p of s.points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const aspect = isFinite(minX) ? ((maxX - minX) || 1) / ((maxY - minY) || 1) : 4 / 3;
  const W = Math.max(32, Math.round(H * aspect));

  const pixels = new Uint8ClampedArray(W * H * 4);
  // Tracks which pixels were drawn by a shape (any colour, including black
  // fills) vs. left as background. Needed so the seam-seal pass below can tell a
  // real gap from the art's own black, which equals the black background colour.
  const painted = new Uint8Array(W * H);
  const project = makeProjection(shapes, W, H);

  const put = (x: number, y: number, c: NapColor) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    pixels[i] = c.r; pixels[i + 1] = c.g; pixels[i + 2] = c.b; pixels[i + 3] = 255;
    painted[y * W + x] = 1;
  };

  if (bg) for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = bg.r; pixels[i + 1] = bg.g; pixels[i + 2] = bg.b; pixels[i + 3] = 255;
  }

  // Integer Bresenham line — used for polylines, polygon outlines (boundary
  // pixels), and arc segments. Hard pixels, no anti-aliasing, like the original.
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

  // Even-odd scanline polygon fill at pixel centres.
  const fillPolygon = (poly: { x: number; y: number }[], c: NapColor) => {
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

  // Painter's order: later shapes draw over earlier ones, as in the byte stream.
  for (const s of shapes) {
    const proj = s.points.map(project);
    if (s.type === 'polygon') {
      if (s.filled) fillPolygon(proj, s.color);
      // Always set the boundary pixels (the period renderers did) — this both
      // outlines unfilled polygons and seals seams between adjacent fills.
      for (let i = 0; i < proj.length; i++) {
        const a = proj[i], b = proj[(i + 1) % proj.length];
        line(a.x, a.y, b.x, b.y, s.color);
      }
    } else if (s.type === 'polyline') {
      for (let i = 0; i + 1 < proj.length; i++) line(proj[i].x, proj[i].y, proj[i + 1].x, proj[i + 1].y, s.color);
    } else if (s.type === 'point') {
      const p = proj[0];
      put(Math.round(p.x), Math.round(p.y), s.color);
    }
  }

  // Seam-seal: a background pixel whose four orthogonal neighbours are all
  // painted is a single-pixel gap between adjacent regions (typically a steep
  // diagonal seam the boundary line couldn't fully cover). Fill it from a
  // neighbour so no black shows through, the way the low-res period framebuffer
  // never exposed such seams. Operates on the paint mask, so the art's own black
  // fills are never disturbed. Two passes catch seams up to two pixels wide.
  for (let pass = 0; pass < 2; pass++) {
    const mask = painted.slice();
    let sealed = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const idx = y * W + x;
        if (mask[idx]) continue;
        if (mask[idx - 1] && mask[idx + 1] && mask[idx - W] && mask[idx + W]) {
          const src = (y * W + (x - 1)) * 4; // copy the left neighbour's colour
          const dst = idx * 4;
          pixels[dst] = pixels[src]; pixels[dst + 1] = pixels[src + 1];
          pixels[dst + 2] = pixels[src + 2]; pixels[dst + 3] = 255;
          painted[idx] = 1;
          sealed++;
        }
      }
    }
    if (sealed === 0) break;
  }

  return { width: W, height: H, pixels, shapeCount: shapes.length, commandCounts };
}
