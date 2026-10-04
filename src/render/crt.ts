/**
 * The optional CRT filter: scanlines and the suggestion of curved glass, off by
 * default (`docs/DESIGN.md` section 3).
 *
 * **It works on device pixels, after the blit, and never moves one.** The game
 * draws on a 224x288 backbuffer and `canvas.ts` presents it at a whole-number
 * scale. A filter on the backbuffer itself has nowhere to put a scanline — at 1x
 * a logical row *is* one pixel, so darkening it erases a row of the 8x8 font —
 * and a filter that resamples (a real barrel warp) puts sprite edges between
 * device pixels, which is the blur the integer scale exists to prevent. So this
 * is an overlay on the presented image, built at its device resolution and
 * composited over it with ordinary alpha: it can only *darken* a device pixel,
 * never shift, blend or recolour one.
 *
 * Three things it darkens, each chosen to stay readable at arcade resolution:
 *
 * - **Scanlines, one per logical row.** The period is the scale, not a fixed
 *   number of device pixels, so every logical row gets the same dark band at its
 *   bottom and the top of every row is untouched. A free-running pitch would beat
 *   against the 8-pixel font and leave some strokes thinner than others. At 1x
 *   there is no room inside a row, and there are no scanlines.
 * - **A vignette**, zero over the middle of the screen and rising towards the
 *   edges and corners — the falloff of a tube's curved face. It is what the
 *   curvature is: the picture stays flat and pixel-exact.
 * - **Rounded glass corners**, three logical pixels in radius, so the mask covers
 *   only the outermost pixel of each corner — space the HUD leaves blank.
 *
 * The overlay is a pure function of the layout, so it is rasterised once per
 * layout (`src/render/README.md`'s first rule) and drawn with one `drawImage` a
 * frame. Its pixels are black with an alpha: this file holds no colour, like the
 * rest of `src/render/`.
 */

import type { Layout, ScreenFilter } from './canvas.js';
import { type Bitmap, createCanvasSurface, type SurfaceFactory } from './sprites.js';

/** Fraction of the light a scanline band removes. */
export const SCANLINE_DARKEN = 0.35;

/** Fraction of the light the vignette removes at the very corner of the picture. */
export const VIGNETTE_DARKEN = 0.3;

/**
 * Where the vignette starts and where it reaches full strength, as a distance from
 * the centre in half-picture units: 1 is the middle of an edge, √2 a corner.
 * Everything nearer the centre than the start is untouched.
 */
export const VIGNETTE_START = 0.75;
export const VIGNETTE_END = Math.SQRT2;

/** Radius of the rounded glass corners, in logical pixels. */
export const CORNER_RADIUS = 3;

/** Everything the overlay is made from, in device pixels of the presented image. */
export interface CrtPlan {
  /** Presented size: the backbuffer at its whole-number scale. */
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  /** Device rows at the bottom of each logical row that are a scanline. 0 at 1x. */
  readonly scanlineRows: number;
  /** Radius of the corner mask, in device pixels. */
  readonly cornerRadius: number;
}

/**
 * How many device rows of each logical row are a scanline.
 *
 * At most half the row, so the lit part of a pixel is never smaller than the dark
 * part, and a quarter of it as the scale grows: one row up to 5x, two at 6x–9x.
 */
export function scanlineRowsFor(scale: number): number {
  if (scale < 2) return 0;
  return Math.max(1, Math.round(scale / 4));
}

/** The overlay for one layout. Pure, so it is testable without a canvas. */
export function planCrt(layout: Pick<Layout, 'width' | 'height' | 'scale'>): CrtPlan {
  return {
    width: layout.width,
    height: layout.height,
    scale: layout.scale,
    scanlineRows: scanlineRowsFor(layout.scale),
    cornerRadius: CORNER_RADIUS * layout.scale,
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** How much of the corner mask covers a device pixel, 0 to 1, anti-aliased. */
function cornerCoverage(plan: CrtPlan, x: number, y: number): number {
  const r = plan.cornerRadius;
  // Distance past the arc's centre towards the nearest corner, on each axis.
  const dx = Math.max(r - (x + 0.5), x + 0.5 - (plan.width - r), 0);
  const dy = Math.max(r - (y + 0.5), y + 0.5 - (plan.height - r), 0);
  if (dx === 0 || dy === 0) return 0;
  return Math.min(1, Math.max(0, Math.hypot(dx, dy) - r + 0.5));
}

/**
 * The fraction of a device pixel's light the filter removes, 0 to 1.
 *
 * `x` and `y` are device pixels within the presented image, not the surface — the
 * letterbox is not part of the picture and the filter never reaches it.
 */
export function crtShade(plan: CrtPlan, x: number, y: number): number {
  const scan = y % plan.scale >= plan.scale - plan.scanlineRows ? SCANLINE_DARKEN : 0;

  const u = ((x + 0.5) / plan.width) * 2 - 1;
  const v = ((y + 0.5) / plan.height) * 2 - 1;
  const vignette = VIGNETTE_DARKEN * smoothstep(VIGNETTE_START, VIGNETTE_END, Math.hypot(u, v));

  const corner = cornerCoverage(plan, x, y);
  // Each stage passes on what is left of the light, so they multiply.
  return 1 - (1 - scan) * (1 - vignette) * (1 - corner);
}

/** The overlay as pixels: black everywhere, alpha the shade. */
export function rasteriseCrt(plan: CrtPlan): Bitmap {
  const data = new Uint8ClampedArray(plan.width * plan.height * 4);
  for (let y = 0; y < plan.height; y += 1) {
    for (let x = 0; x < plan.width; x += 1) {
      data[(y * plan.width + x) * 4 + 3] = Math.round(crtShade(plan, x, y) * 255);
    }
  }
  return { width: plan.width, height: plan.height, data };
}

export interface CrtFilterOptions {
  /** Turns the overlay into something `drawImage` takes. Stubbed by the tests. */
  readonly surfaceFactory?: SurfaceFactory;
}

/**
 * The filter `Display.setFilter` takes.
 *
 * Holds one overlay surface and rebuilds it only when the presented size or the
 * scale changes, which is a resize and not a frame.
 */
export function createCrtFilter(options: CrtFilterOptions = {}): ScreenFilter {
  const surfaceFactory = options.surfaceFactory ?? createCanvasSurface;
  let built: { plan: CrtPlan; surface: CanvasImageSource } | undefined;

  return {
    draw(ctx: CanvasRenderingContext2D, layout: Layout): void {
      if (
        built === undefined ||
        built.plan.width !== layout.width ||
        built.plan.height !== layout.height ||
        built.plan.scale !== layout.scale
      ) {
        const plan = planCrt(layout);
        built = { plan, surface: surfaceFactory(rasteriseCrt(plan)) };
      }
      ctx.drawImage(built.surface, layout.offsetX, layout.offsetY);
    },
  };
}
