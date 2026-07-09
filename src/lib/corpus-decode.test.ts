// Decoder regression tests against genuine period files from the
// pheller/NAPLPS historical corpus (MIT; github.com/pheller/NAPLPS).
//
// These lock in the per-command-family coordinate-group semantics (RHINO
// PDISET.C): before that fix, LINE-ABS-heavy files decoded as "starbursts" —
// long spurious rays from one origin — because groups after the first were
// wrongly treated as relative. The bounding-box and shape-count assertions
// below fail loudly on that class of regression.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decodeNaplpsStandard, type NapShape } from './naplps-std-decoder';

const DIR = join(__dirname, '../../test-fixtures/nap');
const load = (name: string) => decodeNaplpsStandard(new Uint8Array(readFileSync(join(DIR, name))));

// Fraction of points inside the legal field (slightly padded). A mis-parse
// scatters relative-accumulated points far outside it.
function inFieldFraction(shapes: NapShape[]): number {
  let total = 0, inside = 0;
  for (const s of shapes) for (const p of s.points) {
    total++;
    if (p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05) inside++;
  }
  return total ? inside / total : 0;
}

describe('period-file decoding (pheller corpus)', () => {
  // [file, minShapes] — counts are floors, not exact, so smarter decoding
  // (e.g. future TEXT support) doesn't break them.
  const cases: Array<[string, number]> = [
    ['canada1.nap', 200],   // mountain landscape — LINE-ABS heavy
    ['car.nap', 100],       // sedan — SET&LINE pairs
    ['momiji.nap', 150],    // maple waterfall
    ['wmon.nap', 200],      // weather chart — RECT bars + line traces
    ['butfly.nap', 50],     // butterflies — SET&POLY (the always-worked family)
    ['eagle1.nap', 30],
    ['santa.nap', 20],
  ];

  for (const [file, minShapes] of cases) {
    it(`${file}: decodes to sane geometry`, () => {
      const res = load(file);
      expect(res.shapes.length).toBeGreaterThanOrEqual(minShapes);
      // ≥97% of points must land in the field — starburst mis-parses scatter
      // 30-60% of points far outside it.
      expect(inFieldFraction(res.shapes)).toBeGreaterThan(0.97);
    });
  }

  it('SET&LINE-ABS decodes as independent segments, not a chain', () => {
    // hand-built: SET&LINE-ABS with 4 coordinate groups = TWO 2-point lines
    // header: SO, DOMAIN mvl=3
    const enc = (x: number, y: number) => {
      // 3+3 bit interleave, 4 bytes, matching getnum
      const X = Math.round(x * 8192) & 0x1fff, Y = Math.round(y * 8192) & 0x1fff;
      const out: number[] = [];
      for (let i = 0; i < 4; i++) {
        const shift = 11 - 3 * i;
        const xb = (X >> shift) & 7, yb = (Y >> shift) & 7;
        out.push(0x40 | (xb << 3) | yb);
      }
      return out;
    };
    const bytes = new Uint8Array([
      0x0e, 0x21, 0x4d, 0x40, 0x40, 0x40, 0x40,
      0x2a, ...enc(0.1, 0.1), ...enc(0.2, 0.1), ...enc(0.7, 0.6), ...enc(0.8, 0.6),
      0x0f, 0x1a,
    ]);
    const res = decodeNaplpsStandard(bytes);
    const lines = res.shapes.filter(s => s.type === 'polyline');
    expect(lines.length).toBe(2);
    expect(lines[0].points.length).toBe(2);
    // second segment starts at ~0.7, NOT chained/relative to the first
    expect(lines[1].points[0].x).toBeCloseTo(0.7, 1);
  });
});
