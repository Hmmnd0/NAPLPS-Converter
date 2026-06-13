'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { NAPLPSFoxtoolboxEncoder } from '@/lib/naplps-foxtoolbox';

// ── Types ─────────────────────────────────────────────────────────────────────

type RectShape    = { type: 'rect';    x1: number; y1: number; x2: number; y2: number; color: string };
type PolygonShape = { type: 'polygon'; points: { x: number; y: number }[];   color: string };
type Shape = RectShape | PolygonShape;
type Tool  = 'pick' | 'rect' | 'polygon';

type FillResult = {
  mask: Uint8Array;
  x1: number; y1: number; x2: number; y2: number;
  r: number; g: number; b: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.substr(i, 2), 16);
  return b;
}
function downloadBinary(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── SVG shape importer ────────────────────────────────────────────────────────

function normaliseFill(fill: string | null): string {
  if (!fill || fill === 'none') return '#000000';
  const rgb = fill.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  if (fill.startsWith('#')) return fill.toLowerCase();
  return '#000000';
}

// Parse a simple SVG path (M/L/Z commands only — output of Inkscape Path > Union on rects)
function parseSvgPath(d: string): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const tokens = d.trim().match(/[MLZmlz]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g) || [];
  let i = 0, cx = 0, cy = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'L') {
      cx = Number(tokens[i++]); cy = Number(tokens[i++]);
      pts.push({ x: cx, y: cy });
    } else if (cmd === 'm' || cmd === 'l') {
      cx += Number(tokens[i++]); cy += Number(tokens[i++]);
      pts.push({ x: cx, y: cy });
    } else if (cmd === 'Z' || cmd === 'z') {
      // close path — ignore, polygon is implicitly closed
    }
  }
  return pts;
}

async function importShapesFromSvg(file: File): Promise<Shape[]> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return [];

  const vb = svgEl.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  const svgW = vb ? vb[2] : Number(svgEl.getAttribute('width') || 560);
  const svgH = vb ? vb[3] : Number(svgEl.getAttribute('height') || 420);

  type ColoredShape = { color: string; area: number; shape: Shape };
  const results: ColoredShape[] = [];

  // ── <rect> elements (original SVG converter output) ──────────────────────
  type R = { x: number; y: number; w: number; h: number; color: string };
  const allRects: R[] = [];
  for (const el of doc.querySelectorAll('rect')) {
    const x = Number(el.getAttribute('x') || 0);
    const y = Number(el.getAttribute('y') || 0);
    const w = Number(el.getAttribute('width') || 0);
    const h = Number(el.getAttribute('height') || 0);
    if (w <= 0 || h <= 0) continue;
    const color = normaliseFill(el.getAttribute('fill'));
    allRects.push({ x, y, w, h, color });
  }

  if (allRects.length > 0) {
    const byColor = new Map<string, R[]>();
    for (const r of allRects) {
      if (!byColor.has(r.color)) byColor.set(r.color, []);
      byColor.get(r.color)!.push(r);
    }
    for (const [color, rects] of byColor) {
      const sorted = [...rects].sort((a, b) => a.x - b.x || a.y - b.y);
      const merged: R[] = [];
      for (const r of sorted) {
        const ex = merged.find(m => m.x === r.x && m.w === r.w && Math.abs(m.y + m.h - r.y) < 0.5);
        if (ex) { ex.h += r.h; } else { merged.push({ ...r }); }
      }
      const area = merged.reduce((s, r) => s + r.w * r.h, 0);
      for (const r of merged) {
        results.push({ color, area, shape: { type: 'rect', x1: r.x/svgW, y1: r.y/svgH, x2: (r.x+r.w)/svgW, y2: (r.y+r.h)/svgH, color } });
      }
    }
  }

  // ── <path> elements (Inkscape Path > Union output) ────────────────────────
  for (const el of doc.querySelectorAll('path')) {
    const d = el.getAttribute('d') || '';
    // Resolve fill: check element then parent <g>
    let fillAttr = el.getAttribute('fill');
    if (!fillAttr || fillAttr === 'none') {
      fillAttr = el.closest('g')?.getAttribute('fill') ?? null;
    }
    // Also check style attribute
    if (!fillAttr || fillAttr === 'none') {
      const styleMatch = (el.getAttribute('style') || '').match(/fill\s*:\s*([^;]+)/);
      if (styleMatch) fillAttr = styleMatch[1].trim();
    }
    const color = normaliseFill(fillAttr);
    const pts = parseSvgPath(d);
    if (pts.length < 3) continue;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const area = (maxX - minX) * (maxY - minY);
    results.push({ color, area, shape: { type: 'rect', x1: minX/svgW, y1: minY/svgH, x2: maxX/svgW, y2: maxY/svgH, color } });
  }

  // Sort largest area first (background drawn first in NAPLPS)
  results.sort((a, b) => b.area - a.area);
  return results.map(r => r.shape);
}

// ── Flood fill ────────────────────────────────────────────────────────────────

function floodFill(
  data: Uint8ClampedArray, width: number, height: number,
  startX: number, startY: number, tolerance: number
): FillResult | null {
  const si = (startY * width + startX) * 4;
  const tr = data[si], tg = data[si + 1], tb = data[si + 2];
  if (data[si + 3] === 0) return null;

  const mask    = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const stack   = new Int32Array(width * height);
  let top = 0;
  const start = startY * width + startX;
  stack[top++] = start; visited[start] = 1;

  let x1 = startX, y1 = startY, x2 = startX, y2 = startY;

  while (top > 0) {
    const pos = stack[--top];
    const px = pos % width, py = (pos - px) / width;
    mask[pos] = 1;
    if (px < x1) x1 = px; if (px > x2) x2 = px;
    if (py < y1) y1 = py; if (py > y2) y2 = py;

    for (const n of [
      px > 0         ? pos - 1     : -1,
      px < width - 1 ? pos + 1     : -1,
      py > 0         ? pos - width : -1,
      py < height-1  ? pos + width : -1,
    ]) {
      if (n < 0 || visited[n]) continue;
      const ni = n * 4;
      const dr = data[ni] - tr, dg = data[ni+1] - tg, db = data[ni+2] - tb;
      if (Math.sqrt(dr*dr + dg*dg + db*db) <= tolerance) { visited[n] = 1; stack[top++] = n; }
    }
  }
  return { mask, x1, y1, x2, y2, r: tr, g: tg, b: tb };
}

// ── Douglas-Peucker polyline simplification ───────────────────────────────────

function dpSimplify(pts: Array<{ x: number; y: number }>, tol: number): Array<{ x: number; y: number }> {
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

// ── Trace exact rectilinear outline from flood-fill mask ──────────────────────
// Scans each row for the leftmost/rightmost filled pixel and builds a polygon
// that follows the pixel-boundary edges exactly (no bounding-box approximation).

function traceOutline(
  mask: Uint8Array, width: number,
  x1: number, y1: number, x2: number, y2: number
): Array<{ x: number; y: number }> {
  const rowMin = new Int16Array(y2 - y1 + 1).fill(-1);
  const rowMax = new Int16Array(y2 - y1 + 1).fill(-1);

  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (mask[y * width + x]) {
        const ry = y - y1;
        if (rowMin[ry] === -1) rowMin[ry] = x;
        rowMax[ry] = x;
      }
    }
  }

  // Find filled y range
  let minRY = rowMin.length, maxRY = -1;
  for (let ry = 0; ry < rowMin.length; ry++) {
    if (rowMin[ry] !== -1) { if (ry < minRY) minRY = ry; if (ry > maxRY) maxRY = ry; }
  }
  if (maxRY === -1) return [];

  const pts: Array<{ x: number; y: number }> = [];
  const minY2 = y1 + minRY, maxY2 = y1 + maxRY;

  // Left profile: top → bottom
  pts.push({ x: rowMin[minRY], y: minY2 });
  let prevX = rowMin[minRY];
  for (let ry = minRY + 1; ry <= maxRY; ry++) {
    if (rowMin[ry] === -1) continue;
    const curX = rowMin[ry];
    if (curX !== prevX) { pts.push({ x: prevX, y: y1 + ry }); pts.push({ x: curX, y: y1 + ry }); prevX = curX; }
  }

  // Bottom edge
  pts.push({ x: prevX, y: maxY2 + 1 });
  pts.push({ x: rowMax[maxRY] + 1, y: maxY2 + 1 });

  // Right profile: bottom → top
  prevX = rowMax[maxRY] + 1;
  for (let ry = maxRY - 1; ry >= minRY; ry--) {
    if (rowMax[ry] === -1) continue;
    const curX = rowMax[ry] + 1;
    if (curX !== prevX) { pts.push({ x: prevX, y: y1 + ry + 1 }); pts.push({ x: curX, y: y1 + ry + 1 }); prevX = curX; }
  }

  // Top-right corner (close back to start)
  pts.push({ x: rowMax[minRY] + 1, y: minY2 });

  // Simplify: collapse 1-pixel staircase steps (tolerance = 1.5px in HW×HH space)
  return dpSimplify(pts, 1.5);
}

// ── Canvas dimensions ─────────────────────────────────────────────────────────

const DW = 700; const DH = 525; // display canvas (4:3)
const HW = 560; const HH = 420; // hidden canvas / sampling space (4:3)

function clampPan(px: number, py: number, z: number) {
  return {
    x: Math.max(0, Math.min(1 - 1 / z, px)),
    y: Math.max(0, Math.min(1 - 1 / z, py)),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AuthorPage() {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const hiddenRef  = useRef<HTMLCanvasElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement | null>(null);

  // Stable refs for zoom/pan (used in wheel handler without stale closure)
  const zoomRef = useRef(1);
  const panRef  = useRef({ x: 0, y: 0 });

  const [tool, setTool]         = useState<Tool>('pick');
const [color, setColor]       = useState('#ff0000');
  const [opacity, setOpacity]   = useState(0.5);
  const [tolerance, setTolerance] = useState(30);
  const [shapes, setShapes]     = useState<Shape[]>([]);
  const [imageEl, setImageEl]   = useState<HTMLImageElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan]   = useState({ x: 0, y: 0 });
  const spaceRef        = useRef(false);
  const panDragRef      = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  const [pickResult, setPickResult]   = useState<FillResult | null>(null);
  const [pickOutline, setPickOutline] = useState<Array<{ x: number; y: number }> | null>(null);
  const lastPickPx = useRef<{ px: number; py: number } | null>(null);

  const [dragStart, setDragStart]     = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [polyPts, setPolyPts]         = useState<{ x: number; y: number }[]>([]);
  const [mousePos, setMousePos]       = useState<{ x: number; y: number } | null>(null);

  // Recompute outline whenever pick result changes
  useEffect(() => {
    if (!pickResult) { setPickOutline(null); return; }
    const { mask, x1, y1, x2, y2 } = pickResult;
    setPickOutline(traceOutline(mask, HW, x1, y1, x2, y2));
  }, [pickResult]);

  // Keep refs in sync
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  // ── Init mask canvas ──────────────────────────────────────────────────────

  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = HW; c.height = HH;
    maskCanvas.current = c;
  }, []);

  // ── Image upload ──────────────────────────────────────────────────────────

  const [isSvg, setIsSvg] = useState(false);
  const svgFileRef = useRef<File | null>(null);
  const [importing, setImporting] = useState(false);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const svg = file.type === 'image/svg+xml' || file.name.endsWith('.svg');
    setIsSvg(svg);
    svgFileRef.current = svg ? file : null;
    if (svg) setTolerance(0);
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => setImageEl(img);
    img.src = url;
  };

  const handleImportSvg = async () => {
    if (!svgFileRef.current) return;
    setImporting(true);
    try {
      const imported = await importShapesFromSvg(svgFileRef.current);
      setShapes(imported);
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (!imageEl || !hiddenRef.current) return;
    hiddenRef.current.getContext('2d')?.drawImage(imageEl, 0, 0, HW, HH);
  }, [imageEl, isSvg]);

  // ── Coordinate transforms ─────────────────────────────────────────────────

  const displayToNorm = useCallback((cx: number, cy: number) => ({
    x: Math.max(0, Math.min(1, pan.x + cx / (DW * zoom))),
    y: Math.max(0, Math.min(1, pan.y + cy / (DH * zoom))),
  }), [pan, zoom]);

  const normToDisplay = useCallback((nx: number, ny: number) => ({
    cx: (nx - pan.x) * DW * zoom,
    cy: (ny - pan.y) * DH * zoom,
  }), [pan, zoom]);

  const toNorm = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return displayToNorm(e.clientX - r.left, e.clientY - r.top);
  };

  // ── Flood fill on hidden canvas ───────────────────────────────────────────

  const doPick = useCallback((nx: number, ny: number): FillResult | null => {
    if (!hiddenRef.current || !imageEl) return null;
    const ctx = hiddenRef.current.getContext('2d');
    if (!ctx) return null;
    const px = Math.max(0, Math.min(HW - 1, Math.floor(nx * HW)));
    const py = Math.max(0, Math.min(HH - 1, Math.floor(ny * HH)));
    const imageData = ctx.getImageData(0, 0, HW, HH);
    return floodFill(imageData.data, HW, HH, px, py, tolerance);
  }, [imageEl, tolerance]);

  // ── Draw ──────────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, DW, DH);
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, DW, DH);

    // Visible slice of image
    const sx = pan.x, sy = pan.y, sw = 1 / zoom, sh = 1 / zoom;

    if (imageEl) {
      ctx.globalAlpha = opacity;
      ctx.drawImage(imageEl,
        sx * imageEl.naturalWidth, sy * imageEl.naturalHeight,
        sw * imageEl.naturalWidth, sh * imageEl.naturalHeight,
        0, 0, DW, DH
      );
      ctx.globalAlpha = 1;
    }

    // Flood fill mask highlight
    if (pickResult && maskCanvas.current) {
      const mc = maskCanvas.current;
      const mctx = mc.getContext('2d');
      if (mctx) {
        const imgData = mctx.createImageData(HW, HH);
        const { mask, r, g, b } = pickResult;
        for (let i = 0; i < mask.length; i++) {
          if (mask[i]) {
            imgData.data[i * 4]     = r;
            imgData.data[i * 4 + 1] = g;
            imgData.data[i * 4 + 2] = b;
            imgData.data[i * 4 + 3] = 180;
          }
        }
        mctx.putImageData(imgData, 0, 0);
        ctx.drawImage(mc, sx * HW, sy * HH, sw * HW, sh * HH, 0, 0, DW, DH);
      }
    }

    // Committed shapes
    for (const s of shapes) {
      ctx.fillStyle = s.color; ctx.globalAlpha = 0.85;
      if (s.type === 'rect') {
        const { cx: ax, cy: ay } = normToDisplay(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2));
        const { cx: bx, cy: by } = normToDisplay(Math.max(s.x1, s.x2), Math.max(s.y1, s.y2));
        ctx.fillRect(ax, ay, bx - ax, by - ay);
      } else {
        ctx.beginPath();
        const { cx: mx, cy: my } = normToDisplay(s.points[0].x, s.points[0].y);
        ctx.moveTo(mx, my);
        for (const p of s.points.slice(1)) { const { cx, cy } = normToDisplay(p.x, p.y); ctx.lineTo(cx, cy); }
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Pick outline — exact polygon boundary of the selected region
    if (tool === 'pick' && pickOutline && pickOutline.length > 1) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath();
      const { cx: ox, cy: oy } = normToDisplay(pickOutline[0].x / HW, pickOutline[0].y / HH);
      ctx.moveTo(ox, oy);
      for (const p of pickOutline.slice(1)) {
        const { cx, cy } = normToDisplay(p.x / HW, p.y / HH);
        ctx.lineTo(cx, cy);
      }
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    }

    // Rect drag preview
    if (tool === 'rect' && dragStart && dragCurrent) {
      const { cx: ax, cy: ay } = normToDisplay(Math.min(dragStart.x, dragCurrent.x), Math.min(dragStart.y, dragCurrent.y));
      const { cx: bx, cy: by } = normToDisplay(Math.max(dragStart.x, dragCurrent.x), Math.max(dragStart.y, dragCurrent.y));
      ctx.fillStyle = color; ctx.globalAlpha = 0.4; ctx.fillRect(ax, ay, bx-ax, by-ay); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(ax, ay, bx-ax, by-ay);
    }

    // Polygon in-progress
    if (tool === 'polygon' && polyPts.length > 0) {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath();
      const { cx: mx0, cy: my0 } = normToDisplay(polyPts[0].x, polyPts[0].y);
      ctx.moveTo(mx0, my0);
      for (const p of polyPts.slice(1)) { const { cx, cy } = normToDisplay(p.x, p.y); ctx.lineTo(cx, cy); }
      if (mousePos) { const { cx, cy } = normToDisplay(mousePos.x, mousePos.y); ctx.lineTo(cx, cy); }
      ctx.stroke();
      for (const p of polyPts) {
        const { cx, cy } = normToDisplay(p.x, p.y);
        ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }, [shapes, imageEl, opacity, color, tool, dragStart, dragCurrent, polyPts, mousePos,
      pickResult, pickOutline, pan, zoom, normToDisplay]);

  useEffect(() => { draw(); }, [draw]);

  // ── Wheel zoom (stable handler via refs) ──────────────────────────────────

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const z = zoomRef.current;
    const p = panRef.current;
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const newZoom = Math.max(1, Math.min(8, z * factor));
    const nx = p.x + cx / (DW * z);
    const ny = p.y + cy / (DH * z);
    const newPan = clampPan(nx - cx / (DW * newZoom), ny - cy / (DH * newZoom), newZoom);
    setZoom(newZoom);
    setPan(newPan);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Mouse handlers ────────────────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || spaceRef.current) {
      panDragRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
      e.preventDefault(); return;
    }
    if (e.button !== 0) return;
    const pt = toNorm(e);
    if (tool === 'rect') { setDragStart(pt); setDragCurrent(pt); }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (panDragRef.current) {
      const d = panDragRef.current;
      const dx = (e.clientX - d.mx) / (DW * zoom);
      const dy = (e.clientY - d.my) / (DH * zoom);
      setPan(clampPan(d.px - dx, d.py - dy, zoom));
      return;
    }
    const pt = toNorm(e);
    if (tool === 'pick') {
      const px = Math.floor(pt.x * HW), py = Math.floor(pt.y * HH);
      const last = lastPickPx.current;
      if (!last || last.px !== px || last.py !== py) {
        lastPickPx.current = { px, py };
        setPickResult(doPick(pt.x, pt.y));
      }
    }
    if (tool === 'rect' && dragStart) setDragCurrent(pt);
    if (tool === 'polygon') setMousePos(pt);
  };

  const handleMouseUp = () => {
    if (panDragRef.current) { panDragRef.current = null; return; }
    if (tool === 'rect' && dragStart && dragCurrent) {
      if (Math.abs(dragCurrent.x - dragStart.x) > 0.003 && Math.abs(dragCurrent.y - dragStart.y) > 0.003) {
        setShapes(prev => [...prev, { type: 'rect', x1: dragStart.x, y1: dragStart.y, x2: dragCurrent.x, y2: dragCurrent.y, color }]);
      }
      setDragStart(null); setDragCurrent(null);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (panDragRef.current || spaceRef.current) return;
    const pt = toNorm(e);
    if (tool === 'pick' && pickResult && pickOutline) {
      const { x1, y1, x2, y2, r, g, b } = pickResult;
      const col = rgbToHex(r, g, b);
      // Is it a perfect rectangle? (4 unique corners, 2 x-values, 2 y-values)
      const uxs = new Set(pickOutline.map(p => p.x));
      const uys = new Set(pickOutline.map(p => p.y));
      if (uxs.size === 2 && uys.size === 2) {
        // Encode as rect — more compact in NAPLPS
        setShapes(prev => [...prev, { type: 'rect', x1: x1/HW, y1: y1/HH, x2: (x2+1)/HW, y2: (y2+1)/HH, color: col }]);
      } else {
        // Encode as exact polygon
        setShapes(prev => [...prev, { type: 'polygon', points: pickOutline.map(p => ({ x: p.x/HW, y: p.y/HH })), color: col }]);
      }
      setColor(col);
    } else if (tool === 'polygon') {
      setPolyPts(prev => [...prev, pt]);
    }
  };

  const handleDoubleClick = () => {
    if (tool === 'polygon' && polyPts.length >= 3) {
      setShapes(prev => [...prev, { type: 'polygon', points: polyPts, color }]);
      setPolyPts([]);
    }
  };

  const handleMouseLeave = () => {
    panDragRef.current = null;
    if (tool === 'pick') { setPickResult(null); setPickOutline(null); lastPickPx.current = null; }
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === ' ') { e.preventDefault(); spaceRef.current = true; }
    if (e.key === 'Escape') { setPolyPts([]); setDragStart(null); setDragCurrent(null); }
    if (e.key === 'Enter' && polyPts.length >= 3) {
      setShapes(prev => [...prev, { type: 'polygon', points: polyPts, color }]);
      setPolyPts([]);
    }
    if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setShapes(prev => prev.slice(0, -1));
    }
  }, [polyPts, color]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.key === ' ') { spaceRef.current = false; panDragRef.current = null; }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [handleKeyDown, handleKeyUp]);

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = () => {
    if (shapes.length === 0) return;
    const enc = new NAPLPSFoxtoolboxEncoder();
    for (const s of shapes) {
      const [r, g, b] = hexToRgb(s.color);
      enc.setColor({ r, g, b });
      if (s.type === 'rect') {
        enc.addFilledRectangle({ x: Math.min(s.x1,s.x2), y: Math.min(s.y1,s.y2) }, { x: Math.max(s.x1,s.x2), y: Math.max(s.y1,s.y2) });
      } else {
        enc.addPolygon(s.points);
      }
    }
    enc.endGraphics();
    downloadBinary(hexToBytes(enc.getHexString()), 'authored.nap');
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const estBytes = 16 + shapes.length * 14;
  const cursorClass = panDragRef.current ? 'grabbing' : spaceRef.current ? 'grab' : 'crosshair';

  return (
    <div className="min-h-screen bg-gray-900 p-4 text-white">
      <div style={{ maxWidth: DW + 220 }} className="mx-auto">
        <div className="flex items-baseline gap-4 mb-3">
          <h1 className="text-xl font-bold">NAPLPS Authoring Tool</h1>
          <span className="text-xs text-gray-500">Scroll to zoom · Space+drag to pan · ⌘Z undo · Esc cancel</span>
          <span className="ml-auto text-xs text-gray-500">{zoom.toFixed(1)}×</span>
        </div>

        <div className="flex gap-4">

          {/* ── Canvas ───────────────────────────────────────────────────── */}
          <div>
            <canvas ref={hiddenRef} width={HW} height={HH} className="hidden" />
            <canvas
              ref={canvasRef} width={DW} height={DH}
              style={{ width: DW, height: DH, cursor: cursorClass, display: 'block' }}
              className="border border-gray-700 rounded bg-black"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
              onMouseLeave={handleMouseLeave}
              onContextMenu={e => e.preventDefault()}
            />
          </div>

          {/* ── Controls ─────────────────────────────────────────────────── */}
          <div className="w-48 flex flex-col gap-3 text-sm flex-shrink-0">

            {/* Image */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Reference image</label>
              <input type="file" accept="image/*,.svg,image/svg+xml" onChange={handleImageUpload}
                className="w-full text-xs text-gray-400 file:mr-1 file:py-1 file:px-2 file:rounded file:border-0 file:bg-gray-700 file:text-gray-300 file:text-xs cursor-pointer" />
              {isSvg && (
                <button onClick={handleImportSvg} disabled={importing}
                  className="w-full mt-2 py-1.5 text-xs rounded border border-blue-500 bg-blue-900 text-blue-200 hover:bg-blue-800 disabled:opacity-50">
                  {importing ? 'Importing…' : 'Import shapes from SVG'}
                </button>
              )}
              {imageEl && (
                <div className="mt-2">
                  <label className="text-xs text-gray-500">Overlay {Math.round(opacity*100)}%</label>
                  <input type="range" min={0} max={100} value={Math.round(opacity*100)}
                    onChange={e => setOpacity(Number(e.target.value)/100)} className="w-full" />
                </div>
              )}
            </div>

            {/* Tool */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Tool</label>
              <div className="flex gap-1">
                {(['pick','rect','polygon'] as Tool[]).map(t => (
                  <button key={t} onClick={() => { setTool(t); setPolyPts([]); setPickResult(null); setPickOutline(null); lastPickPx.current = null; }}
                    className={`flex-1 py-1.5 text-xs rounded border ${tool===t ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700'}`}>
                    {t==='pick'?'Pick':t==='rect'?'Rect':'Poly'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-600 mt-1">
                {tool==='pick' ? 'Hover=preview · Click=add' : tool==='rect' ? 'Drag to draw' : 'Click pts · Dbl-click close'}
              </p>
            </div>

            {/* Tolerance */}
            {tool === 'pick' && (
              <div>
                <label className="text-xs text-gray-500">Tolerance: {tolerance}</label>
                <input type="range" min={0} max={120} value={tolerance}
                  onChange={e => { setTolerance(Number(e.target.value)); setPickResult(null); lastPickPx.current = null; }}
                  className="w-full" />
                {pickResult && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-5 h-5 rounded border border-gray-600 flex-shrink-0"
                      style={{ backgroundColor: rgbToHex(pickResult.r, pickResult.g, pickResult.b) }} />
                    <span className="text-xs font-mono text-gray-400">{rgbToHex(pickResult.r, pickResult.g, pickResult.b)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Color (rect/polygon) */}
            {tool !== 'pick' && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={color} onChange={e => setColor(e.target.value)}
                    className="w-9 h-7 rounded border border-gray-600 bg-transparent cursor-pointer" />
                  <span className="text-xs font-mono text-gray-400">{color}</span>
                </div>
              </div>
            )}

            {/* Zoom buttons */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Zoom</label>
              <div className="flex gap-1">
                {[1, 2, 4, 8].map(z => (
                  <button key={z} onClick={() => { setZoom(z); setPan(clampPan(pan.x, pan.y, z)); }}
                    className={`flex-1 py-1 text-xs rounded border ${Math.abs(zoom - z) < 0.15 ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700'}`}>
                    {z}×
                  </button>
                ))}
              </div>
              {zoom > 1 && (
                <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
                  className="w-full mt-1 py-1 text-xs rounded border border-gray-600 bg-gray-800 text-gray-400 hover:bg-gray-700">
                  Fit
                </button>
              )}
            </div>

            {/* Shape list */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-400">Shapes ({shapes.length})</label>
                {shapes.length > 0 && (
                  <button onClick={() => setShapes([])} className="text-xs text-red-500 hover:text-red-300">Clear</button>
                )}
              </div>
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {shapes.length === 0 && <p className="text-xs text-gray-600 italic">None yet</p>}
                {shapes.map((s, i) => (
                  <div key={i} className="flex items-center gap-1 bg-gray-800 rounded px-1 py-1 border border-gray-700">
                    <div className="w-4 h-4 rounded-sm flex-shrink-0 border border-gray-600" style={{ backgroundColor: s.color }} />
                    <span className="text-xs text-gray-400 flex-1 truncate px-1">
                      {s.type==='rect' ? 'Rect' : `Poly ${s.points.length}pt`}
                    </span>
                    <div className="flex flex-col gap-0 flex-shrink-0">
                      <button
                        onClick={() => setShapes(prev => { const a = [...prev]; if (i > 0) [a[i-1], a[i]] = [a[i], a[i-1]]; return a; })}
                        disabled={i === 0}
                        className="text-gray-500 hover:text-gray-200 disabled:opacity-20 leading-none text-xs px-0.5">▲</button>
                      <button
                        onClick={() => setShapes(prev => { const a = [...prev]; if (i < a.length-1) [a[i], a[i+1]] = [a[i+1], a[i]]; return a; })}
                        disabled={i === shapes.length - 1}
                        className="text-gray-500 hover:text-gray-200 disabled:opacity-20 leading-none text-xs px-0.5">▼</button>
                    </div>
                    <button onClick={() => setShapes(prev => prev.filter((_, j) => j !== i))}
                      className="text-xs text-red-500 hover:text-red-300 flex-shrink-0">✕</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Export */}
            <div>
              <button onClick={handleExport} disabled={shapes.length === 0}
                className="w-full py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40 text-sm font-medium">
                Export .nap ({shapes.length})
              </button>
              <p className="text-xs text-gray-600 text-center mt-1">
                ~{estBytes < 1024 ? `${estBytes} B` : `${(estBytes/1024).toFixed(1)} KB`}
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
