// Web Worker: runs popularity quantization + SVG generation off the main thread

import { quantizePopularity, type RGB } from './pixelQuantize';

function nearestPaletteColor(palette: RGB[], r: number, g: number, b: number): RGB {
  let minDist = Infinity;
  let best = palette[0];
  for (const c of palette) {
    const dist = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (dist < minDist) { minDist = dist; best = c; }
  }
  return best;
}

self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; width: number; height: number }>) => {
  const { buffer, width, height } = e.data;
  const data = new Uint8ClampedArray(buffer);

  // Quantize to a 16-color palette (popularity-based — preserves pure colours).
  const palette = quantizePopularity(data, 16);

  // Generate SVG with run-length encoding + vertical merging
  // Active runs: key = "x,w,color" → run object (extended in place as rows match)
  type Run = { x: number; y: number; w: number; h: number; color: string };
  const completedRuns: Run[] = [];
  const activeRuns = new Map<string, Run>();

  const totalRows = height;
  const progressInterval = Math.max(1, Math.floor(totalRows / 100));

  for (let y = 0; y < height; y++) {
    const seenKeys = new Set<string>();
    let x = 0;

    while (x < width) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] === 0) { x++; continue; }
      const pal = nearestPaletteColor(palette, data[idx], data[idx + 1], data[idx + 2]);
      const color = `rgb(${pal[0]},${pal[1]},${pal[2]})`;
      let runEnd = x + 1;
      while (runEnd < width) {
        const nextIdx = (y * width + runEnd) * 4;
        if (data[nextIdx + 3] === 0) break;
        const nextPal = nearestPaletteColor(palette, data[nextIdx], data[nextIdx + 1], data[nextIdx + 2]);
        if (nextPal[0] !== pal[0] || nextPal[1] !== pal[1] || nextPal[2] !== pal[2]) break;
        runEnd++;
      }
      const w = runEnd - x;
      const key = `${x},${w},${color}`;
      seenKeys.add(key);
      if (activeRuns.has(key)) {
        activeRuns.get(key)!.h++;
      } else {
        const run: Run = { x, y, w, h: 1, color };
        activeRuns.set(key, run);
        completedRuns.push(run);
      }
      x = runEnd;
    }

    // Close any active runs not seen in this row
    for (const key of activeRuns.keys()) {
      if (!seenKeys.has(key)) activeRuns.delete(key);
    }

    if (y % progressInterval === 0 || y === height - 1) {
      self.postMessage({ type: 'progress', progress: (y + 1) / totalRows });
    }
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges" viewBox="0 0 ${width} ${height}">`;
  for (const r of completedRuns) {
    svg += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.color}" />`;
  }
  svg += '</svg>';

  self.postMessage({
    type: 'result',
    svg,
    palette: palette.map(([r, g, b]) => ({ r, g, b })),
  });
};
