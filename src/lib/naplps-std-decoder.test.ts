import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { decodeNaplpsStandard } from './naplps-std-decoder';
import { naplpsToSvg } from './naplpsToSvg';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(resolve(process.cwd(), 'test-fixtures/nap', name)));

describe('decodeNaplpsStandard — real period .nap files', () => {
  it('decodes EAGLE1 into filled polygons over a palette', () => {
    const r = decodeNaplpsStandard(fixture('eagle1.nap'));
    // real file is built from SET&POLY-FILLED + SELECT-COLOR
    expect(r.commandCounts['SET&POLY-FILLED']).toBeGreaterThan(10);
    expect(r.commandCounts['SELECT-COLOR']).toBeGreaterThan(10);
    const polys = r.shapes.filter(s => s.type === 'polygon' && s.filled);
    expect(polys.length).toBeGreaterThan(10);
    // first big polygon should have several vertices, all within (roughly) the unit square
    const big = polys.find(p => p.points.length >= 4)!;
    expect(big).toBeTruthy();
    for (const pt of big.points) {
      expect(pt.x).toBeGreaterThan(-0.5);
      expect(pt.x).toBeLessThan(1.5);
    }
  });

  it('decodes SANTA and builds a palette via SET-COLOR/SELECT-COLOR', () => {
    const r = decodeNaplpsStandard(fixture('santa.nap'));
    expect(r.commandCounts['SET-COLOR']).toBeGreaterThan(0);
    expect(r.commandCounts['SELECT-COLOR']).toBeGreaterThan(0);
    // palette entries should be real 8-bit RGB
    for (const c of r.palette) {
      expect(c.r).toBeGreaterThanOrEqual(0); expect(c.r).toBeLessThanOrEqual(255);
      expect(c.g).toBeGreaterThanOrEqual(0); expect(c.g).toBeLessThanOrEqual(255);
      expect(c.b).toBeGreaterThanOrEqual(0); expect(c.b).toBeLessThanOrEqual(255);
    }
  });

  it('uses line/move primitives where present (SANTA)', () => {
    const r = decodeNaplpsStandard(fixture('santa.nap'));
    // SANTA is drawn with PT-SET-ABS + LINE-REL + polygons
    expect((r.commandCounts['PT-SET-ABS'] ?? 0) + (r.commandCounts['LINE-REL'] ?? 0)).toBeGreaterThan(0);
    expect(r.shapes.length).toBeGreaterThan(0);
  });

  it('handles all four real files without throwing and yields shapes', () => {
    for (const f of ['eagle1.nap', 'santa.nap', 'memra3.nap', 'amerwest.nap']) {
      const r = decodeNaplpsStandard(fixture(f));
      expect(r.shapes.length).toBeGreaterThan(0);
    }
  });
});

describe('naplpsToSvg', () => {
  it('produces a valid SVG with shapes from a real .nap', () => {
    const { svg, shapeCount, commandCounts } = naplpsToSvg(fixture('eagle1.nap'));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toMatch(/viewBox="[\d.\- ]+"/); // viewBox auto-fits content bounds
    expect(svg).toContain('<polygon');
    expect(shapeCount).toBeGreaterThan(10);
    expect(commandCounts['SET&POLY-FILLED']).toBeGreaterThan(0);
  });

  it('parses as well-formed XML (no malformed output)', () => {
    const { svg } = naplpsToSvg(fixture('santa.nap'));
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('svg')).toBeTruthy();
  });
});
