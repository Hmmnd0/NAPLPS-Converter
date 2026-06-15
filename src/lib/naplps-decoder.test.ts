import { describe, it, expect } from 'vitest';
import { NAPLPSFoxtoolboxEncoder } from './naplps-foxtoolbox';
import { svgToNaplpsFoxtoolbox } from './svgToNaplps';
import { decodeNaplps, decodeNaplpsHex } from './naplps-decoder';

describe('decodeNaplps — direct encoder round-trip', () => {
  it('recovers color, rectangle and polygon exactly', () => {
    const enc = new NAPLPSFoxtoolboxEncoder();
    enc.setColor({ r: 18, g: 52, b: 86 }); // #123456
    enc.addFilledRectangle({ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 });
    enc.setColor({ r: 200, g: 100, b: 50 });
    enc.addPolygon([{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.9 }, { x: 0.9, y: 0.1 }]);
    enc.endGraphics();

    const shapes = decodeNaplps(enc.getData());
    expect(shapes).toHaveLength(2);

    const rect = shapes[0];
    expect(rect.type).toBe('rect');
    if (rect.type === 'rect') {
      expect(rect.color).toEqual({ r: 18, g: 52, b: 86 });
      expect(rect.topLeft.x).toBeCloseTo(0.1, 3);
      expect(rect.topLeft.y).toBeCloseTo(0.2, 3);
      expect(rect.bottomRight.x).toBeCloseTo(0.8, 3);
      expect(rect.bottomRight.y).toBeCloseTo(0.9, 3);
    }

    const poly = shapes[1];
    expect(poly.type).toBe('polygon');
    if (poly.type === 'polygon') {
      expect(poly.color).toEqual({ r: 200, g: 100, b: 50 });
      expect(poly.points).toHaveLength(3);
    }
  });

  it('round-trips a range of colors exactly (8-bit GRB packing is lossless)', () => {
    for (const c of [
      { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 255, g: 140, b: 0 },
      { r: 51, g: 102, b: 204 }, { r: 1, g: 2, b: 3 },
    ]) {
      const enc = new NAPLPSFoxtoolboxEncoder();
      enc.setColor(c);
      enc.addFilledRectangle({ x: 0, y: 0 }, { x: 1, y: 1 });
      enc.endGraphics();
      const [shape] = decodeNaplps(enc.getData());
      expect(shape.color).toEqual(c);
    }
  });
});

describe('full pipeline round-trip: SVG → NAPLPS → decode', () => {
  // The "house": CSS-class fills + <path> rect + <path> triangle + <g>-inherited rect.
  const HOUSE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <style>.wall{fill:#3366CC;} .roof{fill:#CC3333;}</style>
    <path class="wall" d="M20 50 L80 50 L80 90 L20 90 Z"/>
    <path class="roof" d="M15 50 L50 20 L85 50 Z"/>
    <g fill="#FFCC00"><rect x="45" y="65" width="12" height="25"/></g>
  </svg>`;

  it('reproduces the intended shapes, colors and geometry', async () => {
    const shapes = decodeNaplpsHex(await svgToNaplpsFoxtoolbox(HOUSE, 100, 100));
    const rects = shapes.filter(s => s.type === 'rect');
    const polys = shapes.filter(s => s.type === 'polygon');

    expect(rects).toHaveLength(2);
    expect(polys).toHaveLength(1);

    const colors = shapes.map(s => `${s.color.r},${s.color.g},${s.color.b}`);
    expect(colors).toContain('51,102,204');   // #3366CC wall
    expect(colors).toContain('204,51,51');     // #CC3333 roof
    expect(colors).toContain('255,204,0');     // #FFCC00 door

    const wall = rects.find(r => r.type === 'rect' && Math.abs(r.topLeft.x - 0.2) < 0.01);
    expect(wall).toBeTruthy();
    if (wall && wall.type === 'rect') {
      expect(wall.bottomRight.x).toBeCloseTo(0.8, 2);
      expect(wall.bottomRight.y).toBeCloseTo(0.9, 2);
    }
  });
});
