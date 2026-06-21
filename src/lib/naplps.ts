// Shared NAPLPS value types used across the SVG→NAPLPS encoders
// (parseColor in svgToNaplps and the standard period encoder/decoder).

export interface NAPLPSPoint {
  x: number;
  y: number;
}

export interface NAPLPSColor {
  r: number;
  g: number;
  b: number;
}
