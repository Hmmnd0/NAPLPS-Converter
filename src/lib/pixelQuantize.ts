// Palette quantization for the PNG → SVG vectorizer. Kept in its own module
// (not the worker entry) so it can be unit-tested without bundling a Worker.

export type RGB = [number, number, number];

export const unpackRGB = (k: number): RGB => [(k >> 16) & 255, (k >> 8) & 255, k & 255];

// Popularity quantizer tuned for the limited-palette retro art this app targets
// (videotex frames, pixel graphics). Unlike median-cut — which averages each
// bucket and so muddies pure colours (white → gray, bright cyan → dull) — this
// preserves the source's actual colours:
//
//  • If the image already uses ≤ colorCount distinct colours (the common case
//    for clean retro frames), keep every colour EXACTLY — zero loss.
//  • Otherwise group near-identical colours into coarse bins (merging anti-alias
//    fringe), keep the most frequent EXACT colour as each bin's representative,
//    and take the most populous bins. Flat regions dominate by pixel count, so
//    pure colours become palette anchors; rare fringe pixels snap to the nearest
//    anchor at render time (see nearestPaletteColor in the worker).
export function quantizePopularity(data: Uint8ClampedArray, colorCount: number): RGB[] {
  const hist = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  if (hist.size === 0) return [[0, 0, 0]];

  if (hist.size <= colorCount) {
    return [...hist.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => unpackRGB(k));
  }

  type Bin = { count: number; reps: Map<number, number> };
  const bins = new Map<number, Bin>();
  for (const [k, n] of hist) {
    const [r, g, b] = unpackRGB(k);
    const binKey = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); // 16-wide bins per channel
    let bin = bins.get(binKey);
    if (!bin) { bin = { count: 0, reps: new Map() }; bins.set(binKey, bin); }
    bin.count += n;
    bin.reps.set(k, (bin.reps.get(k) || 0) + n);
  }
  return [...bins.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, colorCount)
    .map((bin) => {
      let bestK = 0, bestN = -1;
      for (const [k, n] of bin.reps) if (n > bestN) { bestN = n; bestK = k; }
      return unpackRGB(bestK);
    });
}
