// True 1:1 PNG -> .nap: quantize at native resolution, merge same-colour
// row runs into rects (plus lossless vertical stacking), encode. Pixel-exact
// on period viewers: row-run tiling cancels TURSHOW's edge-inclusive fill
// inflation (docs/turshow-renderer-limits.md §9), and original text survives
// as its actual glyph pixels. This produced END1R.NAP, the highest-fidelity
// MadMaze artifact.
// Run: npx tsx tools/scripts/png-to-raster-nap.ts <input.png> <output.nap>
import { writeFileSync } from 'fs';
import sharp from 'sharp';
import { quantizePopularity } from '../../src/lib/pixelQuantize';
import { quantizePixels } from '../../src/lib/regionTrace';
import { encodeNaplpsStandard } from '../../src/lib/naplps-std-encoder';
import type { NapShape } from '../../src/lib/naplps-std-decoder';

const input = process.argv[2] ?? 'end1.png';
const output = process.argv[3] ?? '/tmp/turshow/END1R.NAP';

(async () => {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width, height = info.height;
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

  const shapes: NapShape[] = rects.map(r => {
    const c = palette[r.ci];
    return {
      type: 'polygon' as const, filled: true, color: { r: c[0], g: c[1], b: c[2] },
      points: [norm(r.x, r.y), norm(r.x + r.w, r.y), norm(r.x + r.w, r.y + r.h), norm(r.x, r.y + r.h)],
    };
  });

  const { bytes } = encodeNaplpsStandard(shapes);
  writeFileSync(output, bytes);
  console.log(`${input} ${width}x${height}: ${rects.length} rects -> ${output}, ${bytes.length} bytes (~${Math.round(bytes.length * 10 / 13288)}s in TURSHOW)`);
})();
