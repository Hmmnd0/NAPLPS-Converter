// NAPLPS Encoder following TelidonP5.js expectations
// Based on breakthrough findings: use polygons (0x37) for filled shapes

export interface NAPLPSPoint {
  x: number; // 0.0 to 1.0
  y: number; // 0.0 to 1.0
}

export interface NAPLPSColor {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

// Pack a 12-bit coordinate into two 6-bit nibbles, each offset by 0x40
function packCoordinate12bit(value: number): [number, number] {
  // Convert 0.0-1.0 to 0-4095 (12-bit range)
  const scaled = Math.round(value * 4095);
  const clamped = Math.max(0, Math.min(4095, scaled));
  
  // Split into high and low 6 bits
  const high6 = (clamped >> 6) & 0x3F;
  const low6 = clamped & 0x3F;
  
  // Offset each by 0x40 for ASCII safety
  return [0x40 + high6, 0x40 + low6];
}

export class NAPLPSFoxtoolboxEncoder {
  private data: number[] = [];
  private currentColor: NAPLPSColor = { r: 255, g: 255, b: 255 }; // White

  constructor() {
    this.reset();
  }

  reset(): void {
    this.data = [];
    
    // Telidon header (from working files)
    this.data.push(0x18); // CANCEL
    this.data.push(0x1B); // ESC
    this.data.push(0x45); // 'E'
    this.data.push(0x1F); // NSR
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

  // Set color using NAPLPS GRB interleaved bit-packing (per NAP.txt spec).
  // The decoder (naplps.js setColor) reads each data byte as GRBGRB at bits 5-0:
  //   bit5=G, bit4=R, bit3=B, bit2=G, bit1=R, bit0=B  (2 bits per component per byte)
  // We send 4 bytes (matching DOMAIN 0x4D which sets 4-byte multi-value mode).
  // Byte i carries bits (7-2i) and (6-2i) of each 8-bit component, MSB first.
  setColor(color: NAPLPSColor): void {
    this.currentColor = color;
    this.data.push(0x3C); // SET_COLOR

    const r = color.r; // 0-255
    const g = color.g;
    const b = color.b;

    for (let i = 0; i < 4; i++) {
      const shift = 7 - 2 * i; // i=0→7, i=1→5, i=2→3, i=3→1
      const gHi = (g >> shift) & 1;
      const gLo = (g >> (shift - 1)) & 1;
      const rHi = (r >> shift) & 1;
      const rLo = (r >> (shift - 1)) & 1;
      const bHi = (b >> shift) & 1;
      const bLo = (b >> (shift - 1)) & 1;
      this.data.push(0x40 | (gHi << 5) | (rHi << 4) | (bHi << 3) | (gLo << 2) | (rLo << 1) | bLo);
    }
  }

  // Add a filled rectangle as a polygon (4 points)
  addFilledRectangle(topLeft: NAPLPSPoint, bottomRight: NAPLPSPoint): void {
    // Debug coordinates
    console.log(`[DEBUG] Adding rectangle as polygon: (${topLeft.x.toFixed(3)},${topLeft.y.toFixed(3)}) to (${bottomRight.x.toFixed(3)},${bottomRight.y.toFixed(3)})`);
    
    // Set & Poly Filled command (0x37) - NOT rectangle primitive
    this.data.push(0x37);
    
    // Create 4 points for rectangle: topLeft, topRight, bottomRight, bottomLeft
    const points = [
      { x: topLeft.x, y: topLeft.y },
      { x: bottomRight.x, y: topLeft.y },
      { x: bottomRight.x, y: bottomRight.y },
      { x: topLeft.x, y: bottomRight.y }
    ];
    
    // Encode each point as two 12-bit coordinates, packed into 6-bit nibbles
    for (const point of points) {
      const [xh, xl] = packCoordinate12bit(point.x);
      const [yh, yl] = packCoordinate12bit(point.y);
      
      // Debug coordinate encoding
      console.log(`[DEBUG] Point (${point.x.toFixed(3)}, ${point.y.toFixed(3)}) -> X:[${xh}, ${xl}] Y:[${yh}, ${yl}]`);
      
      // Add coordinate bytes (4 bytes per point)
      this.data.push(xh, xl, yh, yl);
    }
  }

  // End the graphics data
  endGraphics(): void {
    this.data.push(0x0F); // SI (Shift In, end of graphics)
  }

  // Get the encoded data as hex string
  getHexString(): string {
    return this.data.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Get the encoded data as Uint8Array
  getData(): Uint8Array {
    return new Uint8Array(this.data);
  }
}

// Test function to generate a simple red rectangle as polygon
export function generateFoxtoolboxTest(): string {
  const encoder = new NAPLPSFoxtoolboxEncoder();
  
  // Set red color
  encoder.setColor({ r: 255, g: 0, b: 0 });
  
  // Draw a red rectangle as polygon
  encoder.addFilledRectangle(
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.9 }
  );
  
  encoder.endGraphics();
  return encoder.getHexString();
} 

// Test function to generate a single centered red rectangle
export function generateSingleRedRectangleNaplps(): string {
  const encoder = new NAPLPSFoxtoolboxEncoder();
  
  // Set red color
  encoder.setColor({ r: 255, g: 0, b: 0 });
  
  // Centered rectangle: from (0.4, 0.4) to (0.6, 0.6)
  encoder.addFilledRectangle(
    { x: 0.4, y: 0.4 },
    { x: 0.6, y: 0.6 }
  );
  
  encoder.endGraphics();
  return encoder.getHexString();
} 

// Test function to generate a NAPLPS file with a text primitive
export function generateTextPrimitiveNaplps(): string {
  const encoder = new NAPLPSFoxtoolboxEncoder();
  
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