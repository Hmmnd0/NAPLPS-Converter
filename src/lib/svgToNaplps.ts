import { NAPLPSEncoder, NAPLPSPoint, NAPLPSColor } from './naplps';
import { NAPLPSFoxtoolboxEncoder } from './naplps-foxtoolbox';

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

interface PolygonShape {
  points: Array<{ x: number; y: number }>;
  color: string;
}

function parseSvgToPolygons(svgString: string): PolygonShape[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const shapes: PolygonShape[] = [];

  doc.querySelectorAll('polygon, polyline').forEach(el => {
    const pointsAttr = el.getAttribute('points') || '';
    const color = el.getAttribute('fill') || '#000000';
    const nums = pointsAttr.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    if (nums.length < 4) return; // need at least 2 points
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      points.push({ x: nums[i], y: nums[i + 1] });
    }
    shapes.push({ points, color });
  });

  return shapes;
}

function ellipseToPolygonPoints(cx: number, cy: number, rx: number, ry: number, sides = 24): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides;
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return points;
}

function parseSvgToCirclesAndEllipses(svgString: string): PolygonShape[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const shapes: PolygonShape[] = [];

  doc.querySelectorAll('circle').forEach(el => {
    const cx = parseFloat(el.getAttribute('cx') || '0');
    const cy = parseFloat(el.getAttribute('cy') || '0');
    const r  = parseFloat(el.getAttribute('r')  || '0');
    const color = el.getAttribute('fill') || '#000000';
    if (r <= 0) return;
    shapes.push({ points: ellipseToPolygonPoints(cx, cy, r, r), color });
  });

  doc.querySelectorAll('ellipse').forEach(el => {
    const cx = parseFloat(el.getAttribute('cx') || '0');
    const cy = parseFloat(el.getAttribute('cy') || '0');
    const rx = parseFloat(el.getAttribute('rx') || '0');
    const ry = parseFloat(el.getAttribute('ry') || '0');
    const color = el.getAttribute('fill') || '#000000';
    if (rx <= 0 || ry <= 0) return;
    shapes.push({ points: ellipseToPolygonPoints(cx, cy, rx, ry), color });
  });

  return shapes;
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

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Malformed SVG: ' + (parseError.textContent?.trim().split('\n')[0] ?? 'parse error'));
  }

  const rects = doc.querySelectorAll('rect');
  const rectangles: Rectangle[] = [];
  rects.forEach(rect => {
    const x      = parseInt(rect.getAttribute('x')      || '0');
    const y      = parseInt(rect.getAttribute('y')      || '0');
    const width  = parseInt(rect.getAttribute('width')  || '1');
    const height = parseInt(rect.getAttribute('height') || '1');
    const color  = rect.getAttribute('fill') || '#000000';
    rectangles.push({ x, y, width, height, color });
  });

  return rectangles;
}


function parseColor(color: string): NAPLPSColor {
  const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10)
    };
  }
  const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (hexMatch) {
    return {
      r: parseInt(hexMatch[1], 16),
      g: parseInt(hexMatch[2], 16),
      b: parseInt(hexMatch[3], 16)
    };
  }
  console.warn('Unrecognized color format:', color);
  return { r: 0, g: 0, b: 0 };
}

// Find closest color in Telidon palette using perceptual (Lab) distance
function quantizeColor(color: NAPLPSColor): NAPLPSColor {
  let bestIndex = 0;
  let minDistance = Infinity;

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

function calculateColorDistance(color1: NAPLPSColor, color2: NAPLPSColor): number {
  const lab1 = rgbToLab(color1);
  const lab2 = rgbToLab(color2);

  const deltaL = lab1.L - lab2.L;
  const deltaA = lab1.a - lab2.a;
  const deltaB = lab1.b - lab2.b;

  return Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB);
}

function rgbToLab(rgb: NAPLPSColor): { L: number, a: number, b: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const x = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = 0.0193 * r + 0.1192 * g + 0.9505 * b;

  const L = 116 * Math.pow(y, 1/3) - 16;
  const a = 500 * (Math.pow(x, 1/3) - Math.pow(y, 1/3));
  const b_val = 200 * (Math.pow(y, 1/3) - Math.pow(z, 1/3));

  return { L, a, b: b_val };
}

// Merge adjacent rectangles of the same color
function optimizeRectangles(rectangles: Rectangle[]): Rectangle[] {
  const optimized: Rectangle[] = [];
  const merged = new Set<number>();

  for (let i = 0; i < rectangles.length; i++) {
    if (merged.has(i)) continue;

    const current = rectangles[i];

    for (let j = i + 1; j < rectangles.length; j++) {
      if (merged.has(j) || rectangles[j].color !== current.color) continue;

      const other = rectangles[j];

      if (current.y === other.y && current.height === other.height) {
        if (current.x + current.width === other.x) {
          current.width += other.width;
          merged.add(j);
        } else if (other.x + other.width === current.x) {
          current.x = other.x;
          current.width += other.width;
          merged.add(j);
        }
      }

      if (current.x === other.x && current.width === other.width) {
        if (current.y + current.height === other.y) {
          current.height += other.height;
          merged.add(j);
        } else if (other.y + other.height === current.y) {
          current.y = other.y;
          current.height += other.height;
          merged.add(j);
        }
      }
    }

    optimized.push(current);
  }

  return optimized;
}

// Scale coordinates to 0–63 NAPLPS grid
function scaleCoordinates(rectangles: Rectangle[], maxWidth: number, maxHeight: number): Rectangle[] {
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

    scaledRect.x = Math.max(0, Math.min(63, scaledRect.x));
    scaledRect.y = Math.max(0, Math.min(63, scaledRect.y));
    scaledRect.width = Math.max(1, Math.min(63 - scaledRect.x, scaledRect.width));
    scaledRect.height = Math.max(1, Math.min(63 - scaledRect.y, scaledRect.height));

    return scaledRect;
  });
}

export async function svgToNaplps(svgString: string, width: number, height: number): Promise<string> {
  try {
    let rectangles = parseSvgToPixels(svgString);
    if (rectangles.length === 0) {
      throw new Error('SVG contains no <rect> elements — output would be empty.');
    }
    rectangles = optimizeRectangles(rectangles);
    rectangles = scaleCoordinates(rectangles, width, height);

    const encoder = new NAPLPSEncoder(64, 64);

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

    return encoder.getHexString();
  } catch (error) {
    console.error('Error in svgToNaplps:', error);
    throw error;
  }
}

export async function svgToNaplpsFoxtoolbox(svgString: string, width: number, height: number): Promise<string> {
  try {
    let rectangles = parseSvgToPixels(svgString);
    rectangles = optimizeRectangles(rectangles);
    const polygons = parseSvgToPolygons(svgString);
    const circles  = parseSvgToCirclesAndEllipses(svgString);

    if (rectangles.length === 0 && polygons.length === 0 && circles.length === 0) {
      throw new Error('SVG contains no supported shapes (<rect>, <polygon>, <polyline>, <circle>, <ellipse>) — output would be empty.');
    }

    const encoder = new NAPLPSFoxtoolboxEncoder();

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

    for (const shape of polygons) {
      const originalColor = parseColor(shape.color);
      const quantizedColor = quantizeColor(originalColor);
      encoder.setColor(quantizedColor);
      encoder.addPolygon(
        shape.points.map(p => ({ x: p.x / width, y: p.y / height }))
      );
    }

    for (const shape of circles) {
      const originalColor = parseColor(shape.color);
      const quantizedColor = quantizeColor(originalColor);
      encoder.setColor(quantizedColor);
      encoder.addPolygon(
        shape.points.map(p => ({ x: p.x / width, y: p.y / height }))
      );
    }

    encoder.endGraphics();
    return encoder.getHexString();
  } catch (error) {
    console.error('Error in svgToNaplpsFoxtoolbox:', error);
    throw error;
  }
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
