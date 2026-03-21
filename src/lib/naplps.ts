// NAPLPS (North American Presentation Layer Protocol Syntax) Encoder
// Based on Telidon/NAPLPS format as implemented in TelidonP5.js

export interface NAPLPSPoint {
  x: number;
  y: number;
}

export interface NAPLPSColor {
  r: number;
  g: number;
  b: number;
}

export interface NAPLPSPrimitive {
  type: 'point' | 'line' | 'polyline' | 'polygon' | 'rectangle' | 'circle' | 'text';
  points: NAPLPSPoint[];
  color?: NAPLPSColor;
  fillColor?: NAPLPSColor;
  text?: string;
  radius?: number; // for circles
}

// Telidon/NAPLPS Graphics Primitives (matching TelidonP5.js)
const NAPLPS_PRIMITIVES = {
  RESET: 0x20,           // Reset
  DOMAIN: 0x21,          // Domain (header info)
  TEXT: 0x22,            // Text
  TEXTURE: 0x23,         // Texture
  POINT_SET_ABS: 0x24,   // Point Set Absolute
  POINT_SET_REL: 0x25,   // Point Set Relative
  POINT_ABS: 0x26,       // Point Absolute
  POINT_REL: 0x27,       // Point Relative
  LINE_ABS: 0x28,        // Line Absolute
  LINE_REL: 0x29,        // Line Relative
  SET_LINE_ABS: 0x2A,    // Set & Line Absolute
  SET_LINE_REL: 0x2B,    // Set & Line Relative
  ARC_OUTLINED: 0x2C,    // Arc Outlined
  ARC_FILLED: 0x2D,      // Arc Filled
  SET_ARC_OUTLINED: 0x2E, // Set & Arc Outlined
  SET_ARC_FILLED: 0x2F,  // Set & Arc Filled
  RECT_OUTLINED: 0x30,   // Rectangle Outlined
  RECT_FILLED: 0x31,     // Rectangle Filled
  SET_RECT_OUTLINED: 0x32, // Set & Rectangle Outlined
  SET_RECT_FILLED: 0x33, // Set & Rectangle Filled
  POLY_OUTLINED: 0x34,   // Polygon Outlined
  POLY_FILLED: 0x35,     // Polygon Filled
  SET_POLY_OUTLINED: 0x36, // Set & Polygon Outlined
  SET_POLY_FILLED: 0x37, // Set & Polygon Filled
  FIELD: 0x38,           // Field
  INCREMENTAL_POINT: 0x39, // Incremental Point
  INCREMENTAL_LINE: 0x3A, // Incremental Line
  INCREMENTAL_POLY_FILLED: 0x3B, // Incremental Poly Filled
  SET_COLOR: 0x3C,       // Set Color
  WAIT: 0x3D,            // Wait
} as const;

export class NAPLPSEncoder {
  private data: number[] = [];
  private width: number = 0;
  private height: number = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.reset();
  }

  reset(): void {
    this.data = [];
    this.data.push(0x18); // CANCEL
    this.data.push(0x1B); // ESC
    this.data.push(0x22); // ESC "
    this.data.push(0x46); // ESC F
    this.data.push(0x1B); // ESC
    this.data.push(0x45); // ESC E
    this.data.push(0x1F); // Non-Selective Reset
    this.data.push(0x40); // NSR data
    this.data.push(0x40); // NSR data
    this.data.push(0x0E); // SO (graphics mode)
    this.data.push(0x20); // RESET
    this.data.push(0x7F); // Reset data
    this.data.push(0x4F); // Reset data
    this.data.push(0x21); // DOMAIN
    this.data.push(0x4D); // Domain data (4-byte mode)
    this.data.push(0x40); // Domain data
    this.data.push(0x40); // Domain data
    this.data.push(0x40); // Domain data
    this.data.push(0x40); // Domain data
  }

  // Encode a coordinate value as two data bytes (12-bit, 0x40 offset).
  // Input: 0–63 (already scaled) or 0.0–1.0 fraction. Output: [hi, lo] in 0x40–0x7F range.
  private encodeCoordinate(value: number): number[] {
    let fractional: number;
    if (value >= 0 && value <= 1.0) {
      fractional = value;
    } else {
      fractional = value / Math.max(this.width, this.height);
    }
    const scaled = Math.max(0, Math.min(4095, Math.round(fractional * 4095)));
    const hi = (scaled >> 6) & 0x3F;
    const lo = scaled & 0x3F;
    return [0x40 + hi, 0x40 + lo];
  }

  // Encode a point as 4 bytes: [xHi, xLo, yHi, yLo]
  private encodePoint(point: NAPLPSPoint): number[] {
    const x = this.encodeCoordinate(point.x);
    const y = this.encodeCoordinate(point.y);
    return [...x, ...y];
  }

  // Set color using NAPLPS GRB interleaved bit-packing (per NAP.txt spec).
  // 4 data bytes, each carrying 2 bits per component: bit5=G, bit4=R, bit3=B, bit2=G, bit1=R, bit0=B.
  // 4 bytes × 2 bits = 8 bits per channel, MSB first. All bytes in 0x40–0x7F range.
  setColor(color: NAPLPSColor): void {
    this.data.push(NAPLPS_PRIMITIVES.SET_COLOR);
    const { r, g, b } = color;
    for (let i = 0; i < 4; i++) {
      const shift = 7 - 2 * i;
      const gHi = (g >> shift) & 1;
      const gLo = (g >> (shift - 1)) & 1;
      const rHi = (r >> shift) & 1;
      const rLo = (r >> (shift - 1)) & 1;
      const bHi = (b >> shift) & 1;
      const bLo = (b >> (shift - 1)) & 1;
      this.data.push(0x40 | (gHi << 5) | (rHi << 4) | (bHi << 3) | (gLo << 2) | (rLo << 1) | bLo);
    }
  }

  // Add a filled rectangle as SET & POLY FILLED (0x37) with 4 polygon corner points.
  addRectangle(topLeft: NAPLPSPoint, bottomRight: NAPLPSPoint, color?: NAPLPSColor): void {
    if (color) {
      this.setColor(color);
    }
    this.data.push(NAPLPS_PRIMITIVES.SET_POLY_FILLED);
    const corners = [
      topLeft,
      { x: bottomRight.x, y: topLeft.y },
      bottomRight,
      { x: topLeft.x, y: bottomRight.y },
    ];
    for (const pt of corners) {
      for (const b of this.encodePoint(pt)) this.data.push(b);
    }
  }

  // Add a point primitive (POINT SET ABS 0x24)
  addPoint(point: NAPLPSPoint, color?: NAPLPSColor): void {
    if (color) {
      this.setColor(color);
    }
    this.data.push(NAPLPS_PRIMITIVES.POINT_SET_ABS);
    for (const b of this.encodePoint(point)) this.data.push(b);
  }

  // Add a line primitive (SET & LINE ABS 0x2A)
  addLine(start: NAPLPSPoint, end: NAPLPSPoint, color?: NAPLPSColor): void {
    if (color) {
      this.setColor(color);
    }
    this.data.push(NAPLPS_PRIMITIVES.SET_LINE_ABS);
    for (const b of this.encodePoint(start)) this.data.push(b);
    for (const b of this.encodePoint(end)) this.data.push(b);
  }

  getData(): Uint8Array {
    return new Uint8Array(this.data);
  }

  getHexString(): string {
    return Array.from(this.getData()).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// Generate a minimal NAPLPS file with a filled rectangle using 9-bit coordinates from TelidonJS bit test
export function generateBitTestPolygonNaplps(): Uint8Array {
  const header = [
    0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
    0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  const setColor = [0x3C, 0x59];
  const polyCmd = [0x37];
  const points = [
    { x: 160, y: 120 },
    { x: 480, y: 120 },
    { x: 480, y: 360 },
    { x: 160, y: 360 }
  ];
  const nibbles: number[] = [];
  for (const pt of points) {
    const x = Math.max(0, Math.min(4095, pt.x));
    const y = Math.max(0, Math.min(4095, pt.y));
    nibbles.push(((x >> 6) & 0x3F) + 0x40);
    nibbles.push((x & 0x3F) + 0x40);
    nibbles.push(((y >> 6) & 0x3F) + 0x40);
    nibbles.push((y & 0x3F) + 0x40);
  }
  return new Uint8Array([...header, ...setColor, ...polyCmd, ...nibbles, 0x0F]);
}

// Generate a NAPLPS file for any polygon and color
export function generateNaplpsPolygonFile(points: {x: number, y: number}[], colorByte: number): Uint8Array {
  const header = [
    0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
    0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  const setColor = [0x3C, colorByte];
  const polyCmd = [0x37];
  const nibbles: number[] = [];
  for (const pt of points) {
    const x = Math.max(0, Math.min(4095, Math.round(pt.x)));
    const y = Math.max(0, Math.min(4095, Math.round(pt.y)));
    nibbles.push(((x >> 6) & 0x3F) + 0x40);
    nibbles.push((x & 0x3F) + 0x40);
    nibbles.push(((y >> 6) & 0x3F) + 0x40);
    nibbles.push((y & 0x3F) + 0x40);
  }
  return new Uint8Array([...header, ...setColor, ...polyCmd, ...nibbles, 0x0F]);
}
