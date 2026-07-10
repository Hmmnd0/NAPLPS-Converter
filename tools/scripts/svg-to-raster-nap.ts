// SVG -> 1:1 raster .nap (+ optional NAPLPS font text): rasterize a clean SVG
// at its native viewBox size, quantize, and emit row-run rects. The raster
// route is projection-robust (thin strips survive TURSHOW's 636->596 px
// squeeze that makes 1-2px vector strips touch), and a flat-colour SVG
// rasterizes with no AA noise, so it often comes out SMALLER than the vector
// route (MadMaze: 993 rects / 11.5KB vs 12.4KB). Edit the paths/texts below.
// Run: npx tsx tools/scripts/svg-to-raster-nap.ts
import { writeFileSync } from 'fs';
import sharp from 'sharp';
import { quantizePopularity } from '../../src/lib/pixelQuantize';
import { quantizePixels } from '../../src/lib/regionTrace';
import { encodeNaplpsStandard } from '../../src/lib/naplps-std-encoder';
import type { NapShape } from '../../src/lib/naplps-std-decoder';

(async () => {
  const { data, info } = await sharp('/Users/joe/NAPLPS-Converter/outputNoText-01.svg', { density: 72 })
    .flatten({ background: '#000000' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width, height = info.height;
  console.log('rasterized SVG at', width, 'x', height);
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  const palette = quantizePopularity(rgba, 16);
  const pixels = quantizePixels(rgba, palette);

  type R = { x: number; y: number; w: number; h: number; ci: number };
  const rects: R[] = [];
  let open = new Map<string, R>();
  for (let y = 0; y < height; y++) {
    const next = new Map<string, R>();
    let x = 0;
    while (x < width) {
      const ci = pixels[y * width + x];
      let ex = x + 1;
      while (ex < width && pixels[y * width + ex] === ci) ex++;
      const key = `${x}:${ex - x}:${ci}`;
      const prev = open.get(key);
      if (prev && prev.y + prev.h === y) { prev.h++; next.set(key, prev); }
      else { const r = { x, y, w: ex - x, h: 1, ci }; rects.push(r); next.set(key, r); }
      x = ex;
    }
    open = next;
  }

  const GRID = 2048, fieldH = 0.75, m = 0.03;
  const boxW = 1 - 2 * m, boxH = fieldH - 2 * m;
  const stepsPerPx = Math.max(1, Math.floor(Math.min(boxW / width, boxH / height) * GRID));
  const s = stepsPerPx / GRID;
  const xOff = Math.round((m + (boxW - width * s) / 2) * GRID) / GRID;
  const yOff = Math.round((m + (boxH - height * s) / 2) * GRID) / GRID;
  const norm = (px: number, py: number) => ({ x: xOff + px * s, y: yOff + (height - py) * s });

  // drop pure-black rects: TURSHOW's background is already black, and skipping
  // them cuts bytes (the SVG rasterization is mostly black outside the scroll)
  const shapes: NapShape[] = [];
  for (const r of rects) {
    const c = palette[r.ci];
    if (c[0] < 8 && c[1] < 8 && c[2] < 8) continue;
    shapes.push({
      type: 'polygon', filled: true, color: { r: c[0], g: c[1], b: c[2] },
      points: [norm(r.x, r.y), norm(r.x + r.w, r.y), norm(r.x + r.w, r.y + r.h), norm(r.x, r.y + r.h)],
    });
  }

  const black = { r: 0, g: 0, b: 0 };
  const texts = [
    { lines: ['MadMaze: An Ending'], x: 0.17, y: 0.59, charW: 0.021, charH: 0.036, color: black },
    { lines: [
      'Your quest has ended for now.', '',
      'You can return to your adventure',
      'anytime by closing this window and',
      'restarting MadMaze. You can continue',
      'on through the PRODIGY service now',
      'by using any other service commands.',
    ], x: 0.19, y: 0.50, charW: 0.0145, charH: 0.028, color: black },
  ];
  const { bytes } = encodeNaplpsStandard(shapes, { texts });
  writeFileSync('/tmp/turshow/MADMAZH.NAP', bytes);
  console.log('MADMAZH.NAP', bytes.length, 'bytes', `(~${Math.round(bytes.length * 10 / 13288)}s), ${shapes.length} rects`);
})();
