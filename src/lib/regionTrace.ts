import type { RGB } from './pixelQuantize';

export interface TracedRegion {
  color: RGB;
  /** Pixel-corner coords (x: 0..w, y: 0..h), Y=0 at top. Axis-aligned simplified. */
  points: Array<{ x: number; y: number }>;
  pixelCount: number;
  /** painter-order key: filled area of the whole (pre-split) component */
  sortArea?: number;
}

// Iterative Douglas-Peucker — avoids call-stack overflow on large/jagged boundaries.
export function dpSimplify(pts: Array<{ x: number; y: number }>, tol: number): Array<{ x: number; y: number }> {
  const n = pts.length;
  if (n <= 2) return pts;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    if (j - i <= 1) continue;
    const p1 = pts[i], p2 = pts[j];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    let maxDist = 0, maxIdx = i;
    for (let k = i + 1; k < j; k++) {
      const d = len === 0
        ? Math.sqrt((pts[k].x - p1.x) ** 2 + (pts[k].y - p1.y) ** 2)
        : Math.abs(dy * pts[k].x - dx * pts[k].y + p2.x * p1.y - p2.y * p1.x) / len;
      if (d > maxDist) { maxDist = d; maxIdx = k; }
    }
    if (maxDist > tol) {
      keep[maxIdx] = 1;
      stack.push([i, maxIdx]);
      stack.push([maxIdx, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Chaikin corner-cutting: each edge is replaced by two points at 1/4 and 3/4
// along it. Converts pixel-boundary staircases into smooth curves that DP can
// then approximate cleanly with diagonal line segments.
export function chaikinSmooth(
  pts: Array<{ x: number; y: number }>,
  iterations = 2
): Array<{ x: number; y: number }> {
  let p = pts
  for (let iter = 0; iter < iterations; iter++) {
    const out: Array<{ x: number; y: number }> = []
    const n = p.length
    for (let i = 0; i < n; i++) {
      const a = p[i]
      const b = p[(i + 1) % n]
      out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y })
      out.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y })
    }
    p = out
  }
  return p
}

// Hard cap on vertices per polygon — period renderers (TURSHOW etc.) have fixed
// static vertex buffers. If DP still leaves too many points, raise epsilon until
// the polygon fits. Seams from the diagonal approximations are sub-pixel at
// TURSHOW's actual VGA resolution and don't show in practice.
// TURSHOW is empirically proven up to 63 wire vertices; the encoder can insert
// midpoints on large relative jumps, so trace a little under that.
const MAX_POLY_VERTS = 60;

export function simplifyForHardware(pts: Array<{ x: number; y: number }>, epsilon: number): Array<{ x: number; y: number }> {
  let result = dpSimplify(pts, epsilon);
  let eps = epsilon;
  while (result.length > MAX_POLY_VERTS && eps < 50) {
    eps *= 1.5;
    result = dpSimplify(pts, eps);
  }
  // Absolute fallback: keep first/last + evenly-spaced interior points
  if (result.length > MAX_POLY_VERTS) {
    const step = Math.ceil((pts.length - 2) / (MAX_POLY_VERTS - 2));
    const out = [pts[0]];
    for (let i = step; i < pts.length - 1; i += step) out.push(pts[i]);
    out.push(pts[pts.length - 1]);
    return out;
  }
  return result;
}

// BFS 4-connected component labeling for a binary mask.
export function labelComponents(mask: Uint8Array, w: number, h: number) {
  const labels = new Int32Array(w * h);
  const comps: Array<{
    label: number; startX: number; startY: number; size: number;
    minX: number; minY: number; maxX: number; maxY: number;
  }> = [];
  let nextLabel = 1;
  const queue: number[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx] || labels[idx]) continue;
      const label = nextLabel++;
      const comp = { label, startX: x, startY: y, size: 0, minX: x, minY: y, maxX: x, maxY: y };
      comps.push(comp);
      labels[idx] = label;
      queue.length = 0;
      queue.push(idx);
      let qi = 0;
      while (qi < queue.length) {
        const cur = queue[qi++];
        comp.size++;
        const cx = cur % w, cy = (cur / w) | 0;
        if (cx < comp.minX) comp.minX = cx; if (cx > comp.maxX) comp.maxX = cx;
        if (cy < comp.minY) comp.minY = cy; if (cy > comp.maxY) comp.maxY = cy;
        if (cx + 1 < w && mask[cur + 1] && !labels[cur + 1]) { labels[cur + 1] = label; queue.push(cur + 1); }
        if (cx - 1 >= 0 && mask[cur - 1] && !labels[cur - 1]) { labels[cur - 1] = label; queue.push(cur - 1); }
        if (cy + 1 < h && mask[cur + w] && !labels[cur + w]) { labels[cur + w] = label; queue.push(cur + w); }
        if (cy - 1 >= 0 && mask[cur - w] && !labels[cur - w]) { labels[cur - w] = label; queue.push(cur - w); }
      }
    }
  }
  return { labels, comps };
}

// Trace the outer boundary of a component using directed pixel-grid edges.
//
// Each foreground pixel contributes one directed edge per exposed side.  The
// edges are oriented so the component is always on the LEFT (clockwise in
// screen coords, Y-down).  We chain them into a closed polygon.
//
// Corner coordinates are integers 0..w (x) and 0..h (y).  The boundary of
// pixel (px, py) runs between corners (px, py)…(px+1, py+1).
//
// This is guaranteed to terminate — no possibility of the infinite-loop that
// the Moore pixel-trace has on certain corner configurations.
export function traceEdges(
  labels: Int32Array,
  compLabel: number,
  startX: number,
  startY: number,
  w: number,
  h: number,
  maxPts: number
): Array<{ x: number; y: number }> {
  const in_comp = (px: number, py: number) =>
    px >= 0 && px < w && py >= 0 && py < h && labels[py * w + px] === compLabel;

  // Pack corner (cx, cy) into a single integer key.
  const W1 = w + 1; // corner grid width
  const pack = (cx: number, cy: number) => cy * W1 + cx;

  // Build adjacency: corner → next corner (one outgoing edge per exposed side).
  // A corner can carry TWO outgoing edges when two pixels of the component touch
  // only diagonally there (an "X" corner — ubiquitous in 1px outlines). Keep both;
  // picking the wrong one (or overwriting one) shortcuts the walk back to the
  // start and closes the polygon across the region with a straight edge.
  const adjA = new Int32Array((w + 1) * (h + 1)).fill(-1);
  const adjB = new Int32Array((w + 1) * (h + 1)).fill(-1);
  const addEdge = (from: number, to: number) => {
    if (adjA[from] < 0) adjA[from] = to; else adjB[from] = to;
  };

  for (let py = startY; py < h; py++) {
    let rowHasComp = false;
    for (let px = 0; px < w; px++) {
      if (!in_comp(px, py)) continue;
      rowHasComp = true;
      if (!in_comp(px, py - 1)) addEdge(pack(px, py), pack(px + 1, py));          // top → right
      if (!in_comp(px + 1, py)) addEdge(pack(px + 1, py), pack(px + 1, py + 1));  // right → down
      if (!in_comp(px, py + 1)) addEdge(pack(px + 1, py + 1), pack(px, py + 1));  // bottom → left
      if (!in_comp(px - 1, py)) addEdge(pack(px, py + 1), pack(px, py));          // left → up
    }
    if (!rowHasComp && py > startY) break; // past component (4-connectivity guarantee)
  }

  // Follow the chain starting from the top-left corner of the start pixel.
  // At an ambiguous corner, turn RIGHT relative to the incoming direction — that
  // continues around the pixel we were tracing instead of jumping to the
  // diagonal neighbour's boundary. (Incoming south→west, north→east, west→north,
  // east→south; with our edge orientation the right turn is always the edge
  // contributed by the same pixel.)
  const result: Array<{ x: number; y: number }> = [];
  const startKey = pack(startX, startY);
  let cur = startKey;
  let prev = -1;

  for (let i = 0; i < maxPts; i++) {
    const cx = cur % W1, cy = (cur / W1) | 0;
    result.push({ x: cx, y: cy });
    let next = adjA[cur];
    const alt = adjB[cur];
    if (next < 0) break;
    if (alt >= 0 && prev >= 0) {
      // south(0,1)→west(-1,0), north(0,-1)→east(1,0), west(-1,0)→north(0,-1), east(1,0)→south(0,1)
      const inDx = cx - (prev % W1), inDy = cy - ((prev / W1) | 0);
      const outDx = inDy === 1 ? -1 : inDy === -1 ? 1 : 0;
      const outDy = inDx === -1 ? -1 : inDx === 1 ? 1 : 0;
      const want = pack(cx + outDx, cy + outDy);
      if (alt === want) next = alt;
    } else if (alt >= 0 && prev < 0) {
      // Walk starts on the start pixel's top edge (east); prefer it if present.
      const east = pack(cx + 1, cy);
      if (adjA[cur] !== east && alt === east) next = alt;
    }
    prev = cur;
    cur = next;
    if (cur === startKey) break;
  }

  return result;
}

// Map each pixel to its nearest palette color index (Euclidean RGB distance).
export function quantizePixels(data: Uint8ClampedArray, palette: RGB[]): Uint8Array {
  const result = new Uint8Array(data.length / 4);
  for (let i = 0; i < result.length; i++) {
    const off = i * 4;
    if (data[off + 3] === 0) continue;
    let best = 0, bestDist = Infinity;
    for (let j = 0; j < palette.length; j++) {
      const d = (data[off] - palette[j][0]) ** 2 + (data[off+1] - palette[j][1]) ** 2 + (data[off+2] - palette[j][2]) ** 2;
      if (d < bestDist) { bestDist = d; best = j; }
    }
    result[i] = best;
  }
  return result;
}

// Shoelace area of a polygon in pixel-corner coords.
function polyArea(pts: Array<{ x: number; y: number }>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

// TURSHOW's scanline fill mispairs intersections beyond ~16 per row (verified
// empirically: an 8-tooth comb = 16 crossings renders, 12 teeth = 24 crossings
// fills its gaps solid). Cap well under that: 6 runs per row = 12 crossings.
const MAX_ROW_RUNS = 6;

// Widest count of separate horizontal runs on any pixel row of the component —
// a filled polygon's scanline crossings are 2× this.
function maxRowRuns(
  labels: Int32Array,
  comp: { label: number; minX: number; minY: number; maxX: number; maxY: number },
  w: number
): number {
  let max = 0;
  for (let y = comp.minY; y <= comp.maxY; y++) {
    let runs = 0;
    let inRun = false;
    for (let x = comp.minX; x <= comp.maxX; x++) {
      const inC = labels[y * w + x] === comp.label;
      if (inC && !inRun) runs++;
      inRun = inC;
    }
    if (runs > max) max = runs;
  }
  return max;
}

// Trace one labeled component into polygons of ≤ MAX_POLY_VERTS vertices each,
// and ≤ MAX_ROW_RUNS horizontal runs per scanline (TURSHOW fill limit).
//
// If either limit is exceeded, the component is cut in half (vertical cut for
// run overflow — it divides the parallel strips; longer-axis cut otherwise)
// and each half re-labeled and traced recursively. This preserves comb-shaped
// detail (e.g. thin parallel hatching lines joined at one end) that the old
// escalating-epsilon approach flattened into a single blob.
function traceComponent(
  labels: Int32Array,
  comp: { label: number; startX: number; startY: number; size: number; minX: number; minY: number; maxX: number; maxY: number },
  w: number,
  h: number,
  maxPts: number,
  depth: number,
  out: Array<{ points: Array<{ x: number; y: number }>; pixelCount: number }>
) {
  const boundary = traceEdges(labels, comp.label, comp.startX, comp.startY, w, h, maxPts);
  // Tolerance must stay under half the finest feature pitch. Retro art is full
  // of 1px strokes ATTACHED to large regions (hatching, outlines, serifs), so a
  // per-size epsilon doesn't help — a large component can still carry 1px teeth.
  // 0.5px preserves them; the splitter below absorbs the extra vertices.
  const simplified = dpSimplify(boundary, 0.5);
  if (simplified.length < 3) return;
  const runOverflow = maxRowRuns(labels, comp, w) > MAX_ROW_RUNS;
  // Hole-fill check: we only trace OUTER boundaries, so a ring's polygon fills
  // solid across its hole, painting over content that nothing may repaint
  // (e.g. background showing through). If the filled area is much larger than
  // the component's actual pixels, split until pieces are hole-free (a ring
  // becomes arc segments, each a concavity instead of a hole).
  const holeFill = polyArea(simplified) > comp.size * 1.35 + 64;
  if (!runOverflow && !holeFill && simplified.length <= MAX_POLY_VERTS) {
    out.push({ points: simplified, pixelCount: comp.size });
    return;
  }
  // Too complex for one polygon. Cutting a single-pixel-wide strip can't help —
  // fall back to the hard cap rather than recurse forever.
  const spanX = comp.maxX - comp.minX, spanY = comp.maxY - comp.minY;
  if (depth >= 10 || (spanX < 2 && spanY < 2) || (runOverflow && spanX < 2)) {
    out.push({ points: simplifyForHardware(boundary, 1.5), pixelCount: comp.size });
    return;
  }
  // Run overflow → always cut vertically (divides the parallel strips);
  // vertex overflow → cut across the longer axis.
  const vertical = runOverflow || spanX >= spanY;
  const mid = vertical ? (comp.minX + comp.maxX + 1) >> 1 : (comp.minY + comp.maxY + 1) >> 1;
  const maskA = new Uint8Array(w * h);
  const maskB = new Uint8Array(w * h);
  for (let y = comp.minY; y <= comp.maxY; y++) {
    for (let x = comp.minX; x <= comp.maxX; x++) {
      if (labels[y * w + x] !== comp.label) continue;
      ((vertical ? x < mid : y < mid) ? maskA : maskB)[y * w + x] = 1;
    }
  }
  for (const half of [maskA, maskB]) {
    const sub = labelComponents(half, w, h);
    // No minPixels here: the parent already passed the size filter, and dropping
    // split-off slivers would punch holes in legitimate content.
    for (const c of sub.comps) traceComponent(sub.labels, c, w, h, maxPts, depth + 1, out);
  }
}

// Trace a binary mask into hardware-safe polygons (vertex + scanline-crossing
// caps enforced via recursive splitting). Used by the SVG path to repair
// polygons that TURSHOW's fill cannot handle.
export function traceMaskToPolygons(
  mask: Uint8Array,
  w: number,
  h: number
): Array<Array<{ x: number; y: number }>> {
  const { labels, comps } = labelComponents(mask, w, h);
  const maxPts = Math.max(8000, 4 * (w + h));
  const out: Array<{ points: Array<{ x: number; y: number }>; pixelCount: number }> = [];
  for (const comp of comps) traceComponent(labels, comp, w, h, maxPts, 0, out);
  return out.map(t => t.points);
}

// Trace all flat-color regions in a quantized image into polygon boundaries.
//
// minPixels: skip components smaller than this — removes noise / anti-aliasing fringe.
//            Should be at least ~0.01% of total pixels; default 32 for typical retro art.
//
// Output is sorted by *filled polygon area* descending (painter's order). Using
// pixelCount here breaks badly: the tracer only follows outer boundaries, so a
// thin ring (few pixels) fills to a huge solid disc that would paint over
// everything drawn before it. Area order guarantees whatever sits inside a
// hole-filled shape is drawn after it, back-to-front.
export function traceRegions(
  pixels: Uint8Array,
  palette: RGB[],
  width: number,
  height: number,
  minPixels = 16
): TracedRegion[] {
  const mask = new Uint8Array(width * height);
  const result: TracedRegion[] = [];
  const maxBoundaryPts = Math.max(8000, 4 * (width + height));

  for (let ci = 0; ci < palette.length; ci++) {
    for (let i = 0; i < pixels.length; i++) mask[i] = pixels[i] === ci ? 1 : 0;
    const { labels, comps } = labelComponents(mask, width, height);

    for (const comp of comps) {
      if (comp.size < minPixels) continue;
      const traced: Array<{ points: Array<{ x: number; y: number }>; pixelCount: number }> = [];
      traceComponent(labels, comp, width, height, maxBoundaryPts, 0, traced);
      // All pieces of a split component must sort by the PARENT's filled area,
      // not their own: a small piece of a huge region drawn late would
      // hole-fill over detail (creases, hatching) that sits on top of it.
      const parentArea = traced.reduce((a, t) => a + polyArea(t.points), 0);
      for (const t of traced) {
        result.push({ color: palette[ci], points: t.points, pixelCount: t.pixelCount, sortArea: parentArea });
      }
    }
  }

  result.sort((a, b) => (b.sortArea ?? polyArea(b.points)) - (a.sortArea ?? polyArea(a.points)));
  return result;
}
