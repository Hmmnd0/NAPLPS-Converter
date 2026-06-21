'use client';

import React, { useState } from 'react';
import { pixelPngToSvg } from '@/lib/pixelToSvg';

export default function SvgAccuracyTest() {
  const [testImage, setTestImage] = useState<string | null>(null);
  const [svgOutput, setSvgOutput] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');

  const handleTestImage = async (file: File) => {
    setIsProcessing(true);
    setError('');
    setFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setTestImage(dataUrl);
      
      try {
        const svg = await pixelPngToSvg(dataUrl);
        // Patch: ensure svgOutput is always a string
        setSvgOutput(typeof svg === 'string' ? svg : svg.svg);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setIsProcessing(false);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-zinc-900 mb-4">SVG Accuracy Test</h3>

      <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-zinc-300 rounded-xl cursor-pointer bg-zinc-50 hover:bg-zinc-100 transition-colors">
        <span className="text-zinc-500 text-sm mb-1">
          {fileName ? fileName : 'Click or drag a PNG file here'}
        </span>
        <span className="text-xs text-zinc-400">.png files only</span>
        <input
          type="file"
          accept="image/png"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleTestImage(file);
          }}
        />
      </label>

      {error && (
        <div className="text-red-600 mt-4">{error}</div>
      )}

      {isProcessing && (
        <div className="text-indigo-600 mt-4">Processing...</div>
      )}
      
      {testImage && svgOutput && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="font-medium mb-2">Original PNG</h4>
            <img 
              src={testImage} 
              alt="Original" 
              className="border max-w-full"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
          <div>
            <h4 className="font-medium mb-2">Generated SVG</h4>
            <div 
              className="border max-w-full"
              dangerouslySetInnerHTML={{ __html: svgOutput }}
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        </div>
      )}
    </div>
  );
} 