// NAPLPS decoder — the inverse of NAPLPSFoxtoolboxEncoder.
// Reads a .nap byte stream and returns the structured shapes it contains,
// with colors resolved to RGB and coordinates normalized to 0..1.
//
// This is the read side used for round-trip regression tests and for
// validating/inspecting existing .nap files. It understands the same command
// subset the encoder emits: SET_COLOR (0x3C), RECT FILLED (0x31),
// SET & POLY FILLED (0x37) and SI/end (0x0F). Header and any other control
// bytes are skipped.

export interface DecodedColor { r: number; g: number; b: number; }
export interface DecodedPoint { x: number; y: number; } // normalized 0..1

export type DecodedShape =
  | { type: 'rect'; color: DecodedColor; topLeft: DecodedPoint; bottomRight: DecodedPoint }
  | { type: 'polygon'; color: DecodedColor; points: DecodedPoint[] };

const SET_COLOR = 0x3c;
const RECT_FILLED = 0x31;
const POLY_FILLED = 0x37;
const END = 0x0f;

// Data bytes carry 6 bits offset by 0x40; command bytes are below 0x40.
const isDataByte = (b: number) => b >= 0x40 && b <= 0x7f;

// Two 6-bit nibbles (offset 0x40) → a 12-bit value normalized to 0..1.
function decodeCoord(hi: number, lo: number): number {
  return (((hi - 0x40) << 6) | (lo - 0x40)) / 4095;
}

// Reverse the encoder's 4-byte GRBGRB bit interleaving back into 8-bit RGB.
function decodeColor(b0: number, b1: number, b2: number, b3: number): DecodedColor {
  const bytes = [b0, b1, b2, b3];
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 4; i++) {
    const byte = bytes[i];
    const shift = 7 - 2 * i;
    g |= ((byte >> 5) & 1) << shift; g |= ((byte >> 2) & 1) << (shift - 1);
    r |= ((byte >> 4) & 1) << shift; r |= ((byte >> 1) & 1) << (shift - 1);
    b |= ((byte >> 3) & 1) << shift; b |= ((byte >> 0) & 1) << (shift - 1);
  }
  return { r, g, b };
}

export function decodeNaplps(bytes: Uint8Array | number[]): DecodedShape[] {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const shapes: DecodedShape[] = [];
  let color: DecodedColor = { r: 255, g: 255, b: 255 }; // encoder default
  let i = 0;

  const readPoints = (max: number): DecodedPoint[] => {
    const pts: DecodedPoint[] = [];
    while (pts.length < max && i + 3 < data.length && isDataByte(data[i])) {
      pts.push({ x: decodeCoord(data[i], data[i + 1]), y: decodeCoord(data[i + 2], data[i + 3]) });
      i += 4;
    }
    return pts;
  };

  while (i < data.length) {
    const cmd = data[i++];
    switch (cmd) {
      case SET_COLOR:
        if (i + 3 < data.length) {
          color = decodeColor(data[i], data[i + 1], data[i + 2], data[i + 3]);
          i += 4;
        }
        break;
      case RECT_FILLED: {
        const [topLeft, bottomRight] = readPoints(2);
        if (topLeft && bottomRight) shapes.push({ type: 'rect', color, topLeft, bottomRight });
        break;
      }
      case POLY_FILLED: {
        const points = readPoints(Infinity);
        if (points.length >= 3) shapes.push({ type: 'polygon', color, points });
        break;
      }
      case END:
        return shapes;
      // header / other control bytes: skip
    }
  }
  return shapes;
}

// Parse a hex string (as produced by getHexString) into bytes, then decode.
export function decodeNaplpsHex(hex: string): DecodedShape[] {
  const clean = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let j = 0; j < clean.length; j += 2) bytes[j / 2] = parseInt(clean.substr(j, 2), 16);
  return decodeNaplps(bytes);
}
