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
  const W = opts.width ?? 256;
  const H = opts.height ?? 192;
  const bg = opts.background === undefined ? '#000000' : opts.background;
  const { shapes, commandCounts } = decodeNaplpsStandard(bytes);

  // NAPLPS Y points up (0 bottom … 1 top); SVG Y points down. Clamp to the unit
  // square and flip Y. Round to keep the SVG compact.
  const map = (p: NapPoint) => {
    const x = Math.max(0, Math.min(1, p.x)) * W;
    const y = (1 - Math.max(0, Math.min(1, p.y))) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  const els: string[] = [];
  if (bg) els.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);

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
      const m = map(p).split(',');
      els.push(`<circle cx="${m[0]}" cy="${m[1]}" r="0.6" fill="${rgb(s.color)}"/>`);
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    els.join('') +
    `</svg>`;

  return { svg, shapeCount: shapes.length, commandCounts };
}
