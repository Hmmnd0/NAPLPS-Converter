// Standard NAPLPS decoder — reads REAL period .nap files into shapes.
//
// Implements the actual NAPLPS / T.101 wire format reverse-engineered from period
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
// A font-text block: the WORDS travel in the file; the viewer supplies the
// letterforms. Defined here (with the other shared types) — the encoder
// re-exports it for its callers.
export interface NapText {
  lines: string[];          // text lines, drawn top → bottom
  x: number; y: number;     // top-left of the block, normalized NAPLPS coords (Y up)
  charW?: number;           // character cell width  (normalized), default 0.018
  charH?: number;           // character cell height (normalized), default 0.030
  color?: NapColor;         // default white
}

export interface NapDecodeResult {
  shapes: NapShape[];
  palette: NapColor[];
  /** font-text blocks (TEXT/FIELD + SI character runs), structurally decoded */
  texts: NapText[];
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

// Default colour map — the exact period default (RHINO defmap[16], GRB order,
// 0..8192 scaled to 0..255). Slots 0-7 are a black→white grayscale ramp, 8-15
// the colours. Files that rely on defaults (e.g. EAGLE1) need this; files that
// define their own palette via SET-COLOR (e.g. SANTA) override it.
const DEFAULT_PALETTE: NapColor[] = [
  { r: 0, g: 0, b: 0 }, { r: 32, g: 32, b: 32 }, { r: 64, g: 64, b: 64 }, { r: 96, g: 96, b: 96 },
  { r: 128, g: 128, b: 128 }, { r: 159, g: 159, b: 159 }, { r: 191, g: 191, b: 191 }, { r: 255, g: 255, b: 255 },
  { r: 0, g: 0, b: 223 }, { r: 159, g: 0, b: 223 }, { r: 223, g: 0, b: 128 }, { r: 223, g: 64, b: 0 },
  { r: 223, g: 223, b: 0 }, { r: 64, g: 223, b: 0 }, { r: 0, g: 223, b: 128 }, { r: 0, g: 159, b: 223 },
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
  // >= : raw ONE (8192) is exactly -1.0 in two's complement, not +1.0 — period
  // decoders (TURSHOW) treat the top half of the range as negative unconditionally.
  if (x >= ONE) x -= ONE * 2;
  if (y >= ONE) y -= ONE * 2;
  return { x: x / ONE, y: y / ONE };
}

// Circle through 3 points → arc sampled as a smooth polyline. NAPLPS arcs are
// drawn through start/mid/end (RHINO sp3arc); rendering the raw 3 points as a
// polyline gives a jagged triangle, so we reconstruct the circle and sample it.
function sampleArc(p0: NapPoint, p1: NapPoint, p2: NapPoint, n = 24): NapPoint[] {
  const d = 2 * (p0.x * (p1.y - p2.y) + p1.x * (p2.y - p0.y) + p2.x * (p0.y - p1.y));
  if (Math.abs(d) < 1e-9) return [p0, p1, p2]; // collinear → straight
  const s0 = p0.x * p0.x + p0.y * p0.y, s1 = p1.x * p1.x + p1.y * p1.y, s2 = p2.x * p2.x + p2.y * p2.y;
  const cx = (s0 * (p1.y - p2.y) + s1 * (p2.y - p0.y) + s2 * (p0.y - p1.y)) / d;
  const cy = (s0 * (p2.x - p1.x) + s1 * (p0.x - p2.x) + s2 * (p1.x - p0.x)) / d;
  const r = Math.hypot(p0.x - cx, p0.y - cy);
  const ang = (p: NapPoint) => Math.atan2(p.y - cy, p.x - cx);
  const norm = (x: number) => { let v = x; while (v < 0) v += 2 * Math.PI; while (v >= 2 * Math.PI) v -= 2 * Math.PI; return v; };
  const a0 = ang(p0);
  const fullCircle = Math.hypot(p0.x - p2.x, p0.y - p2.y) < r * 1e-3;
  let total: number;
  if (fullCircle) {
    total = 2 * Math.PI; // start == end → whole circle
  } else {
    const sweepCCW = norm(ang(p2) - a0);
    total = norm(ang(p1) - a0) <= sweepCCW ? sweepCCW : sweepCCW - 2 * Math.PI;
  }
  const pts: NapPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + total * (i / n);
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
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

// Normalize PRODIGY 8-bit protocol encoding → standard 7-bit NAPLPS.
//
// PRODIGY sets bit 7 on ALL protocol bytes (opcodes 0xA0-0xBF, operands 0xC0-0xFF)
// to distinguish them from literal text content (bytes < 0x80). TURSHOW does the
// same strip (confirmed in decompiled TURSHOW.c: `byte & 0x7f` unconditionally).
//
// Detection: if an 8-bit opcode (0xA0-0xBF) appears before any 7-bit opcode (0x20-0x3F).
// After normalization the existing 7-bit decoder runs unchanged.
function normalizeIfEightBit(buf: Uint8Array): Uint8Array {
  let eightBit = false;
  for (let i = 0; i < Math.min(buf.length, 64); i++) {
    const b = buf[i];
    if (b >= 0xA0 && b <= 0xBF) { eightBit = true; break; }
    if (b >= 0x20 && b <= 0x3F) break; // 7-bit opcode found first
  }
  if (!eightBit) return buf;

  const out: number[] = [];
  let i = 0;
  while (i < buf.length) {
    const b = buf[i++];
    if (b >= 0xA0 && b <= 0xBF) {
      const op = b & 0x7F;
      out.push(op);
      if (op === 0x22) {
        // TEXT opcode: skip all following bytes (operands + attribute codes + literal
        // ASCII) until the next opcode byte (0xA0-0xBF). We don't render text.
        while (i < buf.length && !(buf[i] >= 0xA0 && buf[i] <= 0xBF)) i++;
      }
    } else if (b >= 0xC0) {
      out.push(b & 0x7F); // operand byte — strip high bit
    }
    // bytes < 0xA0: SO/SI control codes, filler, literal text outside TEXT runs — skip
  }
  return Uint8Array.from(out);
}

export function decodeNaplpsStandard(bytes: Uint8Array | number[]): NapDecodeResult {
  const buf = normalizeIfEightBit(
    bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  );
  const shapes: NapShape[] = [];
  const texts: NapText[] = [];
  const palette: NapColor[] = DEFAULT_PALETTE.map(c => ({ ...c }));
  const commandCounts: Record<string, number> = {};

  let mvl = 2, svl = 0;
  let mode: 'G' | 'T' = 'G';
  let cur: NapPoint = { x: 0, y: 0 };
  let curColor: NapColor = { r: 255, g: 255, b: 255 };
  let curSlot = 0;

  // TEXT/FIELD state for structural text decoding. charW/H come from the TEXT
  // command's trailing coordinate; the block position comes from the last
  // FIELD origin (or, without a FIELD, the current drawing point).
  let charW = 0.018, charH = 0.030;
  let fieldOrigin: NapPoint | null = null;
  let textLines: string[] = [];
  let textLine = '';
  const flushText = () => {
    if (textLine.length) { textLines.push(textLine); textLine = ''; }
    // trim trailing blank lines (APD runs used for cursor moves, not content)
    while (textLines.length && textLines[textLines.length - 1] === '') textLines.pop();
    if (textLines.some(l => l.trim().length)) {
      const origin = fieldOrigin ?? cur;
      texts.push({
        lines: textLines,
        x: origin.x,
        y: origin.y,
        charW, charH,
        color: { ...curColor },
      });
    }
    textLines = [];
  };

  let i = 0;
  while (i < buf.length) {
    const b = buf[i++];
    if (b === 0x0e) { if (mode === 'T') flushText(); mode = 'G'; continue; } // SO → graphics
    if (b === 0x0f) { mode = 'T'; continue; } // SI → text
    if (mode === 'T') {
      // character layer: printable ASCII accumulates; APD (LF) ends a line;
      // CR alone is a column reset (our encoder always pairs CR+APD).
      if (b >= 0x20 && b <= 0x7e) textLine += String.fromCharCode(b);
      else if (b === 0x0a) { textLines.push(textLine); textLine = ''; }
      continue;
    }
    if (b < 0x20 || b > 0x3f) continue; // control/stray

    // collect operand bytes
    const ops: number[] = [];
    while (i < buf.length && buf[i] >= 0x40 && buf[i] <= 0x7f) ops.push(buf[i++]);
    commandCounts[NAMES[b] ?? `0x${b.toString(16)}`] = (commandCounts[NAMES[b] ?? `0x${b.toString(16)}`] ?? 0) + 1;

    if (b === 0x21) { // DOMAIN
      if (ops.length) { const c = data6(ops[0]); mvl = (c >> 2) & 7; svl = c & 3; }
      continue;
    }
    if (b === 0x22) { // TEXT: 2 attribute bytes, then the character cell size
      if (ops.length >= 2 + mvl + 1) {
        const size = getnum(ops.slice(2, 2 + mvl + 1), mvl);
        if (Math.abs(size.x) > 1e-4) charW = Math.abs(size.x);
        if (Math.abs(size.y) > 1e-4) charH = Math.abs(size.y);
      }
      continue;
    }
    if (b === 0x38) { // FIELD: origin coord + extent coord — origin is the block's top-left
      if (ops.length >= mvl + 1) {
        fieldOrigin = getnum(ops.slice(0, mvl + 1), mvl);
        cur = fieldOrigin;
      }
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

    // decode operand bytes into raw coordinate groups
    const raws: NapPoint[] = [];
    for (let k = 0; k + mvl < ops.length || (k < ops.length && raws.length === 0); k += mvl + 1) {
      raws.push(getnum(ops.slice(k, k + mvl + 1), mvl));
    }
    if (raws.length === 0) continue;

    // Per-family group semantics, matched to RHINO PDISET.C (validated against
    // pheller/NAPLPS's 246-file historical corpus — the old "first absolute,
    // rest relative for everything" heuristic starburst-garbled LINE-ABS-heavy
    // files):
    //   PT-SET/POINT/LINE ABS: every group absolute.
    //   PT-SET/POINT/LINE REL: every group a delta from the running point.
    //   SET&LINE-ABS:  independent PAIRS (start abs, end abs) — not a chain.
    //   SET&LINE-REL:  independent PAIRS (start abs, delta).
    //   ARC/POLY plain: relative chain from the current point.
    //   SET&ARC/SET&POLY: first group absolute, then relative chain.
    //   RECT plain:    each group is a (w,h) delta; only X advances after.
    //   SET&RECT:      PAIRS (corner abs, (w,h) delta); only X advances.
    const rel = REL_FIRST.has(b);

    if (PTSET_OPS.has(b) || POINT_OPS.has(b)) {
      for (const g of raws) {
        cur = rel ? { x: cur.x + g.x, y: cur.y + g.y } : g;
        if (POINT_OPS.has(b)) shapes.push({ type: 'point', points: [cur], color: curColor, filled: true });
      }
    } else if (b === 0x28 || b === 0x29) { // LINE-ABS / LINE-REL: chain from cur
      const pts: NapPoint[] = [cur];
      for (const g of raws) {
        cur = rel ? { x: cur.x + g.x, y: cur.y + g.y } : g;
        pts.push(cur);
      }
      shapes.push({ type: 'polyline', points: pts, color: curColor, filled: false });
    } else if (b === 0x2a || b === 0x2b) { // SET&LINE: independent pairs
      for (let k = 0; k + 1 < raws.length; k += 2) {
        const a = raws[k];
        const e = b === 0x2a ? raws[k + 1] : { x: a.x + raws[k + 1].x, y: a.y + raws[k + 1].y };
        shapes.push({ type: 'polyline', points: [a, e], color: curColor, filled: false });
        cur = e;
      }
    } else if (ARC_OPS.has(b) || POLY_OPS.has(b)) {
      // plain: relative chain from cur; SET&: first abs, then relative chain
      const set = b === 0x2e || b === 0x2f || b === 0x36 || b === 0x37;
      const pts: NapPoint[] = [];
      raws.forEach((g, k) => {
        if (set && k === 0) cur = g;
        else cur = { x: cur.x + g.x, y: cur.y + g.y };
        pts.push(cur);
      });
      const a = set ? pts : [ { x: pts[0].x - raws[0].x, y: pts[0].y - raws[0].y }, ...pts ];
      if (POLY_OPS.has(b)) {
        shapes.push({ type: 'polygon', points: a, color: curColor, filled: FILLED.has(b) });
      } else {
        // RHINO sp3arc: 3 points → arc through them; 2 points → full circle
        // with the two points as diameter endpoints. The eagle's eye is one.
        let sampled: NapPoint[] | null = null;
        if (a.length === 2) {
          const cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2;
          const r = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) / 2;
          sampled = [];
          for (let k = 0; k <= 24; k++) { const t = (2 * Math.PI * k) / 24; sampled.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }); }
        } else if (a.length >= 3) {
          sampled = sampleArc(a[0], a[1], a[2]);
        }
        if (sampled) {
          shapes.push({ type: FILLED.has(b) ? 'polygon' : 'polyline', points: sampled, color: curColor, filled: FILLED.has(b) });
        } else {
          shapes.push({ type: 'polyline', points: a, color: curColor, filled: false });
        }
      }
    } else if (RECT_OPS.has(b)) {
      const set = b === 0x32 || b === 0x33;
      const step = set ? 2 : 1;
      for (let k = 0; k + step - 1 < raws.length; k += step) {
        const p = set ? raws[k] : cur;
        const d = set ? raws[k + 1] : raws[k];
        const q = { x: p.x + d.x, y: p.y + d.y };
        // canonical corner order (min corner first) regardless of delta signs,
        // so encode→decode→encode is stable for rects from any source
        const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x);
        const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
        shapes.push({
          type: 'polygon',
          points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
          color: curColor, filled: FILLED.has(b),
        });
        cur = { x: q.x, y: p.y }; // only X advances (RHINO rectl/srectl)
      }
    }
  }

  if (mode === 'T') flushText(); // file ended inside a text run

  return { shapes, texts, palette, commandCounts, byteCount: buf.length };
}
