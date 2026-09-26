/**
 * The plate a front-end card sits on.
 *
 * Every screen in `src/ui/` is drawn **over a running simulation** — the attract
 * demo, or the game that just ended — so text with nothing behind it lands on
 * top of the formation and the starfield and stops being readable. A filled
 * rectangle with a thin rule is the arcade answer, and it is the same one on
 * every card so the screens look like one machine.
 *
 * The cards themselves sit in the band between the formation and the fighter
 * ({@link CARD_TOP}…{@link CARD_BOTTOM}), which is the part of the playfield the
 * game leaves empty.
 */

import { LOGICAL_HEIGHT } from '../render/canvas.js';

/** Top of the clear band under the formation, in logical rows. */
export const CARD_TOP = 128;

/** Bottom of the clear band, above the fighter's row. */
export const CARD_BOTTOM = LOGICAL_HEIGHT - 56;

export interface PanelOptions {
  readonly fill?: string;
  /** Rule around the plate. Pass `null` for no rule. */
  readonly border?: string | null;
}

const DEFAULT_FILL = '#000000';
const DEFAULT_BORDER = '#2b5cff';

/** Draw a plate. `x`/`y` are its top-left corner. */
export function drawPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  options: PanelOptions = {},
): void {
  const { fill = DEFAULT_FILL, border = DEFAULT_BORDER } = options;
  const left = Math.round(x);
  const top = Math.round(y);
  const w = Math.round(width);
  const h = Math.round(height);

  ctx.fillStyle = fill;
  ctx.fillRect(left, top, w, h);

  if (border === null) return;
  ctx.fillStyle = border;
  ctx.fillRect(left, top, w, 1);
  ctx.fillRect(left, top + h - 1, w, 1);
  ctx.fillRect(left, top, 1, h);
  ctx.fillRect(left + w - 1, top, 1, h);
}

/** The same plate, centred on `centreX`. Returns its left edge. */
export function drawCentredPanel(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  y: number,
  width: number,
  height: number,
  options: PanelOptions = {},
): number {
  const left = Math.round(centreX - width / 2);
  drawPanel(ctx, left, y, width, height, options);
  return left;
}
