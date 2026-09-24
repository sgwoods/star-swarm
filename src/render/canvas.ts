/**
 * The display: a fixed 224x288 logical backbuffer presented at an integer scale
 * (docs/DESIGN.md section 3).
 *
 * All game drawing happens on a backbuffer that is *always* exactly 224x288, so
 * no drawing code ever needs to know the window size. Presenting blits that
 * backbuffer to the on-screen canvas at the largest whole-number factor that
 * fits, centred, with smoothing off. Whole-number factors and integer offsets
 * are the whole point: at 2.5x a one-pixel sprite edge lands between device
 * pixels and the browser blurs it.
 *
 * Space left over becomes black bars. The aspect ratio is never stretched — a
 * distorted 224x288 playfield would change how the game reads.
 */

/** Logical playfield width in pixels. Arcade-accurate portrait proportions. */
export const LOGICAL_WIDTH = 224;

/** Logical playfield height in pixels. */
export const LOGICAL_HEIGHT = 288;

/** Where the backbuffer lands on screen, in device pixels. All integers. */
export interface Layout {
  /** Whole-number magnification factor, at least 1. */
  readonly scale: number;
  /** Presented size in device pixels (`LOGICAL_WIDTH * scale`, etc.). */
  readonly width: number;
  readonly height: number;
  /** Top-left of the presented image within the display surface. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Display surface size in device pixels, i.e. including the black bars. */
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
}

export interface LayoutOptions {
  readonly logicalWidth?: number;
  readonly logicalHeight?: number;
  /** Cap the factor, e.g. to keep a window-mode build from filling a 5K panel. */
  readonly maxScale?: number;
}

/**
 * Pure layout maths — no canvas, no DOM, so it is unit-testable in Node.
 *
 * Scale never drops below 1: on a surface too small for even 1x we present at
 * 1x and let the edges clip, which is far better than vanishing.
 */
export function computeLayout(
  surfaceWidth: number,
  surfaceHeight: number,
  options: LayoutOptions = {},
): Layout {
  const {
    logicalWidth = LOGICAL_WIDTH,
    logicalHeight = LOGICAL_HEIGHT,
    maxScale = Number.POSITIVE_INFINITY,
  } = options;

  if (logicalWidth <= 0 || logicalHeight <= 0) {
    throw new RangeError('Logical dimensions must be positive');
  }

  const surfaceW = Math.max(0, Math.floor(surfaceWidth));
  const surfaceH = Math.max(0, Math.floor(surfaceHeight));

  const fit = Math.min(surfaceW / logicalWidth, surfaceH / logicalHeight);
  const capped = Math.min(Math.floor(fit), Math.floor(maxScale));
  const scale = Number.isFinite(capped) ? Math.max(1, capped) : 1;

  const width = logicalWidth * scale;
  const height = logicalHeight * scale;

  return {
    scale,
    width,
    height,
    // Integer offsets: a half-pixel offset would resample the whole image.
    offsetX: Math.floor((surfaceW - width) / 2),
    offsetY: Math.floor((surfaceH - height) / 2),
    surfaceWidth: surfaceW,
    surfaceHeight: surfaceH,
  };
}

export interface Display {
  /** The on-screen canvas, filling its container including the black bars. */
  readonly canvas: HTMLCanvasElement;
  /** The 224x288 backbuffer. Draw here and nowhere else. */
  readonly backbuffer: HTMLCanvasElement;
  /** 2D context of the backbuffer, with smoothing already disabled. */
  readonly ctx: CanvasRenderingContext2D;
  /** Current layout. Replaced on resize; do not cache the object. */
  readonly layout: Layout;
  /** Blit the backbuffer to the screen. Call once per rendered frame. */
  present: () => void;
  /** Re-measure the container and resize the display surface. */
  resize: () => void;
  /** Convert a client (CSS pixel) point to logical playfield coordinates. */
  toLogical: (clientX: number, clientY: number) => { x: number; y: number };
  /** Detach listeners and drop the canvas if this display created it. */
  destroy: () => void;
}

export interface DisplayOptions extends LayoutOptions {
  /** Element the display fills. Defaults to `document.body`. */
  container?: HTMLElement;
  /** Reuse an existing canvas instead of creating one. */
  canvas?: HTMLCanvasElement;
  /** Colour of the letterbox bars. Defaults to black. */
  letterboxColor?: string;
}

/** Fetch an opaque 2D context, or fail loudly — there is no useful fallback. */
function require2d(canvas: HTMLCanvasElement, what: string): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (ctx === null) throw new Error(`2D ${what} context unavailable`);
  return ctx;
}

/** Turn off every smoothing knob a 2D context might expose. */
function disableSmoothing(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = false;
  // Vendor-prefixed variants on older engines; harmless where absent.
  const legacy = ctx as CanvasRenderingContext2D &
    Record<'mozImageSmoothingEnabled' | 'webkitImageSmoothingEnabled', boolean | undefined>;
  legacy.mozImageSmoothingEnabled = false;
  legacy.webkitImageSmoothingEnabled = false;
}

/**
 * Create the display. Browser-only: this is `src/render/`, and `src/sim/` must
 * never reach for it.
 */
export function createDisplay(options: DisplayOptions = {}): Display {
  const {
    container = document.body,
    letterboxColor = '#000',
    logicalWidth = LOGICAL_WIDTH,
    logicalHeight = LOGICAL_HEIGHT,
    maxScale,
  } = options;

  const layoutOptions: LayoutOptions = {
    logicalWidth,
    logicalHeight,
    ...(maxScale === undefined ? {} : { maxScale }),
  };

  const ownsCanvas = options.canvas === undefined;
  const canvas = options.canvas ?? document.createElement('canvas');
  if (ownsCanvas) {
    canvas.id = 'screen';
    container.appendChild(canvas);
  }
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  // Belt and braces: the blit is already nearest-neighbour, but if anything ever
  // scales this element in CSS we still want hard pixel edges.
  canvas.style.imageRendering = 'pixelated';

  const screenCtx = require2d(canvas, 'canvas');
  disableSmoothing(screenCtx);

  const backbuffer = document.createElement('canvas');
  backbuffer.width = logicalWidth;
  backbuffer.height = logicalHeight;
  const ctx = require2d(backbuffer, 'backbuffer');
  disableSmoothing(ctx);

  let layout = computeLayout(0, 0, layoutOptions);

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    // Measure in device pixels so "largest whole-number factor" is a factor of
    // real pixels, not of CSS pixels that are themselves being scaled.
    const surfaceWidth = Math.max(1, Math.round(rect.width * dpr));
    const surfaceHeight = Math.max(1, Math.round(rect.height * dpr));

    layout = computeLayout(surfaceWidth, surfaceHeight, layoutOptions);

    if (canvas.width !== layout.surfaceWidth) canvas.width = layout.surfaceWidth;
    if (canvas.height !== layout.surfaceHeight) canvas.height = layout.surfaceHeight;
    // Changing the backing store resets context state, so re-apply it.
    disableSmoothing(screenCtx);
    present();
  }

  function present(): void {
    screenCtx.fillStyle = letterboxColor;
    screenCtx.fillRect(0, 0, layout.surfaceWidth, layout.surfaceHeight);
    screenCtx.drawImage(
      backbuffer,
      0,
      0,
      logicalWidth,
      logicalHeight,
      layout.offsetX,
      layout.offsetY,
      layout.width,
      layout.height,
    );
  }

  const onWindowResize = (): void => {
    resize();
  };
  window.addEventListener('resize', onWindowResize);

  // ResizeObserver catches container changes the window never hears about
  // (a flex sibling appearing, a sidebar opening).
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          resize();
        });
  observer?.observe(container);

  resize();

  return {
    canvas,
    backbuffer,
    ctx,
    get layout(): Layout {
      return layout;
    },
    present,
    resize,
    toLogical(clientX: number, clientY: number): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const deviceX = (clientX - rect.left) * dpr - layout.offsetX;
      const deviceY = (clientY - rect.top) * dpr - layout.offsetY;
      return { x: deviceX / layout.scale, y: deviceY / layout.scale };
    },
    destroy(): void {
      window.removeEventListener('resize', onWindowResize);
      observer?.disconnect();
      if (ownsCanvas) canvas.remove();
    },
  };
}
