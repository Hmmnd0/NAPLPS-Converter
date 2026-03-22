// Web Worker: runs median-cut quantization + SVG generation off the main thread

type RGB = [number, number, number];

function medianCutQuantize(data: Uint8ClampedArray, colorCount: number): RGB[] {
  const colors: RGB[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) colors.push([data[i], data[i + 1], data[i + 2]]);
  }

  function getRange(cList: RGB[]): number {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const [r, g, b] of cList) {
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b < bMin) bMin = b; if (b > bMax) bMax = b;
    }
    const rRange = rMax - rMin, gRange = gMax - gMin, bRange = bMax - bMin;
    if (rRange >= gRange && rRange >= bRange) return 0;
    if (gRange >= rRange && gRange >= bRange) return 1;
    return 2;
  }

  function quantize(cList: RGB[], depth: number): RGB[] {
    if (cList.length === 0) return [];
    if (depth === 0 || cList.length === 1) {
      const avg = cList.reduce(
        (acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]] as RGB,
        [0, 0, 0] as RGB
      );
      return [[
        Math.round(avg[0] / cList.length),
        Math.round(avg[1] / cList.length),
        Math.round(avg[2] / cList.length),
      ]];
    }
    const channel = getRange(cList);
    cList.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(cList.length / 2);
    return [
      ...quantize(cList.slice(0, mid), depth - 1),
      ...quantize(cList.slice(mid), depth - 1),
    ];
  }

  return quantize(colors, Math.round(Math.log2(colorCount)));
}

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

  // Quantize to 16-color palette
  const palette = medianCutQuantize(data, 16);

  // Red-preservation patches (same logic as original pixelToSvg.ts)
  const colors: RGB[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) colors.push([data[i], data[i + 1], data[i + 2]]);
  }

  // Patch: most saturated red
  let maxRedScore = -Infinity;
  let mostRed: RGB = [255, 0, 0];
  for (const [r, g, b] of colors) {
    const score = r - g - b;
    if (score > maxRedScore) { maxRedScore = score; mostRed = [r, g, b]; }
  }
  if (!palette.some(([r, g, b]) => r === mostRed[0] && g === mostRed[1] && b === mostRed[2])) {
    palette[palette.length - 1] = mostRed;
  }

  // Patch: exact target red #921c12
  const targetRed: RGB = [146, 28, 18];
  const foundTargetRed = colors.some(([r, g, b]) => Math.abs(r - 146) < 8 && Math.abs(g - 28) < 8 && Math.abs(b - 18) < 8);
  if (foundTargetRed && !palette.some(([r, g, b]) => Math.abs(r - 146) < 8 && Math.abs(g - 28) < 8 && Math.abs(b - 18) < 8)) {
    palette[palette.length - 1] = targetRed;
  }

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
