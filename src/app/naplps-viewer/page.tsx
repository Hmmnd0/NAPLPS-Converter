"use client";
import React, { useRef, useState } from "react";
import { rasterizeNaplps } from "@/lib/naplpsRaster";
import AppHeader from "@/components/AppHeader";

export default function NaplpsViewer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>("");
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [resolution, setResolution] = useState<number>(256);
  const [pixelated, setPixelated] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string>("");
  const lastBytes = useRef<Uint8Array | null>(null);

  // Decode and rasterize with the period rendering model (low-res scanline fill
  // + boundary pixels), then scale the framebuffer up to fill the viewer box.
  // This reproduces the original DOS viewers and, unlike the vector SVG path,
  // leaves no seams between the source art's near-coincident region edges.
  const render = (bytes: Uint8Array) => {
    const host = canvasRef.current;
    if (!host) return;
    setError("");
    try {
      const { width, height, pixels, shapeCount, commandCounts } = rasterizeNaplps(bytes, { height: resolution });
      setStats(commandCounts);
      if (shapeCount === 0) {
        host.innerHTML = '<span class="text-zinc-500">No drawable shapes (text-only frame?)</span>';
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
      canvas.style.maxWidth = "100%";
      canvas.style.maxHeight = "100%";
      canvas.style.width = "auto";
      canvas.style.height = "auto";
      canvas.style.imageRendering = pixelated ? "pixelated" : "auto";
      host.innerHTML = "";
      host.appendChild(canvas);
    } catch (err) {
      setError("Decode failed: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const arrayBuffer = event.target?.result;
      if (!arrayBuffer) { setError("Could not read file as ArrayBuffer"); return; }
      const bytes = new Uint8Array(arrayBuffer as ArrayBuffer);
      lastBytes.current = bytes;
      render(bytes);
    };
    reader.onerror = () => setError("Error reading file.");
    reader.readAsArrayBuffer(file);
  };

  // Re-rasterize when the resolution / scaling controls change.
  React.useEffect(() => {
    if (lastBytes.current) render(lastBytes.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution, pixelated]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 flex flex-col items-center">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">NAPLPS Viewer</h1>
          <p className="mt-2 text-zinc-500">Render real <code className="px-1 py-0.5 rounded bg-zinc-100 text-zinc-700 text-sm font-mono">.nap</code> files in the browser.</p>
        </div>

        <div className="card p-5 w-full flex flex-col items-center gap-5">
          <div className="flex flex-wrap items-center justify-center gap-5 text-sm text-zinc-600">
            <label className="flex items-center gap-2">
              <span className="field-label">Resolution</span>
              <input
                type="range" min={96} max={512} step={16}
                value={resolution}
                onChange={(e) => setResolution(Number(e.target.value))}
              />
              <span className="font-mono w-10 text-zinc-500">{resolution}px</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={pixelated} onChange={(e) => setPixelated(e.target.checked)} />
              <span className="field-label">Pixelated</span>
            </label>
          </div>

          <label className="btn-ghost cursor-pointer">
            {fileName || "Choose .nap file"}
            <input
              type="file"
              accept=".nap,application/octet-stream"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          <div
            ref={canvasRef}
            className="border border-zinc-200 rounded-xl bg-black flex items-center justify-center overflow-hidden"
            style={{ width: 560, height: 420, maxWidth: "100%" }}
          >
            <span className="text-zinc-500">Upload a .nap file to view</span>
          </div>

          {error && (
            <div className="w-full p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          {stats && (
            <div className="w-full text-xs font-mono text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg p-3 max-h-32 overflow-y-auto">
              {Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <span key={k} className="inline-block mr-3">{k}:{v}</span>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 text-sm text-zinc-500 max-w-[560px] text-center">
          <p>
            Decodes real period NAPLPS (interleaved coordinates, indexed palette) using logic
            reverse-engineered from the period DOS tools, and rasterizes it with the same low-res
            framebuffer model as the original viewers.
          </p>
        </div>
      </div>
    </div>
  );
}
