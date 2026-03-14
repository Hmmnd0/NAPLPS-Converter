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
    // Telidon header sequence (from bull.nap)
    this.safePush(0x18, 'CANCEL');           // Cancel
    this.safePush(0x1B, 'ESC');              // ESC
    this.safePush(0x22, 'ESC "');            // ESC "
    this.safePush(0x46, 'ESC F');            // ESC F
    this.safePush(0x1B, 'ESC');              // ESC
    this.safePush(0x45, 'ESC E');            // ESC E
    this.safePush(0x1F, 'NSR');              // Non-Selective Reset
    this.safePush(0x40, 'NSR data');         // NSR data
    this.safePush(0x40, 'NSR data');         // NSR data
    this.safePush(0x0E, 'SO - graphics mode'); // Shift Out (graphics mode)
    this.safePush(0x20, 'RESET');            // Reset
    this.safePush(0x7F, 'Reset data');       // Reset data
    this.safePush(0x4F, 'Reset data');       // Reset data
    this.safePush(0x21, 'DOMAIN');           // Domain
    this.safePush(0x4D, 'Domain data');      // Domain data (4-byte mode)
    this.safePush(0x40, 'Domain data');      // Domain data
    this.safePush(0x40, 'Domain data');      // Domain data
    this.safePush(0x40, 'Domain data');      // Domain data
    this.safePush(0x40, 'Domain data');      // Domain data
  }

  // Safe push function that logs every byte written
  private safePush(value: number, context: string): void {
    // Allow valid NAPLPS control codes: CANCEL(0x18), ESC(0x1B), NSR(0x1F), SO(0x0E), SI(0x0F)
    const validControlCodes = [0x18, 0x1B, 0x1F, 0x0E, 0x0F];
    if (!validControlCodes.includes(value) && (value < 0x20 || value > 0x7F)) {
      console.error(`[AUDIT] Non-ASCII byte: ${value} (0x${value.toString(16)}) at index ${this.data.length} context: ${context}`);
      console.trace('[AUDIT] Stack trace for non-ASCII byte');
    }
    this.data.push(value);
  }

  // Encode a coordinate value using NAPLPS fractional coordinate system
  private encodeCoordinate(value: number): number[] {
    // If value is already in 0-63 range (from scaled coordinates), use it directly
    // Otherwise, convert to fractional coordinate (0.0 to 1.0) then to NAPLPS format
    let clamped: number;
    
    if (value >= 0 && value <= 63) {
      // Already in NAPLPS coordinate range
      clamped = Math.round(value);
    } else {
      // Convert from original image coordinates to NAPLPS coordinates
      const fractional = value / Math.max(this.width, this.height);
      const scaled = Math.round(fractional * 63);
      clamped = Math.max(0, Math.min(63, scaled));
    }
    
    // Encode as ASCII (add 0x20 offset)
    return [clamped + 0x20];
  }

  // Encode a point
  private encodePoint(point: NAPLPSPoint): number[] {
    const x = this.encodeCoordinate(point.x);
    const y = this.encodeCoordinate(point.y);
    return [...x, ...y];
  }

  // Set color using Telidon format with improved color mapping
  setColor(color: NAPLPSColor): void {
    this.safePush(NAPLPS_PRIMITIVES.SET_COLOR, 'SET_COLOR');
    
    // Use a simpler color mapping that stays within ASCII range
    // Map RGB to a 6-bit color space (0-63) then add 0x20 for ASCII
    const brightness = (color.r + color.g + color.b) / 3;
    let colorByte = 0x20; // Default to black (0x20 = space)
    
    // Map colors to ASCII-safe values
    if (color.r > 200 && color.g < 100 && color.b < 100) {
      colorByte = 0x52; // Red
    } else if (color.r < 100 && color.g > 200 && color.b < 100) {
      colorByte = 0x47; // Green
    } else if (color.r < 100 && color.g < 100 && color.b > 200) {
      colorByte = 0x42; // Blue
    } else if (color.r > 200 && color.g > 200 && color.b < 100) {
      colorByte = 0x59; // Yellow
    } else if (color.r > 200 && color.g < 100 && color.b > 200) {
      colorByte = 0x4D; // Magenta
    } else if (color.r < 100 && color.g > 200 && color.b > 200) {
      colorByte = 0x43; // Cyan
    } else if (brightness > 200) {
      colorByte = 0x57; // White
    } else if (brightness > 150) {
      colorByte = 0x4C; // Light gray
    } else if (brightness > 100) {
      colorByte = 0x47; // Gray
    } else if (brightness > 50) {
      colorByte = 0x44; // Dark gray
    } else {
      colorByte = 0x20; // Black
    }
    
    this.safePush(colorByte, `Color: RGB(${color.r},${color.g},${color.b}) -> ASCII(0x${colorByte.toString(16)})`);
  }

  // Set background color
  setBackground(color: NAPLPSColor): void {
    // Telidon doesn't have separate background color, use setColor
    this.setColor(color);
  }

  // Set a color register (Telidon doesn't use registers, just setColor)
  setColorRegister(index: number, color: NAPLPSColor): void {
    // For Telidon, just set the current color
    this.setColor(color);
  }

  // Add a rectangle primitive (Telidon format)
  addRectangle(topLeft: NAPLPSPoint, bottomRight: NAPLPSPoint, color?: NAPLPSColor): void {
    const beforeLen = this.data.length;
    
    // Set color if provided
    if (color) {
      this.setColor(color);
    }
    
    // Use RECT_FILLED for filled rectangles
    this.safePush(NAPLPS_PRIMITIVES.RECT_FILLED, 'RECT_FILLED');
    
    // Encode points
    const pt1 = this.encodePoint(topLeft);
    const pt2 = this.encodePoint(bottomRight);
    this.safePush(pt1[0], 'Rectangle top-left X');
    this.safePush(pt1[1], 'Rectangle top-left Y');
    this.safePush(pt2[0], 'Rectangle bottom-right X');
    this.safePush(pt2[1], 'Rectangle bottom-right Y');
    
    // Debug: log all bytes written for this rectangle
    const afterLen = this.data.length;
    const rectBytes = this.data.slice(beforeLen, afterLen);
    console.log('[DEBUG] Rectangle bytes:', rectBytes);
  }

  // Add a point primitive
  addPoint(point: NAPLPSPoint, color?: NAPLPSColor): void {
    if (color) {
      this.setColor(color);
    }
    this.safePush(NAPLPS_PRIMITIVES.POINT_ABS, 'POINT_ABS');
    const encodedPoint = this.encodePoint(point);
    this.safePush(encodedPoint[0], 'Point X');
    this.safePush(encodedPoint[1], 'Point Y');
  }

  // Add a line primitive
  addLine(start: NAPLPSPoint, end: NAPLPSPoint, color?: NAPLPSColor): void {
    if (color) {
      this.setColor(color);
    }
    this.safePush(NAPLPS_PRIMITIVES.LINE_ABS, 'LINE_ABS');
    const startPoint = this.encodePoint(start);
    const endPoint = this.encodePoint(end);
    this.safePush(startPoint[0], 'Line start X');
    this.safePush(startPoint[1], 'Line start Y');
    this.safePush(endPoint[0], 'Line end X');
    this.safePush(endPoint[1], 'Line end Y');
  }

  // Get the encoded data as Uint8Array
  getData(): Uint8Array {
    const finalData = [...this.data];
    // Audit: check for non-ASCII bytes (except control codes)
    for (let i = 0; i < finalData.length; i++) {
      const b = finalData[i];
      if (b !== 0x0F && b !== 0x0E && b !== 0x18 && b !== 0x1B && b !== 0x1F && (b < 0x20 || b > 0x7F)) {
        console.warn('[AUDIT] Non-ASCII byte in final NAPLPS data:', b, 'at index', i, 'last 10 bytes:', finalData.slice(Math.max(0, i-10), i));
        console.trace('[AUDIT] Stack trace for non-ASCII byte');
      }
    }
    return new Uint8Array(finalData);
  }

  // Get the encoded data as a hex string
  getHexString(): string {
    const data = this.getData();
    return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Get the encoded data as a base64 string
  getBase64String(): string {
    const data = this.getData();
    return btoa(String.fromCharCode(...data));
  }

  // Test function to generate a minimal working Telidon NAPLPS file
  static generateTestNaplps(): string {
    // Exact header and command sequence from bull.nap analysis
    const data: number[] = [];
    
    // Header from bull.nap hexdump analysis
    data.push(0x18); // CANCEL
    data.push(0x1B); // ESC
    data.push(0x22); // '"'
    data.push(0x46); // 'F'
    data.push(0x1B); // ESC
    data.push(0x45); // 'E'
    data.push(0x1F); // NSR
    data.push(0x40); // NSR data
    data.push(0x40); // NSR data
    data.push(0x0E); // SO (graphics mode)
    data.push(0x20); // RESET
    data.push(0x7F); // Reset data
    data.push(0x4F); // Reset data
    data.push(0x21); // DOMAIN
    data.push(0x4D); // Domain data (4-byte mode)
    data.push(0x40); // Domain data
    data.push(0x40); // Domain data
    data.push(0x40); // Domain data
    data.push(0x40); // Domain data
    
    // Drawing commands from bull.nap
    data.push(0x3E); // SET COLOR
    data.push(0x44); // Color data
    data.push(0x60); // Color data
    data.push(0x3C); // SET COLOR
    data.push(0x42); // Color data
    data.push(0x74); // Color data
    data.push(0x42); // Color data
    data.push(0x74); // Color data
    data.push(0x3E); // SET COLOR
    data.push(0x49); // Color data
    data.push(0x40); // Color data
    data.push(0x3C); // SET COLOR
    data.push(0x78); // Color data
    data.push(0x78); // Color data
    data.push(0x47); // Color data
    data.push(0x47); // Color data
    
    // Return as hex string
    return data.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Test function to generate a single point NAPLPS file
  static generatePointTestNaplps(): string {
    const encoder = new NAPLPSEncoder(64, 64);
    
    console.log('[POINT TEST] Generating single point test NAPLPS...');
    
    // Set color to bright green (should be very visible)
    const greenColor = { r: 0, g: 255, b: 0 };
    console.log('[POINT TEST] Setting color to bright green:', greenColor);
    encoder.setColor(greenColor);
    
    // Draw a single green point in the center
    console.log('[POINT TEST] Drawing green point...');
    encoder.addPoint({ x: 32, y: 32 }, greenColor);
    
    const data = encoder.getData();
    console.log('[POINT TEST] Point NAPLPS data:', Array.from(data));
    console.log('[POINT TEST] Point NAPLPS hex:', encoder.getHexString());
    
    // Decode the NAPLPS data for debugging
    console.log('[POINT TEST] Decoding NAPLPS data:');
    console.log('  Byte 0: 0x18 (24) = CANCEL');
    console.log('  Byte 1: 0x1B (27) = ESC');
    console.log('  Byte 2: 0x45 (69) = "E"');
    console.log('  Byte 3: 0x1F (31) = NSR');
    console.log('  Byte 4: 0x40 (64) = "@"');
    console.log('  Byte 5: 0x40 (64) = "@"');
    console.log('  Byte 6: 0x0E (14) = SO (graphics mode)');
    console.log('  Byte 7: 0x20 (32) = SET_COLOR command');
    console.log('  Byte 8: 0x7F (127) = Color data');
    console.log('  Byte 9: 0x4F (79) = POINT_ABS command');
    console.log('  Byte 10: 0x21 (33) = Point X coordinate');
    console.log('  Byte 11: 0x49 (73) = Point Y coordinate');
    console.log('  ... rest are padding/termination');
    
    return encoder.getHexString();
  }

  // Test function to output the exact header and first drawing command bytes from bull.nap
  static generateBullNapTest(): string {
    const data: number[] = [
      0x18, 0x1B, 0x22, 0x46, 0x1B, 0x45, 0x1F, 0x40, 0x40, // header
      0x0E, 0x20, 0x7F, 0x4F, 0x21, 0x4D, 0x40, 0x40, 0x40, 0x3E, 0x44, 0x60, 0x3C, 0x42, 0x74, 0x42, 0x74, 0x3E, 0x49, 0x40, 0x3C, 0x78, 0x78, 0x47, 0x47, 0x3E, 0x4D, 0x60, 0x3C, 0x47, 0x47, 0x78, 0x47
    ];
    return data.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Test function to verify color encoding matches Foxtoolbox
  static testColorEncoding(): void {
    console.log('[COLOR TEST] Testing NAPLPS color encoding...');
    
    const testColors = [
      { r: 0, g: 0, b: 0 },         // Black
      { r: 255, g: 0, b: 0 },       // Red
      { r: 0, g: 255, b: 0 },       // Green
      { r: 0, g: 0, b: 255 },       // Blue
      { r: 255, g: 255, b: 255 },   // White
      { r: 128, g: 128, b: 128 },   // Gray
    ];
    
    testColors.forEach((color, i) => {
      const brightness = (color.r + color.g + color.b) / 3;
      let colorByte = 0x20; // Default to black
      
      // Map colors to ASCII-safe values
      if (color.r > 200 && color.g < 100 && color.b < 100) {
        colorByte = 0x52; // Red
      } else if (color.r < 100 && color.g > 200 && color.b < 100) {
        colorByte = 0x47; // Green
      } else if (color.r < 100 && color.g < 100 && color.b > 200) {
        colorByte = 0x42; // Blue
      } else if (color.r > 200 && color.g > 200 && color.b < 100) {
        colorByte = 0x59; // Yellow
      } else if (color.r > 200 && color.g < 100 && color.b > 200) {
        colorByte = 0x4D; // Magenta
      } else if (color.r < 100 && color.g > 200 && color.b > 200) {
        colorByte = 0x43; // Cyan
      } else if (brightness > 200) {
        colorByte = 0x57; // White
      } else if (brightness > 150) {
        colorByte = 0x4C; // Light gray
      } else if (brightness > 100) {
        colorByte = 0x47; // Gray
      } else if (brightness > 50) {
        colorByte = 0x44; // Dark gray
      } else {
        colorByte = 0x20; // Black
      }
      
      console.log(`Color ${i}: RGB(${color.r},${color.g},${color.b}) -> ASCII(0x${colorByte.toString(16)})`);
    });
  }
}

// Utility function to create NAPLPS primitives from image data
export function createNAPLPSFromImage(
  imageData: ImageData,
  maxPoints: number = 1000
): NAPLPSPrimitive[] {
  const { width, height, data } = imageData;
  const primitives: NAPLPSPrimitive[] = [];
  const visited = new Set<string>();

  console.log(`[CONVERSION] Starting conversion: ${width}x${height} pixels, max ${maxPoints} points`);

  // Color quantization using perceptual color space
  const colors = new Map<string, NAPLPSColor>();
  let colorCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];

      if (a < 128) continue; // Skip transparent pixels

      // Quantize to reduce color palette
      const quantizedR = Math.round(r / 64) * 64;
      const quantizedG = Math.round(g / 64) * 64;
      const quantizedB = Math.round(b / 64) * 64;

      const colorKey = `${quantizedR},${quantizedG},${quantizedB}`;
      if (!colors.has(colorKey)) {
        colors.set(colorKey, { r: quantizedR, g: quantizedG, b: quantizedB });
        colorCount++;
      }
    }
  }

  console.log(`[CONVERSION] Found ${colorCount} unique colors after quantization`);

  // Convert to rectangles
  let rectangleCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = `${x},${y}`;
      if (visited.has(key)) continue;

      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];

      if (a < 128) continue;

      // Find rectangle bounds
      let rectWidth = 1;
      let rectHeight = 1;

      // Expand horizontally
      while (x + rectWidth < width) {
        const nextIndex = (y * width + (x + rectWidth)) * 4;
        if (data[nextIndex] === r && 
            data[nextIndex + 1] === g && 
            data[nextIndex + 2] === b && 
            data[nextIndex + 3] === a) {
          rectWidth++;
        } else {
          break;
        }
      }

      // Expand vertically
      while (y + rectHeight < height) {
        let canExpand = true;
        for (let dx = 0; dx < rectWidth; dx++) {
          const nextIndex = ((y + rectHeight) * width + (x + dx)) * 4;
          if (data[nextIndex] !== r || 
              data[nextIndex + 1] !== g || 
              data[nextIndex + 2] !== b || 
              data[nextIndex + 3] !== a) {
            canExpand = false;
            break;
          }
        }
        if (canExpand) {
          rectHeight++;
        } else {
          break;
        }
      }

      // Mark as visited
      for (let dy = 0; dy < rectHeight; dy++) {
        for (let dx = 0; dx < rectWidth; dx++) {
          visited.add(`${x + dx},${y + dy}`);
        }
      }

      // Add rectangle
      const color: NAPLPSColor = { r, g, b };
      primitives.push({
        type: 'rectangle',
        points: [
          { x, y },
          { x: x + rectWidth - 1, y: y + rectHeight - 1 }
        ],
        color,
        fillColor: color
      });

      rectangleCount++;
      if (rectangleCount >= maxPoints) break;
    }
    if (rectangleCount >= maxPoints) break;
  }

  console.log(`[CONVERSION] Generated ${rectangleCount} rectangles`);
  if (primitives.length > 0) {
    console.log(`[CONVERSION] Sample rectangle: ${JSON.stringify(primitives[0])}`);
  }
  return primitives;
}


// Test function to generate a NAPLPS file with a text primitive (original encoder)
export function generateTextPrimitiveNaplpsOriginal(): string {
  const encoder = new NAPLPSEncoder(64, 64);
  // Switch to text mode (SI)
  encoder['data'].push(0x0F); // SI (Shift In, text mode)
  // TEXT command (0x22)
  encoder['data'].push(0x22);
  // ASCII for 'HELLO'
  const text = 'HELLO';
  for (let i = 0; i < text.length; i++) {
    encoder['data'].push(text.charCodeAt(i));
  }
  // End of file (optional)
  encoder['data'].push(0x1A); // SUB (end of file)
  return encoder.getHexString();
} 

// Test function to generate a minimal NAPLPS file with only the text command and 'HELLO' (no header)
export function generateMinimalTextOnlyNaplps(): string {
  const data: number[] = [];
  data.push(0x0F); // SI (Shift In, text mode)
  data.push(0x22); // TEXT command
  const text = 'HELLO';
  for (let i = 0; i < text.length; i++) {
    data.push(text.charCodeAt(i));
  }
  data.push(0x1A); // SUB (end of file)
  return data.map(b => b.toString(16).padStart(2, '0')).join('');
} 

// Utility: Pack NAPLPS coordinates (12-bit per x/y, packed as 6-bit nibbles, ASCII offset 0x40)
export function packNaplpsCoordinates(points: {x: number, y: number}[]): number[] {
  // Each coordinate is 12 bits, so each (x, y) pair is 24 bits (4 x 6-bit nibbles)
  // All nibbles are packed into a stream, then each nibble is offset by 0x40
  const nibbles: number[] = [];
  for (const pt of points) {
    // Clamp and round to 0-4095
    const x = Math.max(0, Math.min(4095, Math.round(pt.x)));
    const y = Math.max(0, Math.min(4095, Math.round(pt.y)));
    // X: 12 bits
    nibbles.push((x >> 6) & 0x3F); // high 6
    nibbles.push(x & 0x3F);        // low 6
    // Y: 12 bits
    nibbles.push((y >> 6) & 0x3F); // high 6
    nibbles.push(y & 0x3F);        // low 6
  }
  // Pack nibbles into bytes (each nibble + 0x40)
  return nibbles.map(n => n + 0x40);
}

// Minimal working NAPLPS file for a filled rectangle (matches bull.nap structure)
export function generateMinimalFilledRectangleNaplps(): Uint8Array {
  // Header (from bull.nap)
  const data: number[] = [
    0x18, 0x1B, 0x1B, 0x1F, 0x0E, 0x20, 0x7F, 0x4F, 0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  // Set color (white, as in bull.nap)
  data.push(0x3E); // SelectColor
  data.push(0x44); // Color data (example: white)
  data.push(0x60); // Color data
  data.push(0x3C); // SetColor
  data.push(0x42); // Color data
  data.push(0x74); // Color data
  data.push(0x42); // Color data
  data.push(0x74); // Color data
  // PolygonSetFilled (0x37) and packed coordinates for a rectangle
  data.push(0x37); // PolygonSetFilled
  // Rectangle as polygon: (x0,y0), (x1,y0), (x1,y1), (x0,y1)
  // Use domain 0-4095 for both axes (full screen)
  const points = [
    {x: 512, y: 512},   // top-left
    {x: 3584, y: 512},  // top-right
    {x: 3584, y: 3072}, // bottom-right
    {x: 512, y: 3072}   // bottom-left
  ];
  const packed = packNaplpsCoordinates(points);
  data.push(...packed);
  // End of file (optional: could add SI or other control codes)
  return new Uint8Array(data);
} 

// Generate a minimal NAPLPS file with a filled rectangle using 9-bit coordinates from TelidonJS bit test
export function generateBitTestPolygonNaplps(): Uint8Array {
  // Header (matching working files)
  const header = [
    0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
    0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  // Set color to yellow (0x3C, 0x59 for yellow in Telidon palette)
  const setColor = [0x3C, 0x59];
  // Set & Poly Filled command
  const polyCmd = [0x37];
  // Rectangle points from bit test (9-bit, but NAPLPS expects 12-bit)
  const points = [
    { x: 160, y: 120 }, // (010100000, 001111000)
    { x: 480, y: 120 }, // (111100000, 001111000)
    { x: 480, y: 360 }, // (111100000, 101101000)
    { x: 160, y: 360 }  // (010100000, 101101000)
  ];
  // Pack as NAPLPS 12-bit coordinates (each x/y: hi 6, lo 6, offset 0x40)
  const nibbles: number[] = [];
  for (const pt of points) {
    const x = Math.max(0, Math.min(4095, pt.x));
    const y = Math.max(0, Math.min(4095, pt.y));
    nibbles.push(((x >> 6) & 0x3F) + 0x40); // x hi
    nibbles.push((x & 0x3F) + 0x40);        // x lo
    nibbles.push(((y >> 6) & 0x3F) + 0x40); // y hi
    nibbles.push((y & 0x3F) + 0x40);        // y lo
  }
  // End with SI (0x0F)
  const end = [0x0F];
  // Combine all
  return new Uint8Array([...header, ...setColor, ...polyCmd, ...nibbles, ...end]);
} 

// Generalized: Generate a NAPLPS file for any polygon and color
export function generateNaplpsPolygonFile(points: {x: number, y: number}[], colorByte: number): Uint8Array {
  // Header (from working files)
  const header = [
    0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
    0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  // Set color (user-supplied Telidon color byte)
  const setColor = [0x3C, colorByte];
  // Set & Poly Filled command
  const polyCmd = [0x37];
  // Pack all points as NAPLPS 12-bit coordinates (hi 6, lo 6, offset 0x40)
  const nibbles: number[] = [];
  for (const pt of points) {
    const x = Math.max(0, Math.min(4095, Math.round(pt.x)));
    const y = Math.max(0, Math.min(4095, Math.round(pt.y)));
    nibbles.push(((x >> 6) & 0x3F) + 0x40); // x hi
    nibbles.push((x & 0x3F) + 0x40);        // x lo
    nibbles.push(((y >> 6) & 0x3F) + 0x40); // y hi
    nibbles.push((y & 0x3F) + 0x40);        // y lo
  }
  // End with SI (0x0F)
  const end = [0x0F];
  // Combine all
  return new Uint8Array([...header, ...setColor, ...polyCmd, ...nibbles, ...end]);
} 