// Regression tests for the TURSHOW renderer limits (docs/turshow-renderer-limits.md).
// These were bisected empirically against TURSHOW.EXE; the fixture files
// test-fixtures/nap/turshow-vtest*.nap are the original bisect screens.
import { describe, it, expect } from 'vitest';
import { encodeNaplpsStandard } from './naplps-std-encoder';
import { decodeNaplpsStandard, type NapShape } from './naplps-std-decoder';
import { traceMaskToPolygons } from './regionTrace';
import { lintShapes, LINT_MAX_CROSSINGS, LINT_MAX_VERTS } from './turshowSim';

const square = (x: number, y: number, w: number): NapShape => ({
  type: 'polygon', filled: true, color: { r: 255, g: 0, b: 0 },
  points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }],
});

describe('TURSHOW hardware guarantees', () => {
  it('encoder appends the 0F 1A trailer (streaming decoders drop the last command at EOF)', () => {
    const { bytes } = encodeNaplpsStandard([square(0.1, 0.1, 0.2)]);
    expect(bytes[bytes.length - 2]).toBe(0x0f);
    expect(bytes[bytes.length - 1]).toBe(0x1a);
  });

  it('encoder DOMAIN carries the pel-0 pen (nonzero pels draw fat or broken lines)', () => {
    const { bytes } = encodeNaplpsStandard([square(0.1, 0.1, 0.2)]);
    // DOMAIN opcode 0x21, operand 0x4d (mvl=3/svl=1), then 4 pel bytes = 0x40 each
    const i = bytes.indexOf(0x21);
    expect(bytes[i + 1]).toBe(0x4d);
    expect([...bytes.slice(i + 2, i + 6)]).toEqual([0x40, 0x40, 0x40, 0x40]);
  });

  it('round-trips the trailer: decoder still sees every shape', () => {
    const shapes = [square(0.1, 0.1, 0.2), square(0.5, 0.3, 0.1)];
    const { bytes } = encodeNaplpsStandard(shapes);
    const decoded = decodeNaplpsStandard(bytes);
    expect(decoded.shapes.length).toBe(2);
  });

  it('traceMaskToPolygons splits a dense comb under the fill limits', () => {
    // 30 vertical teeth, 2px pitch, joined at a base: a single polygon would be
    // ~60 crossings per scanline — far beyond TURSHOW's ~16 budget.
    const W = 128, H = 96;
    const mask = new Uint8Array(W * H);
    for (let t = 0; t < 30; t++) {
      const x = 4 + t * 4;
      for (let y = 8; y < 80; y++) mask[y * W + x] = 1; // 1px tooth
    }
    for (let y = 80; y < 88; y++) for (let x = 4; x < 124; x++) mask[y * W + x] = 1; // base

    const pieces = traceMaskToPolygons(mask, W, H);
    expect(pieces.length).toBeGreaterThan(1);

    const shapes: NapShape[] = pieces.map(points => ({
      type: 'polygon', filled: true, color: { r: 160, g: 72, b: 20 },
      // map pixel corners into the field the way the pipelines do
      points: points.map(p => ({ x: p.x / W, y: 0.75 - (p.y / H) * 0.75 })),
    }));
    expect(lintShapes(shapes)).toEqual([]);

    // every piece within the caps directly, too
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(LINT_MAX_VERTS);
    }
  });

  it('lintShapes flags a hand-built over-crossing polygon', () => {
    // zig-zag comb polygon: 20 teeth = 40 crossings on one scanline
    const pts: Array<{ x: number; y: number }> = [];
    for (let t = 0; t < 20; t++) {
      const x = 0.05 + t * 0.045;
      pts.push({ x, y: 0.1 }, { x: x + 0.01, y: 0.6 }, { x: x + 0.02, y: 0.1 });
    }
    const bad: NapShape = { type: 'polygon', filled: true, color: { r: 0, g: 255, b: 0 }, points: pts };
    const lint = lintShapes([bad]);
    expect(lint.length).toBe(1);
    expect(lint[0].maxCrossings).toBeGreaterThan(LINT_MAX_CROSSINGS);
  });
});
