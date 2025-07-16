// NAPLPS Spec-Compliant Encoder (bit-packed, Foxtoolbox style)

export class NaplpsSpecEncoder {
  public data: number[] = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.data = [];
    // Standard header (CANCEL, ESC, NSR, SO, RESET, DOMAIN)
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

  // Bit-pack a coordinate (0.0-1.0) to two 6-bit ASCII bytes (0x20-0x5F)
  static encodeCoord12bit(val: number): [number, number] {
    const scaled = Math.max(0, Math.min(4095, Math.round(val * 4095)));
    const hi = (scaled >> 6) & 0x3F;
    const lo = scaled & 0x3F;
    return [0x20 + hi, 0x20 + lo];
  }

  // Bit-pack color as 3 bits each for G, R, B (NAPLPS spec)
  static encodeColorGRB(r: number, g: number, b: number): number {
    // Convert 0-255 to 0-7
    const gr = Math.round(g / 255 * 7) & 0x7;
    const rr = Math.round(r / 255 * 7) & 0x7;
    const br = Math.round(b / 255 * 7) & 0x7;
    // Pack as GGG RRR BB (NAPLPS spec: 3 bits G, 3 bits R, 2 bits B)
    return (gr << 5) | (rr << 2) | (br >> 1);
  }

  // Add SET_COLOR command (bit-packed)
  setColor(r: number, g: number, b: number) {
    this.data.push(0x3C); // SET_COLOR
    this.data.push(NaplpsSpecEncoder.encodeColorGRB(r, g, b));
  }

  // Add RECT_FILLED command (bit-packed coordinates)
  addFilledRectangle(x1: number, y1: number, x2: number, y2: number) {
    this.data.push(0x31); // RECT_FILLED
    const [x1h, x1l] = NaplpsSpecEncoder.encodeCoord12bit(x1);
    const [y1h, y1l] = NaplpsSpecEncoder.encodeCoord12bit(y1);
    const [x2h, x2l] = NaplpsSpecEncoder.encodeCoord12bit(x2);
    const [y2h, y2l] = NaplpsSpecEncoder.encodeCoord12bit(y2);
    this.data.push(x1h, x1l, y1h, y1l, x2h, x2l, y2h, y2l);
  }

  // Add minimal text command
  addText(text: string) {
    this.data.push(0x0F); // SI (text mode)
    this.data.push(0x22); // TEXT
    for (let i = 0; i < text.length; i++) {
      this.data.push(text.charCodeAt(i));
    }
    this.data.push(0x1A); // SUB (end of file)
  }

  getData(): Uint8Array {
    return new Uint8Array(this.data);
  }

  getHexString(): string {
    return this.data.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// Generate a minimal red rectangle file (centered)
export function generateSpecMinimalRectangle(): string {
  const enc = new NaplpsSpecEncoder();
  enc.setColor(255, 0, 0); // Red
  enc.addFilledRectangle(0.4, 0.4, 0.6, 0.6); // Centered
  enc.data.push(0x0F); // SI (end of graphics)
  return enc.getHexString();
}

// Generate a minimal text file
export function generateSpecMinimalText(): string {
  const enc = new NaplpsSpecEncoder();
  enc.addText('HELLO');
  return enc.getHexString();
}

// Generate a TelidonP5.js-compatible text file (header + SI + ASCII + SO + SI)
export function generateTelidonP5TextFile(text: string): string {
  const header = [
    0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
    0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  const ascii = Array.from(text).map(c => c.charCodeAt(0));
  const bytes = [
    ...header,
    0x0F, // SI (text mode)
    ...ascii,
    0x0E, // SO (graphics mode)
    0x0F  // SI (exit)
  ];
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a TelidonP5.js-compatible minimal rectangle file (header + SO + graphics + SI)
export function generateTelidonP5RectangleFile(): string {
  const header = [
    0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
    0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  // Set color to red (SET_COLOR, ASCII-safe for TelidonP5.js)
  const setColor = [0x3C, 0x52]; // SET_COLOR, 'R'
  // Draw a filled rectangle in the center (RECT_FILLED, 8 ASCII bytes for two 12-bit coords per corner)
  // (0.4, 0.4) to (0.6, 0.6)
  const rect = [0x31,
    ...pack12bitCoords(0.4, 0.4),
    ...pack12bitCoords(0.6, 0.6)
  ];
  // End with SI (text mode)
  return [...header, ...setColor, ...rect, 0x0F].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a TelidonP5.js-compatible hybrid file (rectangle + text)
export function generateTelidonP5HybridFile(text: string): string {
  const header = [
    0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
    0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  const setColor = [0x3C, 0x52]; // SET_COLOR, 'R'
  const rect = [0x31, 0x39, 0x39, 0x46, 0x46];
  // Switch to text mode, write text, then back to graphics
  const ascii = Array.from(text).map(c => c.charCodeAt(0));
  return [
    ...header,
    ...setColor,
    ...rect,
    0x0F, // SI (text mode)
    ...ascii,
    0x0E, // SO (graphics mode)
    0x0F  // SI (exit)
  ].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper: Pack two 12-bit coordinates into 4 ASCII-safe bytes (0x20-0x5F)
function pack12bitCoords(x: number, y: number): number[] {
  // Clamp and scale to 0-4095
  const xVal = Math.max(0, Math.min(4095, Math.round(x * 4095)));
  const yVal = Math.max(0, Math.min(4095, Math.round(y * 4095)));
  // 12 bits each: xxxx xxxx xxxx yyyy yyyy yyyy
  // Pack into 4 6-bit values
  const b0 = (xVal >> 6) & 0x3F; // x high 6
  const b1 = xVal & 0x3F;        // x low 6
  const b2 = (yVal >> 6) & 0x3F; // y high 6
  const b3 = yVal & 0x3F;        // y low 6
  // Offset to ASCII-safe (0x20-0x5F)
  return [b0, b1, b2, b3].map(v => v + 0x20);
}

// Generate a TelidonP5.js-compatible rectangle file using 8-byte coordinates (bit-packed, spec-compliant)
export function generateTelidonP5Rectangle8ByteFile(): string {
  const header = [
    0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
    0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  const setColor = [0x3C, 0x52]; // SET_COLOR, 'R'
  // Centered rectangle: (0.4, 0.4) to (0.6, 0.6)
  const rect = [0x31,
    ...pack12bitCoords(0.4, 0.4),
    ...pack12bitCoords(0.6, 0.6)
  ];
  return [...header, ...setColor, ...rect, 0x0F].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a TelidonP5.js-compatible minimal point file
export function generateTelidonP5PointFile(): string {
  const header = [
    0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
    0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  const setColor = [0x3C, 0x52]; // SET_COLOR, 'R'
  // Point at center (0.5, 0.5)
  const point = [0x21, ...pack12bitCoords(0.5, 0.5)];
  return [...header, ...setColor, ...point, 0x0F].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a TelidonP5.js-compatible minimal line file
export function generateTelidonP5LineFile(): string {
  const header = [
    0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
    0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  const setColor = [0x3C, 0x52]; // SET_COLOR, 'R'
  // Line from (0.2, 0.2) to (0.8, 0.8)
  const line = [0x23, ...pack12bitCoords(0.2, 0.2), ...pack12bitCoords(0.8, 0.8)];
  return [...header, ...setColor, ...line, 0x0F].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a TelidonP5.js-compatible outlined rectangle file
export function generateTelidonP5RectangleOutlinedFile(): string {
  const header = [
    0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
    0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
  ];
  const setColor = [0x3C, 0x52]; // SET_COLOR, 'R'
  // Outlined rectangle: (0.4, 0.4) to (0.6, 0.6)
  const rect = [0x30, ...pack12bitCoords(0.4, 0.4), ...pack12bitCoords(0.6, 0.6)];
  return [...header, ...setColor, ...rect, 0x0F].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a TelidonP5.js-compatible filled rectangle using Telidon-master's exact working approach
export function generateTelidonP5PolygonRectangleFile(): string {
  // Use Telidon-master's exact working approach
  const color = new Vector3(255, 255, 0); // Yellow
  
  // Rectangle points (normalized 0-1)
  const points = [
    new Vector2(0.25, 0.25), // top-left
    new Vector2(0.75, 0.25), // top-right
    new Vector2(0.75, 0.75), // bottom-right
    new Vector2(0.25, 0.75)  // bottom-left
  ];
  
  const isFill = true; // Filled polygon
  
  // Create stroke using Telidon-master's wrapper
  const stroke = new NapInputWrapper(color, points, isFill);
  
  // Create encoder using Telidon-master's approach
  const encoder = new NapEncoder([stroke]);
  
  // Return the raw NAPLPS data
  return encoder.napRaw;
}

// Helper classes to match Telidon-master's implementation
class Vector2 {
  constructor(public x: number, public y: number) {}
}

class Vector3 {
  constructor(public x: number, public y: number, public z: number) {}
}

class NapInputWrapper {
  constructor(public color: Vector3, public points: Vector2[], public isFill: boolean) {}
}

// Simplified NapEncoder that matches Telidon-master's approach
class NapEncoder {
  public napRaw: string;
  
  constructor(strokes: NapInputWrapper[]) {
    this.napRaw = this.generateNapFile(strokes);
  }
  
  private generateNapFile(strokes: NapInputWrapper[]): string {
    let result = '';
    
    // Header (exact from Telidon-master)
    result += this.makeNapHeader();
    
    // Process each stroke
    for (const stroke of strokes) {
      result += this.makeNapStroke(stroke.isFill, stroke.color, stroke.points);
    }
    
    // Footer (exact from Telidon-master)
    result += this.makeNapFooter();
    
    return result;
  }
  
  private makeNapHeader(): string {
    return doEncode("18") + // cancel
           doEncode("1B") + // esc
           doEncode("45") +
           doEncode("1F") + // nsr 
           doEncode("40") +
           doEncode("40") +
           doEncode("0E") + // shift-out (graphics mode)
           doEncode("20") + // reset 
           doEncode("7F") +
           doEncode("4F") +
           doEncode("21") + // domain
           doEncode("4D") + // 4-byte domain
           doEncode("40") +
           doEncode("40") +
           doEncode("40") +
           doEncode("40");
  }
  
  private makeNapFooter(): string {
    return doEncode("1B") + // esc
           doEncode("45");
  }
  
  private makeNapStroke(isFill: boolean, color: Vector3, points: Vector2[]): string {
    let result = '';
    
    // Color selection (exact from Telidon-master)
    result += this.makeNapSelectColor(color);
    
    // Opcode (exact from Telidon-master)
    result += isFill ? doEncode("37") : doEncode("36"); // FILLED vs OUTLINED
    
    // Points (exact from Telidon-master)
    result += this.makeNapPoints(points);
    
    return result;
  }
  
  private makeNapSelectColor(color: Vector3): string {
    // Find closest color from palette
    let index = 0;
    let dist = 999999;
    for (let i = 0; i < naplps_defaultColorMap.length; i++) {
      const newDist = getDistance(color, naplps_defaultColorMap[i]);
      if (newDist < dist) {
        index = i;
        dist = newDist;
      }
    }
    
    return doEncode("3E") + // SELECT COLOR
           doEncode(naplps_defaultColorIndices1[index]) + 
           doEncode(naplps_defaultColorIndices2[index]) + 
           doEncode("40") +
           doEncode("40");
  }
  
  private makeNapPoints(points: Vector2[]): string {
    let result = '';
    
    // Convert to relative coordinates (exact from Telidon-master)
    const pointsToEncode: Vector2[] = [];
    
    for (let i = 0; i < points.length; i++) {
      if (i === 0) {
        pointsToEncode.push(points[0]);
      } else {
        const nv = points[i];
        const nvLast = points[i-1];
        
        let x = Math.abs(nv.x) - Math.abs(nvLast.x);
        if (nv.x < nvLast.x) x = Math.abs(x) - 1;
        
        let y = Math.abs(nv.y) - Math.abs(nvLast.y);
        if (nv.y < nvLast.y) y = Math.abs(y) - 1;
        
        pointsToEncode.push(new Vector2(x, y));
      }
    }
    
    // Encode each point
    for (const point of pointsToEncode) {
      result += this.makeNapVector2(point);
    }
    
    return result;
  }
  
  private makeNapVector2(input: Vector2): string {
    const dataLength = 4;
    const bitExponent = (dataLength * 3) - 1; // 11 bits
    const maxBitVals = Math.pow(2, bitExponent); // 2047
    
    const intX = Math.round(Math.abs(input.x) * maxBitVals);
    const intY = Math.round(Math.abs(input.y) * maxBitVals);
    
    const binX = intX.toString(2).padStart(11, '0');
    const binY = intY.toString(2).padStart(11, '0');
    
    let result = '';
    
    for (let i = 0; i < dataLength; i++) {
      let vectorByte = "01";
      
      switch (i) {
        case 0:
          vectorByte += input.x >= 0 ? "0" : "1";
          vectorByte += binX.charAt(0) + binX.charAt(1);
          vectorByte += input.y >= 0 ? "0" : "1";
          vectorByte += binY.charAt(0) + binY.charAt(1);
          break;
        case 1:
          vectorByte += binX.charAt(2) + binX.charAt(3) + binX.charAt(4);
          vectorByte += binY.charAt(2) + binY.charAt(3) + binY.charAt(4);
          break;
        case 2:
          vectorByte += binX.charAt(5) + binX.charAt(6) + binX.charAt(7);
          vectorByte += binY.charAt(5) + binY.charAt(6) + binY.charAt(7);
          break;
        case 3:
          vectorByte += binX.charAt(8) + binX.charAt(9) + binX.charAt(10);
          vectorByte += binY.charAt(8) + binY.charAt(9) + binY.charAt(10);
          break;
      }
      
      const hexByte = parseInt(vectorByte, 2).toString(16).padStart(2, '0');
      result += doEncode(hexByte);
    }
    
    return result;
  }
}

// Helper functions from Telidon-master
function doEncode(input: string): string {
  input = input.charAt(input.length-2) + input.charAt(input.length-1);
  let returns = "";
  for (let i = 0; i < input.length; i += 2) {
    returns += String.fromCharCode(parseInt(input.substr(i, 2), 16));
  }
  return returns;
}

function getDistance(v1: Vector3, v2: Vector3): number {
  return Math.sqrt((v1.x - v2.x)**2 + (v1.y - v2.y)**2 + (v1.z - v2.z)**2);
}

// Color palette from Telidon-master
const naplps_black = new Vector3(0, 0, 0);
const naplps_gray1 = new Vector3(32, 32, 32);
const naplps_gray2 = new Vector3(64, 64, 64);
const naplps_gray3 = new Vector3(96, 96, 96);
const naplps_gray4 = new Vector3(128, 128, 128);
const naplps_gray5 = new Vector3(160, 160, 160);
const naplps_gray6 = new Vector3(192, 192, 192);
const naplps_gray7 = new Vector3(224, 224, 224);
const naplps_blue = new Vector3(0, 0, 255);
const naplps_blue_magenta = new Vector3(5*36, 0, 7*36);
const naplps_pinkish_red = new Vector3(7*36, 0, 4*36);
const naplps_orange_red = new Vector3(7*36, 2*36, 0);
const naplps_yellow = new Vector3(255, 255, 0);
const naplps_yellow_green = new Vector3(2*36, 7*36, 0);
const naplps_greenish = new Vector3(0, 7*36, 4*36);
const naplps_bluegreen = new Vector3(0, 5*36, 7*36);

const naplps_defaultColorMap = [naplps_black, naplps_gray1, naplps_gray2, naplps_gray3, naplps_gray4, naplps_gray5, naplps_gray6, naplps_gray7, naplps_blue, naplps_blue_magenta, naplps_pinkish_red, naplps_orange_red, naplps_yellow, naplps_yellow_green, naplps_greenish, naplps_bluegreen];
const naplps_defaultColorIndices1 = ["40", "44", "49", "4D", "52", "56", "5B", "5F", "60", "64", "68", "6C", "70", "74", "78", "7C"];
const naplps_defaultColorIndices2 = ["40", "60", "40", "60", "50", "70", "50", "70", "40", "40", "40", "40", "40", "40", "40", "40"]; 