import { describe, it, expect } from 'vitest';
import { svgToNaplpsStandard } from './svgToNaplps';
import { decodeNaplpsStandard } from './naplps-std-decoder';

// Simulates the back half of the PNG → .nap pipeline: a traced SVG (filled
// polygons over a palette) → real standard NAPLPS bytes → decoded back.
describe('svgToNaplpsStandard — SVG (traced PNG) → real .nap', () => {
  const W = 100, H = 100;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    // red square, top-left in SVG space (so high Y in NAPLPS after the flip)
    `<polygon points="10,10 40,10 40,40 10,40" fill="rgb(223,64,0)"/>` +
    // blue square, bottom-right in SVG space
    `<polygon points="60,60 90,60 90,90 60,90" fill="rgb(0,0,223)"/>` +
    `</svg>`;

  it('produces decodable standard NAPLPS with the right colours and geometry', async () => {
    const bytes = await svgToNaplpsStandard(svg, W, H);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(20);

    const { shapes, commandCounts } = decodeNaplpsStandard(bytes);
    expect(commandCounts['SET&POLY-FILLED']).toBe(2);
    expect(commandCounts['SELECT-COLOR']).toBeGreaterThanOrEqual(2);

    const fills = shapes.filter(s => s.type === 'polygon' && s.filled);
    expect(fills.length).toBe(2);

    const colors = fills.map(s => `${s.color.r},${s.color.g},${s.color.b}`);
    expect(colors).toContain('223,64,0');
    expect(colors).toContain('0,0,223');

    // The red square sat at SVG y=10..40 (top) → higher NAPLPS y (up). Confirm
    // the Y-flip happened: the red shape's mean y should be the larger one.
    const red = fills.find(s => s.color.r === 223)!;
    const blue = fills.find(s => s.color.b === 223 && s.color.r === 0)!;
    const meanY = (s: typeof red) => s.points.reduce((a, p) => a + p.y, 0) / s.points.length;
    expect(meanY(red)).toBeGreaterThan(meanY(blue));

    // All content fits inside TURSHOW's visible field (X∈[0,1], Y∈[0,0.75]) with
    // the configured margin — nothing clipped off the top, nothing past x=1.
    for (const s of fills) for (const p of s.points) {
      expect(p.x).toBeGreaterThanOrEqual(0.03 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(0.97 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(0.03 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(0.72 + 1e-6);
    }

    // Aspect ratio preserved: a square in SVG stays square in NAPLPS units.
    const span = (vals: number[]) => Math.max(...vals) - Math.min(...vals);
    expect(span(red.points.map(p => p.x))).toBeCloseTo(span(red.points.map(p => p.y)), 2);
    // Red is left of blue (no horizontal flip).
    expect(Math.max(...red.points.map(p => p.x))).toBeLessThan(Math.min(...blue.points.map(p => p.x)));
  });

  it('throws on an SVG with no supported shapes', async () => {
    await expect(svgToNaplpsStandard(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`, W, H))
      .rejects.toThrow(/no supported shapes/);
  });
});
