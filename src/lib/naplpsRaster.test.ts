import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { rasterizeNaplps } from './naplpsRaster';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(resolve(process.cwd(), 'test-fixtures/nap', name)));

describe('rasterizeNaplps — period rendering model', () => {
  it('produces a framebuffer sized from the content aspect ratio', () => {
    const r = rasterizeNaplps(fixture('eagle1.nap'), { height: 256 });
    expect(r.height).toBe(256);
    expect(r.width).toBeGreaterThan(200);
    expect(r.pixels.length).toBe(r.width * r.height * 4);
    expect(r.shapeCount).toBeGreaterThan(10);
  });

  it('paints the decoded colours (eagle uses red, white, and a black background)', () => {
    const r = rasterizeNaplps(fixture('eagle1.nap'), { height: 200 });
    const colors = new Set<string>();
    for (let i = 0; i < r.pixels.length; i += 4) {
      colors.add(`${r.pixels[i]},${r.pixels[i + 1]},${r.pixels[i + 2]}`);
    }
    expect(colors.has('0,0,0')).toBe(true);        // background
    expect(colors.has('255,255,255')).toBe(true);  // the eagle's head
    expect(colors.has('223,64,0')).toBe(true);     // flag red
  });

  it('leaves no enclosed background gaps between adjacent fills', () => {
    // Render on a sentinel background colour (not in the palette) so true
    // uncovered background is distinguishable from the art's own black fills.
    // A sentinel pixel enclosed on all four sides by painted pixels is a seam.
    const SENT = { r: 255, g: 0, b: 255 };
    const r = rasterizeNaplps(fixture('eagle1.nap'), { height: 256, background: SENT });
    const { width: W, height: H, pixels } = r;
    const isBg = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const i = (y * W + x) * 4;
      return pixels[i] === SENT.r && pixels[i + 1] === SENT.g && pixels[i + 2] === SENT.b;
    };
    const isPainted = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !isBg(x, y);
    // A true seam is a background pixel pinched between paint on all four direct
    // sides (orthogonal or 1px-diagonal). Wider notches that legitimately show
    // background (e.g. between the feather spikes) have a background neighbour
    // and are not counted. The seam-seal pass should drive this to ~zero.
    let seams = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!isBg(x, y)) continue;
        if (isPainted(x - 1, y) && isPainted(x + 1, y) && isPainted(x, y - 1) && isPainted(x, y + 1)) seams++;
      }
    }
    // The SVG path left hundreds of such enclosed-gap pixels.
    expect(seams).toBeLessThan(8);
  });

  it('handles all four real files without throwing', () => {
    for (const f of ['eagle1.nap', 'santa.nap', 'memra3.nap', 'amerwest.nap']) {
      const r = rasterizeNaplps(fixture(f), { height: 192 });
      expect(r.pixels.length).toBe(r.width * r.height * 4);
    }
  });
});
