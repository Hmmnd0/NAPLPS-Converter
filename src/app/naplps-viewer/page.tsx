"use client";
import React, { useRef, useState } from "react";

export default function NaplpsViewer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>("");

  // Load Telidon scripts on mount
  React.useEffect(() => {
    const scripts = [
      "/telidon/p5.min.js",
      "/telidon/naplps.js",
      "/telidon/TelidonP5.js",
    ];
    scripts.forEach((src) => {
      if (!document.querySelector(`script[src='${src}']`)) {
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        document.body.appendChild(script);
      }
    });
  }, []);

  // Handle file upload and render
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError("");
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const arrayBuffer = event.target?.result;
      if (!arrayBuffer) {
        setError("Could not read file as ArrayBuffer");
        return;
      }

      if (canvasRef.current) {
        canvasRef.current.innerHTML = '<span class="text-gray-400">Loading...</span>';
      }

      // Wait for TelidonP5 to be loaded (max 5 seconds)
      let attempts = 0;
      const tryRender = () => {
        if (window.TelidonP5 && window.p5) {
          try {
            window.TelidonP5.renderBinary(
              new Uint8Array(arrayBuffer as ArrayBuffer),
              canvasRef.current
            );
          } catch (err) {
            setError("Error rendering NAPLPS: " + (err instanceof Error ? err.message : String(err)));
            console.error("Error rendering NAPLPS:", err);
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
    reader.onerror = (err) => {
      setError("Error reading file: " + (err instanceof Error ? err.message : String(err)));
      console.error("Error reading file:", err);
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">NAPLPS Viewer (TelidonP5.js)</h1>
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
        className="border rounded bg-gray-100 min-h-[400px] flex items-center justify-center"
        style={{ minHeight: 400 }}
      >
        <span className="text-gray-400">Upload a .nap file to view</span>
      </div>
      {error && (
        <div className="mt-4 p-3 bg-red-100 border border-red-300 text-red-800 rounded">
          {error}
        </div>
      )}
      <div className="mt-4 text-sm text-gray-600">
        <p>
          Powered by <a href="https://github.com/n1ckfg/Telidon" target="_blank" rel="noopener noreferrer" className="underline">TelidonP5.js</a> (<a href="https://n1ckfg.github.io/Telidon/" target="_blank" rel="noopener noreferrer" className="underline">demo</a>)
        </p>
      </div>
    </div>
  );
}
