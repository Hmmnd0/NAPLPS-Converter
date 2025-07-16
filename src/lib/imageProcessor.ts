import { NAPLPSPrimitive, NAPLPSPoint, NAPLPSColor } from './naplps';

export interface ProcessedImage {
  primitives: NAPLPSPrimitive[];
  width: number;
  height: number;
}

export class ImageProcessor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
  }

  async processImage(file: File): Promise<ProcessedImage> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.canvas.width = img.width;
        this.canvas.height = img.height;
        this.ctx.drawImage(img, 0, 0);
        this.imageData = this.ctx.getImageData(0, 0, img.width, img.height);
        
        const primitives = this.detectPrimitives();
        resolve({
          primitives,
          width: img.width,
          height: img.height
        });
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  private detectPrimitives(): NAPLPSPrimitive[] {
    if (!this.imageData) return [];
    
    const primitives: NAPLPSPrimitive[] = [];
    const { width, height, data } = this.imageData;
    
    // Detect edges and contours
    const edges = this.detectEdges();
    const contours = this.findContours(edges);
    
    // Convert contours to NAPLPS primitives
    for (const contour of contours) {
      if (contour.length >= 3) {
        // Convert contour to polygon
        const points: NAPLPSPoint[] = contour.map(([x, y]) => ({ x, y }));
        const color = this.getAverageColor(contour);
        
        primitives.push({
          type: 'polygon',
          points,
          color,
          fillColor: color
        });
      }
    }
    
    // Detect lines
    const lines = this.detectLines(edges);
    for (const line of lines) {
      primitives.push({
        type: 'line',
        points: [
          { x: line.start.x, y: line.start.y },
          { x: line.end.x, y: line.end.y }
        ],
        color: line.color
      });
    }
    
    // Detect circles
    const circles = this.detectCircles(edges);
    for (const circle of circles) {
      primitives.push({
        type: 'circle',
        points: [{ x: circle.center.x, y: circle.center.y }],
        color: circle.color,
        radius: circle.radius
      });
    }
    
    return primitives;
  }

  private detectEdges(): boolean[][] {
    if (!this.imageData) return [];
    
    const { width, height, data } = this.imageData;
    const edges: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
    
    // Sobel edge detection
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        // Calculate gradient
        const gx = this.calculateGradientX(x, y, width, data);
        const gy = this.calculateGradientY(x, y, width, data);
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        
        if (magnitude > 50) { // Threshold for edge detection
          edges[y][x] = true;
        }
      }
    }
    
    return edges;
  }

  private calculateGradientX(x: number, y: number, width: number, data: Uint8ClampedArray): number {
    const idx = (y * width + x) * 4;
    const left = data[idx - 4];
    const right = data[idx + 4];
    return right - left;
  }

  private calculateGradientY(x: number, y: number, width: number, data: Uint8ClampedArray): number {
    const idx = (y * width + x) * 4;
    const top = data[idx - width * 4];
    const bottom = data[idx + width * 4];
    return bottom - top;
  }

  private findContours(edges: boolean[][]): [number, number][][] {
    const contours: [number, number][][] = [];
    const visited = new Set<string>();
    
    for (let y = 0; y < edges.length; y++) {
      for (let x = 0; x < edges[y].length; x++) {
        if (edges[y][x] && !visited.has(`${x},${y}`)) {
          const contour = this.traceContour(x, y, edges, visited);
          if (contour.length > 10) { // Minimum contour size
            contours.push(contour);
          }
        }
      }
    }
    
    return contours;
  }

  private traceContour(
    startX: number, 
    startY: number, 
    edges: boolean[][], 
    visited: Set<string>
  ): [number, number][] {
    const contour: [number, number][] = [];
    let x = startX;
    let y = startY;
    
    do {
      contour.push([x, y]);
      visited.add(`${x},${y}`);
      
      // Find next edge pixel
      const next = this.findNextEdgePixel(x, y, edges, visited);
      if (!next) break;
      
      x = next[0];
      y = next[1];
    } while (x !== startX || y !== startY);
    
    return contour;
  }

  private findNextEdgePixel(
    x: number, 
    y: number, 
    edges: boolean[][], 
    visited: Set<string>
  ): [number, number] | null {
    const directions = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];
    
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      
      if (nx >= 0 && nx < edges[0].length && 
          ny >= 0 && ny < edges.length &&
          edges[ny][nx] && !visited.has(`${nx},${ny}`)) {
        return [nx, ny];
      }
    }
    
    return null;
  }

  private detectLines(edges: boolean[][]): Array<{
    start: NAPLPSPoint;
    end: NAPLPSPoint;
    color: NAPLPSColor;
  }> {
    const lines: Array<{
      start: NAPLPSPoint;
      end: NAPLPSPoint;
      color: NAPLPSColor;
    }> = [];
    
    // Hough transform for line detection
    const houghSpace = new Map<string, number>();
    const width = edges[0].length;
    const height = edges.length;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (edges[y][x]) {
          // For each edge point, calculate possible lines
          for (let angle = 0; angle < 180; angle += 5) {
            const rad = (angle * Math.PI) / 180;
            const r = x * Math.cos(rad) + y * Math.sin(rad);
            const key = `${Math.round(r)},${angle}`;
            houghSpace.set(key, (houghSpace.get(key) || 0) + 1);
          }
        }
      }
    }
    
    // Find peaks in Hough space
    const threshold = Math.max(...houghSpace.values()) * 0.3;
    for (const [key, count] of houghSpace) {
      if (count > threshold) {
        const [r, angle] = key.split(',').map(Number);
        const rad = (angle * Math.PI) / 180;
        
        // Convert back to line coordinates
        const x1 = r * Math.cos(rad);
        const y1 = r * Math.sin(rad);
        const x2 = x1 + Math.sin(rad) * 100;
        const y2 = y1 - Math.cos(rad) * 100;
        
        lines.push({
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          color: { r: 0, g: 0, b: 0 } // Default black
        });
      }
    }
    
    return lines;
  }

  private detectCircles(edges: boolean[][]): Array<{
    center: NAPLPSPoint;
    radius: number;
    color: NAPLPSColor;
  }> {
    const circles: Array<{
      center: NAPLPSPoint;
      radius: number;
      color: NAPLPSColor;
    }> = [];
    
    // Simple circle detection using Hough transform
    const width = edges[0].length;
    const height = edges.length;
    const maxRadius = Math.min(width, height) / 4;
    
    for (let y = 0; y < height; y += 5) {
      for (let x = 0; x < width; x += 5) {
        if (edges[y][x]) {
          // Check for circles with different radii
          for (let r = 10; r < maxRadius; r += 5) {
            let circlePoints = 0;
            const totalPoints = Math.floor(2 * Math.PI * r);
            
            for (let angle = 0; angle < 360; angle += 10) {
              const rad = (angle * Math.PI) / 180;
              const cx = Math.round(x + r * Math.cos(rad));
              const cy = Math.round(y + r * Math.sin(rad));
              
              if (cx >= 0 && cx < width && cy >= 0 && cy < height && edges[cy][cx]) {
                circlePoints++;
              }
            }
            
            if (circlePoints > totalPoints * 0.3) {
              circles.push({
                center: { x, y },
                radius: r,
                color: { r: 0, g: 0, b: 0 } // Default black
              });
              break; // Found a circle, move to next center
            }
          }
        }
      }
    }
    
    return circles;
  }

  private getAverageColor(points: [number, number][]): NAPLPSColor {
    if (!this.imageData || points.length === 0) {
      return { r: 0, g: 0, b: 0 };
    }
    
    const { width, data } = this.imageData;
    let r = 0, g = 0, b = 0;
    
    for (const [x, y] of points) {
      const idx = (y * width + x) * 4;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
    }
    
    const count = points.length;
    return {
      r: Math.round(r / count),
      g: Math.round(g / count),
      b: Math.round(b / count)
    };
  }
} 