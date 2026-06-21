// Shared NAPLPS value types used across the SVG→NAPLPS encoders
// (the TelidonP5 "foxtoolbox" dialect and the standard period encoder).

export interface NAPLPSPoint {
  x: number;
  y: number;
}

export interface NAPLPSColor {
  r: number;
  g: number;
  b: number;
}
