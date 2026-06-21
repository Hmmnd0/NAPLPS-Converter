'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import FileUpload from '@/components/FileUpload';
import SvgAccuracyTest from '@/components/SvgAccuracyTest';
import { pixelPngToSvg } from '@/lib/pixelToSvg';
import { svgToNaplpsFoxtoolbox, svgToNaplpsStandard, getConversionStats } from '@/lib/svgToNaplps';
import { naplpsToSvg } from '@/lib/naplpsToSvg';

// ─── Download helpers ─────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substr(i, 2), 16);
  }
  return bytes;
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

function downloadText(content: string, filename: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Home() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [originalPreview, setOriginalPreview] = useState<string | null>(null);
  const [svgString, setSvgString] = useState<string | null>(null);
  const [svgReady, setSvgReady] = useState<boolean>(false);
  const [naplpsData, setNaplpsData] = useState<string>('');
  const [conversionStats, setConversionStats] = useState<{
    totalPixels: number;
    totalRectangles: number;
    optimizedRectangles: number;
    compressionRatio: number;
    optimizationRatio: number;
  } | null>(null);
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [isNaplpsProcessing, setIsNaplpsProcessing] = useState<boolean>(false);

  // SVG direct upload → NAP state
  const [svgUploadString, setSvgUploadString] = useState<string | null>(null);
  const [svgUploadFilename, setSvgUploadFilename] = useState<string>('');
  const [svgUploadNaplpsData, setSvgUploadNaplpsData] = useState<string>('');
  const [isSvgUploadProcessing, setIsSvgUploadProcessing] = useState<boolean>(false);
  const [svgUploadError, setSvgUploadError] = useState<string>('');

  // .nap import → SVG (read REAL period NAPLPS files)
  const [napImportName, setNapImportName] = useState<string>('');
  const [napImportSvg, setNapImportSvg] = useState<string>('');
  const [napImportStats, setNapImportStats] = useState<Record<string, number> | null>(null);
  const [napImportError, setNapImportError] = useState<string>('');

  const handleFileSelect = async (file: File) => {
    setIsProcessing(true);
    setProcessingProgress(0);
    setError('');
    setNaplpsData('');
    setSvgString(null);
    setOriginalPreview(null);
    setSvgReady(false);
    setConversionStats(null);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        setOriginalPreview(dataUrl);

        // Pre-check image dimensions before starting the full conversion
        const imgCheck = new Image();
        imgCheck.onload = async () => {
          if (imgCheck.width === 0 || imgCheck.height === 0) {
            setError('Image has invalid dimensions (0×0). Please upload a valid PNG.');
            setIsProcessing(false);
            return;
          }
          if (imgCheck.width * imgCheck.height > 1_000_000) {
            setError(
              `Image too large: ${imgCheck.width}×${imgCheck.height} = ${(imgCheck.width * imgCheck.height).toLocaleString()} pixels. Maximum is 1,000,000 pixels.`
            );
            setIsProcessing(false);
            return;
          }

          try {
            setSvgReady(false);
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Conversion timeout - image may be too large')), 30000);
            });
            const svgPromise = pixelPngToSvg(dataUrl, (progress) => {
              setProcessingProgress(progress);
            });
            const result = await Promise.race([svgPromise, timeoutPromise]) as { svg: string, palette: Array<{r:number,g:number,b:number}> };
            setSvgString(result.svg);
            setSvgReady(true);
          } catch (svgErr) {
            setError('SVG conversion failed: ' + (svgErr instanceof Error ? svgErr.message : String(svgErr)));
          }
          setIsProcessing(false);
        };
        imgCheck.onerror = () => {
          setError('Could not load image — file may be corrupt or not a valid PNG.');
          setIsProcessing(false);
        };
        imgCheck.src = dataUrl;
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while processing the image');
      setIsProcessing(false);
    }
  };

  const handleConvertToNaplps = async () => {
    if (!svgString || !originalPreview) return;
    setIsNaplpsProcessing(true);
    setError('');
    setNaplpsData('');
    setConversionStats(null);
    try {
      const img = new Image();
      img.onload = async () => {
        if (img.width === 0 || img.height === 0) {
          setError('Could not determine image dimensions. Please re-upload the image.');
          setIsNaplpsProcessing(false);
          return;
        }
        try {
          const naplps = await svgToNaplpsFoxtoolbox(svgString, img.width, img.height);
          setNaplpsData(naplps);
          const stats = getConversionStats(svgString);
          setConversionStats(stats);
        } catch (naplpsErr) {
          setError('NAPLPS conversion failed: ' + (naplpsErr instanceof Error ? naplpsErr.message : String(naplpsErr)));
        }
        setIsNaplpsProcessing(false);
      };
      img.src = originalPreview;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while processing the SVG');
      setIsNaplpsProcessing(false);
    }
  };

  const handleSvgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSvgUploadNaplpsData('');
    setSvgUploadError('');
    setSvgUploadFilename(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setSvgUploadString(ev.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleSvgUploadConvert = async () => {
    if (!svgUploadString) return;
    setIsSvgUploadProcessing(true);
    setSvgUploadError('');
    setSvgUploadNaplpsData('');
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgUploadString, 'image/svg+xml');

      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        setSvgUploadError('Malformed SVG: ' + (parseError.textContent?.trim().split('\n')[0] ?? 'parse error'));
        setIsSvgUploadProcessing(false);
        return;
      }

      const svgEl = doc.querySelector('svg');
      let width = 0, height = 0;
      const viewBox = svgEl?.getAttribute('viewBox');
      if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/);
        width = parseFloat(parts[2]) || 0;
        height = parseFloat(parts[3]) || 0;
      }
      if (!width) width = parseFloat(svgEl?.getAttribute('width') || '0');
      if (!height) height = parseFloat(svgEl?.getAttribute('height') || '0');
      if (!width || !height) {
        setSvgUploadError('Could not determine SVG dimensions. Make sure the SVG has a viewBox or width/height attributes.');
        setIsSvgUploadProcessing(false);
        return;
      }
      const naplps = await svgToNaplpsFoxtoolbox(svgUploadString, width, height);
      setSvgUploadNaplpsData(naplps);
    } catch (err) {
      setSvgUploadError('Conversion failed: ' + (err instanceof Error ? err.message : String(err)));
    }
    setIsSvgUploadProcessing(false);
  };

  // Read an SVG's pixel dimensions from its viewBox or width/height attributes.
  const extractSvgDims = (svg: string): { width: number; height: number } => {
    const el = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('svg');
    let width = 0, height = 0;
    const vb = el?.getAttribute('viewBox');
    if (vb) { const p = vb.trim().split(/[\s,]+/); width = parseFloat(p[2]) || 0; height = parseFloat(p[3]) || 0; }
    if (!width) width = parseFloat(el?.getAttribute('width') || '0');
    if (!height) height = parseFloat(el?.getAttribute('height') || '0');
    return { width, height };
  };

  // Export the current SVG as a REAL standard NAPLPS .nap (period-tool readable),
  // using the standard encoder rather than the app's TelidonP5 dialect.
  const downloadStandardNap = async (svg: string, baseName: string) => {
    try {
      const { width, height } = extractSvgDims(svg);
      if (!width || !height) { setError('Could not determine SVG dimensions for standard .nap export.'); return; }
      const bytes = await svgToNaplpsStandard(svg, width, height);
      downloadBinary(bytes, `${baseName}.nap`);
    } catch (e) {
      setError('Standard .nap export failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleNapImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNapImportError('');
    setNapImportSvg('');
    setNapImportStats(null);
    setNapImportName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const bytes = new Uint8Array(ev.target?.result as ArrayBuffer);
        const { svg, shapeCount, commandCounts } = naplpsToSvg(bytes);
        if (shapeCount === 0) {
          setNapImportError('No drawable shapes were decoded — this may be a text-only or unsupported NAPLPS frame.');
          return;
        }
        setNapImportSvg(svg);
        setNapImportStats(commandCounts);
      } catch (err) {
        setNapImportError('Decode failed: ' + (err instanceof Error ? err.message : String(err)));
      }
    };
    reader.onerror = () => setNapImportError('Could not read file.');
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Viewer Button */}
        <div className="flex justify-end gap-3 mb-4">
          <a
            href="/text-placer"
            className="px-6 py-2 bg-amber-600 text-white rounded-lg font-semibold shadow hover:bg-amber-700 transition-colors"
          >
            Text Placer
          </a>
          <a
            href="/naplps-viewer"
            className="px-6 py-2 bg-purple-700 text-white rounded-lg font-semibold shadow hover:bg-purple-800 transition-colors"
          >
            Open NAPLPS Viewer
          </a>
        </div>
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            NAPLPS Converter
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Convert PNG images to NAPLPS (North American Presentation Layer Protocol Syntax) format.
            This tool analyzes images and converts them to vector graphics primitives used in vintage
            teletext and videotex systems.
          </p>
          <Link href="/author"
            className="inline-block mt-3 px-4 py-1.5 bg-gray-800 text-white text-sm rounded hover:bg-gray-700 transition-colors">
            Authoring Tool (trace shapes manually)
          </Link>
        </div>

        {/* File Upload */}
        <div className="mb-8">
          <FileUpload onFileSelect={handleFileSelect} isProcessing={isProcessing} />

          {/* Progress Bar */}
          {isProcessing && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>Processing image...</span>
                <span>{Math.round(processingProgress * 100)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${processingProgress * 100}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Results */}
        {(originalPreview || svgString) && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Original Image */}
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Original Image</h2>
              <div className="border border-gray-300 rounded-lg overflow-hidden flex items-center justify-center min-h-[200px] bg-white">
                {originalPreview ? (
                  <img
                    src={originalPreview}
                    alt="Original"
                    className="w-full h-auto"
                    style={{ maxHeight: '400px', objectFit: 'contain' }}
                  />
                ) : (
                  <span className="text-gray-400">No image</span>
                )}
              </div>
            </div>

            {/* SVG Preview + Download */}
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">SVG Preview</h2>
              <div className="border border-gray-300 rounded-lg overflow-hidden flex items-center justify-center min-h-[200px] bg-white">
                {svgString ? (
                  <div
                    className="w-full h-auto"
                    style={{ maxHeight: '400px', objectFit: 'contain' }}
                    dangerouslySetInnerHTML={{ __html: svgString }}
                  />
                ) : (
                  <span className="text-gray-400">No SVG</span>
                )}
              </div>
              {svgString && (
                <button
                  className="mt-4 w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  onClick={() => {
                    const svgWithHeader = `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;
                    downloadText(svgWithHeader, 'output.svg', 'image/svg+xml');
                  }}
                >
                  Download SVG
                </button>
              )}
              <div className="mt-4 space-y-2">
                <button
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  onClick={handleConvertToNaplps}
                  disabled={!svgReady || isNaplpsProcessing}
                >
                  {isNaplpsProcessing ? 'Converting to NAPLPS...' : 'Convert SVG to NAPLPS'}
                </button>
              </div>
            </div>

            {/* NAPLPS Preview + Download */}
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">NAPLPS Data</h2>
              <div className="border border-gray-300 rounded-lg overflow-hidden bg-white p-4">
                {naplpsData ? (
                  <div className="space-y-4">
                    <div className="bg-gray-900 text-green-400 p-3 rounded font-mono text-xs overflow-x-auto">
                      <pre>{naplpsData}</pre>
                    </div>
                    {conversionStats && (
                      <div className="text-sm text-gray-600 space-y-1">
                        <p>Total pixels: {conversionStats.totalPixels.toLocaleString()}</p>
                        <p>Initial rectangles: {conversionStats.totalRectangles.toLocaleString()}</p>
                        <p>Optimized rectangles: {conversionStats.optimizedRectangles.toLocaleString()}</p>
                        <p>Compression: {((1 - conversionStats.compressionRatio) * 100).toFixed(1)}%</p>
                        <p>Optimization: {((1 - conversionStats.optimizationRatio) * 100).toFixed(1)}%</p>
                      </div>
                    )}
                    <button
                      onClick={() => downloadText(naplpsData, 'naplps_output.txt')}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Download NAPLPS File
                    </button>
                    <button
                      onClick={() => {
                        const hex = naplpsData.replace(/\s+/g, '');
                        if (!hex || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
                          setError('Cannot export binary: NAPLPS data is empty or invalid.');
                          return;
                        }
                        downloadBinary(hexToBytes(hex), 'naplps_output.nap');
                      }}
                      className="w-full mt-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                    >
                      Download NAPLPS (.nap) <span className="opacity-75">— TelidonP5 dialect</span>
                    </button>
                    {svgString && (
                      <button
                        onClick={() => downloadStandardNap(svgString, 'naplps_output_standard')}
                        className="w-full mt-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                      >
                        Download standard .nap <span className="opacity-75">— real NAPLPS (TURSHOW-readable)</span>
                      </button>
                    )}
                    {/* Hex/byte preview */}
                    <div className="mt-4 bg-gray-100 p-2 rounded text-xs font-mono text-gray-700">
                      <div>First 64 bytes (hex):</div>
                      <div>
                        {(() => {
                          const hex = naplpsData.replace(/\s+/g, '');
                          let preview = '';
                          for (let i = 0; i < Math.min(64, hex.length); i += 2) {
                            preview += hex.substr(i, 2) + ' ';
                          }
                          return preview.trim();
                        })()}
                      </div>
                      <div>
                        Total bytes: {Math.floor(naplpsData.replace(/\s+/g, '').length / 2)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <span className="text-gray-400">No NAPLPS data</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SVG → NAP Direct Upload */}
        <div className="mt-12 bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">SVG → NAPLPS (Direct Upload)</h2>
          <p className="text-sm text-gray-500 mb-6">
            Already have an SVG? Upload it directly to convert to a .nap file — no PNG required.
          </p>

          <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
            <span className="text-gray-500 text-sm mb-1">
              {svgUploadFilename ? svgUploadFilename : 'Click or drag an SVG file here'}
            </span>
            <span className="text-xs text-gray-400">.svg files only</span>
            <input
              type="file"
              accept=".svg,image/svg+xml"
              className="hidden"
              onChange={handleSvgUpload}
            />
          </label>

          {svgUploadError && (
            <p className="mt-3 text-sm text-red-700">{svgUploadError}</p>
          )}

          {svgUploadString && (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* SVG Preview */}
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-3">SVG Preview</h3>
                <div className="border border-gray-200 rounded-lg bg-white flex items-center justify-center min-h-[200px] overflow-hidden">
                  <div
                    className="w-full h-auto"
                    style={{ maxHeight: '360px' }}
                    dangerouslySetInnerHTML={{ __html: svgUploadString }}
                  />
                </div>
                <button
                  className="mt-4 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  onClick={handleSvgUploadConvert}
                  disabled={isSvgUploadProcessing}
                >
                  {isSvgUploadProcessing ? 'Converting…' : 'Convert to NAPLPS'}
                </button>
              </div>

              {/* NAP Output */}
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-3">NAPLPS Output</h3>
                {svgUploadNaplpsData ? (
                  <div className="space-y-3">
                    <div className="bg-gray-900 text-green-400 p-3 rounded font-mono text-xs overflow-x-auto" style={{ maxHeight: '200px' }}>
                      <pre>{svgUploadNaplpsData}</pre>
                    </div>
                    <p className="text-xs text-gray-500">
                      {Math.floor(svgUploadNaplpsData.length / 2)} bytes
                    </p>
                    <button
                      className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                      onClick={() => {
                        const base = svgUploadFilename.replace(/\.svg$/i, '') || 'output';
                        downloadBinary(hexToBytes(svgUploadNaplpsData), `${base}.nap`);
                      }}
                    >
                      Download .nap <span className="opacity-75">— TelidonP5 dialect</span>
                    </button>
                    <button
                      className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                      onClick={() => downloadStandardNap(svgUploadString, (svgUploadFilename.replace(/\.svg$/i, '') || 'output') + '_standard')}
                    >
                      Download standard .nap <span className="opacity-75">— real NAPLPS (TURSHOW-readable)</span>
                    </button>
                    <button
                      className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                      onClick={() => {
                        const base = svgUploadFilename.replace(/\.svg$/i, '') || 'output';
                        downloadText(svgUploadNaplpsData, `${base}_naplps.txt`);
                      }}
                    >
                      Download hex (.txt)
                    </button>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg bg-gray-50 flex items-center justify-center min-h-[200px]">
                    <span className="text-gray-400 text-sm">
                      {isSvgUploadProcessing ? 'Converting…' : 'No output yet'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Import real NAPLPS (.nap → SVG) */}
        <div className="mt-12 bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Import NAPLPS (.nap → SVG)</h2>
          <p className="text-sm text-gray-500 mb-6">
            Decode a <em>real</em> NAPLPS file (period videotex art, BBS-era <code>.nap</code>) into
            SVG. Handles standard interleaved coordinates, the indexed palette, polygons, lines and points.
          </p>

          <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
            <span className="text-gray-500 text-sm mb-1">
              {napImportName ? napImportName : 'Click or drag a .nap file here'}
            </span>
            <span className="text-xs text-gray-400">.nap files (real NAPLPS frames)</span>
            <input type="file" accept=".nap,application/octet-stream" className="hidden" onChange={handleNapImport} />
          </label>

          {napImportError && <p className="mt-3 text-sm text-red-700">{napImportError}</p>}

          {napImportSvg && (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-3">Decoded Preview</h3>
                <div
                  className="border border-gray-200 rounded-lg bg-black flex items-center justify-center min-h-[200px] overflow-hidden"
                  dangerouslySetInnerHTML={{ __html: napImportSvg }}
                />
                <button
                  className="mt-4 w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  onClick={() => {
                    const base = napImportName.replace(/\.nap$/i, '') || 'imported';
                    downloadText(`<?xml version="1.0" encoding="UTF-8"?>\n${napImportSvg}`, `${base}.svg`, 'image/svg+xml');
                  }}
                >
                  Download SVG
                </button>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-3">NAPLPS Commands Decoded</h3>
                <div className="border border-gray-200 rounded-lg bg-gray-50 p-3 text-sm font-mono text-gray-700 max-h-[260px] overflow-y-auto">
                  {napImportStats &&
                    Object.entries(napImportStats)
                      .sort((a, b) => b[1] - a[1])
                      .map(([name, count]) => (
                        <div key={name} className="flex justify-between">
                          <span>{name}</span>
                          <span className="text-gray-500">{count}</span>
                        </div>
                      ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SVG Accuracy Test — dev-only diagnostic panel, omitted from production builds */}
        {process.env.NODE_ENV !== 'production' && (
          <div className="mt-8">
            <SvgAccuracyTest />
          </div>
        )}

        {/* Information */}
        <div className="mt-12 bg-white p-6 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">About NAPLPS</h3>
          <div className="prose prose-sm text-gray-600">
            <p>
              NAPLPS (North American Presentation Layer Protocol Syntax) was a graphics language
              developed in the 1980s for videotex and teletext services. It was used by services
              like Prodigy and various cable television systems to display graphics and text.
            </p>
            <p>
              This converter analyzes PNG images and converts them to NAPLPS primitives including:
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>Points and lines</li>
              <li>Polygons and rectangles</li>
              <li>Circles and arcs</li>
              <li>Text elements</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
