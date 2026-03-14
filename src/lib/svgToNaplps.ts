import { NAPLPSEncoder, NAPLPSPoint, NAPLPSColor } from './naplps';
import { NAPLPSFoxtoolboxEncoder } from './naplps-foxtoolbox';

interface Pixel {
  x: number;
  y: number;
  color: string;
}

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

// Telidon 16-color palette (exact values from Telidon specification)
const TELIDON_PALETTE = [
  { r: 0, g: 0, b: 0 },         // 0: Black
  { r: 0, g: 0, b: 255 },       // 1: Blue
  { r: 0, g: 255, b: 0 },       // 2: Green
  { r: 0, g: 255, b: 255 },     // 3: Cyan
  { r: 255, g: 0, b: 0 },       // 4: Red
  { r: 255, g: 0, b: 255 },     // 5: Magenta
  { r: 165, g: 42, b: 42 },     // 6: Brown
  { r: 192, g: 192, b: 192 },   // 7: Light Gray
  { r: 128, g: 128, b: 128 },   // 8: Dark Gray
  { r: 0, g: 0, b: 255 },       // 9: Light Blue
  { r: 0, g: 255, b: 0 },       // 10: Light Green
  { r: 0, g: 255, b: 255 },     // 11: Light Cyan
  { r: 255, g: 0, b: 0 },       // 12: Light Red
  { r: 255, g: 0, b: 255 },     // 13: Light Magenta
  { r: 255, g: 255, b: 0 },     // 14: Yellow
  { r: 255, g: 255, b: 255 },   // 15: White
];

// Parse SVG and extract pixel rectangles
function parseSvgToPixels(svgString: string): Rectangle[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const rects = doc.querySelectorAll('rect');

  console.log(`Parsing ${rects.length} pixels from SVG...`);

  const pixels: Pixel[] = [];
  rects.forEach(rect => {
    const x = parseInt(rect.getAttribute('x') || '0');
    const y = parseInt(rect.getAttribute('y') || '0');
    const color = rect.getAttribute('fill') || '#000000';
    pixels.push({ x, y, color });
  });

  // Group adjacent pixels of the same color into rectangles
  return groupPixelsIntoRectangles(pixels);
}

// Group adjacent pixels into optimal rectangles
function groupPixelsIntoRectangles(pixels: Pixel[]): Rectangle[] {
  const rectangles: Rectangle[] = [];

  // Sort pixels by color for efficient grouping
  const pixelsByColor = new Map<string, Pixel[]>();
  pixels.forEach(pixel => {
    if (!pixelsByColor.has(pixel.color)) {
      pixelsByColor.set(pixel.color, []);
    }
    pixelsByColor.get(pixel.color)!.push(pixel);
  });

  console.log(`Grouping pixels by ${pixelsByColor.size} colors...`);

  // For each color, find optimal rectangles using a per-color grid
  for (const [, colorPixels] of pixelsByColor) {
    const colorVisited = new Set<string>();
    // Build a grid containing only pixels of this color
    const colorGrid = new Map<string, boolean>();
    for (const p of colorPixels) {
      colorGrid.set(`${p.x},${p.y}`, true);
    }

    for (const pixel of colorPixels) {
      const key = `${pixel.x},${pixel.y}`;
      if (colorVisited.has(key)) continue;

      // Find the largest possible rectangle starting from this pixel
      const rect = findLargestRectangleOptimized(pixel, colorVisited, colorGrid);
      rectangles.push(rect);
    }
  }

  console.log(`Created ${rectangles.length} rectangles`);
  return rectangles;
}

// Optimized rectangle finding using a per-color grid lookup
function findLargestRectangleOptimized(
  startPixel: Pixel,
  visited: Set<string>,
  colorGrid: Map<string, boolean>
): Rectangle {
  const color = startPixel.color;

  // Find maximum width (only unvisited pixels of the same color)
  let maxWidth = 1;
  for (let w = 1; ; w++) {
    const key = `${startPixel.x + w},${startPixel.y}`;
    if (!colorGrid.has(key) || visited.has(key)) break;
    maxWidth = w + 1;
  }

  // Find optimal rectangle
  let bestArea = 1;
  let bestWidth = 1;
  let bestHeight = 1;

  for (let width = 1; width <= maxWidth; width++) {
    let height = 1;

    while (true) {
      let canExtend = true;

      for (let x = 0; x < width; x++) {
        const key = `${startPixel.x + x},${startPixel.y + height}`;
        if (!colorGrid.has(key) || visited.has(key)) {
          canExtend = false;
          break;
        }
      }

      if (!canExtend) break;
      height++;
    }

    const area = width * height;
    if (area > bestArea) {
      bestArea = area;
      bestWidth = width;
      bestHeight = height;
    }
  }

  // Mark all pixels in the rectangle as visited
  for (let y = 0; y < bestHeight; y++) {
    for (let x = 0; x < bestWidth; x++) {
      visited.add(`${startPixel.x + x},${startPixel.y + y}`);
    }
  }

  return {
    x: startPixel.x,
    y: startPixel.y,
    width: bestWidth,
    height: bestHeight,
    color
  };
}

// Replace hexToRgb with parseColor
function parseColor(color: string): NAPLPSColor {
  // Handle rgb(r,g,b)
  const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10)
    };
  }
  // Handle hex #rrggbb
  const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (hexMatch) {
    return {
      r: parseInt(hexMatch[1], 16),
      g: parseInt(hexMatch[2], 16),
      b: parseInt(hexMatch[3], 16)
    };
  }
  // Fallback to black
  console.warn('Unrecognized color format:', color);
  return { r: 0, g: 0, b: 0 };
}

// Improved color quantization using Telidon palette
function quantizeColor(color: NAPLPSColor): NAPLPSColor {
  let bestIndex = 0;
  let minDistance = Infinity;
  
  // Find closest color in Telidon palette using perceptual distance
  for (let i = 0; i < TELIDON_PALETTE.length; i++) {
    const paletteColor = TELIDON_PALETTE[i];
    const distance = calculateColorDistance(color, paletteColor);
    if (distance < minDistance) {
      minDistance = distance;
      bestIndex = i;
    }
  }
  
  return TELIDON_PALETTE[bestIndex];
}

// Perceptual color distance calculation (CIE76)
function calculateColorDistance(color1: NAPLPSColor, color2: NAPLPSColor): number {
  // Convert RGB to Lab for better perceptual distance
  const lab1 = rgbToLab(color1);
  const lab2 = rgbToLab(color2);
  
  const deltaL = lab1.L - lab2.L;
  const deltaA = lab1.a - lab2.a;
  const deltaB = lab1.b - lab2.b;
  
  return Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB);
}

// RGB to Lab conversion for perceptual color distance
function rgbToLab(rgb: NAPLPSColor): { L: number, a: number, b: number } {
  // Simplified RGB to Lab conversion
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  
  // Convert to XYZ
  const x = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  
  // Convert to Lab
  const L = 116 * Math.pow(y, 1/3) - 16;
  const a = 500 * (Math.pow(x, 1/3) - Math.pow(y, 1/3));
  const b_val = 200 * (Math.pow(y, 1/3) - Math.pow(z, 1/3));
  
  return { L, a, b: b_val };
}

// Rectangle optimization: merge adjacent rectangles of the same color
function optimizeRectangles(rectangles: Rectangle[]): Rectangle[] {
  const optimized: Rectangle[] = [];
  const merged = new Set<number>();
  
  for (let i = 0; i < rectangles.length; i++) {
    if (merged.has(i)) continue;
    
    const current = rectangles[i];
    let mergedCount = 0;
    
    // Try to merge with other rectangles of the same color
    for (let j = i + 1; j < rectangles.length; j++) {
      if (merged.has(j) || rectangles[j].color !== current.color) continue;
      
      const other = rectangles[j];
      
      // Check if rectangles can be merged horizontally
      if (current.y === other.y && current.height === other.height) {
        if (current.x + current.width === other.x) {
          // Merge horizontally
          current.width += other.width;
          merged.add(j);
          mergedCount++;
        } else if (other.x + other.width === current.x) {
          // Merge horizontally (other comes first)
          current.x = other.x;
          current.width += other.width;
          merged.add(j);
          mergedCount++;
        }
      }
      
      // Check if rectangles can be merged vertically
      if (current.x === other.x && current.width === other.width) {
        if (current.y + current.height === other.y) {
          // Merge vertically
          current.height += other.height;
          merged.add(j);
          mergedCount++;
        } else if (other.y + other.height === current.y) {
          // Merge vertically (other comes first)
          current.y = other.y;
          current.height += other.height;
          merged.add(j);
          mergedCount++;
        }
      }
    }
    
    optimized.push(current);
    if (mergedCount > 0) {
      console.log(`Merged ${mergedCount} rectangles into one`);
    }
  }
  
  console.log(`Optimized ${rectangles.length} rectangles to ${optimized.length} rectangles`);
  return optimized;
}

// Coordinate scaling to ensure coordinates fit within NAPLPS range
function scaleCoordinates(rectangles: Rectangle[], maxWidth: number, maxHeight: number): Rectangle[] {
  console.log(`Scaling coordinates for image ${maxWidth}x${maxHeight}`);

  const scaleFactorX = 63 / maxWidth;
  const scaleFactorY = 63 / maxHeight;

  return rectangles.map(rect => {
    const scaledRect = {
      ...rect,
      x: Math.round(rect.x * scaleFactorX),
      y: Math.round(rect.y * scaleFactorY),
      width: Math.max(1, Math.round(rect.width * scaleFactorX)),
      height: Math.max(1, Math.round(rect.height * scaleFactorY))
    };

    // Clamp coordinates to 0-63 range
    scaledRect.x = Math.max(0, Math.min(63, scaledRect.x));
    scaledRect.y = Math.max(0, Math.min(63, scaledRect.y));
    scaledRect.width = Math.max(1, Math.min(63 - scaledRect.x, scaledRect.width));
    scaledRect.height = Math.max(1, Math.min(63 - scaledRect.y, scaledRect.height));

    return scaledRect;
  });
}

// Accept palette as argument
export async function svgToNaplps(svgString: string, width: number, height: number): Promise<string> {
  try {
    console.log('Starting SVG to NAPLPS conversion...');
    let rectangles = parseSvgToPixels(svgString);
    
    // Optimize rectangles by merging adjacent ones
    console.log('Optimizing rectangles...');
    rectangles = optimizeRectangles(rectangles);
    
    // Scale coordinates to fit NAPLPS range
    console.log('Scaling coordinates...');
    console.log(`Original image size: ${width}x${height}`);
    rectangles = scaleCoordinates(rectangles, width, height);
    console.log(`After scaling, first few rectangles:`, rectangles.slice(0, 3));
    
    // Create encoder with NAPLPS coordinate system dimensions (64x64)
    const encoder = new NAPLPSEncoder(64, 64);
    
    // No palette setup needed - colors are handled directly in setColor
    
    // Convert rectangles to NAPLPS primitives with improved color quantization
    for (const rect of rectangles) {
      const originalColor = parseColor(rect.color);
      const quantizedColor = quantizeColor(originalColor);

      const topLeft: NAPLPSPoint = { x: rect.x, y: rect.y };
      const bottomRight: NAPLPSPoint = {
        x: rect.x + rect.width - 1,
        y: rect.y + rect.height - 1
      };

      encoder.setColor(quantizedColor);
      encoder.addRectangle(topLeft, bottomRight);
    }
    
    const hexString = encoder.getHexString();
    console.log(`[DEBUG] Generated NAPLPS hex string (first 100 chars): ${hexString.substring(0, 100)}...`);
    console.log(`[DEBUG] Total NAPLPS data length: ${hexString.length / 2} bytes`);
    return hexString;
  } catch (error) {
    console.error('Error in svgToNaplps:', error);
    throw error;
  }
}

// New function using Foxtoolbox approach
export async function svgToNaplpsFoxtoolbox(svgString: string, width: number, height: number): Promise<string> {
  try {
    console.log('Starting SVG to NAPLPS conversion (Foxtoolbox approach)...');
    let rectangles = parseSvgToPixels(svgString);
    
    // Optimize rectangles by merging adjacent ones
    console.log('Optimizing rectangles...');
    rectangles = optimizeRectangles(rectangles);
    
    // Scale coordinates to fractional (0.0-1.0) range
    console.log('Scaling coordinates to fractional range...');
    console.log(`Original image size: ${width}x${height}`);
    
    const encoder = new NAPLPSFoxtoolboxEncoder();
    
    // Convert rectangles to NAPLPS primitives using Foxtoolbox approach
    for (const rect of rectangles) {
      const originalColor = parseColor(rect.color);
      const quantizedColor = quantizeColor(originalColor);

      const topLeftX = rect.x / width;
      const topLeftY = rect.y / height;
      const bottomRightX = (rect.x + rect.width) / width;
      const bottomRightY = (rect.y + rect.height) / height;

      encoder.setColor(quantizedColor);
      encoder.addFilledRectangle(
        { x: topLeftX, y: topLeftY },
        { x: bottomRightX, y: bottomRightY }
      );
    }
    
    // End graphics data
    encoder.endGraphics();
    
    const hexString = encoder.getHexString();
    console.log(`[DEBUG] Generated Foxtoolbox NAPLPS hex string (first 100 chars): ${hexString.substring(0, 100)}...`);
    console.log(`[DEBUG] Total Foxtoolbox NAPLPS data length: ${hexString.length / 2} bytes`);
    
    return hexString;
  } catch (error) {
    console.error('Error in svgToNaplpsFoxtoolbox:', error);
    throw error;
  }
}

// Minimal working NAPLPS generator for testing
export function generateMinimalNaplps(): string {
  const width = 64;
  const height = 64;
  const encoder = new NAPLPSEncoder(width, height);
  // Classic Telidon 16-color palette (4-bit RGB, 0-15 scaled to 0-255)
  const telidonPalette = [
    { r: 0, g: 0, b: 0 },         // 0: Black
    { r: 0, g: 0, b: 255 },       // 1: Blue
    { r: 0, g: 255, b: 0 },       // 2: Green
    { r: 0, g: 255, b: 255 },     // 3: Cyan
    { r: 255, g: 0, b: 0 },       // 4: Red
    { r: 255, g: 0, b: 255 },     // 5: Magenta
    { r: 165, g: 42, b: 42 },     // 6: Brown
    { r: 192, g: 192, b: 192 },   // 7: Light Gray
    { r: 128, g: 128, b: 128 },   // 8: Dark Gray
    { r: 0, g: 0, b: 255 },       // 9: Light Blue
    { r: 0, g: 255, b: 0 },       // 10: Light Green
    { r: 0, g: 255, b: 255 },     // 11: Light Cyan
    { r: 255, g: 0, b: 0 },       // 12: Light Red
    { r: 255, g: 0, b: 255 },     // 13: Light Magenta
    { r: 255, g: 255, b: 0 },     // 14: Yellow
    { r: 255, g: 255, b: 255 },   // 15: White
  ];
  
  console.log('[DEBUG] Setting up Telidon palette...');
  telidonPalette.forEach((color, i) => {
    console.log(`[DEBUG] Palette ${i}: RGB(${color.r},${color.g},${color.b})`);
    encoder.setColorRegister(i, color);
  });
  
  console.log('[DEBUG] Setting background to black...');
  encoder.setBackground({ r: 0, g: 0, b: 0 });
  
  console.log('[DEBUG] Drawing white rectangle using palette index 15...');
  encoder.addRectangle(
    { x: 10, y: 10 },
    { x: 53, y: 53 }
  );
  
  // Debug: log first 32 bytes of binary file
  const data = encoder.getData();
  console.log('[DEBUG] First 32 bytes of minimal NAPLPS binary:', Array.from(data.slice(0, 32)));
  console.log('[DEBUG] Total NAPLPS data length:', data.length);
  
  // Log the hex string for manual inspection
  const hexString = encoder.getHexString();
  console.log('[DEBUG] Full NAPLPS hex string:', hexString);
  
  return hexString;
}

// Get statistics about the conversion
export function getConversionStats(svgString: string): {
  totalPixels: number;
  totalRectangles: number;
  optimizedRectangles: number;
  compressionRatio: number;
  optimizationRatio: number;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const rects = doc.querySelectorAll('rect');
  const totalPixels = rects.length;
  
  const rectangles = parseSvgToPixels(svgString);
  const totalRectangles = rectangles.length;
  
  // Get optimized rectangles count
  const optimizedRectangles = optimizeRectangles(rectangles).length;
  
  const compressionRatio = totalPixels > 0 ? totalRectangles / totalPixels : 0;
  const optimizationRatio = totalRectangles > 0 ? optimizedRectangles / totalRectangles : 0;
  
  return {
    totalPixels,
    totalRectangles,
    optimizedRectangles,
    compressionRatio,
    optimizationRatio
  };
} 