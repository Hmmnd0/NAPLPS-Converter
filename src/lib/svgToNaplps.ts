import { NAPLPSEncoder, NAPLPSPoint, NAPLPSColor } from './naplps';
import { NAPLPSFoxtoolboxEncoder } from './naplps-foxtoolbox';
import { encodeNaplpsStandard, NapText } from './naplps-std-encoder';
import { NapShape, NapColor, NapPoint } from './naplps-std-decoder';

// Set to true to enable detailed conversion debug logging in the browser console
const DEBUG_SVG_NAPLPS = false;

// Douglas-Peucker tolerance in SVG coordinate units.
// 0.5px only removes collinear/redundant points without visibly rounding corners.
// Raise toward 1.5 to smooth more aggressively (smaller files, more distortion).
const DP_TOLERANCE = 0.5;

export function dpSimplify(pts: Array<{ x: number; y: number }>, tol: number): Array<{ x: number; y: number }> {
  if (pts.length <= 2) return pts;
  const p1 = pts[0], p2 = pts[pts.length - 1];
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dist = len === 0
      ? Math.sqrt((pts[i].x - p1.x) ** 2 + (pts[i].y - p1.y) ** 2)
      : Math.abs(dy * pts[i].x - dx * pts[i].y + p2.x * p1.y - p2.y * p1.x) / len;
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  if (maxDist > tol) {
    const L = dpSimplify(pts.slice(0, maxIdx + 1), tol);
    const R = dpSimplify(pts.slice(maxIdx), tol);
    return [...L.slice(0, -1), ...R];
  }
  return [pts[0], pts[pts.length - 1]];
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface PolygonShape {
  points: Array<{ x: number; y: number }>;
  color: string;
}

// Parse the SVG string into a DOM once and build the shared class→fill map.
// All shape extractors take the resulting (doc, cssMap) so a single conversion
// parses the document one time instead of once per shape type.
function parseSvgDocument(svgString: string): { doc: Document; cssMap: Map<string, string> } {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Malformed SVG: ' + (parseError.textContent?.trim().split('\n')[0] ?? 'parse error'));
  }
  return { doc, cssMap: buildCssClassMap(doc) };
}

function parseSvgToPolygons(doc: Document, cssMap: Map<string, string>): PolygonShape[] {
  const shapes: PolygonShape[] = [];

  doc.querySelectorAll('polygon, polyline').forEach(el => {
    const pointsAttr = el.getAttribute('points') || '';
    const color = resolveFill(el, cssMap);
    const nums = pointsAttr.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    if (nums.length < 4) return; // need at least 2 points
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      points.push({ x: nums[i], y: nums[i + 1] });
    }
    shapes.push({ points, color });
  });

  return shapes;
}

function ellipseToPolygonPoints(cx: number, cy: number, rx: number, ry: number, sides = 24): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides;
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return points;
}

function parseSvgToCirclesAndEllipses(doc: Document, cssMap: Map<string, string>): PolygonShape[] {
  const shapes: PolygonShape[] = [];

  doc.querySelectorAll('circle').forEach(el => {
    const cx = parseFloat(el.getAttribute('cx') || '0');
    const cy = parseFloat(el.getAttribute('cy') || '0');
    const r  = parseFloat(el.getAttribute('r')  || '0');
    const color = resolveFill(el, cssMap);
    if (r <= 0) return;
    shapes.push({ points: ellipseToPolygonPoints(cx, cy, r, r), color });
  });

  doc.querySelectorAll('ellipse').forEach(el => {
    const cx = parseFloat(el.getAttribute('cx') || '0');
    const cy = parseFloat(el.getAttribute('cy') || '0');
    const rx = parseFloat(el.getAttribute('rx') || '0');
    const ry = parseFloat(el.getAttribute('ry') || '0');
    const color = resolveFill(el, cssMap);
    if (rx <= 0 || ry <= 0) return;
    shapes.push({ points: ellipseToPolygonPoints(cx, cy, rx, ry), color });
  });

  return shapes;
}

// Tokenize a path `d` attribute into [command, ...args] tuples.
// Recognizes line commands (M/L/H/V/Z) and curve commands (C/S/Q/T/A).
// Numbers are extracted with a tolerant regex so terse forms like "10-5"
// (implicit separator) and "1.5.5" (two coordinates) parse correctly.
export function tokenizePathD(d: string): Array<[string, number[]]> {
  const tokens = d.trim().match(/[MLHVZCSQTAmlhvzcsqta][^MLHVZCSQTAmlhvzcsqta]*/g) ?? [];
  return tokens.map(token => {
    const cmd = token[0];
    const nums = (token.slice(1).match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
    return [cmd, nums];
  });
}

// ── Curve flattening ──────────────────────────────────────────────────────────
// Segments per curve. We oversample; the Douglas–Peucker pass downstream then
// collapses near-collinear points, so flat regions stay cheap while tight bends
// keep enough detail.
const CURVE_SEGMENTS = 16;
type XY = { x: number; y: number };

// Cubic Bézier — returns sampled points excluding the start, including the end.
function sampleCubic(p0: XY, c1: XY, c2: XY, p1: XY, n = CURVE_SEGMENTS): XY[] {
  const pts: XY[] = [];
  for (let k = 1; k <= n; k++) {
    const t = k / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    pts.push({
      x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
      y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
    });
  }
  return pts;
}

// Quadratic Bézier.
function sampleQuad(p0: XY, c: XY, p1: XY, n = CURVE_SEGMENTS): XY[] {
  const pts: XY[] = [];
  for (let k = 1; k <= n; k++) {
    const t = k / n, u = 1 - t;
    const a = u * u, b = 2 * u * t, d = t * t;
    pts.push({ x: a * p0.x + b * c.x + d * p1.x, y: a * p0.y + b * c.y + d * p1.y });
  }
  return pts;
}

// Elliptical arc (SVG endpoint parameterization → center, then sample).
function sampleArc(
  p0: XY, rx: number, ry: number, xAxisDeg: number,
  largeArc: boolean, sweep: boolean, p1: XY, n = CURVE_SEGMENTS,
): XY[] {
  if (rx === 0 || ry === 0) return [p1]; // degenerate → straight line
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (xAxisDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);

  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;

  // Correct radii if too small to span the endpoints.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }

  const sign = largeArc !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;

  const cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2;

  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const pts: XY[] = [];
  for (let k = 1; k <= n; k++) {
    const theta = theta1 + (dTheta * k) / n;
    const x = cx + rx * Math.cos(theta) * cosP - ry * Math.sin(theta) * sinP;
    const y = cy + rx * Math.cos(theta) * sinP + ry * Math.sin(theta) * cosP;
    pts.push({ x, y });
  }
  return pts;
}

// Build a map of CSS class name → fill color from <style> blocks in the SVG document.
// Illustrator exports use this pattern: .st0{fill:#FF8C00;} applied via class="st0".
export function buildCssClassMap(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  doc.querySelectorAll('style').forEach(styleEl => {
    const text = styleEl.textContent ?? '';
    // Match .className { ... fill: #hex or rgb(...) ... }
    const ruleRe = /\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = ruleRe.exec(text)) !== null) {
      const className = match[1];
      const body = match[2];
      const fillMatch = body.match(/fill\s*:\s*([^;}\s]+)/);
      if (fillMatch) map.set(className, fillMatch[1].trim());
    }
  });
  if (DEBUG_SVG_NAPLPS && map.size > 0) console.log(`[svgToNaplps] CSS class fills found:`, Object.fromEntries(map));
  return map;
}

// Walk up the DOM to find the nearest fill color, checking inline attributes,
// CSS class map (for Illustrator exports), and parent elements.
export function resolveFill(el: Element, cssMap: Map<string, string>): string {
  let node: Element | null = el;
  while (node) {
    // 1. Inline fill attribute
    const fill = node.getAttribute('fill');
    if (fill && fill !== 'inherit') return fill.trim();
    // 2. Inline style attribute
    const styleFill = node.getAttribute('style')?.match(/fill:\s*([^;]+)/)?.[1];
    if (styleFill) return styleFill.trim();
    // 3. CSS class map (Illustrator .stN classes)
    const classes = (node.getAttribute('class') ?? '').split(/\s+/);
    for (const cls of classes) {
      const mapped = cssMap.get(cls);
      if (mapped) return mapped;
    }
    node = node.parentElement;
  }
  return '#000000';
}

// If 4 points form an axis-aligned rectangle, return it as a Rectangle; otherwise null.
export function extractRectIfAxisAligned(points: Array<{ x: number; y: number }>, color: string): Rectangle | null {
  if (points.length !== 4) return null;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (xMax <= xMin || yMax <= yMin) return null;
  const tol = 0.5; // pixel tolerance for floating-point imprecision
  const allAtCorners = points.every(p =>
    (Math.abs(p.x - xMin) < tol || Math.abs(p.x - xMax) < tol) &&
    (Math.abs(p.y - yMin) < tol || Math.abs(p.y - yMax) < tol)
  );
  if (!allAtCorners) return null;
  return { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin, color };
}

// Parse SVG <path> elements into rects (axis-aligned 4-point paths) and polygons.
// Handles: M/m (moveto), L/l (lineto), H/h (horiz), V/v (vert), Z/z (close)
export function parseSvgToPaths(doc: Document, cssMap: Map<string, string>): { rects: Rectangle[], polygons: PolygonShape[] } {
  const rects: Rectangle[] = [];
  const shapes: PolygonShape[] = [];

  const pathEls = doc.querySelectorAll('path');
  if (DEBUG_SVG_NAPLPS) console.log(`[svgToNaplps] <path> elements found: ${pathEls.length}`);

  pathEls.forEach((el, elIdx) => {
    const d = el.getAttribute('d') ?? '';
    const rawColor = resolveFill(el, cssMap);
    if (!d) {
      if (DEBUG_SVG_NAPLPS) console.warn(`[svgToNaplps] path[${elIdx}] has empty d attribute, skipping`);
      return;
    }
    if (rawColor === 'none') {
      if (DEBUG_SVG_NAPLPS) console.warn(`[svgToNaplps] path[${elIdx}] fill:none, skipping`);
      return;
    }
    const color = rawColor;

    const commands = tokenizePathD(d);
    if (DEBUG_SVG_NAPLPS) console.log(`[svgToNaplps] path[${elIdx}] color=${color} commands:`, commands.map(([c, a]) => `${c}(${a.join(',')})`).join(' '));

    // Walk commands, building subpaths
    let cx = 0, cy = 0;           // current point
    let subpathStart = { x: 0, y: 0 };
    let currentPoints: Array<{ x: number; y: number }> = [];
    const skippedCommands: string[] = [];
    let subpathsEmitted = 0;
    // Last cubic/quadratic control points (absolute), for S/T smooth reflection.
    // Non-null only while the previous command was the matching curve type.
    let prevCubicCtrl: XY | null = null;
    let prevQuadCtrl: XY | null = null;

    const emitSubpath = (reason: string) => {
      if (currentPoints.length >= 3) {
        const rect = extractRectIfAxisAligned(currentPoints, color);
        if (rect) {
          rects.push(rect);
          if (DEBUG_SVG_NAPLPS) console.log(`[svgToNaplps] path[${elIdx}] subpath closed (${reason}): 4 axis-aligned pts → rect x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}`);
        } else {
          shapes.push({ points: [...currentPoints], color });
          if (DEBUG_SVG_NAPLPS) console.log(`[svgToNaplps] path[${elIdx}] subpath closed (${reason}): ${currentPoints.length} points → polygon #${shapes.length}`);
        }
        subpathsEmitted++;
      } else if (currentPoints.length > 0) {
        if (DEBUG_SVG_NAPLPS) console.warn(`[svgToNaplps] path[${elIdx}] subpath closed (${reason}) but only ${currentPoints.length} point(s) — skipped (need ≥3)`);
      }
      currentPoints = [];
    };

    const pushPts = (pts: XY[]) => { for (const p of pts) currentPoints.push(p); };

    for (const [cmd, args] of commands) {
      // Any non-cubic command clears the cubic reflection point, and vice versa.
      if (!'CcSs'.includes(cmd)) prevCubicCtrl = null;
      if (!'QqTt'.includes(cmd)) prevQuadCtrl = null;

      switch (cmd) {
        case 'M': {
          // Close any open subpath before starting a new one
          if (currentPoints.length > 0) emitSubpath('new M');
          cx = args[0]; cy = args[1];
          subpathStart = { x: cx, y: cy };
          currentPoints = [{ x: cx, y: cy }];
          // Subsequent pairs after the first M are implicit L
          for (let i = 2; i + 1 < args.length; i += 2) {
            cx = args[i]; cy = args[i + 1];
            currentPoints.push({ x: cx, y: cy });
          }
          break;
        }
        case 'm': {
          if (currentPoints.length > 0) emitSubpath('new m');
          cx += args[0]; cy += args[1];
          subpathStart = { x: cx, y: cy };
          currentPoints = [{ x: cx, y: cy }];
          for (let i = 2; i + 1 < args.length; i += 2) {
            cx += args[i]; cy += args[i + 1];
            currentPoints.push({ x: cx, y: cy });
          }
          break;
        }
        case 'L': {
          for (let i = 0; i + 1 < args.length; i += 2) {
            cx = args[i]; cy = args[i + 1];
            currentPoints.push({ x: cx, y: cy });
          }
          break;
        }
        case 'l': {
          for (let i = 0; i + 1 < args.length; i += 2) {
            cx += args[i]; cy += args[i + 1];
            currentPoints.push({ x: cx, y: cy });
          }
          break;
        }
        case 'H': {
          for (const x of args) {
            cx = x;
            currentPoints.push({ x: cx, y: cy });
          }
          break;
        }
        case 'h': {
          for (const dx of args) {
            cx += dx;
            currentPoints.push({ x: cx, y: cy });
          }
          break;
        }
        case 'V': {
          for (const y of args) {
            cy = y;
            currentPoints.push({ x: cx, y: cy });
          }
          break;
        }
        case 'v': {
          for (const dy of args) {
            cy += dy;
            currentPoints.push({ x: cx, y: cy });
          }
          break;
        }
        case 'C': case 'c': {
          const rel = cmd === 'c';
          for (let i = 0; i + 5 < args.length; i += 6) {
            const c1 = { x: (rel ? cx : 0) + args[i],     y: (rel ? cy : 0) + args[i + 1] };
            const c2 = { x: (rel ? cx : 0) + args[i + 2], y: (rel ? cy : 0) + args[i + 3] };
            const end = { x: (rel ? cx : 0) + args[i + 4], y: (rel ? cy : 0) + args[i + 5] };
            pushPts(sampleCubic({ x: cx, y: cy }, c1, c2, end));
            cx = end.x; cy = end.y; prevCubicCtrl = c2;
          }
          break;
        }
        case 'S': case 's': {
          const rel = cmd === 's';
          for (let i = 0; i + 3 < args.length; i += 4) {
            const c1: XY = prevCubicCtrl
              ? { x: 2 * cx - prevCubicCtrl.x, y: 2 * cy - prevCubicCtrl.y }
              : { x: cx, y: cy };
            const c2 = { x: (rel ? cx : 0) + args[i],     y: (rel ? cy : 0) + args[i + 1] };
            const end = { x: (rel ? cx : 0) + args[i + 2], y: (rel ? cy : 0) + args[i + 3] };
            pushPts(sampleCubic({ x: cx, y: cy }, c1, c2, end));
            cx = end.x; cy = end.y; prevCubicCtrl = c2;
          }
          break;
        }
        case 'Q': case 'q': {
          const rel = cmd === 'q';
          for (let i = 0; i + 3 < args.length; i += 4) {
            const c = { x: (rel ? cx : 0) + args[i],     y: (rel ? cy : 0) + args[i + 1] };
            const end = { x: (rel ? cx : 0) + args[i + 2], y: (rel ? cy : 0) + args[i + 3] };
            pushPts(sampleQuad({ x: cx, y: cy }, c, end));
            cx = end.x; cy = end.y; prevQuadCtrl = c;
          }
          break;
        }
        case 'T': case 't': {
          const rel = cmd === 't';
          for (let i = 0; i + 1 < args.length; i += 2) {
            const c: XY = prevQuadCtrl
              ? { x: 2 * cx - prevQuadCtrl.x, y: 2 * cy - prevQuadCtrl.y }
              : { x: cx, y: cy };
            const end = { x: (rel ? cx : 0) + args[i], y: (rel ? cy : 0) + args[i + 1] };
            pushPts(sampleQuad({ x: cx, y: cy }, c, end));
            cx = end.x; cy = end.y; prevQuadCtrl = c;
          }
          break;
        }
        case 'A': case 'a': {
          const rel = cmd === 'a';
          for (let i = 0; i + 6 < args.length; i += 7) {
            const end = { x: (rel ? cx : 0) + args[i + 5], y: (rel ? cy : 0) + args[i + 6] };
            pushPts(sampleArc(
              { x: cx, y: cy }, args[i], args[i + 1], args[i + 2],
              args[i + 3] !== 0, args[i + 4] !== 0, end,
            ));
            cx = end.x; cy = end.y;
          }
          break;
        }
        case 'Z':
        case 'z': {
          cx = subpathStart.x; cy = subpathStart.y;
          emitSubpath('Z');
          break;
        }
        default: {
          if (!skippedCommands.includes(cmd)) skippedCommands.push(cmd);
          break;
        }
      }
    }

    // Emit any unclosed trailing subpath
    if (currentPoints.length >= 3) {
      if (DEBUG_SVG_NAPLPS) console.warn(`[svgToNaplps] path[${elIdx}] has unclosed subpath (no Z) — emitting anyway (${currentPoints.length} pts)`);
      emitSubpath('end-of-path');
    }

    if (skippedCommands.length > 0) {
      console.warn(`[svgToNaplps] path[${elIdx}] unsupported commands skipped: ${skippedCommands.join(', ')}`);
    }
    if (DEBUG_SVG_NAPLPS) console.log(`[svgToNaplps] path[${elIdx}] → ${subpathsEmitted} shape(s) emitted`);
  });

  if (DEBUG_SVG_NAPLPS) console.log(`[svgToNaplps] parseSvgToPaths: ${rects.length} rects, ${shapes.length} polygons`);
  return { rects, polygons: shapes };
}

// Telidon 16-color palette (exact values from Telidon specification)
const TELIDON_PALETTE = [
  { r: 0, g: 0, b: 0 },         // 0: Black
  { r: 0, g: 0, b: 255 },       // 1: Blue
  { r: 0, g: 255, b: 0 },       // 2: Green
  { r: 0, g: 255, b: 255 },     // 3: Cyan
  { r: 255, g: 0, b: 0 },       // 4: Red
  { r: 255, g: 0, b: 255 },     // 5: Magenta
  { r: 165, g: 42, b: 42 },     // 6: Brown
  { r: 192, g: 192, b: 192 },   // 7: Light Gray
  { r: 128, g: 128, b: 128 },   // 8: Dark Gray
  { r: 0, g: 0, b: 255 },       // 9: Light Blue
  { r: 0, g: 255, b: 0 },       // 10: Light Green
  { r: 0, g: 255, b: 255 },     // 11: Light Cyan
  { r: 255, g: 0, b: 0 },       // 12: Light Red
  { r: 255, g: 0, b: 255 },     // 13: Light Magenta
  { r: 255, g: 255, b: 0 },     // 14: Yellow
  { r: 255, g: 255, b: 255 },   // 15: White
];

// Extract <rect> elements as pixel rectangles
function parseSvgToPixels(doc: Document, cssMap: Map<string, string>): Rectangle[] {
  const rects = doc.querySelectorAll('rect');
  const rectangles: Rectangle[] = [];
  rects.forEach(rect => {
    const x      = parseInt(rect.getAttribute('x')      || '0');
    const y      = parseInt(rect.getAttribute('y')      || '0');
    const width  = parseInt(rect.getAttribute('width')  || '1');
    const height = parseInt(rect.getAttribute('height') || '1');
    const color  = resolveFill(rect, cssMap);
    rectangles.push({ x, y, width, height, color });
  });

  return rectangles;
}


export function parseColor(color: string): NAPLPSColor {
  const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10)
    };
  }
  const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (hexMatch) {
    return {
      r: parseInt(hexMatch[1], 16),
      g: parseInt(hexMatch[2], 16),
      b: parseInt(hexMatch[3], 16)
    };
  }
  console.warn('Unrecognized color format:', color);
  return { r: 0, g: 0, b: 0 };
}

// Find closest color in Telidon palette using perceptual (Lab) distance
function quantizeColor(color: NAPLPSColor): NAPLPSColor {
  let bestIndex = 0;
  let minDistance = Infinity;

  for (let i = 0; i < TELIDON_PALETTE.length; i++) {
    const paletteColor = TELIDON_PALETTE[i];
    const distance = calculateColorDistance(color, paletteColor);
    if (distance < minDistance) {
      minDistance = distance;
      bestIndex = i;
    }
  }

  return TELIDON_PALETTE[bestIndex];
}

function calculateColorDistance(color1: NAPLPSColor, color2: NAPLPSColor): number {
  const lab1 = rgbToLab(color1);
  const lab2 = rgbToLab(color2);

  const deltaL = lab1.L - lab2.L;
  const deltaA = lab1.a - lab2.a;
  const deltaB = lab1.b - lab2.b;

  return Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB);
}

function rgbToLab(rgb: NAPLPSColor): { L: number, a: number, b: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const x = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = 0.0193 * r + 0.1192 * g + 0.9505 * b;

  const L = 116 * Math.pow(y, 1/3) - 16;
  const a = 500 * (Math.pow(x, 1/3) - Math.pow(y, 1/3));
  const b_val = 200 * (Math.pow(y, 1/3) - Math.pow(z, 1/3));

  return { L, a, b: b_val };
}

// Single vertical+horizontal merge pass
function mergeOnce(rectangles: Rectangle[]): Rectangle[] {
  // Pass 1 — vertical: same color, x, width — adjacent rows
  const vertGroups = new Map<string, Rectangle[]>();
  for (const rect of rectangles) {
    const key = `${rect.color}:${rect.x}:${rect.width}`;
    if (!vertGroups.has(key)) vertGroups.set(key, []);
    vertGroups.get(key)!.push(rect);
  }

  const afterVert: Rectangle[] = [];
  for (const group of vertGroups.values()) {
    group.sort((a, b) => a.y - b.y);
    let cur = { ...group[0] };
    for (let i = 1; i < group.length; i++) {
      if (cur.y + cur.height === group[i].y) {
        cur.height += group[i].height;
      } else {
        afterVert.push(cur);
        cur = { ...group[i] };
      }
    }
    afterVert.push(cur);
  }

  // Pass 2 — horizontal: same color, y, height — adjacent columns
  const horizGroups = new Map<string, Rectangle[]>();
  for (const rect of afterVert) {
    const key = `${rect.color}:${rect.y}:${rect.height}`;
    if (!horizGroups.has(key)) horizGroups.set(key, []);
    horizGroups.get(key)!.push(rect);
  }

  const result: Rectangle[] = [];
  for (const group of horizGroups.values()) {
    group.sort((a, b) => a.x - b.x);
    let cur = { ...group[0] };
    for (let i = 1; i < group.length; i++) {
      if (cur.x + cur.width === group[i].x) {
        cur.width += group[i].width;
      } else {
        result.push(cur);
        cur = { ...group[i] };
      }
    }
    result.push(cur);
  }

  return result;
}

// Iteratively merge until no further reduction (each pass can unlock new merges)
export function optimizeRectangles(rectangles: Rectangle[]): Rectangle[] {
  let cur = rectangles;
  let prev = Infinity;
  while (cur.length < prev) {
    prev = cur.length;
    cur = mergeOnce(cur);
  }
  return cur;
}

// Scale coordinates to 0–63 NAPLPS grid
function scaleCoordinates(rectangles: Rectangle[], maxWidth: number, maxHeight: number): Rectangle[] {
  const scaleFactorX = 63 / maxWidth;
  const scaleFactorY = 63 / maxHeight;

  return rectangles.map(rect => {
    const scaledRect = {
      ...rect,
      x: Math.round(rect.x * scaleFactorX),
      y: Math.round(rect.y * scaleFactorY),
      width: Math.max(1, Math.round(rect.width * scaleFactorX)),
      height: Math.max(1, Math.round(rect.height * scaleFactorY))
    };

    scaledRect.x = Math.max(0, Math.min(63, scaledRect.x));
    scaledRect.y = Math.max(0, Math.min(63, scaledRect.y));
    scaledRect.width = Math.max(1, Math.min(63 - scaledRect.x, scaledRect.width));
    scaledRect.height = Math.max(1, Math.min(63 - scaledRect.y, scaledRect.height));

    return scaledRect;
  });
}

export async function svgToNaplps(svgString: string, width: number, height: number): Promise<string> {
  try {
    const { doc, cssMap } = parseSvgDocument(svgString);
    let rectangles = parseSvgToPixels(doc, cssMap);
    if (rectangles.length === 0) {
      throw new Error('SVG contains no <rect> elements — output would be empty.');
    }
    rectangles = optimizeRectangles(rectangles);
    rectangles = scaleCoordinates(rectangles, width, height);

    const encoder = new NAPLPSEncoder(64, 64);

    for (const rect of rectangles) {
      const originalColor = parseColor(rect.color);
      const quantizedColor = quantizeColor(originalColor);

      const topLeft: NAPLPSPoint = { x: rect.x, y: rect.y };
      const bottomRight: NAPLPSPoint = {
        x: rect.x + rect.width - 1,
        y: rect.y + rect.height - 1
      };

      encoder.setColor(quantizedColor);
      encoder.addRectangle(topLeft, bottomRight);
    }

    return encoder.getHexString();
  } catch (error) {
    console.error('Error in svgToNaplps:', error);
    throw error;
  }
}

export async function svgToNaplpsFoxtoolbox(svgString: string, width: number, height: number): Promise<string> {
  try {
    const { doc, cssMap } = parseSvgDocument(svgString);
    let rectangles = parseSvgToPixels(doc, cssMap);
    const rectsBefore = rectangles.length;
    const polygons = parseSvgToPolygons(doc, cssMap);
    const circles  = parseSvgToCirclesAndEllipses(doc, cssMap);
    const { rects: pathRects, polygons: paths } = parseSvgToPaths(doc, cssMap);
    // Merge all rects together (native + recovered from paths) in one pass
    rectangles = optimizeRectangles([...rectangles, ...pathRects]);

    if (DEBUG_SVG_NAPLPS) {
      console.log('[svgToNaplps] shape counts:', {
        rects_raw: rectsBefore,
        rects_from_paths: pathRects.length,
        rects_merged: rectangles.length,
        polygons: polygons.length,
        circles_ellipses: circles.length,
        path_polygons: paths.length,
      });
    }

    if (rectangles.length === 0 && polygons.length === 0 && circles.length === 0 && paths.length === 0) {
      throw new Error('SVG contains no supported shapes (<rect>, <polygon>, <polyline>, <circle>, <ellipse>, <path>) — output would be empty.');
    }

    const encoder = new NAPLPSFoxtoolboxEncoder();

    // Sort by color so we minimize setColor calls (one per unique color instead of one per rect)
    rectangles.sort((a, b) => (a.color < b.color ? -1 : a.color > b.color ? 1 : 0));

    let lastColorKey = '';
    for (const rect of rectangles) {
      if (rect.color !== lastColorKey) {
        encoder.setColor(parseColor(rect.color));
        lastColorKey = rect.color;
      }
      encoder.addFilledRectangle(
        { x: rect.x / width, y: rect.y / height },
        { x: (rect.x + rect.width) / width, y: (rect.y + rect.height) / height }
      );
    }

    let totalPointsBefore = 0, totalPointsAfter = 0;

    for (const shape of polygons) {
      const simplified = dpSimplify(shape.points, DP_TOLERANCE);
      if (DEBUG_SVG_NAPLPS) {
        totalPointsBefore += shape.points.length;
        totalPointsAfter += simplified.length;
        console.log(`[svgToNaplps] polygon: color=${shape.color} pts ${shape.points.length}→${simplified.length}`);
      }
      if (simplified.length < 3) continue;
      encoder.setColor(parseColor(shape.color));
      encoder.addPolygon(simplified.map(p => ({ x: p.x / width, y: p.y / height })));
    }

    for (const shape of circles) {
      // Circles are already 24-point approximations — no simplification needed
      if (DEBUG_SVG_NAPLPS) console.log(`[svgToNaplps] circle/ellipse: color=${shape.color} points=${shape.points.length}`);
      encoder.setColor(parseColor(shape.color));
      encoder.addPolygon(shape.points.map(p => ({ x: p.x / width, y: p.y / height })));
    }

    for (const shape of paths) {
      const simplified = dpSimplify(shape.points, DP_TOLERANCE);
      if (DEBUG_SVG_NAPLPS) {
        totalPointsBefore += shape.points.length;
        totalPointsAfter += simplified.length;
        console.log(`[svgToNaplps] path polygon: color=${shape.color} pts ${shape.points.length}→${simplified.length}`);
      }
      if (simplified.length < 3) continue;
      encoder.setColor(parseColor(shape.color));
      encoder.addPolygon(simplified.map(p => ({ x: p.x / width, y: p.y / height })));
    }

    if (DEBUG_SVG_NAPLPS) console.log(`[svgToNaplps] polygon points total: ${totalPointsBefore} → ${totalPointsAfter} (${((1 - totalPointsAfter / totalPointsBefore) * 100).toFixed(1)}% reduction)`);

    encoder.endGraphics();
    const hexResult = encoder.getHexString();
    if (DEBUG_SVG_NAPLPS) console.log(`[svgToNaplps] output bytes: ${hexResult.length / 2}`);
    return hexResult;
  } catch (error) {
    console.error('Error in svgToNaplpsFoxtoolbox:', error);
    throw error;
  }
}

// Convert an SVG (e.g. from a traced PNG) into a REAL standard NAPLPS .nap byte
// stream — interleaved coordinates + indexed palette, readable by period tools —
// using the standard encoder. This is the counterpart to svgToNaplpsFoxtoolbox,
// which emits the app's own TelidonP5 dialect instead.
export async function svgToNaplpsStandard(
  svgString: string,
  width: number,
  height: number,
  opts: { maxColors?: number; fieldHeight?: number; margin?: number; texts?: NapText[]; minShapeArea?: number; excludeFills?: string[] } = {},
): Promise<Uint8Array> {
  const { doc, cssMap } = parseSvgDocument(svgString);
  const rects = optimizeRectangles([
    ...parseSvgToPixels(doc, cssMap),
    ...parseSvgToPaths(doc, cssMap).rects,
  ]);
  const polygons = parseSvgToPolygons(doc, cssMap);
  const circles = parseSvgToCirclesAndEllipses(doc, cssMap);
  const paths = parseSvgToPaths(doc, cssMap).polygons;

  if (rects.length === 0 && polygons.length === 0 && circles.length === 0 && paths.length === 0) {
    throw new Error('SVG contains no supported shapes — standard .nap output would be empty.');
  }

  // Map the SVG into NAPLPS coordinates. NAPLPS works in a 0..1 unit square with
  // Y pointing up, but period viewers (TURSHOW) only display Y up to ~0.75 (the
  // 4:3 field) — content above that is clipped off the top. So fit the image,
  // preserving its aspect ratio, into a margined box inside that visible field
  // and centre it (letterbox), rather than stretching it to the full square.
  // This also keeps shapes off the exact 0/1 edges, avoiding full-span deltas.
  const fieldH = opts.fieldHeight ?? 0.75;
  const m = opts.margin ?? 0.03;
  const boxX0 = m, boxY0 = m, boxW = 1 - 2 * m, boxH = fieldH - 2 * m;
  const pxPerUnit = Math.max(width / boxW, height / boxH); // isotropic fit
  const contentW = width / pxPerUnit, contentH = height / pxPerUnit;
  const xOff = boxX0 + (boxW - contentW) / 2;
  const yOff = boxY0 + (boxH - contentH) / 2; // NAPLPS-Y of the content's bottom
  const norm = (p: { x: number; y: number }): NapPoint => ({
    x: xOff + (p.x / width) * contentW,
    y: yOff + (1 - p.y / height) * contentH,
  });
  const toColor = (c: string): NapColor => {
    const k = parseColor(c);
    return { r: k.r, g: k.g, b: k.b };
  };
  // Colours to drop from the graphic (e.g. '#000000' for the black-default
  // fragments left by traced text, when that text is being supplied as font
  // text instead). Fill-less SVG shapes resolve to black via resolveFill.
  const excluded = (opts.excludeFills ?? []).map(toColor);
  const isExcluded = (c: NapColor) => excluded.some(e => e.r === c.r && e.g === c.g && e.b === c.b);

  // Despeckle: drop shapes whose pixel-space bounding box is below this area.
  // Traced rasterized text/anti-aliasing leaves hundreds of tiny fragments; the
  // real graphic is a few large regions, so a modest threshold strips the junk.
  const minArea = opts.minShapeArea ?? 0;
  const bboxArea = (pts: { x: number; y: number }[]) => {
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const p of pts) { if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x; if (p.y < mny) mny = p.y; if (p.y > mxy) mxy = p.y; }
    return (mxx - mnx) * (mxy - mny);
  };

  const shapes: NapShape[] = [];
  for (const r of rects) {
    if (r.width * r.height < minArea) continue;
    const color = toColor(r.color);
    if (isExcluded(color)) continue;
    shapes.push({
      type: 'polygon',
      filled: true,
      color,
      points: [
        norm({ x: r.x, y: r.y }),
        norm({ x: r.x + r.width, y: r.y }),
        norm({ x: r.x + r.width, y: r.y + r.height }),
        norm({ x: r.x, y: r.y + r.height }),
      ],
    });
  }
  for (const shape of [...polygons, ...paths]) {
    const simplified = dpSimplify(shape.points, DP_TOLERANCE);
    if (simplified.length < 3) continue;
    if (bboxArea(simplified) < minArea) continue;
    const color = toColor(shape.color);
    if (isExcluded(color)) continue;
    shapes.push({ type: 'polygon', filled: true, color, points: simplified.map(norm) });
  }
  for (const shape of circles) {
    if (bboxArea(shape.points) < minArea) continue;
    const color = toColor(shape.color);
    if (isExcluded(color)) continue;
    shapes.push({ type: 'polygon', filled: true, color, points: shape.points.map(norm) });
  }

  return encodeNaplpsStandard(shapes, { maxColors: opts.maxColors, texts: opts.texts }).bytes;
}

// Get statistics about the conversion
export function getConversionStats(svgString: string): {
  totalPixels: number;
  totalRectangles: number;
  optimizedRectangles: number;
  compressionRatio: number;
  optimizationRatio: number;
} {
  const { doc, cssMap } = parseSvgDocument(svgString);
  const totalPixels = doc.querySelectorAll('rect').length;

  // Count every shape the encoder will emit, not just native <rect>s: rects
  // recovered from <path>, plus polygons / circles / path-polygons.
  const { rects: pathRects, polygons: pathPolys } = parseSvgToPaths(doc, cssMap);
  const allRects = [...parseSvgToPixels(doc, cssMap), ...pathRects];
  const otherShapes =
    parseSvgToPolygons(doc, cssMap).length +
    parseSvgToCirclesAndEllipses(doc, cssMap).length +
    pathPolys.length;

  const totalRectangles = allRects.length + otherShapes;                  // before rect merge
  const optimizedRectangles = optimizeRectangles(allRects).length + otherShapes; // what gets encoded

  const compressionRatio = totalPixels > 0 ? totalRectangles / totalPixels : 0;
  const optimizationRatio = totalRectangles > 0 ? optimizedRectangles / totalRectangles : 0;

  return {
    totalPixels,
    totalRectangles,
    optimizedRectangles,
    compressionRatio,
    optimizationRatio
  };
}
