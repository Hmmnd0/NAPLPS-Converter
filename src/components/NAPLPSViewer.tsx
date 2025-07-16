'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { NAPLPSPrimitive, NAPLPSPoint, NAPLPSColor } from '@/lib/naplps';

interface NAPLPSViewerProps {
  primitives: NAPLPSPrimitive[];
  width: number;
  height: number;
  className?: string;
}

export default function NAPLPSViewer({ 
  primitives, 
  width, 
  height, 
  className = '' 
}: NAPLPSViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawPrimitive = useCallback((ctx: CanvasRenderingContext2D, primitive: NAPLPSPrimitive) => {
    if (!primitive.points.length) return;

    // Set colors
    if (primitive.color) {
      ctx.strokeStyle = `rgb(${primitive.color.r}, ${primitive.color.g}, ${primitive.color.b})`;
      ctx.fillStyle = `rgb(${primitive.color.r}, ${primitive.color.g}, ${primitive.color.b})`;
    }

    switch (primitive.type) {
      case 'point':
        if (primitive.points.length > 0) {
          const point = primitive.points[0];
          ctx.beginPath();
          ctx.arc(point.x, point.y, 1, 0, 2 * Math.PI);
          ctx.fill();
        }
        break;

      case 'line':
        if (primitive.points.length >= 2) {
          const [start, end] = primitive.points;
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
        }
        break;

      case 'polyline':
        if (primitive.points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(primitive.points[0].x, primitive.points[0].y);
          for (let i = 1; i < primitive.points.length; i++) {
            ctx.lineTo(primitive.points[i].x, primitive.points[i].y);
          }
          ctx.stroke();
        }
        break;

      case 'polygon':
        if (primitive.points.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(primitive.points[0].x, primitive.points[0].y);
          for (let i = 1; i < primitive.points.length; i++) {
            ctx.lineTo(primitive.points[i].x, primitive.points[i].y);
          }
          ctx.closePath();
          if (primitive.fillColor) {
            ctx.fillStyle = `rgb(${primitive.fillColor.r}, ${primitive.fillColor.g}, ${primitive.fillColor.b})`;
            ctx.fill();
          }
          ctx.stroke();
        }
        break;

      case 'rectangle':
        if (primitive.points.length >= 2) {
          const [topLeft, bottomRight] = primitive.points;
          const rectWidth = bottomRight.x - topLeft.x;
          const rectHeight = bottomRight.y - topLeft.y;
          
          if (primitive.fillColor) {
            ctx.fillStyle = `rgb(${primitive.fillColor.r}, ${primitive.fillColor.g}, ${primitive.fillColor.b})`;
            ctx.fillRect(topLeft.x, topLeft.y, rectWidth, rectHeight);
          }
          ctx.strokeRect(topLeft.x, topLeft.y, rectWidth, rectHeight);
        }
        break;

      case 'circle':
        if (primitive.points.length > 0 && primitive.radius) {
          const center = primitive.points[0];
          ctx.beginPath();
          ctx.arc(center.x, center.y, primitive.radius, 0, 2 * Math.PI);
          if (primitive.fillColor) {
            ctx.fillStyle = `rgb(${primitive.fillColor.r}, ${primitive.fillColor.g}, ${primitive.fillColor.b})`;
            ctx.fill();
          }
          ctx.stroke();
        }
        break;

      case 'text':
        if (primitive.points.length > 0 && primitive.text) {
          const position = primitive.points[0];
          ctx.font = '12px monospace';
          ctx.textBaseline = 'top';
          ctx.fillText(primitive.text, position.x, position.y);
        }
        break;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Set background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Draw all primitives
    primitives.forEach(primitive => {
      drawPrimitive(ctx, primitive);
    });
  }, [primitives, width, height, drawPrimitive]);

  return (
    <div className={`border border-gray-300 rounded-lg overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="block w-full h-auto"
        style={{ maxWidth: '100%', height: 'auto' }}
      />
    </div>
  );
} 