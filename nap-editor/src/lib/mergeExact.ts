// Electron-app-only merge path: exact geometric union via Clipper2 (the
// same family Inkscape/most CAD tools lean on for robustness), falling back
// to turshowSim's rasterize/retrace merge for anything the union can't
// represent safely. Kept out of the shared src/lib (which the root Next.js
// project's vitest suite also imports) since clipper2-ts isn't a dependency
// there.
//
// Clipper2 scales doubles to fixed-point 64-bit integers internally before
// running its sweep-line — that's specifically what its author changed
// Clipper1 to do after floating-point coordinates proved numerically
// unrobust (see angusj.com/clipper2/Docs/Robustness.htm). The earlier
// polygon-clipping-based version of this file stayed in float the whole
// way through, which is the more failure-prone category by Clipper's own
// account — hence trying this instead of hand-rolling more validation.
import { booleanOpD, ClipType, FillRule, areaD } from 'clipper2-ts'
import type { PathD, PathsD } from 'clipper2-ts'
import type { NapShape, NapPoint } from '@lib/naplps-std-decoder'
import { mergeShapesForHardware, LINT_MAX_VERTS, LINT_MAX_CROSSINGS } from '@lib/turshowSim'

// Clipper2 paths are implicitly closed (no repeated first/last point).
function toPathD(pts: NapPoint[]): PathD {
  return pts.map(p => ({ x: p.x, y: p.y }))
}

function fromPathD(path: PathD): NapPoint[] {
  return path.map(({ x, y }) => ({ x, y }))
}

// Catches a self-touching "bowtie" boundary (a repeated vertex) — the same
// pinch-point failure mode that broke rendering before under the raster path.
function isDegenerate(path: PathD): boolean {
  const seen = new Set<string>()
  for (const { x, y } of path) {
    const key = `${x.toFixed(6)},${y.toFixed(6)}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

// True boundary self-intersection (two non-adjacent edges crossing at a
// point that isn't a shared vertex) — isDegenerate() above doesn't catch
// this, since a warped boundary doesn't always repeat a vertex exactly.
function segmentsCross(a1: NapPoint, a2: NapPoint, b1: NapPoint, b2: NapPoint): boolean {
  const cross = (o: NapPoint, a: NapPoint, b: NapPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const d1 = cross(b1, b2, a1)
  const d2 = cross(b1, b2, a2)
  const d3 = cross(a1, a2, b1)
  const d4 = cross(a1, a2, b2)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function hasSelfIntersection(path: PathD): boolean {
  const n = path.length
  for (let i = 0; i < n; i++) {
    const a1 = path[i], a2 = path[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue // adjacent edges share a vertex
      const b1 = path[j], b2 = path[(j + 1) % n]
      if (segmentsCross(a1, a2, b1, b2)) return true
    }
  }
  return false
}

// Same even-odd scanline crossing count turshowSim's hardware linter uses,
// duplicated rather than exported from the shared lib (see file header).
function maxScanlineCrossings(path: PathD): number {
  let yMin = Infinity, yMax = -Infinity
  for (const { y } of path) { if (y < yMin) yMin = y; if (y > yMax) yMax = y }
  const SAMPLES = 480
  let max = 0
  for (let i = 0; i <= SAMPLES; i++) {
    const yc = yMin + ((yMax - yMin) * i) / SAMPLES
    let c = 0
    for (let j = 0, k = path.length - 1; j < path.length; k = j++) {
      const ay = path[k].y, by = path[j].y
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) c++
    }
    if (c > max) max = c
  }
  return max
}

// Field coordinates need resolution finer than 1/2048 (the finest nudge
// step); 8 decimal places is Clipper2's max and far exceeds that.
const PRECISION = 8

/**
 * Merge selected shapes with exact geometric union when the result is
 * hardware-safe (no holes, within vertex/crossing limits, no degenerate or
 * self-intersecting boundary); otherwise falls back to
 * mergeShapesForHardware's rasterize-and-retrace approach for the whole
 * selection.
 */
export function mergeShapesExact(list: NapShape[]): NapPoint[][] {
  const eligible = list.filter(s => s.points.length >= 3)
  if (eligible.length < 2) return mergeShapesForHardware(list)

  const subjects: PathsD = eligible.map(s => toPathD(s.points))
  const inputArea = subjects.reduce((a, p) => a + Math.abs(areaD(p)), 0)

  // booleanOpD (rather than unionD's clip-less overload) so we can pass an
  // explicit precision — the single-argument unionD overload silently
  // hardcodes precision=2, far too coarse for our sub-pixel field coords.
  let unioned: PathsD
  try {
    unioned = booleanOpD(ClipType.Union, subjects, null, FillRule.NonZero, PRECISION)
  } catch {
    return mergeShapesForHardware(list)
  }

  // A hole shows up as a separate path wound opposite to its parent (negative
  // signed area). We don't have a way to represent holes in a NapShape point
  // loop, so bail to the raster path rather than dropping or flattening one.
  if (unioned.some(p => areaD(p) < 0)) return mergeShapesForHardware(list)

  const exact: NapPoint[][] = []
  let outputArea = 0
  for (const path of unioned) {
    if (
      path.length > LINT_MAX_VERTS ||
      maxScanlineCrossings(path) > LINT_MAX_CROSSINGS ||
      isDegenerate(path) ||
      hasSelfIntersection(path)
    ) {
      return mergeShapesForHardware(list) // whole-selection fallback
    }
    outputArea += Math.abs(areaD(path))
    exact.push(fromPathD(path))
  }

  // Union area can only shrink relative to the inputs (shapes overlapping),
  // never grow. Meaningful growth means the boolean op produced a warped
  // result that slipped past the checks above.
  if (outputArea > inputArea * 1.001 + 1e-9) {
    return mergeShapesForHardware(list)
  }

  return exact
}
