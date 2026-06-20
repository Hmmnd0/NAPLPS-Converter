import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { decodeNaplpsStandard, NapShape } from './naplps-std-decoder';
import { encodeNaplpsStandard } from './naplps-std-encoder';

const fixture = (n: string) => new Uint8Array(readFileSync(resolve(process.cwd(), 'test-fixtures/nap', n)));

const fillablePolys = (shapes: NapShape[]) =>
  shapes.filter(s => s.type === 'polygon' && s.filled && s.points.length >= 3);

describe('encodeNaplpsStandard — real .nap out', () => {
  it('emits only valid NAPLPS bytes (control, opcodes 0x20-0x3f, operands 0x40-0x7f)', () => {
    const { shapes } = decodeNaplpsStandard(fixture('amerwest.nap'));
    const { bytes } = encodeNaplpsStandard(shapes);
    for (const b of bytes) {
      const ok = b < 0x20 || (b >= 0x20 && b <= 0x3f) || (b >= 0x40 && b <= 0x7f);
      expect(ok).toBe(true);
    }
    // starts with the period service preamble + SO graphics
    expect(bytes[0]).toBe(0x18);
    expect([...bytes.slice(0, 10)]).toContain(0x0e);
  });

  it('round-trips filled-polygon geometry within the coordinate quantization step', () => {
    for (const f of ['eagle1.nap', 'santa.nap', 'amerwest.nap']) {
      const a = decodeNaplpsStandard(fixture(f));
      const { bytes } = encodeNaplpsStandard(a.shapes);
      const b = decodeNaplpsStandard(bytes);
      const fa = fillablePolys(a.shapes), fb = fillablePolys(b.shapes);
      expect(fb.length).toBe(fa.length);
      let maxErr = 0;
      for (let i = 0; i < fa.length; i++) {
        expect(fb[i].points.length).toBe(fa[i].points.length);
        for (let k = 0; k < fa[i].points.length; k++) {
          maxErr = Math.max(maxErr,
            Math.abs(fa[i].points[k].x - fb[i].points[k].x),
            Math.abs(fa[i].points[k].y - fb[i].points[k].y));
        }
      }
      // LSB is 4/8192 ≈ 0.0005; allow a little headroom.
      expect(maxErr, `${f} maxVertexErr`).toBeLessThan(0.002);
    }
  });

  it('preserves the palette colours through a round-trip', () => {
    const a = decodeNaplpsStandard(fixture('amerwest.nap'));
    const { bytes, palette } = encodeNaplpsStandard(a.shapes);
    const b = decodeNaplpsStandard(bytes);
    // every colour used by an output shape resolves to a palette entry that the
    // re-decode reproduces exactly (8-bit GRB is lossless at mvl=3).
    const inB = new Set(b.shapes.map(s => `${s.color.r},${s.color.g},${s.color.b}`));
    for (const c of palette) {
      expect(inB.has(`${c.r},${c.g},${c.b}`)).toBe(true);
    }
  });

  it('keeps full-span shapes in bounds (no ±1.0 delta sign-wrap blowup)', () => {
    // A rectangle spanning the entire 0..1 range has a closing edge with a delta
    // of -1.0, which used to wrap to +1.0 and send a vertex to x=2.0. The encoder
    // must subdivide it so every decoded coordinate stays within [0,1].
    const shapes: NapShape[] = [{
      type: 'polygon', filled: true, color: { r: 200, g: 100, b: 50 },
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    }];
    const { bytes } = encodeNaplpsStandard(shapes);
    const { shapes: out } = decodeNaplpsStandard(bytes);
    for (const s of out) for (const p of s.points) {
      expect(p.x).toBeGreaterThanOrEqual(-0.001);
      expect(p.x).toBeLessThanOrEqual(1.001);
      expect(p.y).toBeGreaterThanOrEqual(-0.001);
      expect(p.y).toBeLessThanOrEqual(1.001);
    }
  });

  it('caps the palette at 16 slots', () => {
    const a = decodeNaplpsStandard(fixture('amerwest.nap'));
    const { palette } = encodeNaplpsStandard(a.shapes, { maxColors: 16 });
    expect(palette.length).toBeLessThanOrEqual(16);
  });
});
