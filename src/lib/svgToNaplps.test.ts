import { describe, it, expect } from 'vitest';
import {
  tokenizePathD,
  parseColor,
  extractRectIfAxisAligned,
  dpSimplify,
  optimizeRectangles,
  parseSvgToPaths,
  buildCssClassMap,
  resolveFill,
  type Rectangle,
} from './svgToNaplps';

const svgDoc = (inner: string) =>
  new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`,
    'image/svg+xml',
  );

// Parse a full SVG string and feed parseSvgToPaths the (doc, cssMap) it now expects.
const pathsOf = (svg: string) => {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return parseSvgToPaths(doc, buildCssClassMap(doc));
};

describe('tokenizePathD', () => {
  it('splits commands and parses their numeric args', () => {
    expect(tokenizePathD('M0 0 L10 0')).toEqual([
      ['M', [0, 0]],
      ['L', [10, 0]],
    ]);
  });

  it('keeps multiple coordinate pairs attached to one command', () => {
    expect(tokenizePathD('M0,0L10,0 10,5')).toEqual([
      ['M', [0, 0]],
      ['L', [10, 0, 10, 5]],
    ]);
  });

  it('handles single-axis (H/V) and close (Z) commands', () => {
    expect(tokenizePathD('M0 0 H10 V5 Z')).toEqual([
      ['M', [0, 0]],
      ['H', [10]],
      ['V', [5]],
      ['Z', []],
    ]);
  });

  it('returns an empty list for an empty d string', () => {
    expect(tokenizePathD('')).toEqual([]);
  });
});

describe('parseColor', () => {
  it('parses 6-digit hex with and without leading #', () => {
    expect(parseColor('#FF8C00')).toEqual({ r: 255, g: 140, b: 0 });
    expect(parseColor('ff8c00')).toEqual({ r: 255, g: 140, b: 0 });
  });

  it('parses rgb() with or without spaces', () => {
    expect(parseColor('rgb(0,128,255)')).toEqual({ r: 0, g: 128, b: 255 });
    expect(parseColor('rgb(0, 128, 255)')).toEqual({ r: 0, g: 128, b: 255 });
  });

  it('falls back to black on unrecognized formats (e.g. 3-digit hex)', () => {
    expect(parseColor('#abc')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColor('rebeccapurple')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('extractRectIfAxisAligned', () => {
  it('recognizes a 4-corner axis-aligned rectangle', () => {
    const r = extractRectIfAxisAligned(
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
      '#ff0000',
    );
    expect(r).toEqual({ x: 0, y: 0, width: 10, height: 5, color: '#ff0000' });
  });

  it('rejects a non-axis-aligned quad', () => {
    const r = extractRectIfAxisAligned(
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }],
      '#000',
    );
    expect(r).toBeNull();
  });

  it('rejects degenerate (zero-area) and wrong-count point sets', () => {
    expect(
      extractRectIfAxisAligned(
        [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 5 }],
        '#000',
      ),
    ).toBeNull();
    expect(
      extractRectIfAxisAligned([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], '#000'),
    ).toBeNull();
  });
});

describe('dpSimplify', () => {
  it('drops collinear interior points', () => {
    const out = dpSimplify([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }], 0.5);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it('keeps a corner that exceeds the tolerance', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    expect(dpSimplify(pts, 0.5)).toHaveLength(3);
  });

  it('returns segments of two or fewer points unchanged', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(dpSimplify(pts, 0.5)).toBe(pts);
  });
});

describe('optimizeRectangles', () => {
  const red = '#ff0000';
  const mk = (x: number, y: number, width: number, height: number, color = red): Rectangle =>
    ({ x, y, width, height, color });

  it('merges a vertical strip of same-color rows', () => {
    const out = optimizeRectangles([mk(0, 0, 2, 1), mk(0, 1, 2, 1), mk(0, 2, 2, 1)]);
    expect(out).toEqual([mk(0, 0, 2, 3)]);
  });

  it('merges a horizontal run of same-color columns', () => {
    const out = optimizeRectangles([mk(0, 0, 1, 2), mk(1, 0, 1, 2)]);
    expect(out).toEqual([mk(0, 0, 2, 2)]);
  });

  it('does not merge rectangles of different colors', () => {
    const out = optimizeRectangles([mk(0, 0, 1, 1, '#ff0000'), mk(0, 1, 1, 1, '#00ff00')]);
    expect(out).toHaveLength(2);
  });

  it('iterates so a second pass can unlock further merges', () => {
    // Single pass reduces 3->2; the iterative loop must run again to reach 1.
    const out = optimizeRectangles([mk(0, 0, 2, 1), mk(0, 1, 1, 1), mk(1, 1, 1, 1)]);
    expect(out).toEqual([mk(0, 0, 2, 2)]);
  });
});

describe('parseSvgToPaths', () => {
  it('recovers an axis-aligned rectangle path as a rect, not a polygon', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 0 L10 5 L0 5 Z" fill="#ff0000"/></svg>';
    const { rects, polygons } = pathsOf(svg);
    expect(rects).toEqual([{ x: 0, y: 0, width: 10, height: 5, color: '#ff0000' }]);
    expect(polygons).toHaveLength(0);
  });

  it('keeps a triangular path as a polygon', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 0 L5 8 Z" fill="#00ff00"/></svg>';
    const { rects, polygons } = pathsOf(svg);
    expect(rects).toHaveLength(0);
    expect(polygons).toHaveLength(1);
    expect(polygons[0].color).toBe('#00ff00');
    expect(polygons[0].points).toHaveLength(3);
  });

  it('resolves fill from a CSS class block (Illustrator-style export)', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.st0{fill:#FF8C00;}</style>' +
      '<path class="st0" d="M0 0 L10 0 L5 8 Z"/></svg>';
    const { polygons } = pathsOf(svg);
    expect(polygons[0].color).toBe('#FF8C00');
  });

  it('skips paths with fill:none', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 0 L5 8 Z" fill="none"/></svg>';
    const { rects, polygons } = pathsOf(svg);
    expect(rects).toHaveLength(0);
    expect(polygons).toHaveLength(0);
  });
});

describe('resolveFill', () => {
  it('prefers an inline fill attribute', () => {
    const el = svgDoc('<rect fill="#112233"/>').querySelector('rect')!;
    expect(resolveFill(el, new Map())).toBe('#112233');
  });

  it('reads fill from an inline style attribute', () => {
    const el = svgDoc('<rect style="fill:#445566;stroke:red"/>').querySelector('rect')!;
    expect(resolveFill(el, new Map())).toBe('#445566');
  });

  it('inherits fill from an ancestor <g>', () => {
    const el = svgDoc('<g fill="#778899"><rect/></g>').querySelector('rect')!;
    expect(resolveFill(el, new Map())).toBe('#778899');
  });

  it('falls back to black when nothing specifies a fill', () => {
    const el = svgDoc('<rect/>').querySelector('rect')!;
    expect(resolveFill(el, new Map())).toBe('#000000');
  });

  it('builds a class->fill map from <style> rules that resolveFill consumes', () => {
    const doc = svgDoc('<style>.a{fill:#abcdef;} .b{stroke:red;}</style><rect class="a"/>');
    const map = buildCssClassMap(doc);
    expect(map.get('a')).toBe('#abcdef');
    expect(map.has('b')).toBe(false);
    expect(resolveFill(doc.querySelector('rect')!, map)).toBe('#abcdef');
  });
});
