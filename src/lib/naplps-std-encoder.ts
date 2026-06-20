// Standard NAPLPS encoder — the inverse of naplps-std-decoder.ts. Turns decoded
// shapes (filled polygons, polylines, points over a ≤16-colour indexed palette)
// into a REAL period .nap byte stream: interleaved getnum coordinates, a DOMAIN
// of mvl=3/svl=1, an indexed palette via SET-COLOR/SELECT-COLOR, and SET&POLY-
// FILLED / PT-SET + LINE-REL geometry. Output round-trips through our decoder and
// is structured to mimic genuine period files (so tools like TURSHOW can read it).
//
// Bit layout is derived by inverting the decoder exactly:
//  - getnum: operand byte i contributes 3 bits of X (<<3) and 3 of Y, landing at
//    fixed-point position (11 - 3*i). With mvl=3 the LSB is 2^2 = 4 fixed units.
//  - getadr (svl=1): colour index i → byte0 = idx<<2, byte1 = 0 (low bits unused).
//  - SET-COLOR: GRB, 2 bits per channel per byte; byte i carries channel bits
//    (7-2i, 6-2i). With mvl=3 all 8 bits of each 0..255 channel are encoded.
import { NapShape, NapColor, NapPoint } from './naplps-std-decoder';

const ONE = 8192;
const MVL = 3;                 // 4 bytes per coordinate
const LSB = 1 << (11 - 3 * MVL); // smallest encodable fixed-point step (=4)
// Largest representable signed delta magnitude. The decoder treats x > ONE as
// negative (x -= 2*ONE), so exactly ±ONE is ambiguous; stay one LSB inside it.
const SAFE = ONE - LSB;

// Header mimicking genuine period files: service preamble, SO (graphics), RESET,
// DOMAIN (mvl=3, svl=1), TEXTURE. Copied byte-for-byte from real .nap samples.
const HEADER = [
  0x18, 0x1b, 0x22, 0x46, 0x1b, 0x45, 0x1f, 0x40, 0x40,
  0x0e,                                // SO → graphics mode
  0x20, 0x7f, 0x4f,                    // RESET
  0x21, 0x4d, 0x40, 0x40, 0x49, 0x40,  // DOMAIN: mvl=3, svl=1
  0x23, 0x40, 0x40, 0x52, 0x40, 0x40,  // TEXTURE
];

const OP = {
  SELECT_COLOR: 0x3e,
  SET_COLOR: 0x3c,
  SET_POLY_FILLED: 0x37,
  PT_SET_ABS: 0x24,
  LINE_REL: 0x29,
  POINT_ABS: 0x26,
  TEXT: 0x22,
  FIELD: 0x38,
};
// C0 control codes used by the text layer.
const C0 = { APD: 0x0a, CR: 0x0d, SI: 0x0f, SO: 0x0e };

// Quantize a normalized component (0..1, or a delta) to fixed-point rounded to
// the encodable LSB, so nothing is lost when the bits are packed below.
const quant = (v: number) => Math.round((v * ONE) / LSB) * LSB;

// Emit one coordinate. X/Y are integer fixed-point; negatives wrap into
// [0, 2*ONE) exactly as the decoder's `if (x > ONE) x -= 2*ONE` expects.
function emitCoord(out: number[], Xint: number, Yint: number) {
  const X = ((Xint % (2 * ONE)) + 2 * ONE) % (2 * ONE);
  const Y = ((Yint % (2 * ONE)) + 2 * ONE) % (2 * ONE);
  for (let i = 0; i <= MVL; i++) {
    const shift = 11 - 3 * i;
    const xb = shift >= 0 ? (X >> shift) & 7 : (X << -shift) & 7;
    const yb = shift >= 0 ? (Y >> shift) & 7 : (Y << -shift) & 7;
    out.push(0x40 | (xb << 3) | yb);
  }
}

// Colour-index operand (inverse of getadr, svl=1 → 2 bytes).
function emitIndex(out: number[], idx: number) {
  out.push(0x40 | ((idx & 0x0f) << 2));
  out.push(0x40);
}

// SET-COLOR operand group (inverse of decodeColor, GRB, mvl=3 → 4 bytes).
function emitColor(out: number[], c: NapColor) {
  for (let i = 0; i <= MVL; i++) {
    const gh = (c.g >> (7 - 2 * i)) & 1, gl = (c.g >> (6 - 2 * i)) & 1;
    const rh = (c.r >> (7 - 2 * i)) & 1, rl = (c.r >> (6 - 2 * i)) & 1;
    const bh = (c.b >> (7 - 2 * i)) & 1, bl = (c.b >> (6 - 2 * i)) & 1;
    out.push(0x40 | (gh << 5) | (rh << 4) | (bh << 3) | (gl << 2) | (rl << 1) | bl);
  }
}

// Emit an absolute vertex (clamped into the unit square) and return its
// quantized fixed-point so relative deltas can chain from the exact value.
function emitAbs(out: number[], p: NapPoint): [number, number] {
  const qx = Math.max(0, Math.min(ONE, quant(p.x)));
  const qy = Math.max(0, Math.min(ONE, quant(p.y)));
  emitCoord(out, qx, qy);
  return [qx, qy];
}

// Emit a relative move from the running quantized position `q` to a quantized
// target, subdividing into collinear steps if a single delta would exceed the
// representable signed range. Without this, a full-span edge (delta ≈ ±ONE) hits
// the sign-wrap ambiguity and the decoder reconstructs the wrong sign, sending a
// vertex out of bounds (e.g. x→2.0). Intermediate points are collinear, so the
// filled shape is unchanged. Mutates q to the final quantized position.
function emitTo(out: number[], q: [number, number], tx: number, ty: number) {
  const x0 = q[0], y0 = q[1];           // fixed start (q advances each step)
  const dx = tx - x0, dy = ty - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / SAFE));
  for (let i = 1; i <= steps; i++) {
    const nx = Math.round((x0 + (dx * i) / steps) / LSB) * LSB;
    const ny = Math.round((y0 + (dy * i) / steps) / LSB) * LSB;
    emitCoord(out, nx - q[0], ny - q[1]);
    q[0] = nx; q[1] = ny;
  }
}

// Emit a vertex list as "first absolute, rest relative" (SET&POLY-FILLED, LINE
// after PT-SET). Tracks the running quantized position so the decoded path
// reproduces these exact quantized vertices with no accumulated drift.
function emitRelPath(out: number[], pts: NapPoint[], start: [number, number]) {
  const q: [number, number] = [start[0], start[1]];
  for (let k = 1; k < pts.length; k++) emitTo(out, q, quant(pts[k].x), quant(pts[k].y));
}

// A block of NAPLPS font text, drawn with the TEXT/FIELD/SI mechanism (the
// authentic crisp-font path) rather than as traced polygons.
export interface NapText {
  lines: string[];          // text lines, drawn top → bottom
  x: number; y: number;     // top-left of the block, normalized NAPLPS coords (Y up)
  charW?: number;           // character cell width  (normalized), default 0.018
  charH?: number;           // character cell height (normalized), default 0.030
  color?: NapColor;         // default white
}

const DEFAULT_TEXT_COLOR: NapColor = { r: 255, g: 255, b: 255 };

// Emit one text block: SELECT-COLOR, TEXT (attributes + character field size),
// FIELD (position + area), then SI + characters with CR/APD line breaks, SO.
// Mirrors the structure of genuine period files (e.g. email2.nap).
function emitText(out: number[], t: NapText, slotOf: (c: NapColor) => number) {
  const cw = t.charW ?? 0.018, ch = t.charH ?? 0.030;
  out.push(OP.SELECT_COLOR); emitIndex(out, slotOf(t.color ?? DEFAULT_TEXT_COLOR));
  // TEXT: 2 attribute bytes (proportional spacing, L→R, no rotation — copied
  // from real files) followed by the character field size as a coordinate.
  out.push(OP.TEXT, 0x70, 0x40);
  emitCoord(out, Math.round(cw * ONE), Math.round(ch * ONE));
  // FIELD: text area = top-left position + (width, -height) extent (down is -Y).
  const maxLen = Math.max(1, ...t.lines.map(l => l.length));
  const fieldW = Math.max(cw, Math.min(0.97 - t.x, maxLen * cw));
  const fieldH = Math.max(ch, t.lines.length * ch);
  out.push(OP.FIELD);
  emitCoord(out, Math.round(t.x * ONE), Math.round(t.y * ONE));
  emitCoord(out, Math.round(fieldW * ONE), Math.round(-fieldH * ONE));
  // Drop to the first baseline, enter text mode, draw lines, return to graphics.
  out.push(C0.APD, C0.SI);
  t.lines.forEach((line, i) => {
    if (i > 0) out.push(C0.CR, C0.APD);
    for (const ch of line) {
      const cc = ch.charCodeAt(0);
      if (cc >= 0x20 && cc <= 0x7e) out.push(cc);
    }
  });
  out.push(C0.SO);
}

export interface EncodeOptions {
  /** maximum palette slots (NAPLPS allows 16). */
  maxColors?: number;
  /** font-text blocks drawn after the shapes (the authentic crisp-text path). */
  texts?: NapText[];
}

export interface EncodeResult {
  bytes: Uint8Array;
  palette: NapColor[];
}

const keyOf = (c: NapColor) => `${c.r},${c.g},${c.b}`;

// Build a ≤maxColors palette from the shapes' colours (most-frequent first),
// keeping pure black at slot 0 when present (the period background convention).
function buildPalette(shapes: NapShape[], texts: NapText[], maxColors: number): NapColor[] {
  const freq = new Map<string, { c: NapColor; n: number }>();
  const add = (c: NapColor) => {
    const k = keyOf(c);
    const e = freq.get(k);
    if (e) e.n++; else freq.set(k, { c: { ...c }, n: 1 });
  };
  for (const s of shapes) add(s.color);
  for (const t of texts) add(t.color ?? DEFAULT_TEXT_COLOR);
  const sorted = [...freq.values()].sort((a, b) => b.n - a.n).map(e => e.c);
  const black = sorted.find(c => c.r === 0 && c.g === 0 && c.b === 0);
  const rest = sorted.filter(c => !(c.r === 0 && c.g === 0 && c.b === 0));
  const ordered = black ? [black, ...rest] : sorted;
  return ordered.slice(0, maxColors);
}

export function encodeNaplpsStandard(shapes: NapShape[], opts: EncodeOptions = {}): EncodeResult {
  const maxColors = Math.max(1, Math.min(16, opts.maxColors ?? 16));
  const texts = opts.texts ?? [];
  const palette = buildPalette(shapes, texts, maxColors);

  const slotOf = (c: NapColor) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  const out: number[] = [...HEADER];

  // Define every palette slot: SELECT-COLOR(slot) then SET-COLOR(rgb).
  for (let i = 0; i < palette.length; i++) {
    out.push(OP.SELECT_COLOR); emitIndex(out, i);
    out.push(OP.SET_COLOR); emitColor(out, palette[i]);
  }

  // Draw shapes in order; emit SELECT-COLOR only when the slot changes.
  let curSlot = -1;
  for (const s of shapes) {
    if (!s.points.length) continue;
    const slot = slotOf(s.color);
    if (slot !== curSlot) { out.push(OP.SELECT_COLOR); emitIndex(out, slot); curSlot = slot; }

    if (s.type === 'polygon' && s.filled && s.points.length >= 3) {
      out.push(OP.SET_POLY_FILLED);
      const start = emitAbs(out, s.points[0]);
      emitRelPath(out, s.points, start);
    } else if (s.type === 'point' || s.points.length === 1) {
      // a single vertex (incl. degenerate 1-point polygons) → a point.
      out.push(OP.POINT_ABS);
      emitAbs(out, s.points[0]);
    } else {
      // polyline, or a polygon too small to fill: move to first, then LINE-REL.
      out.push(OP.PT_SET_ABS);
      const start = emitAbs(out, s.points[0]);
      out.push(OP.LINE_REL);
      emitRelPath(out, s.points, start);
    }
  }

  // Font text blocks last, on top of the graphics.
  for (const t of texts) emitText(out, t, slotOf);

  return { bytes: Uint8Array.from(out), palette };
}
