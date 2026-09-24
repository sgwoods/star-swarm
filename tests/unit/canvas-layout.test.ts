import { describe, expect, it } from 'vitest';

import { computeLayout, LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../src/render/canvas.js';

describe('logical resolution', () => {
  it('is the 224x288 arcade portrait playfield', () => {
    expect(LOGICAL_WIDTH).toBe(224);
    expect(LOGICAL_HEIGHT).toBe(288);
  });
});

describe('integer scaling', () => {
  it('uses the largest whole-number factor that fits', () => {
    // 1920x1080: height allows 1080/288 = 3.75, so 3x.
    const layout = computeLayout(1920, 1080);
    expect(layout.scale).toBe(3);
    expect(layout.width).toBe(224 * 3);
    expect(layout.height).toBe(288 * 3);
  });

  it('never picks a fractional factor, even when one would fit exactly', () => {
    const layout = computeLayout(224 * 2.5, 288 * 2.5);
    expect(layout.scale).toBe(2);
  });

  it('scales exactly at an exact multiple', () => {
    for (const scale of [1, 2, 3, 4, 7]) {
      const layout = computeLayout(LOGICAL_WIDTH * scale, LOGICAL_HEIGHT * scale);
      expect(layout.scale).toBe(scale);
      expect(layout.offsetX).toBe(0);
      expect(layout.offsetY).toBe(0);
    }
  });

  it('is limited by the tighter axis', () => {
    // Very wide, short viewport: height decides.
    expect(computeLayout(4000, 600).scale).toBe(2);
    // Very tall, narrow viewport: width decides.
    expect(computeLayout(500, 4000).scale).toBe(2);
  });

  it('honours a maxScale cap', () => {
    expect(computeLayout(4000, 4000, { maxScale: 3 }).scale).toBe(3);
    expect(computeLayout(224 * 2, 288 * 2, { maxScale: 5 }).scale).toBe(2);
  });

  it('never drops below 1x, so a tiny viewport clips rather than vanishes', () => {
    const layout = computeLayout(100, 100);
    expect(layout.scale).toBe(1);
    expect(layout.width).toBe(LOGICAL_WIDTH);
    expect(layout.height).toBe(LOGICAL_HEIGHT);
  });

  it('survives a zero-sized surface', () => {
    const layout = computeLayout(0, 0);
    expect(layout.scale).toBe(1);
    expect(Number.isFinite(layout.offsetX)).toBe(true);
    expect(Number.isFinite(layout.offsetY)).toBe(true);
  });
});

describe('letterboxing', () => {
  it('centres the image and leaves the rest as bars', () => {
    const layout = computeLayout(1000, 800);
    expect(layout.scale).toBe(2);
    expect(layout.offsetX).toBe(Math.floor((1000 - 448) / 2));
    expect(layout.offsetY).toBe(Math.floor((800 - 576) / 2));
  });

  it('keeps offsets whole, because a half-pixel offset resamples everything', () => {
    for (const [w, h] of [
      [1001, 801],
      [1365, 767],
      [377, 999],
    ] as const) {
      const layout = computeLayout(w, h);
      expect(Number.isInteger(layout.offsetX)).toBe(true);
      expect(Number.isInteger(layout.offsetY)).toBe(true);
    }
  });

  it('never stretches: the presented aspect ratio is always 224:288', () => {
    for (const [w, h] of [
      [1920, 1080],
      [800, 2000],
      [3000, 700],
      [224, 288],
      [640, 480],
    ] as const) {
      const layout = computeLayout(w, h);
      expect(layout.width / layout.height).toBeCloseTo(LOGICAL_WIDTH / LOGICAL_HEIGHT, 10);
    }
  });

  it('never overflows the surface once the surface is big enough for 1x', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 1024],
      [2560, 1440],
      [900, 1600],
    ] as const) {
      const layout = computeLayout(w, h);
      expect(layout.offsetX).toBeGreaterThanOrEqual(0);
      expect(layout.offsetY).toBeGreaterThanOrEqual(0);
      expect(layout.offsetX + layout.width).toBeLessThanOrEqual(w);
      expect(layout.offsetY + layout.height).toBeLessThanOrEqual(h);
    }
  });

  it('reports the full surface, bars included', () => {
    const layout = computeLayout(1920, 1080);
    expect(layout.surfaceWidth).toBe(1920);
    expect(layout.surfaceHeight).toBe(1080);
  });
});

describe('fractional and hostile inputs', () => {
  it('floors a fractional surface size rather than producing sub-pixel geometry', () => {
    const layout = computeLayout(1000.7, 800.9);
    expect(layout.surfaceWidth).toBe(1000);
    expect(layout.surfaceHeight).toBe(800);
  });

  it('clamps a negative surface size to zero', () => {
    const layout = computeLayout(-10, -10);
    expect(layout.surfaceWidth).toBe(0);
    expect(layout.surfaceHeight).toBe(0);
    expect(layout.scale).toBe(1);
  });

  it('rejects non-positive logical dimensions', () => {
    expect(() => computeLayout(100, 100, { logicalWidth: 0 })).toThrow(RangeError);
    expect(() => computeLayout(100, 100, { logicalHeight: -1 })).toThrow(RangeError);
  });

  it('accepts an alternative logical size, for the /lab previewer later', () => {
    const layout = computeLayout(640, 640, { logicalWidth: 64, logicalHeight: 64 });
    expect(layout.scale).toBe(10);
    expect(layout.width).toBe(640);
  });
});
