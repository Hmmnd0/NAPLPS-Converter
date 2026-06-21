import { describe, it, expect } from 'vitest';
import { quantizePopularity } from './pixelQuantize';

// Build an RGBA Uint8ClampedArray from [r,g,b,count] tuples (alpha = 255).
function makePixels(colors: Array<[number, number, number, number]>): Uint8ClampedArray {
  const total = colors.reduce((n, c) => n + c[3], 0);
  const data = new Uint8ClampedArray(total * 4);
  let i = 0;
  for (const [r, g, b, count] of colors) {
    for (let k = 0; k < count; k++) {
      data[i++] = r; data[i++] = g; data[i++] = b; data[i++] = 255;
    }
  }
  return data;
}

const has = (palette: number[][], rgb: number[]) =>
  palette.some((c) => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]);

describe('quantizePopularity', () => {
  it('keeps every colour exactly when the image uses ≤ colorCount colours', () => {
    // The PRODIGY case: a clean limited palette must survive untouched.
    const data = makePixels([
      [0, 0, 0, 100],
      [0, 0, 168, 90],
      [255, 255, 255, 50], // pure white — must NOT be averaged to gray
      [87, 87, 87, 30],
      [87, 255, 255, 10],
    ]);
    const palette = quantizePopularity(data, 16);
    expect(palette.length).toBe(5);
    expect(has(palette, [255, 255, 255])).toBe(true);
    expect(has(palette, [0, 0, 168])).toBe(true);
    expect(has(palette, [87, 87, 87])).toBe(true);
  });

  it('preserves a dominant pure colour exactly even past the palette limit', () => {
    // 20 distinct colours (> 16) forces binning; white dominates its bin and a
    // little anti-alias fringe sits in the same bin — white must win exactly.
    const colors: Array<[number, number, number, number]> = [
      [255, 255, 255, 1000], // dominant pure white
      [250, 250, 250, 5],    // AA fringe near white (same coarse bin)
    ];
    for (let i = 0; i < 20; i++) colors.push([i * 12, 64, 200, 20]); // 20 distinct blues
    const palette = quantizePopularity(makePixels(colors), 16);
    expect(palette.length).toBe(16);
    expect(has(palette, [255, 255, 255])).toBe(true); // exact, not 252/253-ish average
  });
});
