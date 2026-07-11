import { quantizePopularity } from './pixelQuantize';
import { traceRegions, quantizePixels } from './regionTrace';
import { encodeNaplpsStandard } from './naplps-std-encoder';
import type { NapShape } from './naplps-std-decoder';
import type { RGB } from './pixelQuantize';

type WorkerInput = {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  minPixels: number;
  mode: 'polygons' | 'raster';
  rasterWidth: number;
};

// Raster mode: scan row by row, merge same-color horizontal runs into
// rectangles, then stack runs with identical x/width/color from consecutive
// rows into taller rectangles (lossless — pixels are unchanged). Each
// rectangle is a 4-vertex polygon: immune to every TURSHOW fill limit.
function rasterToShapes(
  pixels: Uint8Array,
  palette: RGB[],
  width: number,
  height: number,
  norm: (p: { x: number; y: number }) => { x: number; y: number }
): NapShape[] {
  type R = { x: number; y: number; w: number; h: number; ci: number };
  const rects: R[] = [];
  let open = new Map<string, R>(); // extendable rects touching the previous row
  for (let y = 0; y < height; y++) {
    const next = new Map<string, R>();
    let x = 0;
    while (x < width) {
      const ci = pixels[y * width + x];
      let ex = x + 1;
      while (ex < width && pixels[y * width + ex] === ci) ex++;
      const key = `${x}:${ex - x}:${ci}`;
      const prev = open.get(key);
      if (prev && prev.y + prev.h === y) {
        prev.h++;
        next.set(key, prev);
      } else {
        const r = { x, y, w: ex - x, h: 1, ci };
        rects.push(r);
        next.set(key, r);
      }
      x = ex;
    }
    open = next;
  }

  // NOTE: keep row-major order — TURSHOW's edge-inclusive fill (+1px) makes
  // tiles overlap their neighbours, and only in-order drawing repaints the
  // overlaps consistently (colour-sorting causes wrong-coloured fringes).
  return rects.map(r => {
    const c = palette[r.ci];
    return {
      type: 'polygon' as const,
      filled: true,
      color: { r: c[0], g: c[1], b: c[2] },
      points: [
        norm({ x: r.x, y: r.y }),
        norm({ x: r.x + r.w, y: r.y }),
        norm({ x: r.x + r.w, y: r.y + r.h }),
        norm({ x: r.x, y: r.y + r.h }),
      ],
    };
  });
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { buffer, width, height, minPixels, mode, rasterWidth: _rw } = e.data; void _rw;
  const data = new Uint8ClampedArray(buffer);

  try {
    const palette = quantizePopularity(data, 16);
    const pixels = quantizePixels(data, palette);

    // Coordinate transform: isotropic letterbox into the 4:3 field, SNAPPED to
    // the encodable coordinate grid. The encoder can only express multiples of
    // LSB = ONE/2048 field units; if a source pixel maps between two steps,
    // abutting polygons round apart and the viewer shows background seams.
    // Snapping the scale so 1 source px = an integer number of steps (and the
    // offsets onto the grid) makes every traced pixel corner encode exactly.
    const GRID = 2048; // encodable steps per field unit (ONE=8192 / LSB=4)
    const fieldH = 0.75, m = 0.03;
    const boxW = 1 - 2 * m, boxH = fieldH - 2 * m;
    // steps per px, floored to an integer (min 1 — only reachable if the source
    // were wider than ~1900px, and both modes cap well below that)
    const stepsPerPx = Math.max(1, Math.floor(Math.min(boxW / width, boxH / height) * GRID));
    const s = stepsPerPx / GRID; // field units per px
    const contentW = width * s, contentH = height * s;
    const xOff = Math.round((m + (boxW - contentW) / 2) * GRID) / GRID;
    const yOff = Math.round((m + (boxH - contentH) / 2) * GRID) / GRID;
    const norm = (p: { x: number; y: number }) => ({
      x: xOff + p.x * s,
      y: yOff + (height - p.y) * s,
    });

    let shapes: NapShape[];

    if (mode === 'raster') {
      shapes = rasterToShapes(pixels, palette, width, height, norm);
    } else {
      const regions = traceRegions(pixels, palette, width, height, minPixels);
      if (regions.length === 0) {
        self.postMessage({ type: 'error', message: 'No traceable regions — try a flat-color image rather than a photo' });
        return;
      }
      shapes = regions.map(r => ({
        type: 'polygon' as const,
        filled: true,
        color: { r: r.color[0], g: r.color[1], b: r.color[2] },
        points: r.points.map(norm),
      }));
    }

    const { bytes: nap } = encodeNaplpsStandard(shapes);

    self.postMessage({
      type: 'result',
      nap: nap.buffer,
      palette,
      polygonCount: shapes.length,
      totalVertices: shapes.reduce((s, sh) => s + sh.points.length, 0),
    }, { transfer: [nap.buffer] });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
