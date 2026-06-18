// Convert decoded standard-NAPLPS shapes into an SVG string, so real .nap files
// can be imported into the app's existing SVG/edit/preview pipeline.
import { decodeNaplpsStandard, NapPoint } from './naplps-std-decoder';

export interface NaplpsToSvgOptions {
  width?: number;   // viewBox width  (default 256)
  height?: number;  // viewBox height (default 192, 4:3 like the period displays)
  background?: string | null; // background rect fill, or null for none (default '#000')
}

const rgb = (c: { r: number; g: number; b: number }) => `rgb(${c.r},${c.g},${c.b})`;

export interface NaplpsSvgResult {
  svg: string;
  shapeCount: number;
  commandCounts: Record<string, number>;
}

export function naplpsToSvg(bytes: Uint8Array | number[], opts: NaplpsToSvgOptions = {}): NaplpsSvgResult {
  const bg = opts.background === undefined ? '#000000' : opts.background;
  const { shapes, commandCounts } = decodeNaplpsStandard(bytes);

  // Work in a 0..1000 space (NAPLPS Y points up → flip for SVG), then fit the
  // viewBox to the content's bounding box so the image fills the frame instead
  // of floating in a corner of a fixed canvas.
  const S = 1000;
  const sx = (p: NapPoint) => p.x * S;
  const sy = (p: NapPoint) => (1 - p.y) * S;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) for (const p of s.points) {
    const x = sx(p), y = sy(p);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = S; maxY = S; }
  const pad = Math.max(8, 0.02 * Math.max(maxX - minX, maxY - minY));
  const vbX = minX - pad, vbY = minY - pad;
  const vbW = (maxX - minX) + 2 * pad, vbH = (maxY - minY) + 2 * pad;

  const map = (p: NapPoint) => `${sx(p).toFixed(1)},${sy(p).toFixed(1)}`;

  const els: string[] = [];
  if (bg) els.push(`<rect x="${vbX.toFixed(1)}" y="${vbY.toFixed(1)}" width="${vbW.toFixed(1)}" height="${vbH.toFixed(1)}" fill="${bg}"/>`);

  for (const s of shapes) {
    const pts = s.points.map(map).join(' ');
    if (s.type === 'polygon') {
      els.push(
        s.filled
          ? `<polygon points="${pts}" fill="${rgb(s.color)}"/>`
          : `<polygon points="${pts}" fill="none" stroke="${rgb(s.color)}" stroke-width="1"/>`,
      );
    } else if (s.type === 'polyline') {
      els.push(`<polyline points="${pts}" fill="none" stroke="${rgb(s.color)}" stroke-width="1"/>`);
    } else if (s.type === 'point') {
      const [p] = s.points;
      els.push(`<circle cx="${sx(p).toFixed(1)}" cy="${sy(p).toFixed(1)}" r="2" fill="${rgb(s.color)}"/>`);
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}" width="${Math.round(vbW)}" height="${Math.round(vbH)}">` +
    els.join('') +
    `</svg>`;

  return { svg, shapeCount: shapes.length, commandCounts };
}
