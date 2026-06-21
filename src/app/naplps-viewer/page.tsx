"use client";
import React, { useRef, useState } from "react";
import { rasterizeNaplps } from "@/lib/naplpsRaster";
import AppHeader from "@/components/AppHeader";

type Renderer = "standard" | "telidon";

export default function NaplpsViewer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>("");
  const [renderer, setRenderer] = useState<Renderer>("standard");
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [resolution, setResolution] = useState<number>(256);
  const [pixelated, setPixelated] = useState<boolean>(false);
  const lastBytes = useRef<Uint8Array | null>(null);

  // Load Telidon scripts on mount (only needed for the legacy renderer)
  React.useEffect(() => {
    const scripts = ["/telidon/p5.min.js", "/telidon/naplps.js", "/telidon/TelidonP5.js"];
    scripts.forEach((src) => {
      if (!document.querySelector(`script[src='${src}']`)) {
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        document.body.appendChild(script);
      }
    });
  }, []);

  // Decode and rasterize with the period rendering model (low-res scanline fill
  // + boundary pixels), then scale the framebuffer up to fill the viewer box.
  // This reproduces the original DOS viewers and, unlike the vector SVG path,
  // leaves no seams between the source art's near-coincident region edges.
  const renderStandard = (bytes: Uint8Array) => {
    const host = canvasRef.current;
    if (!host) return;
    const { width, height, pixels, shapeCount, commandCounts } = rasterizeNaplps(bytes, { height: resolution });
    setStats(commandCounts);
    if (shapeCount === 0) {
      host.innerHTML = '<span class="text-gray-400">No drawable shapes (text-only frame?)</span>';
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    // Fit within the viewer box, preserving aspect; CSS scales the small buffer up.
    canvas.style.maxWidth = "100%";
    canvas.style.maxHeight = "100%";
    canvas.style.width = "auto";
    canvas.style.height = "auto";
    canvas.style.imageRendering = pixelated ? "pixelated" : "auto";
    host.innerHTML = "";
    host.appendChild(canvas);
  };

  const renderTelidon = (bytes: Uint8Array) => {
    let attempts = 0;
    const tryRender = () => {
      if (window.TelidonP5 && window.p5) {
        try {
          window.TelidonP5.renderBinary(bytes, canvasRef.current, 560, 420);
        } catch (err) {
          setError("Error rendering NAPLPS: " + (err instanceof Error ? err.message : String(err)));
        }
      } else if (attempts < 25) {
        attempts++;
        setTimeout(tryRender, 200);
      } else {
        setError("Timed out waiting for TelidonP5 to load.");
      }
    };
    tryRender();
  };

  const draw = (bytes: Uint8Array, mode: Renderer) => {
    setError("");
    setStats(null);
    if (canvasRef.current) canvasRef.current.innerHTML = '<span class="text-gray-400">Decoding…</span>';
    try {
      if (mode === "standard") renderStandard(bytes);
      else renderTelidon(bytes);
    } catch (err) {
      setError("Decode failed: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const arrayBuffer = event.target?.result;
      if (!arrayBuffer) { setError("Could not read file as ArrayBuffer"); return; }
      const bytes = new Uint8Array(arrayBuffer as ArrayBuffer);
      lastBytes.current = bytes;
      draw(bytes, renderer);
    };
    reader.onerror = () => setError("Error reading file.");
    reader.readAsArrayBuffer(file);
  };

  const switchRenderer = (mode: Renderer) => {
    setRenderer(mode);
    if (lastBytes.current) draw(lastBytes.current, mode);
  };

  // Re-rasterize when the resolution / scaling controls change.
  React.useEffect(() => {
    if (renderer === "standard" && lastBytes.current) renderStandard(lastBytes.current);
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
          {/* Renderer toggle */}
          <div className="inline-flex rounded-lg border border-zinc-200 p-1 bg-zinc-50">
            {([["standard", "Standard", "real .nap files"], ["telidon", "TelidonP5", "legacy dialect"]] as const).map(
              ([val, label, hint]) => (
                <button
                  key={val}
                  onClick={() => switchRenderer(val)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    renderer === val ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-800"
                  }`}
                  title={hint}
                >
                  {label}
                </button>
              ),
            )}
          </div>

          {renderer === "standard" && (
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
          )}

          <label className="btn-ghost cursor-pointer">
            Choose .nap file
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
            id="telidon-canvas"
            className="border border-zinc-200 rounded-xl bg-black flex items-center justify-center overflow-hidden"
            style={{ width: 560, height: 420, maxWidth: "100%" }}
          >
            <span className="text-zinc-500">Upload a .nap file to view</span>
          </div>

          {error && (
            <div className="w-full p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          {stats && renderer === "standard" && (
            <div className="w-full text-xs font-mono text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg p-3 max-h-32 overflow-y-auto">
              {Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <span key={k} className="inline-block mr-3">{k}:{v}</span>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 text-sm text-zinc-500 max-w-[560px] text-center">
          <p>
            Standard mode decodes real period NAPLPS (interleaved coordinates, indexed palette) using logic
            reverse-engineered from the period DOS tools. Legacy mode uses{" "}
            <a href="https://github.com/n1ckfg/Telidon" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-800">TelidonP5.js</a>,
            which only reads this app&apos;s own encoder output.
          </p>
        </div>
      </div>
    </div>
  );
}
