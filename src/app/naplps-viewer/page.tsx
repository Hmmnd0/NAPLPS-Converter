"use client";
import React, { useRef, useState } from "react";
import { naplpsToSvg } from "@/lib/naplpsToSvg";

type Renderer = "standard" | "telidon";

export default function NaplpsViewer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>("");
  const [renderer, setRenderer] = useState<Renderer>("standard");
  const [stats, setStats] = useState<Record<string, number> | null>(null);
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

  // Decode with the standard decoder and draw the SVG into the canvas div.
  const renderStandard = (bytes: Uint8Array) => {
    const { svg, shapeCount, commandCounts } = naplpsToSvg(bytes);
    if (!canvasRef.current) return;
    if (shapeCount === 0) {
      canvasRef.current.innerHTML = '<span class="text-gray-400">No drawable shapes (text-only frame?)</span>';
      setStats(commandCounts);
      return;
    }
    // Scale the SVG to fit the viewer box while preserving aspect ratio.
    canvasRef.current.innerHTML = svg.replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"');
    setStats(commandCounts);
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

  return (
    <div className="flex flex-col items-center py-8 w-full">
      <h1 className="text-2xl font-bold mb-2">NAPLPS Viewer</h1>

      <div className="flex items-center gap-4 mb-4 text-sm">
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" name="renderer" checked={renderer === "standard"} onChange={() => switchRenderer("standard")} />
          <span>Standard NAPLPS <span className="text-gray-400">(real .nap files)</span></span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" name="renderer" checked={renderer === "telidon"} onChange={() => switchRenderer("telidon")} />
          <span>TelidonP5 <span className="text-gray-400">(legacy dialect)</span></span>
        </label>
      </div>

      <input
        type="file"
        accept=".nap,application/octet-stream"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="mb-4"
      />
      <div
        ref={canvasRef}
        id="telidon-canvas"
        className="border rounded bg-black flex items-center justify-center overflow-hidden"
        style={{ width: 560, height: 420 }}
      >
        <span className="text-gray-400">Upload a .nap file to view</span>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-100 border border-red-300 text-red-800 rounded">{error}</div>
      )}

      {stats && renderer === "standard" && (
        <div className="mt-4 w-[560px] text-xs font-mono text-gray-600 bg-gray-50 border rounded p-2 max-h-32 overflow-y-auto">
          {Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <span key={k} className="inline-block mr-3">{k}:{v}</span>
          ))}
        </div>
      )}

      <div className="mt-4 text-sm text-gray-600 max-w-[560px] text-center">
        <p>
          Standard mode decodes real period NAPLPS (interleaved coordinates, indexed palette) using logic
          reverse-engineered from the period DOS tools. Legacy mode uses{" "}
          <a href="https://github.com/n1ckfg/Telidon" target="_blank" rel="noopener noreferrer" className="underline">TelidonP5.js</a>,
          which only reads this app&apos;s own encoder output.
        </p>
      </div>
    </div>
  );
}
