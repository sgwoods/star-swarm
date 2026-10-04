import { describe, expect, it } from 'vitest';

import { computeLayout, LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../src/render/canvas.js';
import {
  CORNER_RADIUS,
  createCrtFilter,
  crtShade,
  planCrt,
  rasteriseCrt,
  SCANLINE_DARKEN,
  scanlineRowsFor,
  VIGNETTE_DARKEN,
} from '../../src/render/crt.js';
import type { Bitmap } from '../../src/render/sprites.js';

/**
 * The CRT overlay, without a canvas (`src/render/crt.ts`).
 *
 * The filter is a darkening overlay on the presented image, so everything about
 * whether it stays readable is a property of one pure function of the layout.
 * What the browser does with it — that off is the bare blit and on only darkens —
 * is `tests/e2e/crt.spec.ts`.
 */

function planAt(scale: number): ReturnType<typeof planCrt> {
  return planCrt(computeLayout(LOGICAL_WIDTH * scale, LOGICAL_HEIGHT * scale));
}

const SCALES = [1, 2, 3, 4, 5, 6, 8];

describe('scanlines', () => {
  it('has none at 1x, where a logical row is a single device row', () => {
    expect(scanlineRowsFor(1)).toBe(0);
    const plan = planAt(1);
    const mid = Math.floor(plan.width / 2);
    for (let y = plan.height / 4; y < (plan.height * 3) / 4; y += 1) {
      expect(crtShade(plan, mid, y)).toBe(0);
    }
  });

  it('never darkens more than half of a logical row', () => {
    for (const scale of SCALES) {
      expect(scanlineRowsFor(scale) * 2).toBeLessThanOrEqual(scale);
    }
  });

  it('puts the same band at the bottom of every logical row, and nowhere else', () => {
    for (const scale of SCALES.filter((s) => s > 1)) {
      const plan = planAt(scale);
      const x = Math.floor(plan.width / 2);
      // The middle third, where the vignette is zero and only scanlines remain.
      for (let row = 96; row < 192; row += 1) {
        for (let offset = 0; offset < scale; offset += 1) {
          const dark = offset >= scale - plan.scanlineRows;
          expect(crtShade(plan, x, row * scale + offset)).toBeCloseTo(
            dark ? SCANLINE_DARKEN : 0,
            12,
          );
        }
      }
    }
  });
});

describe('readable at arcade resolution', () => {
  it('leaves the middle of the screen pixel-exact on the lit rows', () => {
    for (const scale of SCALES) {
      const plan = planAt(scale);
      for (let y = 112 * scale; y < 176 * scale; y += scale) {
        for (let x = 80 * scale; x < 144 * scale; x += 1) {
          expect(crtShade(plan, x, y)).toBe(0);
        }
      }
    }
  });

  it('keeps every logical pixel lit outside the corner glass', () => {
    // A logical pixel is as visible as the brightest device pixel inside it, so
    // that is the one measured. The worst it may lose is the vignette at its
    // strongest; anything darker is the corner glass, which may reach no further
    // than its own radius from each corner — space the HUD leaves blank, which
    // `tests/e2e/crt.spec.ts` checks against what is really drawn.
    const r = CORNER_RADIUS;
    const inCorner = (lx: number, ly: number): boolean =>
      (lx < r || lx >= LOGICAL_WIDTH - r) && (ly < r || ly >= LOGICAL_HEIGHT - r);
    for (const scale of SCALES) {
      const plan = planAt(scale);
      const hidden: string[] = [];
      for (let ly = 0; ly < LOGICAL_HEIGHT; ly += 1) {
        for (let lx = 0; lx < LOGICAL_WIDTH; lx += 1) {
          let least = 1;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              least = Math.min(least, crtShade(plan, lx * scale + dx, ly * scale + dy));
            }
          }
          if (least > VIGNETTE_DARKEN + 1e-9) hidden.push(`${lx},${ly}`);
        }
      }
      expect(
        hidden.filter((at) => !inCorner(...(at.split(',').map(Number) as [number, number]))),
      ).toEqual([]);
      // And the glass is really there: the outermost device pixel of each corner
      // is black.
      for (const [x, y] of [
        [0, 0],
        [plan.width - 1, 0],
        [0, plan.height - 1],
        [plan.width - 1, plan.height - 1],
      ] as const) {
        expect(crtShade(plan, x, y)).toBe(1);
      }
    }
  });

  it('only ever removes light, and never in colour', () => {
    const bitmap = rasteriseCrt(planAt(3));
    for (let at = 0; at < bitmap.data.length; at += 4) {
      expect(bitmap.data[at]).toBe(0);
      expect(bitmap.data[at + 1]).toBe(0);
      expect(bitmap.data[at + 2]).toBe(0);
    }
  });
});

describe('the overlay', () => {
  it('is the shade function, rasterised at the presented size', () => {
    const plan = planAt(2);
    const bitmap = rasteriseCrt(plan);
    expect(bitmap.width).toBe(LOGICAL_WIDTH * 2);
    expect(bitmap.height).toBe(LOGICAL_HEIGHT * 2);
    for (const [x, y] of [
      [0, 0],
      [5, 3],
      [224, 288],
      [447, 575],
      [100, 1],
    ] as const) {
      expect(bitmap.data[(y * bitmap.width + x) * 4 + 3]).toBe(
        Math.round(crtShade(plan, x, y) * 255),
      );
    }
  });

  it('is built once per layout and drawn at the picture, not the surface', () => {
    const built: Bitmap[] = [];
    const filter = createCrtFilter({
      surfaceFactory: (bitmap) => {
        built.push(bitmap);
        return { bitmap } as unknown as CanvasImageSource;
      },
    });
    const draws: unknown[][] = [];
    const ctx = {
      drawImage: (...args: unknown[]) => draws.push(args),
    } as unknown as CanvasRenderingContext2D;

    const wide = computeLayout(1280, 720);
    for (let frame = 0; frame < 5; frame += 1) filter.draw(ctx, wide);
    expect(built).toHaveLength(1);
    expect(draws).toHaveLength(5);
    expect(draws[0]?.slice(1)).toEqual([wide.offsetX, wide.offsetY]);

    // A resize that keeps the scale keeps the overlay; one that changes it does not.
    filter.draw(ctx, computeLayout(1300, 720));
    expect(built).toHaveLength(1);
    filter.draw(ctx, computeLayout(1280, 1200));
    expect(built).toHaveLength(2);
    expect(built[1]?.width).toBe(LOGICAL_WIDTH * 4);
  });
});
