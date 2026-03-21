// NAPLPS Spec-Informed Encoder
// Key encoding conventions (per NAP.txt and naplps.js decoder):
//   - Opcode bytes: 0x20–0x3F (bit 6 = 0). Data bytes: 0x40–0x7F (bit 6 = 1).
//   - Coordinates: 12-bit, split into two 6-bit nibbles each offset by 0x40.
//     X and Y encoded separately (2 bytes each), 4 bytes per point total.
//     This matches the decoder's special path for SET & POLY FILLED (0x37).
//   - Color (SET COLOR 0x3C): 4-byte GRBGRB interleaved.
//     Each byte: bit5=G, bit4=R, bit3=B, bit2=G, bit1=R, bit0=B.
//     4 bytes × 2 bits/channel = 8 bits per channel, MSB first.

// Standard 16-byte header (CANCEL, ESC E, NSR, SO, RESET, DOMAIN 4-byte mode)
const NAPLPS_HEADER = [
  0x18, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F,
  0x21, 0x4D, 0x40, 0x40, 0x40, 0x40
];

// Encode RGB (0–255 each) as 4-byte GRBGRB interleaved, matching naplps.js setColor decoder.
function encodeColorBytes(r: number, g: number, b: number): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 4; i++) {
    const shift = 7 - 2 * i; // i=0→shift=7, i=1→5, i=2→3, i=3→1
    const gHi = (g >> shift) & 1;
    const gLo = (g >> (shift - 1)) & 1;
    const rHi = (r >> shift) & 1;
    const rLo = (r >> (shift - 1)) & 1;
    const bHi = (b >> shift) & 1;
    const bLo = (b >> (shift - 1)) & 1;
    bytes.push(0x40 | (gHi << 5) | (rHi << 4) | (bHi << 3) | (gLo << 2) | (rLo << 1) | bLo);
  }
  return bytes;
}

// Pack two normalized coordinates (0.0–1.0) into four data bytes (0x40–0x7F).
// Each axis: 12-bit value split into hi-6 and lo-6 bits, each offset by 0x40.
function pack12bitCoords(x: number, y: number): number[] {
  const xVal = Math.max(0, Math.min(4095, Math.round(x * 4095)));
  const yVal = Math.max(0, Math.min(4095, Math.round(y * 4095)));
  return [
    0x40 + ((xVal >> 6) & 0x3F),
    0x40 + (xVal & 0x3F),
    0x40 + ((yVal >> 6) & 0x3F),
    0x40 + (yVal & 0x3F),
  ];
}

// Build SET_COLOR bytes (opcode + 4 data bytes).
function setColorBytes(r: number, g: number, b: number): number[] {
  return [0x3C, ...encodeColorBytes(r, g, b)];
}

// Build SET & POLY FILLED (0x37) rectangle as 4 polygon points.
// The decoder's special path for 0x37 uses 2 bytes per coord, 4 bytes per point.
function polyFilledRect(x1: number, y1: number, x2: number, y2: number): number[] {
  return [
    0x37, // SET & POLY FILLED
    ...pack12bitCoords(x1, y1), // top-left
    ...pack12bitCoords(x2, y1), // top-right
    ...pack12bitCoords(x2, y2), // bottom-right
    ...pack12bitCoords(x1, y2), // bottom-left
  ];
}

// Build SET & POLY OUTLINED (0x36) rectangle as 4 polygon points.
function polyOutlinedRect(x1: number, y1: number, x2: number, y2: number): number[] {
  return [
    0x36, // SET & POLY OUTLINED
    ...pack12bitCoords(x1, y1),
    ...pack12bitCoords(x2, y1),
    ...pack12bitCoords(x2, y2),
    ...pack12bitCoords(x1, y2),
  ];
}

function toHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Main encoder class ───────────────────────────────────────────────────────

export class NaplpsSpecEncoder {
  public data: number[] = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.data = [...NAPLPS_HEADER];
  }

  // Pack a 12-bit coordinate (0.0–1.0) into two data bytes (0x40–0x7F).
  static encodeCoord12bit(val: number): [number, number] {
    const scaled = Math.max(0, Math.min(4095, Math.round(val * 4095)));
    return [0x40 + ((scaled >> 6) & 0x3F), 0x40 + (scaled & 0x3F)];
  }

  // Encode RGB as 4-byte GRBGRB array (matches naplps.js decoder).
  static encodeColorGRB(r: number, g: number, b: number): number[] {
    return encodeColorBytes(r, g, b);
  }

  // Add SET_COLOR command (opcode + 4 data bytes).
  setColor(r: number, g: number, b: number) {
    this.data.push(0x3C);
    this.data.push(...encodeColorBytes(r, g, b));
  }

  // Add filled rectangle as SET & POLY FILLED polygon (4 points).
  addFilledRectangle(x1: number, y1: number, x2: number, y2: number) {
    this.data.push(...polyFilledRect(x1, y1, x2, y2));
  }

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

// ─── Test file generators ─────────────────────────────────────────────────────

export function generateSpecMinimalRectangle(): string {
  const enc = new NaplpsSpecEncoder();
  enc.setColor(255, 0, 0); // Red
  enc.addFilledRectangle(0.4, 0.4, 0.6, 0.6);
  enc.data.push(0x0F); // SI (end of graphics)
  return enc.getHexString();
}

export function generateSpecMinimalText(): string {
  const enc = new NaplpsSpecEncoder();
  enc.addText('HELLO');
  return enc.getHexString();
}

export function generateTelidonP5TextFile(text: string): string {
  const ascii = Array.from(text).map(c => c.charCodeAt(0));
  return toHex([
    ...NAPLPS_HEADER,
    0x0F, // SI (text mode)
    ...ascii,
    0x0E, // SO (graphics mode)
    0x0F, // SI (exit)
  ]);
}

export function generateTelidonP5RectangleFile(): string {
  return toHex([
    ...NAPLPS_HEADER,
    ...setColorBytes(255, 0, 0), // Red
    ...polyFilledRect(0.4, 0.4, 0.6, 0.6),
    0x0F, // SI (end of graphics)
  ]);
}

export function generateTelidonP5HybridFile(text: string): string {
  const ascii = Array.from(text).map(c => c.charCodeAt(0));
  return toHex([
    ...NAPLPS_HEADER,
    ...setColorBytes(255, 0, 0), // Red
    ...polyFilledRect(0.3, 0.3, 0.7, 0.7),
    0x0F, // SI (text mode)
    ...ascii,
    0x0E, // SO (graphics mode)
    0x0F, // SI (exit)
  ]);
}

export function generateTelidonP5Rectangle8ByteFile(): string {
  return toHex([
    ...NAPLPS_HEADER,
    ...setColorBytes(255, 0, 0), // Red
    ...polyFilledRect(0.4, 0.4, 0.6, 0.6),
    0x0F, // SI (end of graphics)
  ]);
}

// POINT SET ABS (0x24) — positions drawing cursor and draws a point.
export function generateTelidonP5PointFile(): string {
  return toHex([
    ...NAPLPS_HEADER,
    ...setColorBytes(255, 0, 0), // Red
    0x24, // POINT SET ABS
    ...pack12bitCoords(0.5, 0.5),
    0x0F, // SI (end of graphics)
  ]);
}

// LINE ABS (0x28) — set start point with POINT SET ABS then draw to endpoint.
export function generateTelidonP5LineFile(): string {
  return toHex([
    ...NAPLPS_HEADER,
    ...setColorBytes(255, 0, 0), // Red
    0x24, // POINT SET ABS (set start point)
    ...pack12bitCoords(0.2, 0.2),
    0x28, // LINE ABS (draw to endpoint)
    ...pack12bitCoords(0.8, 0.8),
    0x0F, // SI (end of graphics)
  ]);
}

export function generateTelidonP5RectangleOutlinedFile(): string {
  return toHex([
    ...NAPLPS_HEADER,
    ...setColorBytes(255, 0, 0), // Red
    ...polyOutlinedRect(0.4, 0.4, 0.6, 0.6),
    0x0F, // SI (end of graphics)
  ]);
}

// Uses the spec-compliant NapEncoder (XY-interleaved coords + SELECT COLOR palette).
export function generateTelidonP5PolygonRectangleFile(): string {
  const color = new Vector3(255, 255, 0); // Yellow
  const points = [
    new Vector2(0.25, 0.25),
    new Vector2(0.75, 0.25),
    new Vector2(0.75, 0.75),
    new Vector2(0.25, 0.75),
  ];
  const stroke = new NapInputWrapper(color, points, true);
  const encoder = new NapEncoder([stroke]);
  return encoder.napRaw;
}

// ─── Spec-compliant NapEncoder (used by generateTelidonP5PolygonRectangleFile) ─

function doEncode(input: string): string {
  input = input.slice(-2);
  let returns = "";
  for (let i = 0; i < input.length; i += 2) {
    returns += String.fromCharCode(parseInt(input.substr(i, 2), 16));
  }
  return returns;
}

function getDistance(v1: Vector3, v2: Vector3): number {
  return Math.sqrt((v1.x - v2.x) ** 2 + (v1.y - v2.y) ** 2 + (v1.z - v2.z) ** 2);
}

class Vector2 {
  constructor(public x: number, public y: number) {}
}

class Vector3 {
  constructor(public x: number, public y: number, public z: number) {}
}

class NapInputWrapper {
  constructor(public color: Vector3, public points: Vector2[], public isFill: boolean) {}
}

// Default Telidon 16-color palette (for SELECT COLOR command)
const naplps_defaultColorMap = [
  new Vector3(0, 0, 0),          // 0 black
  new Vector3(32, 32, 32),       // 1 gray1
  new Vector3(64, 64, 64),       // 2 gray2
  new Vector3(96, 96, 96),       // 3 gray3
  new Vector3(128, 128, 128),    // 4 gray4
  new Vector3(160, 160, 160),    // 5 gray5
  new Vector3(192, 192, 192),    // 6 gray6
  new Vector3(224, 224, 224),    // 7 gray7
  new Vector3(0, 0, 255),        // 8 blue
  new Vector3(180, 0, 252),      // 9 blue-magenta
  new Vector3(252, 0, 144),      // 10 pinkish-red
  new Vector3(252, 72, 0),       // 11 orange-red
  new Vector3(255, 255, 0),      // 12 yellow
  new Vector3(72, 252, 0),       // 13 yellow-green
  new Vector3(0, 252, 144),      // 14 greenish
  new Vector3(0, 180, 252),      // 15 blue-green
];
const naplps_defaultColorIndices1 = ["40","44","49","4D","52","56","5B","5F","60","64","68","6C","70","74","78","7C"];
const naplps_defaultColorIndices2 = ["40","60","40","60","50","70","50","70","40","40","40","40","40","40","40","40"];

// Spec-compliant encoder: XY-interleaved coordinates (3 bits/axis/byte, sign bit in byte 0)
// plus SELECT COLOR palette lookup. Used only by generateTelidonP5PolygonRectangleFile.
class NapEncoder {
  public napRaw: string;

  constructor(strokes: NapInputWrapper[]) {
    this.napRaw = this.generateNapFile(strokes);
  }

  private generateNapFile(strokes: NapInputWrapper[]): string {
    let result = this.makeNapHeader();
    for (const stroke of strokes) {
      result += this.makeNapStroke(stroke.isFill, stroke.color, stroke.points);
    }
    result += this.makeNapFooter();
    return result;
  }

  private makeNapHeader(): string {
    return ["18","1B","45","1F","40","40","0E","20","7F","4F","21","4D","40","40","40","40"]
      .map(doEncode).join('');
  }

  private makeNapFooter(): string {
    return doEncode("1B") + doEncode("45");
  }

  private makeNapStroke(isFill: boolean, color: Vector3, points: Vector2[]): string {
    return this.makeNapSelectColor(color) +
           (isFill ? doEncode("37") : doEncode("36")) +
           this.makeNapPoints(points);
  }

  private makeNapSelectColor(color: Vector3): string {
    let index = 0, dist = 999999;
    for (let i = 0; i < naplps_defaultColorMap.length; i++) {
      const d = getDistance(color, naplps_defaultColorMap[i]);
      if (d < dist) { index = i; dist = d; }
    }
    return doEncode("3E") +
           doEncode(naplps_defaultColorIndices1[index]) +
           doEncode(naplps_defaultColorIndices2[index]) +
           doEncode("40") +
           doEncode("40");
  }

  private makeNapPoints(points: Vector2[]): string {
    const pointsToEncode: Vector2[] = [];
    for (let i = 0; i < points.length; i++) {
      if (i === 0) {
        pointsToEncode.push(points[0]);
      } else {
        const nv = points[i], nvLast = points[i - 1];
        let x = Math.abs(nv.x) - Math.abs(nvLast.x);
        if (nv.x < nvLast.x) x = Math.abs(x) - 1;
        let y = Math.abs(nv.y) - Math.abs(nvLast.y);
        if (nv.y < nvLast.y) y = Math.abs(y) - 1;
        pointsToEncode.push(new Vector2(x, y));
      }
    }
    return pointsToEncode.map(p => this.makeNapVector2(p)).join('');
  }

  // XY-interleaved 4-byte vector: byte 0 has sign+top-2-bits each axis,
  // bytes 1-3 have 3 bits each axis.
  private makeNapVector2(input: Vector2): string {
    const dataLength = 4;
    const maxBitVals = Math.pow(2, dataLength * 3 - 1); // 2048 for 4 bytes
    const intX = Math.round(Math.abs(input.x) * maxBitVals);
    const intY = Math.round(Math.abs(input.y) * maxBitVals);
    const binX = intX.toString(2).padStart(11, '0');
    const binY = intY.toString(2).padStart(11, '0');
    let result = '';
    for (let i = 0; i < dataLength; i++) {
      let vectorByte = "01"; // bit7=0, bit6=1 (data byte marker)
      switch (i) {
        case 0:
          vectorByte += (input.x >= 0 ? "0" : "1") + binX.charAt(0) + binX.charAt(1);
          vectorByte += (input.y >= 0 ? "0" : "1") + binY.charAt(0) + binY.charAt(1);
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
      result += doEncode(parseInt(vectorByte, 2).toString(16).padStart(2, '0'));
    }
    return result;
  }
}
