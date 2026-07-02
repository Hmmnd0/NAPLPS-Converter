'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import AppHeader from '@/components/AppHeader';
import { rasterizeNaplps } from '@/lib/naplpsRaster';
import type { RGB } from '@/lib/pixelQuantize';

function fmtBytes(n: number) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

function downloadBinary(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface VectorizeResult {
  nap: Uint8Array;
  palette: RGB[];
  polygonCount: number;
  totalVertices: number;
  originalUrl: string;
  rasterWidth: number;
  rasterHeight: number;
  rasterPixels: Uint8ClampedArray;
  outName: string;
}

type Mode = 'polygons' | 'raster';

export default function Vectorizer() {
  const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<VectorizeResult | null>(null);
  const [mode, setMode] = useState<Mode>('raster');
  // 0 = keep everything. Size filtering exists for anti-aliased/noisy sources;
  // on clean pixel art it silently drops letter fragments and fine detail.
  const [minPixels, setMinPixels] = useState(0);
  const [rasterWidth, setRasterWidth] = useState(160);
  const rasterRef = useRef<HTMLCanvasElement>(null);
  const currentFileRef = useRef<File | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processFileRef = useRef<((f: File) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!result || !rasterRef.current) return;
    const canvas = rasterRef.current;
    canvas.width = result.rasterWidth;
    canvas.height = result.rasterHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(result.rasterPixels, result.rasterWidth, result.rasterHeight), 0, 0);
  }, [result]);

  const reprocess = useCallback(() => {
    if (!currentFileRef.current || !processFileRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      processFileRef.current!(currentFileRef.current!);
    }, 400);
  }, []);

  const processFile = useCallback(async (file: File) => {
    currentFileRef.current = file;
    processFileRef.current = processFile;
    console.log('Vectorizer: processing', file.name, `${(file.size / 1024).toFixed(0)} KB`);
    setStatus('processing');
    setError('');
    setResult(null);

    try {
      const originalUrl = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not load image'));
        el.src = originalUrl;
      });

      const { naturalWidth: srcW, naturalHeight: srcH } = img;
      if (srcW === 0 || srcH === 0) throw new Error('Image has zero dimensions');

      let width: number, height: number;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;

      if (mode === 'raster') {
        // Scale to the chosen raster width, preserving aspect ratio. At or
        // above the source width this is a true 1:1 conversion (no resampling).
        // No blur — we want pixel-accurate quantization, not anti-aliasing.
        const scale = Math.min(1, rasterWidth / srcW);
        width = Math.min(rasterWidth, srcW);
        height = Math.max(1, Math.round(srcH * scale));
        canvas.width = width;
        canvas.height = height;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, width, height);
      } else {
        // Polygon mode: scale to ≤640px. No blur — quantizing to the popularity
        // palette already snaps anti-aliasing fringe to the nearest flat colour,
        // and blurring destroys thin features (1px outlines, hatching, text).
        const scale = Math.min(1, 640 / srcW, 640 / srcH);
        width = Math.max(1, Math.round(srcW * scale));
        height = Math.max(1, Math.round(srcH * scale));
        canvas.width = width;
        canvas.height = height;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, width, height);
      }

      const imageData = ctx.getImageData(0, 0, width, height);
      const worker = new Worker(new URL('../../lib/vectorizer.worker.ts', import.meta.url));
      worker.postMessage(
        { buffer: imageData.data.buffer, width, height, minPixels, mode, rasterWidth },
        [imageData.data.buffer]
      );

      worker.onmessage = (e) => {
        worker.terminate();
        const msg = e.data;
        if (msg.type === 'error') {
          setError(msg.message);
          setStatus('error');
          return;
        }
        const nap = new Uint8Array(msg.nap);
        const raster = rasterizeNaplps(nap, { height: 512 });
        setResult({
          nap,
          palette: msg.palette,
          polygonCount: msg.polygonCount,
          totalVertices: msg.totalVertices,
          originalUrl,
          rasterWidth: raster.width,
          rasterHeight: raster.height,
          rasterPixels: raster.pixels,
          outName: file.name.replace(/\.[^.]+$/, '') + '_vector.nap',
        });
        setStatus('done');
      };

      worker.onerror = (err) => {
        worker.terminate();
        setError(err.message || 'Worker error');
        setStatus('error');
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vectorization failed');
      setStatus('error');
    }
  }, [mode, minPixels, rasterWidth]);

  useEffect(() => { processFileRef.current = processFile; }, [processFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'] },
    multiple: false,
    onDropAccepted: ([file]) => processFile(file),
    onDropRejected: () => { setError('Unsupported file type — use PNG or JPEG'); setStatus('error'); },
  });

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">NAPLPS Vectorizer</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Convert PNG images to NAPLPS. Raster mode gives 1:1 pixel fidelity; Polygon mode gives smaller files for flat-color art.
          </p>
        </div>

        {/* Mode toggle */}
        <div className="card flex gap-2">
          {(['raster', 'polygons'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); reprocess(); }}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {m === 'raster' ? 'Raster (1:1)' : 'Polygon'}
            </button>
          ))}
          <span className="ml-4 text-xs text-zinc-400 self-center">
            {mode === 'raster'
              ? 'Row-by-row rectangles — faithful to the original including text'
              : 'Traces flat-color region outlines — smaller files, loses fine detail'}
          </span>
        </div>

        {/* Raster options */}
        {mode === 'raster' && (
          <div className="card flex items-center gap-4">
            <label className="text-sm font-medium text-zinc-700 whitespace-nowrap">Resolution</label>
            <input
              type="range" min={80} max={640} step={8}
              value={rasterWidth}
              onChange={e => { setRasterWidth(Number(e.target.value)); reprocess(); }}
              className="flex-1"
            />
            <span className="text-sm text-zinc-500 w-24 text-right">{rasterWidth}px wide</span>
            <span className="text-xs text-zinc-400">↑ more detail, larger file — at/above source width = exact 1:1 (period viewers display ~1 KB/s)</span>
          </div>
        )}

        {/* Polygon options */}
        {mode === 'polygons' && (
          <div className="card flex items-center gap-4">
            <label className="text-sm font-medium text-zinc-700 whitespace-nowrap">Min region size</label>
            <input
              type="range" min={0} max={2000} step={8}
              value={minPixels}
              onChange={e => { setMinPixels(Number(e.target.value)); reprocess(); }}
              className="flex-1"
            />
            <span className="text-sm text-zinc-500 w-20 text-right">{minPixels} px</span>
            <span className="text-xs text-zinc-400">↑ filters small details &amp; text</span>
          </div>
        )}

        <div
          {...getRootProps()}
          className={`card border-2 border-dashed cursor-pointer transition-colors ${
            isDragActive ? 'border-indigo-400 bg-indigo-50' : 'border-zinc-300 hover:border-zinc-400'
          }`}
        >
          <input {...getInputProps()} />
          <div className="py-10 text-center space-y-1">
            <p className="text-sm font-medium text-zinc-600">
              {isDragActive ? 'Drop to convert' : 'Drop a PNG or JPEG here'}
            </p>
            <p className="text-xs text-zinc-400">or click to browse</p>
          </div>
        </div>

        {status === 'processing' && (
          <div className="card py-10 text-center text-sm text-zinc-400">
            {mode === 'raster' ? 'Tiling…' : 'Tracing regions…'}
          </div>
        )}

        {status === 'error' && (
          <div className="card border border-red-200 bg-red-50 text-sm text-red-700 px-4 py-3">
            {error}
          </div>
        )}

        {status === 'done' && result && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="card space-y-2">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Original</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result.originalUrl} className="w-full rounded" alt="original" />
              </div>
              <div className="card space-y-2">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">NAPLPS raster</p>
                <canvas
                  ref={rasterRef}
                  className="w-full rounded bg-black"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
            </div>

            <div className="card">
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                {[
                  ['Colors', result.palette.length],
                  ['Rectangles', result.polygonCount],
                  ['Total vertices', result.totalVertices],
                  ['File size', fmtBytes(result.nap.length)],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-xs text-zinc-500">{label}</dt>
                    <dd className="text-xl font-semibold text-zinc-900 mt-0.5">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="flex gap-3">
              <button className="btn-primary" onClick={() => downloadBinary(result.nap, result.outName)}>
                Download {result.outName}
              </button>
              <button
                className="btn-neutral"
                onClick={() => { setStatus('idle'); setResult(null); URL.revokeObjectURL(result.originalUrl); }}
              >
                Clear
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
