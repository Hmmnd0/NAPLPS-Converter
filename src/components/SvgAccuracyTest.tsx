'use client';

import React, { useState } from 'react';
import { pixelPngToSvg } from '@/lib/pixelToSvg';

export default function SvgAccuracyTest() {
  const [testImage, setTestImage] = useState<string | null>(null);
  const [svgOutput, setSvgOutput] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string>('');

  const handleTestImage = async (file: File) => {
    setIsProcessing(true);
    setError('');
    
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
    <div className="p-4 border rounded-lg bg-gray-50">
      <h3 className="text-lg font-semibold mb-4">SVG Accuracy Test</h3>
      
      <input
        type="file"
        accept="image/png"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleTestImage(file);
        }}
        className="mb-4"
      />
      
      {error && (
        <div className="text-red-600 mb-4">{error}</div>
      )}
      
      {isProcessing && (
        <div className="text-blue-600 mb-4">Processing...</div>
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