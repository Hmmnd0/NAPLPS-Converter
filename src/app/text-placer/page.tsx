"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { svgToNaplpsStandard } from "@/lib/svgToNaplps";
import { rasterizeNaplps } from "@/lib/naplpsRaster";
import type { NapText } from "@/lib/naplps-std-encoder";

// The visible NAPLPS field that period viewers (TURSHOW) show: X∈[0,1],
// Y∈[0,FIELD_H], displayed 4:3. Must match svgToNaplpsStandard's fieldHeight so
// the overlaid text registers with the rasterized graphic exactly.
const FIELD_H = 0.75;

// One editable font-text block. Mirrors NapText but keeps colour as a hex string
// for the <input type=color> and gives every block a stable id for React keys.
interface TextBlock {
  id: number;
  text: string; // newline-separated lines (what the textarea edits)
  x: number;
  y: number;
  charW: number;
  charH: number;
  color: string; // #rrggbb
}

let nextId = 1;
const mkBlock = (b: Partial<TextBlock> = {}): TextBlock => ({
  id: nextId++,
  text: b.text ?? "Text",
  x: b.x ?? 0.2,
  y: b.y ?? 0.55,
  charW: b.charW ?? 0.018,
  charH: b.charH ?? 0.03,
  color: b.color ?? "#ffffff",
});

// The MadMaze "An Ending" screen, as the known-good starting layout. Drag/tune
// in the preview, then download. Words are exact; positions are nudgeable.
const MADMAZE_BLOCKS: Partial<TextBlock>[] = [
  { text: "MadMaze: An Ending", x: 0.13, y: 0.59, charW: 0.021, charH: 0.036, color: "#000000" },
  {
    text: [
      "Your quest has ended for now.",
      "",
      "You can return to your adventure",
      "anytime by closing this window and",
      "restarting MadMaze. You can continue",
      "on through the PRODIGY service now",
      "by using any other service commands.",
    ].join("\n"),
    x: 0.15,
    y: 0.5,
    charW: 0.0145,
    charH: 0.028,
    color: "#000000",
  },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function blockToNapText(b: TextBlock): NapText {
  return {
    lines: b.text.split("\n"),
    x: b.x,
    y: b.y,
    charW: b.charW,
    charH: b.charH,
    color: hexToRgb(b.color),
  };
}

function extractSvgDims(svg: string): { width: number; height: number } {
  const el = new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("svg");
  let width = 0,
    height = 0;
  const vb = el?.getAttribute("viewBox");
  if (vb) {
    const p = vb.trim().split(/[\s,]+/);
    width = parseFloat(p[2]) || 0;
    height = parseFloat(p[3]) || 0;
  }
  if (!width) width = parseFloat(el?.getAttribute("width") || "0");
  if (!height) height = parseFloat(el?.getAttribute("height") || "0");
  return { width, height };
}

export default function TextPlacer() {
  const [svgString, setSvgString] = useState<string | null>(null);
  const [svgName, setSvgName] = useState<string>("");
  const [dims, setDims] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [excludeBlack, setExcludeBlack] = useState<boolean>(true);
  const [resolution, setResolution] = useState<number>(256);
  const [blocks, setBlocks] = useState<TextBlock[]>(() => MADMAZE_BLOCKS.map(mkBlock));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [graphicUrl, setGraphicUrl] = useState<string>("");
  const [error, setError] = useState<string>("");

  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; dxField: number; dyField: number } | null>(null);

  const selected = blocks.find((b) => b.id === selectedId) ?? null;

  const updateBlock = useCallback((id: number, patch: Partial<TextBlock>) => {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  // Rasterize the graphic-only .nap (no text) into a field-space data URL so the
  // text overlay can sit on top at true coordinates. Re-runs only when the
  // graphic inputs change — editing text never touches this (drag stays smooth).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!svgString) {
        setGraphicUrl("");
        return;
      }
      try {
        setError("");
        const { width, height } = dims;
        if (!width || !height) throw new Error("Could not read SVG dimensions (need width/height or viewBox).");
        const bytes = await svgToNaplpsStandard(svgString, width, height, {
          excludeFills: excludeBlack ? ["#000000"] : [],
        });
        const { width: W, height: H, pixels } = rasterizeNaplps(bytes, { height: resolution, fieldHeight: FIELD_H });
        if (cancelled) return;
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.putImageData(new ImageData(pixels, W, H), 0, 0);
        setGraphicUrl(c.toDataURL());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [svgString, dims, excludeBlack, resolution]);

  const handleSvgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? "");
      setSvgString(text);
      setSvgName(file.name);
      setDims(extractSvgDims(text));
    };
    reader.onerror = () => setError("Could not read SVG file.");
    reader.readAsText(file);
  };

  // ── Dragging a text block in the preview ───────────────────────────────────
  const fieldFromEvent = (clientX: number, clientY: number) => {
    const rect = previewRef.current!.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (1 - (clientY - rect.top) / rect.height) * FIELD_H;
    return { fx, fy };
  };

  const onBlockPointerDown = (e: React.PointerEvent, b: TextBlock) => {
    e.preventDefault();
    setSelectedId(b.id);
    const { fx, fy } = fieldFromEvent(e.clientX, e.clientY);
    dragRef.current = { id: b.id, dxField: b.x - fx, dyField: b.y - fy };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !previewRef.current) return;
      const { fx, fy } = fieldFromEvent(e.clientX, e.clientY);
      const x = Math.min(1, Math.max(0, fx + d.dxField));
      const y = Math.min(FIELD_H, Math.max(0, fy + d.dyField));
      updateBlock(d.id, { x: +x.toFixed(4), y: +y.toFixed(4) });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateBlock]);

  const addBlock = () => {
    const b = mkBlock({ text: "New text", x: 0.2, y: 0.6 });
    setBlocks((bs) => [...bs, b]);
    setSelectedId(b.id);
  };
  const duplicateBlock = (b: TextBlock) => {
    const copy = mkBlock({ ...b, x: Math.min(1, b.x + 0.02), y: Math.max(0, b.y - 0.02) });
    setBlocks((bs) => [...bs, copy]);
    setSelectedId(copy.id);
  };
  const deleteBlock = (id: number) => {
    setBlocks((bs) => bs.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const loadMadMaze = () => {
    const bs = MADMAZE_BLOCKS.map(mkBlock);
    setBlocks(bs);
    setSelectedId(bs[0]?.id ?? null);
    setExcludeBlack(true);
  };

  const download = async () => {
    if (!svgString) {
      setError("Upload an SVG graphic first.");
      return;
    }
    try {
      setError("");
      const { width, height } = dims;
      const bytes = await svgToNaplpsStandard(svgString, width, height, {
        excludeFills: excludeBlack ? ["#000000"] : [],
        texts: blocks.filter((b) => b.text.trim().length).map(blockToNapText),
      });
      const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (svgName.replace(/\.svg$/i, "") || "output") + "_text.nap";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError("Export failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  // Container-query units (cqw/cqh) make the overlay scale with the preview box,
  // so positions/sizes stay correct at any rendered width.
  const renderBlock = (b: TextBlock) => {
        const lines = b.text.split("\n");
        const fontCqh = (b.charH / FIELD_H) * 100; // 1cqh = 1% of preview height
        const advanceCqw = b.charW * 100; // 1cqw = 1% of preview width (X unit = full width)
        const isSel = b.id === selectedId;
        return (
          <div
            key={b.id}
            onPointerDown={(e) => onBlockPointerDown(e, b)}
            style={{
              position: "absolute",
              left: `${b.x * 100}%`,
              top: `${(1 - b.y / FIELD_H) * 100}%`,
              color: b.color,
              fontFamily: '"Courier New", monospace',
              fontSize: `${fontCqh}cqh`,
              lineHeight: `${fontCqh}cqh`,
              letterSpacing: `calc(${advanceCqw}cqw - ${fontCqh * 0.6}cqh)`,
              whiteSpace: "pre",
              cursor: "move",
              userSelect: "none",
              touchAction: "none",
              outline: isSel ? "1px dashed #38bdf8" : "1px dashed transparent",
              outlineOffset: "2px",
              textShadow: b.color.toLowerCase() === "#000000" ? "0 0 1px rgba(255,255,255,0.25)" : undefined,
            }}
            title="Drag to position"
          >
            {lines.map((ln, i) => (
              <div key={i} style={{ minHeight: `${fontCqh}cqh` }}>
                {ln === "" ? " " : ln}
              </div>
            ))}
          </div>
        );
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">NAPLPS Text Placer</h1>
          <p className="text-zinc-500 mt-2 max-w-2xl">
            Drop font text onto a traced graphic and export a real, TURSHOW-readable{" "}
            <code className="px-1 py-0.5 rounded bg-zinc-100 text-zinc-700 text-sm font-mono">.nap</code>. Drag blocks to
            position; the preview shows the true NAPLPS field.
          </p>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
          {/* ── Preview ─────────────────────────────────────────────────── */}
          <div>
            <div
              ref={previewRef}
              className="relative w-full bg-black rounded-lg overflow-hidden shadow-inner select-none"
              style={{
                aspectRatio: `${1 / FIELD_H}`,
                containerType: "size",
                backgroundImage: graphicUrl ? `url(${graphicUrl})` : undefined,
                backgroundSize: "100% 100%",
                imageRendering: "auto",
              }}
            >
              {!svgString && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm px-6 text-center">
                  Upload an SVG graphic to begin. Text blocks below are shown over a black field until then.
                </div>
              )}
              {blocks.map(renderBlock)}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Field shown is the 4:3 area period viewers display (X 0–1, Y 0–{FIELD_H}). The preview font is a
              placeholder monospace — TURSHOW supplies its own letterforms, so on-device spacing will differ slightly.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="btn-primary cursor-pointer">
                Upload SVG graphic
                <input type="file" accept=".svg,image/svg+xml" onChange={handleSvgUpload} className="hidden" />
              </label>
              {svgName && (
                <span className="text-sm text-gray-600">
                  {svgName} {dims.width ? `(${dims.width}×${dims.height})` : ""}
                </span>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={excludeBlack} onChange={(e) => setExcludeBlack(e.target.checked)} />
                Drop black shapes (removes traced text)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                Preview res
                <input
                  type="range"
                  min={128}
                  max={512}
                  step={32}
                  value={resolution}
                  onChange={(e) => setResolution(+e.target.value)}
                />
                {resolution}px
              </label>
            </div>
          </div>

          {/* ── Panel ───────────────────────────────────────────────────── */}
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button onClick={addBlock} className="btn-ghost">
                + Add text
              </button>
              <button onClick={loadMadMaze} className="btn-neutral">
                Load MadMaze example
              </button>
              <button
                onClick={download}
                disabled={!svgString}
                className="btn-accent"
              >
                Download .nap
              </button>
            </div>

            {/* Block list */}
            <div className="space-y-1">
              {blocks.map((b) => (
                <div
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm ${
                    b.id === selectedId ? "bg-sky-100 ring-1 ring-sky-400" : "bg-white hover:bg-gray-100"
                  }`}
                >
                  <span className="truncate flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-sm border border-gray-300" style={{ background: b.color }} />
                    {b.text.split("\n")[0] || "(empty)"}
                  </span>
                  <span className="flex gap-1 shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); duplicateBlock(b); }} className="text-gray-500 hover:text-gray-800" title="Duplicate">⧉</button>
                    <button onClick={(e) => { e.stopPropagation(); deleteBlock(b.id); }} className="text-red-500 hover:text-red-700" title="Delete">✕</button>
                  </span>
                </div>
              ))}
              {blocks.length === 0 && <p className="text-sm text-gray-400 px-1">No text blocks. Click “+ Add text”.</p>}
            </div>

            {/* Editor for the selected block */}
            {selected && (
              <div className="border rounded-lg p-3 space-y-3 bg-white">
                <h3 className="font-semibold text-sm text-gray-700">Edit block</h3>
                <textarea
                  value={selected.text}
                  onChange={(e) => updateBlock(selected.id, { text: e.target.value })}
                  rows={Math.min(8, Math.max(2, selected.text.split("\n").length))}
                  className="w-full border rounded p-2 font-mono text-sm"
                  placeholder="One line per row…"
                />
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <NumField label="X (0–1)" value={selected.x} min={0} max={1} step={0.005} onChange={(v) => updateBlock(selected.id, { x: v })} />
                  <NumField label={`Y (0–${FIELD_H})`} value={selected.y} min={0} max={FIELD_H} step={0.005} onChange={(v) => updateBlock(selected.id, { y: v })} />
                  <NumField label="Char width" value={selected.charW} min={0.005} max={0.06} step={0.0005} onChange={(v) => updateBlock(selected.id, { charW: v })} />
                  <NumField label="Char height" value={selected.charH} min={0.01} max={0.08} step={0.001} onChange={(v) => updateBlock(selected.id, { charH: v })} />
                  <label className="flex items-center justify-between gap-2 col-span-2">
                    <span className="text-gray-600">Color</span>
                    <input type="color" value={selected.color} onChange={(e) => updateBlock(selected.id, { color: e.target.value })} />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="flex-1" />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(+e.target.value)}
          className="w-20 border rounded px-1 py-0.5 text-right"
        />
      </div>
    </label>
  );
}
