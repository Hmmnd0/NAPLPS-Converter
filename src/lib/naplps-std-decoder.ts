// Standard NAPLPS decoder — reads REAL period .nap files into shapes.
//
// Unlike naplps-decoder.ts (which reads our own TelidonP5-dialect output), this
// implements the actual NAPLPS / T.101 wire format reverse-engineered from period
// tools (RHINO/PDISET.C, decompiled TURSHOW/MGEEXE) and validated against real
// .nap sample files. See docs/naplps-format-findings.md.
//
// Key format facts:
//  - Operand bytes are 0x40-0x7F (6 data bits); opcodes are 0x20-0x3F. Self-delimiting.
//  - DOMAIN (0x21) sets dim/mvl/svl: a coordinate is (mvl+1) bytes, interleaved X/Y.
//  - Coordinates (getnum, 2D): per byte, bits 5-3 = X, bits 2-0 = Y, MSB-first.
//    ONE = 8192 fixed-point; values > ONE are negative (v -= 2*ONE).
//  - Multi-point operators: first vertex absolute (or relative for the REL ops),
//    every subsequent vertex relative to the previous one.
//  - Colour: SET-COLOR (0x3C) defines the current 16-slot palette entry from a
//    GRB-interleaved value; SELECT-COLOR (0x3E) picks a slot.

const ONE = 8192;

export interface NapColor { r: number; g: number; b: number }
export interface NapPoint { x: number; y: number } // normalized 0..1, NAPLPS axes (Y up)
export interface NapShape {
  type: 'polygon' | 'polyline' | 'point';
  points: NapPoint[];
  color: NapColor;
  filled: boolean;
}
export interface NapDecodeResult {
  shapes: NapShape[];
  palette: NapColor[];
  /** opcode usage histogram, name → count */
  commandCounts: Record<string, number>;
  /** bytes that decoded into geometry vs total */
  byteCount: number;
}

const NAMES: Record<number, string> = {
  0x20: 'RESET', 0x21: 'DOMAIN', 0x22: 'TEXT', 0x23: 'TEXTURE',
  0x24: 'PT-SET-ABS', 0x25: 'PT-SET-REL', 0x26: 'POINT-ABS', 0x27: 'POINT-REL',
  0x28: 'LINE-ABS', 0x29: 'LINE-REL', 0x2a: 'SET&LINE-ABS', 0x2b: 'SET&LINE-REL',
  0x2c: 'ARC', 0x2d: 'ARC-FILLED', 0x2e: 'SET&ARC', 0x2f: 'SET&ARC-FILLED',
  0x30: 'RECT', 0x31: 'RECT-FILLED', 0x32: 'SET&RECT', 0x33: 'SET&RECT-FILLED',
  0x34: 'POLY', 0x35: 'POLY-FILLED', 0x36: 'SET&POLY', 0x37: 'SET&POLY-FILLED',
  0x38: 'FIELD', 0x39: 'INCR-POINT', 0x3a: 'INCR-LINE', 0x3b: 'INCR-POLY-FILLED',
  0x3c: 'SET-COLOR', 0x3d: 'WAIT', 0x3e: 'SELECT-COLOR', 0x3f: 'BLINK',
};

// First vertex is relative to the current point for these; everyone else absolute.
const REL_FIRST = new Set([0x25, 0x27, 0x29, 0x2b]);
const FILLED = new Set([0x2d, 0x2f, 0x31, 0x33, 0x35, 0x37]);
const POLY_OPS = new Set([0x34, 0x35, 0x36, 0x37]);
const RECT_OPS = new Set([0x30, 0x31, 0x32, 0x33]);
const LINE_OPS = new Set([0x28, 0x29, 0x2a, 0x2b]);
const ARC_OPS = new Set([0x2c, 0x2d, 0x2e, 0x2f]);
const POINT_OPS = new Set([0x26, 0x27]);
const PTSET_OPS = new Set([0x24, 0x25]);
const COORD_OPS = new Set([
  ...PTSET_OPS, ...POINT_OPS, ...LINE_OPS, ...ARC_OPS, ...RECT_OPS, ...POLY_OPS,
]);

// Default colour map. Real files usually define the slots they use via SET-COLOR
// (e.g. SANTA), but some (e.g. EAGLE1) rely on defaults. Low 8 = saturated
// videotex colours, high 8 = a grayscale ramp so undefined light slots stay
// neutral rather than turning an unexpected hue.
const DEFAULT_PALETTE: NapColor[] = [
  { r: 0, g: 0, b: 0 }, { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 255, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 }, { r: 255, g: 0, b: 255 }, { r: 0, g: 255, b: 255 }, { r: 255, g: 255, b: 255 },
  ...Array.from({ length: 8 }, (_, i) => { const v = Math.round((i / 7) * 255); return { r: v, g: v, b: v }; }),
];

const data6 = (b: number) => b & 0x3f;

// getnum — interleaved multi-value coordinate (2D). Returns 0..1 (signed allowed).
function getnum(ops: number[], mvl: number): NapPoint {
  let x = 0, y = 0;
  const n = Math.min(mvl + 1, ops.length);
  for (let i = 0; i < n; i++) {
    const b = data6(ops[i]);
    x |= ((b & 0x38) << 8) >> (i * 3);
    y |= ((b & 0x07) << 11) >> (i * 3);
  }
  if (x > ONE) x -= ONE * 2;
  if (y > ONE) y -= ONE * 2;
  return { x: x / ONE, y: y / ONE };
}

// getadr — single-value (color index / angle). Returns the raw scaled integer.
function getadr(ops: number[], svl: number): number {
  let a = 0;
  const n = Math.min(svl + 1, ops.length);
  for (let i = 0; i < n; i++) a |= ((data6(ops[i]) << 7) >> (i * 6));
  return a >> 9; // A_SCALE
}

// SET-COLOR — GRB interleave across (mvl+1) bytes → 8-bit RGB.
function decodeColor(ops: number[], mvl: number): NapColor {
  let g = 0, r = 0, b = 0;
  const n = Math.min(mvl + 1, ops.length);
  for (let i = 0; i < n; i++) {
    const m = data6(ops[i]);
    g |= (((m & 0x20) << 7) | ((m & 0x04) << 9)) >> (i << 1);
    r |= (((m & 0x10) << 8) | ((m & 0x02) << 10)) >> (i << 1);
    b |= (((m & 0x08) << 9) | ((m & 0x01) << 11)) >> (i << 1);
  }
  // Loop packs 8 significant bits at positions 5..12; normalize to 0..255.
  const norm = (v: number) => Math.max(0, Math.min(255, (v >> 5) & 0xff));
  return { r: norm(r), g: norm(g), b: norm(b) };
}

export function decodeNaplpsStandard(bytes: Uint8Array | number[]): NapDecodeResult {
  const buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const shapes: NapShape[] = [];
  const palette: NapColor[] = DEFAULT_PALETTE.map(c => ({ ...c }));
  const commandCounts: Record<string, number> = {};

  let mvl = 2, svl = 0;
  let mode: 'G' | 'T' = 'G';
  let cur: NapPoint = { x: 0, y: 0 };
  let curColor: NapColor = { r: 255, g: 255, b: 255 };
  let curSlot = 0;

  let i = 0;
  while (i < buf.length) {
    const b = buf[i++];
    if (b === 0x0e) { mode = 'G'; continue; } // SO → graphics
    if (b === 0x0f) { mode = 'T'; continue; } // SI → text
    if (mode === 'T') continue;
    if (b < 0x20 || b > 0x3f) continue; // control/stray

    // collect operand bytes
    const ops: number[] = [];
    while (i < buf.length && buf[i] >= 0x40 && buf[i] <= 0x7f) ops.push(buf[i++]);
    commandCounts[NAMES[b] ?? `0x${b.toString(16)}`] = (commandCounts[NAMES[b] ?? `0x${b.toString(16)}`] ?? 0) + 1;

    if (b === 0x21) { // DOMAIN
      if (ops.length) { const c = data6(ops[0]); mvl = (c >> 2) & 7; svl = c & 3; }
      continue;
    }
    if (b === 0x3c) { // SET-COLOR → define current palette slot
      curColor = decodeColor(ops, mvl);
      palette[curSlot] = curColor;
      continue;
    }
    if (b === 0x3e) { // SELECT-COLOR → pick a slot
      curSlot = ((getadr(ops, svl) % 16) + 16) % 16;
      curColor = palette[curSlot];
      continue;
    }
    if (!COORD_OPS.has(b) || ops.length === 0) continue;

    // decode operand groups into raw coordinates, then resolve abs/relative
    const raws: NapPoint[] = [];
    for (let k = 0; k + mvl < ops.length || (k < ops.length && raws.length === 0); k += mvl + 1) {
      raws.push(getnum(ops.slice(k, k + mvl + 1), mvl));
    }
    const pts: NapPoint[] = [];
    const relFirst = REL_FIRST.has(b);
    for (let k = 0; k < raws.length; k++) {
      if (k === 0) pts.push(relFirst ? { x: cur.x + raws[0].x, y: cur.y + raws[0].y } : raws[0]);
      else pts.push({ x: pts[k - 1].x + raws[k].x, y: pts[k - 1].y + raws[k].y });
    }
    if (pts.length === 0) continue;

    if (PTSET_OPS.has(b)) {
      cur = pts[pts.length - 1]; // move only
    } else if (POINT_OPS.has(b)) {
      shapes.push({ type: 'point', points: [pts[0]], color: curColor, filled: true });
      cur = pts[pts.length - 1];
    } else if (LINE_OPS.has(b) || ARC_OPS.has(b)) {
      shapes.push({ type: 'polyline', points: [cur, ...pts], color: curColor, filled: false });
      cur = pts[pts.length - 1];
    } else if (POLY_OPS.has(b)) {
      shapes.push({ type: 'polygon', points: pts, color: curColor, filled: FILLED.has(b) });
      cur = pts[pts.length - 1];
    } else if (RECT_OPS.has(b) && pts.length >= 2) {
      const [p, q] = pts;
      shapes.push({
        type: 'polygon',
        points: [{ x: p.x, y: p.y }, { x: q.x, y: p.y }, { x: q.x, y: q.y }, { x: p.x, y: q.y }],
        color: curColor, filled: FILLED.has(b),
      });
      cur = q;
    }
  }

  return { shapes, palette, commandCounts, byteCount: buf.length };
}
