'use client';

import React, { useState } from 'react';
import FileUpload from '@/components/FileUpload';
import SvgAccuracyTest from '@/components/SvgAccuracyTest';
import { pixelPngToSvg } from '@/lib/pixelToSvg';
import { svgToNaplps, svgToNaplpsFoxtoolbox, getConversionStats } from '@/lib/svgToNaplps';

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
  const [useFoxtoolboxApproach, setUseFoxtoolboxApproach] = useState<boolean>(true);

  // SVG direct upload → NAP state
  const [svgUploadString, setSvgUploadString] = useState<string | null>(null);
  const [svgUploadFilename, setSvgUploadFilename] = useState<string>('');
  const [svgUploadNaplpsData, setSvgUploadNaplpsData] = useState<string>('');
  const [isSvgUploadProcessing, setIsSvgUploadProcessing] = useState<boolean>(false);
  const [svgUploadError, setSvgUploadError] = useState<string>('');

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
      // Create preview
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        setOriginalPreview(dataUrl);

        // Pixel-perfect SVG vectorization
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
      // Get image dimensions for NAPLPS conversion
      const img = new Image();
      img.onload = async () => {
        try {
          const naplps = useFoxtoolboxApproach 
            ? await svgToNaplpsFoxtoolbox(svgString, img.width, img.height)
            : await svgToNaplps(svgString, img.width, img.height);
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

  // SVG direct upload handler
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
      // Extract dimensions from SVG viewBox or width/height attributes
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgUploadString, 'image/svg+xml');
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

  const downloadSvgUploadNap = (hex: string, filename: string) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Optionally, add a button to run NAPLPS conversion from SVG later

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Viewer Button */}
        <div className="flex justify-end mb-4">
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
                    console.log('Download SVG button clicked');
                    const svgWithHeader = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n${svgString}`;
                    console.log('SVG length:', svgWithHeader.length);
                    try {
                      const blob = new Blob([svgWithHeader], { type: 'image/svg+xml' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'output.svg';
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      alert('Failed to download SVG: ' + err);
                    }
                  }}
                >
                  Download SVG
                </button>
              )}
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between p-2 bg-gray-100 rounded-lg">
                  <span className="text-sm font-medium">NAPLPS Approach:</span>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useFoxtoolboxApproach}
                      onChange={(e) => setUseFoxtoolboxApproach(e.target.checked)}
                      className="mr-2"
                    />
                    <span className="text-sm">
                      {useFoxtoolboxApproach ? 'Foxtoolbox (Proper)' : 'ASCII-Safe (Legacy)'}
                    </span>
                  </label>
                </div>
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
                      onClick={() => {
                        const blob = new Blob([naplpsData], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'naplps_output.txt';
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Download NAPLPS File
                    </button>
                    <button
                      onClick={() => {
                        // Convert hex string to binary
                        const hex = naplpsData.replace(/\s+/g, '');
                        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
                          alert('Invalid hex string: cannot export binary.');
                          return;
                        }
                        const bytes = new Uint8Array(hex.length / 2);
                        for (let i = 0; i < hex.length; i += 2) {
                          bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                        }
                        const blob = new Blob([bytes], { type: 'application/octet-stream' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'naplps_output.nap';
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="w-full mt-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                    >
                      Download NAPLPS (.nap)
                    </button>
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
                {/* Test Files Section */}
                <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Test Files</h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => {
                        import('@/lib/naplps-spec').then(({ generateTelidonP5TextFile }) => {
                          const hex = generateTelidonP5TextFile('HELLO');
                          const bytes = new Uint8Array(hex.length / 2);
                          for (let i = 0; i < hex.length; i += 2) {
                            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                          }
                          const blob = new Blob([bytes], { type: 'application/octet-stream' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'telidonp5_text_test.nap';
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        });
                      }}
                      className="w-full px-3 py-2 bg-green-700 text-white text-sm rounded-md hover:bg-green-800 transition-colors flex items-center justify-center gap-2"
                    >
                      <span className="w-2 h-2 bg-white rounded-full"></span>
                      TelidonP5.js Text Test
                    </button>
                    <button
                      onClick={() => {
                        import('@/lib/naplps-spec').then(({ generateTelidonP5RectangleFile }) => {
                          const hex = generateTelidonP5RectangleFile();
                          const bytes = new Uint8Array(hex.length / 2);
                          for (let i = 0; i < hex.length; i += 2) {
                            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                          }
                          const blob = new Blob([bytes], { type: 'application/octet-stream' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'telidonp5_rectangle_test.nap';
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        });
                      }}
                      className="w-full px-3 py-2 bg-red-700 text-white text-sm rounded-md hover:bg-red-800 transition-colors flex items-center justify-center gap-2"
                    >
                      <span className="w-2 h-2 bg-white rounded-full"></span>
                      TelidonP5.js Rectangle Test
                    </button>
                    <button
                      onClick={() => {
                        import('@/lib/naplps-spec').then(({ generateTelidonP5HybridFile }) => {
                          const hex = generateTelidonP5HybridFile('HELLO');
                          const bytes = new Uint8Array(hex.length / 2);
                          for (let i = 0; i < hex.length; i += 2) {
                            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                          }
                          const blob = new Blob([bytes], { type: 'application/octet-stream' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'telidonp5_hybrid_test.nap';
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        });
                      }}
                      className="w-full px-3 py-2 bg-purple-700 text-white text-sm rounded-md hover:bg-purple-800 transition-colors flex items-center justify-center gap-2"
                    >
                      <span className="w-2 h-2 bg-white rounded-full"></span>
                      TelidonP5.js Hybrid Test
                    </button>
                    <button
                      onClick={() => {
                        import('@/lib/naplps-spec').then(({ generateTelidonP5PolygonRectangleFile }) => {
                          const hex = generateTelidonP5PolygonRectangleFile();
                          const bytes = new Uint8Array(hex.length / 2);
                          for (let i = 0; i < hex.length; i += 2) {
                            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                          }
                          const blob = new Blob([bytes], { type: 'application/octet-stream' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'telidonp5_polygon_rectangle_test.nap';
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        });
                      }}
                      className="w-full px-3 py-2 bg-red-700 text-white text-sm rounded-md hover:bg-red-800 transition-colors flex items-center justify-center gap-2"
                    >
                      <span className="w-2 h-2 bg-white rounded-full"></span>
                      TelidonP5.js Polygon Rectangle Test
                    </button>
                    {/* Minimal NAPLPS Rectangle Download Button */}
                    <button
                      className="w-full px-3 py-2 bg-blue-700 text-white text-sm rounded-md hover:bg-blue-800 transition-colors flex items-center justify-center gap-2"
                      onClick={async () => {
                        const { generateTelidonP5RectangleFile } = await import('@/lib/naplps-spec');
                        const hex = generateTelidonP5RectangleFile();
                        const bytes = new Uint8Array(hex.length / 2);
                        for (let i = 0; i < hex.length; i += 2) {
                          bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                        }
                        const blob = new Blob([bytes], { type: 'application/octet-stream' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'minimal-rectangle.nap';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <span className="w-2 h-2 bg-white rounded-full"></span>
                      Minimal NAPLPS Rectangle
                    </button>
                    {/* Bit Test Polygon NAPLPS Button */}
                    <button
                      className="w-full px-3 py-2 bg-yellow-700 text-white text-sm rounded-md hover:bg-yellow-800 transition-colors flex items-center justify-center gap-2"
                      onClick={async () => {
                        const { generateBitTestPolygonNaplps } = await import('@/lib/naplps');
                        const naplpsData = generateBitTestPolygonNaplps();
                        const blob = new Blob([naplpsData], { type: 'application/octet-stream' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'bit-test-polygon.nap';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <span className="w-2 h-2 bg-white rounded-full"></span>
                      Bit Test Polygon (Yellow Rectangle)
                    </button>
                    {/* Custom Rectangle (Red) NAPLPS Button */}
                    <button
                      className="w-full px-3 py-2 bg-red-700 text-white text-sm rounded-md hover:bg-red-800 transition-colors flex items-center justify-center gap-2"
                      onClick={async () => {
                        const { generateNaplpsPolygonFile } = await import('@/lib/naplps');
                        // 5-point rectangle in 512x512 grid (explicitly closed)
                        const points = [
                          { x: 160, y: 120 },
                          { x: 480, y: 120 },
                          { x: 480, y: 360 },
                          { x: 160, y: 360 },
                          { x: 160, y: 120 } // Repeat first point to close
                        ];
                        // Red (Telidon: 0x52)
                        const colorByte = 0x52;
                        const naplpsData = generateNaplpsPolygonFile(points, colorByte);
                        const blob = new Blob([naplpsData], { type: 'application/octet-stream' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'custom-rectangle-red.nap';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <span className="w-2 h-2 bg-white rounded-full"></span>
                      Custom Rectangle (Red)
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Use these to test the Telidon viewer
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* NAPLPS Data (disabled for now) */}
        {/* {naplpsData && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">NAPLPS Data</h2>
              <button
                onClick={downloadNaplps}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Download NAPLPS File
              </button>
            </div>
            
            <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-x-auto">
              <pre>{naplpsData}</pre>
            </div>
            
            <div className="mt-4 text-sm text-gray-600">
              <p>Generated {processedImage?.primitives.length || 0} primitives</p>
              <p>Data size: {Math.round(naplpsData.length / 2)} bytes</p>
            </div>
          </div>
        )} */}

        {/* SVG → NAP Direct Upload */}
        <div className="mt-12 bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">SVG → NAPLPS (Direct Upload)</h2>
          <p className="text-sm text-gray-500 mb-6">
            Already have an SVG? Upload it directly to convert to a .nap file — no PNG required.
          </p>

          {/* File input */}
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
                        downloadSvgUploadNap(svgUploadNaplpsData, `${base}.nap`);
                      }}
                    >
                      Download .nap
                    </button>
                    <button
                      className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                      onClick={() => {
                        const base = svgUploadFilename.replace(/\.svg$/i, '') || 'output';
                        const blob = new Blob([svgUploadNaplpsData], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${base}_naplps.txt`;
                        a.click();
                        URL.revokeObjectURL(url);
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

        {/* SVG Accuracy Test */}
        <div className="mt-8">
          <SvgAccuracyTest />
        </div>

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
