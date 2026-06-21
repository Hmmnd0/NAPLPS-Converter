"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { decodeNaplpsStandard, type NapShape, type NapColor, type NapPoint } from "@/lib/naplps-std-decoder";
import { encodeNaplpsStandard } from "@/lib/naplps-std-encoder";
import { rasterizeNaplps } from "@/lib/naplpsRaster";

const key = (c: NapColor) => `${c.r},${c.g},${c.b}`;
const hex = (c: NapColor) =>
  "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("");
const dist = (a: NapColor, b: NapColor) =>
  Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

const SELECTED: NapColor = { r: 255, g: 0, b: 255 }; // magenta
const HOVERED: NapColor = { r: 0, g: 230, b: 255 }; // cyan
const dim = (c: NapColor): NapColor => ({ r: Math.round(c.r * 0.22), g: Math.round(c.g * 0.22), b: Math.round(c.b * 0.22) });

// Greedy palette merge: the most-used colours become representatives; any colour
// within `threshold` RGB distance snaps to the nearest. Preserves order/count.
function mergeColors(shapes: NapShape[], threshold: number): NapShape[] {
  if (threshold <= 0) return shapes;
  const counts = new Map<string, { color: NapColor; count: number }>();
  for (const s of shapes) {
    const e = counts.get(key(s.color));
    if (e) e.count++;
    else counts.set(key(s.color), { color: s.color, count: 1 });
  }
  const reps: NapColor[] = [];
  const mapping = new Map<string, NapColor>();
  for (const { color } of [...counts.values()].sort((a, b) => b.count - a.count)) {
    const rep = reps.find((r) => dist(color, r) <= threshold);
    if (rep) mapping.set(key(color), rep);
    else { reps.push(color); mapping.set(key(color), color); }
  }
  return shapes.map((s) => ({ ...s, color: mapping.get(key(s.color)) ?? s.color }));
}

function bbox(points: NapPoint[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
const shapeArea = (s: NapShape) => {
  const b = bbox(s.points);
  return isFinite(b.minX) ? (b.maxX - b.minX) * (b.maxY - b.minY) : 0;
};
// Ray-cast point-in-polygon (works in NAPLPS 0..1 space).
function pointInPoly(pt: NapPoint, poly: NapPoint[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (((a.y > pt.y) !== (b.y > pt.y)) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const uniqueColorCount = (shapes: NapShape[]) => new Set(shapes.map((s) => key(s.color))).size;
const encodedSize = (shapes: NapShape[]) => {
  if (shapes.length === 0) return 0;
  try { return encodeNaplpsStandard(shapes).bytes.length; } catch { return 0; }
};
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export default function Optimizer() {
  const [fileName, setFileName] = useState("");
  const [original, setOriginal] = useState<NapShape[]>([]);
  const [shapes, setShapes] = useState<NapShape[]>([]);
  const [commandCounts, setCommandCounts] = useState<Record<string, number> | null>(null);
  const [threshold, setThreshold] = useState(0);
  const [resolution, setResolution] = useState(256);
  const [pixelated, setPixelated] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  // "Junk size" threshold in per-mille of the field's bbox area; shapes smaller
  // than this are flagged as likely overdraw and can be bulk-selected.
  const [tinyPermille, setTinyPermille] = useState(0.5);
  const [error, setError] = useState("");

  const tinyArea = tinyPermille / 1000;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Projection used by the raster, kept so canvas clicks can be inverted to NAPLPS coords for hit-testing.
  const projRef = useRef<{ W: number; H: number; minX: number; minY: number; spanX: number; spanY: number } | null>(null);

  const preview = useMemo(() => mergeColors(shapes, threshold), [shapes, threshold]);

  const origSize = useMemo(() => encodedSize(original), [original]);
  const newSize = useMemo(() => encodedSize(preview), [preview]);
  const origColors = useMemo(() => uniqueColorCount(original), [original]);
  const newColors = useMemo(() => uniqueColorCount(preview), [preview]);
  const tinyCount = useMemo(() => preview.filter((s) => shapeArea(s) < tinyArea).length, [preview, tinyArea]);

  const palette = useMemo(() => {
    const m = new Map<string, { color: NapColor; count: number }>();
    for (const s of preview) {
      const e = m.get(key(s.color));
      if (e) e.count++;
      else m.set(key(s.color), { color: s.color, count: 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [preview]);

  // Render: dim every shape except the selected (magenta) / hovered (cyan) so the
  // focused shapes pop. No focus → render true colours.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || preview.length === 0) return;
    const focus = selected.size > 0 || hover != null;
    const styled = preview.map((s, i) => {
      if (i === hover) return { ...s, color: HOVERED };
      if (selected.has(i)) return { ...s, color: SELECTED };
      return focus ? { ...s, color: dim(s.color) } : s;
    });
    try {
      const bytes = encodeNaplpsStandard(styled).bytes;
      const { width, height, pixels } = rasterizeNaplps(bytes, { height: resolution });
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
      // Mirror the raster's content-bbox projection so clicks can be inverted.
      const b = bbox(preview.flatMap((s) => s.points));
      projRef.current = {
        W: width, H: height, minX: b.minX, minY: b.minY,
        spanX: (b.maxX - b.minX) || 1, spanY: (b.maxY - b.minY) || 1,
      };
    } catch (e) {
      setError("Render failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [preview, selected, hover, resolution, pixelated]);

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // Click the viewer → select the topmost filled shape under the cursor.
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const proj = projRef.current;
    const canvas = canvasRef.current;
    if (!proj || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pad = 0.5;
    const fx = (e.clientX - rect.left) * (proj.W / rect.width);
    const fy = (e.clientY - rect.top) * (proj.H / rect.height);
    const nx = proj.minX + ((fx - pad) / (proj.W - 1 - 2 * pad)) * proj.spanX;
    const ny = proj.minY + (1 - (fy - pad) / (proj.H - 1 - 2 * pad)) * proj.spanY;
    for (let i = preview.length - 1; i >= 0; i--) {
      const s = preview[i];
      if (s.type === "polygon" && pointInPoly({ x: nx, y: ny }, s.points)) {
        toggle(i);
        document.getElementById(`shape-row-${i}`)?.scrollIntoView({ block: "nearest" });
        return;
      }
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(""); setFileName(file.name); setSelected(new Set()); setHover(null); setThreshold(0);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const bytes = new Uint8Array(ev.target?.result as ArrayBuffer);
        const { shapes: decoded, commandCounts } = decodeNaplpsStandard(bytes);
        if (decoded.length === 0) { setError("No drawable shapes decoded — text-only or unsupported frame."); return; }
        setOriginal(decoded); setShapes(decoded); setCommandCounts(commandCounts);
      } catch (err) {
        setError("Decode failed: " + (err instanceof Error ? err.message : String(err)));
      }
    };
    reader.onerror = () => setError("Could not read file.");
    reader.readAsArrayBuffer(file);
  };

  const applyMerge = () => { setShapes(mergeColors(shapes, threshold)); setThreshold(0); };
  const reset = () => { setShapes(original); setThreshold(0); setSelected(new Set()); setHover(null); };
  const deleteSelected = () => {
    setShapes((prev) => prev.filter((_, j) => !selected.has(j)));
    setSelected(new Set()); setHover(null);
  };
  const selectTiny = () => setSelected(new Set(preview.map((s, i) => (shapeArea(s) < tinyArea ? i : -1)).filter((i) => i >= 0)));
  const move = (i: number, dir: -1 | 1) => {
    setShapes((prev) => {
      const a = [...prev]; const j = i + dir;
      if (j < 0 || j >= a.length) return prev;
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });
    setSelected(new Set()); setHover(null);
  };

  const download = () => {
    try {
      const bytes = encodeNaplpsStandard(preview).bytes;
      const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (fileName.replace(/\.nap$/i, "") || "optimized") + "_optimized.nap";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError("Export failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const loaded = original.length > 0;
  const pct = origSize > 0 ? Math.round((1 - newSize / origSize) * 100) : 0;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">NAPLPS Optimizer</h1>
          <p className="text-zinc-500 mt-2 max-w-2xl">
            Import a real <code className="px-1 py-0.5 rounded bg-zinc-100 text-zinc-700 text-sm font-mono">.nap</code>,
            merge near-duplicate colors, prune overdraw shapes, reorder the draw stack, and re-export a smaller real{" "}
            <code className="px-1 py-0.5 rounded bg-zinc-100 text-zinc-700 text-sm font-mono">.nap</code>. Click a shape in
            the viewer or the list to select it.
          </p>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <label className="btn-primary cursor-pointer">
            Upload .nap
            <input type="file" accept=".nap,application/octet-stream" onChange={handleUpload} className="hidden" />
          </label>
          {fileName && <span className="text-sm text-zinc-500">{fileName}</span>}
          {loaded && (
            <>
              <button onClick={applyMerge} disabled={threshold <= 0} className="btn-ghost">Apply color merge</button>
              <button onClick={reset} className="btn-ghost">Reset</button>
              <button onClick={download} className="btn-accent">Download optimized .nap</button>
            </>
          )}
        </div>

        {loaded && (
          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
            {/* Preview + stats */}
            <div className="space-y-4">
              <div className="card p-4">
                <div className="rounded-xl bg-black flex items-center justify-center overflow-hidden min-h-[280px]">
                  <canvas
                    ref={canvasRef}
                    onClick={handleCanvasClick}
                    className="cursor-crosshair"
                    style={{ maxWidth: "100%", maxHeight: 440, imageRendering: pixelated ? "pixelated" : "auto" }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-5 mt-4 text-sm text-zinc-600">
                  <label className="flex items-center gap-2">
                    <span className="field-label">Resolution</span>
                    <input type="range" min={96} max={512} step={16} value={resolution} onChange={(e) => setResolution(+e.target.value)} />
                    <span className="font-mono w-10 text-zinc-500">{resolution}px</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={pixelated} onChange={(e) => setPixelated(e.target.checked)} />
                    <span className="field-label">Pixelated</span>
                  </label>
                  <span className="text-xs text-zinc-400">Tip: click the art to pick a shape</span>
                </div>
              </div>

              <div className="card p-4 grid grid-cols-3 gap-4 text-center">
                <Stat label="Shapes" before={original.length} after={preview.length} />
                <Stat label="Colors" before={origColors} after={newColors} />
                <Stat label="Size" before={fmtBytes(origSize)} after={fmtBytes(newSize)} highlight={pct > 0 ? `−${pct}%` : undefined} />
              </div>

              {commandCounts && (
                <div className="card p-3 text-xs font-mono text-zinc-500">
                  {Object.entries(commandCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <span key={k} className="inline-block mr-3">{k}:{v}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Palette + shapes */}
            <div className="space-y-4">
              <div className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm text-zinc-800">Palette ({palette.length})</h3>
                  <label className="flex items-center gap-2 text-xs text-zinc-500">
                    Merge ≤
                    <input type="range" min={0} max={150} step={2} value={threshold} onChange={(e) => setThreshold(+e.target.value)} />
                    <span className="font-mono w-6">{threshold}</span>
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {palette.map((p) => (
                    <span key={key(p.color)} title={`${hex(p.color)} · ${p.count} shapes`}
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-200 pl-1 pr-1.5 py-0.5 text-xs text-zinc-600">
                      <span className="w-3.5 h-3.5 rounded-sm border border-zinc-300" style={{ background: hex(p.color) }} />
                      {p.count}
                    </span>
                  ))}
                </div>
              </div>

              <div className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm text-zinc-800">Shapes ({preview.length})</h3>
                  {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="text-xs text-zinc-400 hover:text-zinc-700">Clear selection</button>}
                </div>
                <div className="flex items-center gap-2 mb-2 text-xs text-zinc-500">
                  <button onClick={selectTiny} disabled={tinyCount === 0} className="text-indigo-600 hover:text-indigo-500 disabled:opacity-30 whitespace-nowrap">
                    Select tiny ({tinyCount})
                  </button>
                  <span className="text-zinc-400">junk size ≤</span>
                  <input type="range" min={0.05} max={3} step={0.05} value={tinyPermille} onChange={(e) => setTinyPermille(+e.target.value)} className="flex-1" />
                  <span className="font-mono w-10 text-right">{tinyPermille.toFixed(2)}‰</span>
                </div>

                {selected.size > 0 && (
                  <button onClick={deleteSelected} className="btn-ghost w-full mb-2 text-red-600 border-red-200 hover:bg-red-50">
                    Delete selected ({selected.size})
                  </button>
                )}

                <div className="space-y-0.5 max-h-[460px] overflow-y-auto">
                  {preview.map((s, i) => {
                    const tiny = shapeArea(s) < tinyArea;
                    const isSel = selected.has(i);
                    return (
                      <div
                        key={i}
                        id={`shape-row-${i}`}
                        onClick={() => toggle(i)}
                        onMouseEnter={() => setHover(i)}
                        onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm ${
                          isSel ? "bg-fuchsia-50 ring-1 ring-fuchsia-300" : "hover:bg-zinc-50"
                        }`}
                      >
                        <input type="checkbox" readOnly checked={isSel} className="pointer-events-none accent-fuchsia-500" />
                        <span className="w-4 h-4 rounded-sm border border-zinc-300 shrink-0" style={{ background: hex(s.color) }} />
                        <span className="flex-1 truncate text-zinc-600">
                          {s.type === "polygon" ? (s.filled ? "Filled poly" : "Outline poly") : s.type === "polyline" ? "Polyline" : "Point"}
                          <span className="text-zinc-400"> · {s.points.length}pt</span>
                          {tiny && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-600">tiny</span>}
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); move(i, -1); }} disabled={i === 0} className="text-zinc-400 hover:text-zinc-800 disabled:opacity-20 px-0.5">▲</button>
                        <button onClick={(e) => { e.stopPropagation(); move(i, 1); }} disabled={i === preview.length - 1} className="text-zinc-400 hover:text-zinc-800 disabled:opacity-20 px-0.5">▼</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {!loaded && (
          <div className="card p-10 text-center text-zinc-400">Upload a real <code className="font-mono">.nap</code> file to begin.</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, before, after, highlight }: { label: string; before: number | string; after: number | string; highlight?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-1 flex items-baseline justify-center gap-1.5">
        <span className="text-zinc-400 line-through text-sm">{before}</span>
        <span className="text-lg font-semibold text-zinc-900">{after}</span>
      </div>
      {highlight && <div className="text-xs font-medium text-emerald-600 mt-0.5">{highlight}</div>}
    </div>
  );
}
