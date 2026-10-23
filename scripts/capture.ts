/**
 * Render a replay to a clip: `docs/ROADMAP.md`, "Capturing gameplay video",
 * phase 1.
 *
 *     npm run capture -- --replay dual-fighter --from 3800 --to 6600 --fps 10
 *
 * A replay is a seed and an input log, so the run it describes can be played
 * again at any speed. This plays it through the real simulation and the real
 * renderer in a headless browser page (`capture.html`, on the `/lab` pattern),
 * **stepping** the loop rather than waiting on a clock: every simulation step
 * is taken, only the steps that become frames are drawn, and each drawn frame is
 * the logical 224x288 backbuffer saved as a numbered PNG under `.scratch/`.
 * `ffmpeg` then turns the frames into a clip with the recipe
 * `docs/media/README.md` used to state as prose, now as flags.
 *
 * So the frame rate is a choice of which steps to emit (`--fps 10` is every
 * sixth), fast-forward is stepping without drawing, and a slow machine renders
 * the same clip more slowly rather than a different, slower game.
 *
 * `--replay` takes a golden's name — its seed, cabinet and starting stage come
 * from `GOLDENS` in `scripts/record-replay.ts`, which is the only place they are
 * written down — or the path to a `.replay.json` log, which plays on the shipped
 * Classic rules from `--stage` (or the rules' first stage). `npm run record`
 * (`scripts/record.ts`) writes such a log from a run somebody played, and prints
 * the line that renders it.
 *
 * After the encode the clip is decoded again and compared with the frames pixel
 * for pixel: a GIF whose palette merged two of the game's colours, or a filter
 * that resampled a sprite, fails the command instead of shipping.
 *
 * Nothing is rendered unless this command is run. The game has no trigger for
 * it and the page is never built into the bundle.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { STEP_HZ } from '../src/engine/loop.js';
import { parseReplay, type Replay } from '../src/engine/replay.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../src/render/canvas.js';
import type { CaptureRequest, CaptureSession } from '../src/ui/lab/capture.js';
import { LOG_PACKS } from '../src/ui/lab/recording.js';
import { classicRules, GOLDENS, goldenPath } from './record-replay.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SCRATCH = join(REPO_ROOT, '.scratch', 'capture');

/* -------------------------------------------------------------------------- */
/* Options                                                                      */
/* -------------------------------------------------------------------------- */

export interface CaptureOptions {
  /** A golden's name, or a path to a `.replay.json`. */
  readonly replay: string;
  /** First step drawn, inclusive. A frame shows the world after that many steps. */
  readonly from: number;
  /** Last step that may be drawn, inclusive. Omitted means the end of the log. */
  readonly to: number | undefined;
  /** Frames per second of output. Must divide the simulation rate. */
  readonly fps: number;
  /** Whole-number magnification, nearest-neighbour. */
  readonly scale: number;
  /** GIF palette size. */
  readonly colors: number;
  /** Starting stage for a log that is not a golden. */
  readonly stage: number | undefined;
  /** Output file; its extension picks the format. */
  readonly out: string | undefined;
}

export const USAGE = `usage: npm run capture -- --replay <golden|path.replay.json> [options]

  --replay <name|path>  a golden in tests/sim/golden/ by name, or a replay log
  --from <step>         first step drawn (default 1)
  --to <step>           last step that may be drawn (default: the log's last)
  --fps <n>             output frame rate; must divide ${String(STEP_HZ)} (default 10)
  --scale <n>           whole-number nearest-neighbour magnification (default 1)
  --colors <n>          GIF palette size, at most 256 (default 256)
  --stage <n>           starting stage, for a log that is not a golden
  --out <file>          .gif or .mp4 (default .scratch/capture/<replay>.gif)`;

function wholeNumber(flag: string, value: string | undefined, min: number): number {
  const parsed = Number(value);
  if (value === undefined || !Number.isInteger(parsed) || parsed < min) {
    throw new Error(
      `${flag} needs a whole number of at least ${String(min)}, got ${String(value)}`,
    );
  }
  return parsed;
}

export function parseCaptureArgs(argv: readonly string[]): CaptureOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === undefined || !flag.startsWith('--')) {
      throw new Error(`unexpected argument ${String(flag)}\n\n${USAGE}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    values.set(flag, value);
    i += 1;
  }
  const known = ['--replay', '--from', '--to', '--fps', '--scale', '--colors', '--stage', '--out'];
  for (const flag of values.keys()) {
    if (!known.includes(flag)) throw new Error(`unknown option ${flag}\n\n${USAGE}`);
  }

  const replay = values.get('--replay');
  if (replay === undefined) throw new Error(`--replay is required\n\n${USAGE}`);
  const fps = wholeNumber('--fps', values.get('--fps') ?? '10', 1);
  if (STEP_HZ % fps !== 0) {
    throw new Error(
      `--fps ${String(fps)} does not divide ${String(STEP_HZ)}: a frame is a whole number of steps`,
    );
  }
  const colors = wholeNumber('--colors', values.get('--colors') ?? '256', 2);
  if (colors > 256) throw new Error('--colors is at most 256, which is all a GIF palette holds');

  const to = values.get('--to');
  const stage = values.get('--stage');
  const options: CaptureOptions = {
    replay,
    from: wholeNumber('--from', values.get('--from') ?? '1', 1),
    to: to === undefined ? undefined : wholeNumber('--to', to, 1),
    fps,
    scale: wholeNumber('--scale', values.get('--scale') ?? '1', 1),
    colors,
    stage: stage === undefined ? undefined : wholeNumber('--stage', stage, 1),
    out: values.get('--out'),
  };
  if (options.to !== undefined && options.to < options.from) {
    throw new Error(`--to ${String(options.to)} is before --from ${String(options.from)}`);
  }
  return options;
}

/** The steps that become frames: every `STEP_HZ / fps`-th, from `from` to `to`. */
export function emittedSteps(from: number, to: number, fps: number): number[] {
  const stride = STEP_HZ / fps;
  const steps: number[] = [];
  for (let step = from; step <= to; step += stride) steps.push(step);
  return steps;
}

/* -------------------------------------------------------------------------- */
/* The encoding recipe, as flags                                                */
/* -------------------------------------------------------------------------- */

/** Palettes for `paletteuse` to read: one for the whole clip, or one per frame. */
export interface PaletteFile {
  /** 16x16 raw RGB images, one after another, from {@link planPalettes}. */
  readonly path: string;
  readonly perFrame: boolean;
}

/**
 * The `ffmpeg` arguments that turn numbered frames into a clip.
 *
 * `flags=neighbor` and `dither=none` are the two that matter, as they were in
 * the prose recipe: any other scaler resamples the pixel art and any dither
 * speckles it. The frames already arrive at the output rate, so the recipe's
 * `fps=` filter has nothing left to do and is gone.
 *
 * A GIF's palette is read from `palette` when there is one — the frames' own
 * colours, exactly — and generated by `palettegen` only when there is not.
 * `palettegen` builds its palette in a perceptual space and can fold two colours
 * a step apart into one entry: the first recorded run lost a fading ember's
 * `#020505` into `#020405` that way, with 34 colours on screen and 256 to spare.
 */
export function ffmpegArgs(options: {
  readonly frames: string;
  readonly fps: number;
  readonly scale: number;
  readonly colors: number;
  readonly out: string;
  readonly palette?: PaletteFile;
}): string[] {
  const { frames, fps, scale, colors, out, palette } = options;
  const resize = `scale=iw*${String(scale)}:ih*${String(scale)}:flags=neighbor`;
  const input = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', frames];
  switch (extname(out).toLowerCase()) {
    case '.gif':
      if (palette !== undefined) {
        // One palette image per frame arrives at the frames' own rate, and
        // `new=1` makes each frame take its own.
        const rate = palette.perFrame ? ['-framerate', String(fps)] : [];
        return [
          ...input,
          ...['-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', '16x16', ...rate],
          ...['-i', palette.path],
          '-lavfi',
          `[0:v]${resize}[x];[x][1:v]paletteuse=dither=none${palette.perFrame ? ':new=1' : ''}`,
          '-loop',
          '0',
          out,
        ];
      }
      return [
        ...input,
        '-vf',
        `${resize},split[s0][s1];[s0]palettegen=max_colors=${String(colors)}[p];` +
          `[s1][p]paletteuse=dither=none`,
        '-loop',
        '0',
        out,
      ];
    case '.mp4':
      // H.264 subsamples chroma, so an MP4 is for length rather than for
      // pixel-exact frames; the GIF is the one the check below can hold exact.
      return [...input, '-vf', resize, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', out];
    default:
      throw new Error(`--out must end in .gif or .mp4, got ${out}`);
  }
}

/** The distinct colours in raw RGB pixels, as `0xRRGGBB`, ascending. */
export function distinctColours(rgb: Uint8Array): number[] {
  const seen = new Set<number>();
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    seen.add(((rgb[i] ?? 0) << 16) | ((rgb[i + 1] ?? 0) << 8) | (rgb[i + 2] ?? 0));
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * A GIF palette holding exactly `colours`, as the 16x16 raw RGB image
 * `paletteuse` reads one from. Unused entries repeat the first colour, so the
 * palette holds nothing the frames do not.
 */
export function exactPalette(colours: readonly number[], size = 256): Buffer {
  const first = colours[0];
  if (first === undefined) throw new Error('a palette needs at least one colour');
  if (colours.length > size) {
    throw new Error(`${String(colours.length)} colours do not fit a ${String(size)}-entry palette`);
  }
  const palette = Buffer.alloc(size * 3);
  for (let entry = 0; entry < size; entry += 1) {
    const colour = colours[entry] ?? first;
    palette[entry * 3] = (colour >> 16) & 0xff;
    palette[entry * 3 + 1] = (colour >> 8) & 0xff;
    palette[entry * 3 + 2] = colour & 0xff;
  }
  return palette;
}

/** How a GIF will hold the frames' colours exactly — or that it cannot. */
export type PalettePlan =
  | { readonly kind: 'shared' | 'per-frame'; readonly palettes: Buffer; readonly colours: number }
  | { readonly kind: 'none'; readonly colours: number; readonly busiest: number };

/**
 * Exact palettes for `rgb`, a run of frames `frameBytes` long each.
 *
 * One palette for the clip when every colour in it fits `colors` entries; else
 * one per frame — a GIF may carry a palette on each — when every frame's do. A
 * played run reaches the second: explosions are drawn with blending, and a run
 * that loses three fighters can hold three hundred colours in all and never more
 * than about a hundred and twenty at once. Past that nothing exact exists.
 */
export function planPalettes(rgb: Uint8Array, frameBytes: number, colors: number): PalettePlan {
  const all = distinctColours(rgb);
  if (all.length <= colors) {
    return { kind: 'shared', palettes: exactPalette(all), colours: all.length };
  }
  const perFrame: number[][] = [];
  for (let at = 0; at < rgb.length; at += frameBytes) {
    perFrame.push(distinctColours(rgb.subarray(at, at + frameBytes)));
  }
  const busiest = Math.max(...perFrame.map((colours) => colours.length));
  if (busiest > colors) return { kind: 'none', colours: all.length, busiest };
  return {
    kind: 'per-frame',
    palettes: Buffer.concat(perFrame.map((colours) => exactPalette(colours))),
    colours: all.length,
  };
}

/** Fail with the tool's name, not a stack trace, when `ffmpeg` is not installed. */
export function requireFfmpeg(command = 'ffmpeg'): void {
  const probe = spawnSync(command, ['-version'], { encoding: 'utf8' });
  if (probe.error !== undefined || probe.status !== 0) {
    throw new Error(
      `npm run capture needs ${command} on the PATH, and it was not found. ` +
        'It is an external tool rather than a package — install it (for example ' +
        '`brew install ffmpeg` or `apt-get install ffmpeg`) and run the command again.',
    );
  }
}

function runFfmpeg(args: readonly string[]): Buffer {
  const result = spawnSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr.toString('utf8').trim()}`);
  }
  return result.stdout;
}

/** Decode frames (or a clip) to raw RGB, scaled nearest-neighbour by `scale`. */
function decodeRgb(input: string[], scale: number): Buffer {
  return runFfmpeg([
    '-loglevel',
    'error',
    ...input,
    '-vf',
    `scale=iw*${String(scale)}:ih*${String(scale)}:flags=neighbor`,
    '-fps_mode',
    'passthrough',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ]);
}

/* -------------------------------------------------------------------------- */
/* Resolving a replay                                                           */
/* -------------------------------------------------------------------------- */

export interface ResolvedReplay {
  readonly name: string;
  readonly request: CaptureRequest;
  /** Whether a final fingerprint exists to hold the browser's run to. */
  readonly golden: boolean;
}

export function resolveReplay(replay: string, stage: number | undefined): ResolvedReplay {
  const spec = GOLDENS.find((golden) => golden.name === replay);
  if (spec !== undefined) {
    if (stage !== undefined) {
      throw new Error(`--stage is a golden's own (${replay} starts where it was recorded)`);
    }
    return {
      name: spec.name,
      golden: true,
      request: {
        replay: parseReplay(readFileSync(goldenPath(spec.name), 'utf8')),
        rules: spec.rules ?? classicRules(),
        packs: ['classic'],
        ...(spec.stage !== undefined && { stage: spec.stage }),
      },
    };
  }
  if (!replay.endsWith('.json')) {
    const names = GOLDENS.map((golden) => golden.name).join(', ');
    throw new Error(`no golden named "${replay}" (have: ${names}); a log is a path ending .json`);
  }
  const parsed: Replay = parseReplay(readFileSync(resolve(replay), 'utf8'));
  return {
    name: basename(replay).replace(/\.replay\.json$|\.json$/, ''),
    golden: parsed.finalState !== undefined,
    request: logRequest(parsed, stage),
  };
}

/**
 * What a `.replay.json` log plays on: the shipped Classic rules and pack, from
 * `stage` or the rules' first. The record page plays exactly this
 * (`LOG_PACKS` in `src/ui/lab/recording.ts`), and `npm run record` checks every
 * run it keeps against it, so a log it wrote is a log this command renders.
 */
export function logRequest(replay: Replay, stage: number | undefined): CaptureRequest {
  return {
    replay,
    rules: classicRules(),
    packs: LOG_PACKS,
    ...(stage !== undefined && { stage }),
  };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                    */
/* -------------------------------------------------------------------------- */

/** A port nothing is listening on, so a second checkout's dev server is never the one used. */
export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no port'));
        else resolvePort(address.port);
      });
    });
  });
}

interface Rendered {
  readonly frames: number;
  readonly fingerprint: string | undefined;
}

/**
 * Render every emitted step to `dir/NNNNN.png` through the page.
 *
 * Its own dev server on a free port, so a second checkout's server on the shared
 * one is never what gets filmed (the trap `playwright.config.ts` describes).
 */
async function renderFrames(
  request: CaptureRequest,
  steps: readonly number[],
  lastStep: number,
  dir: string,
): Promise<Rendered> {
  const { createServer } = await import('vite');
  const { chromium } = await import('@playwright/test');

  const port = await freePort();
  const server = await createServer({
    root: REPO_ROOT,
    logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  });
  await server.listen();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT },
    });
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await page.goto(`http://127.0.0.1:${String(port)}/capture.html`);
    await page.waitForFunction(() => window.starSwarmCapture !== undefined);
    if (problems.length > 0) throw new Error(`the capture page failed: ${problems.join('; ')}`);

    await page.evaluate((req) => {
      const capture = window.starSwarmCapture;
      if (capture === undefined) throw new Error('capture page not ready');
      (window as unknown as { session: CaptureSession }).session = capture.open(req);
    }, request);

    let written = 0;
    for (const step of steps) {
      const url = await page.evaluate(
        (at) => (window as unknown as { session: CaptureSession }).session.frameAt(at),
        step,
      );
      written += 1;
      const png = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      writeFileSync(join(dir, `${String(written).padStart(5, '0')}.png`), png);
      if (written % 100 === 0) console.log(`  ${String(written)}/${String(steps.length)} frames`);
    }

    const fingerprint = await page.evaluate((end) => {
      const { session } = window as unknown as { session: CaptureSession };
      session.skipTo(end);
      return session.fingerprint;
    }, lastStep);
    return { frames: written, fingerprint };
  } finally {
    await browser.close();
    await server.close();
  }
}

/* -------------------------------------------------------------------------- */
/* The command                                                                  */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const options = parseCaptureArgs(process.argv.slice(2));
  requireFfmpeg();

  const { name, request, golden } = resolveReplay(options.replay, options.stage);
  const to = options.to ?? request.replay.steps;
  const steps = emittedSteps(options.from, to, options.fps);
  const out = resolve(options.out ?? join(SCRATCH, `${name}.gif`));
  const dir = join(SCRATCH, `${name}-frames`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  mkdirSync(dirname(out), { recursive: true });

  console.log(
    `capture  ${name}: steps ${String(options.from)}-${String(to)} of ` +
      `${String(request.replay.steps)}, ${String(steps.length)} frames at ${String(options.fps)} fps`,
  );
  const rendered = await renderFrames(request, steps, Math.max(to, request.replay.steps), dir);

  // The browser played the run, not something near it: the same fingerprint the
  // golden test compares, taken at the log's last step.
  const expected = request.replay.finalState;
  if (golden && expected !== undefined) {
    if (rendered.fingerprint !== expected) {
      throw new Error(`${name} did not replay to its recorded final state in the browser`);
    }
    console.log(`replayed ${name} to its recorded final state`);
  }

  const frames = join(dir, '%05d.png');
  const gif = extname(out).toLowerCase() === '.gif';
  // The frames' own colours, when they fit: then the palette is exact, and the
  // check below is a check on the scaler and the dither alone.
  const plan = gif
    ? planPalettes(
        decodeRgb(['-framerate', String(options.fps), '-i', frames], 1),
        LOGICAL_WIDTH * LOGICAL_HEIGHT * 3,
        options.colors,
      )
    : undefined;
  let palette: PaletteFile | undefined;
  if (plan !== undefined && plan.kind !== 'none') {
    palette = { path: join(SCRATCH, `${name}-palettes.rgb`), perFrame: plan.kind === 'per-frame' };
    writeFileSync(palette.path, plan.palettes);
  }
  runFfmpeg(
    ffmpegArgs({
      frames,
      fps: options.fps,
      scale: options.scale,
      colors: options.colors,
      out,
      ...(palette !== undefined && { palette }),
    }),
  );

  if (plan !== undefined) {
    // Decode both and compare: the clip's pixels must be the backbuffer's.
    const source = decodeRgb(['-framerate', String(options.fps), '-i', frames], options.scale);
    const clip = decodeRgb(['-i', out], 1);
    if (!source.equals(clip)) {
      const why =
        plan.kind === 'none'
          ? `the frames hold ${String(plan.colours)} colours, ${String(plan.busiest)} in the ` +
            `busiest one, and a palette holds ${String(options.colors)}`
          : `though its palettes held every colour the frames do`;
      throw new Error(
        `${basename(out)} is not pixel-identical to the rendered frames ` +
          `(${String(source.length)} bytes against ${String(clip.length)}): ${why}`,
      );
    }
    const held =
      plan.kind === 'per-frame'
        ? `${String(plan.colours)} colours, one palette per frame`
        : `${String(plan.colours)} colours`;
    console.log(
      `checked  every frame of ${basename(out)} is the backbuffer, pixel for pixel (${held})`,
    );
  }

  const size = readFileSync(out).length;
  const count = readdirSync(dir).length;
  console.log(`wrote    ${out} (${String(count)} frames, ${(size / 1024).toFixed(0)} KiB)`);
}

// Importing this module (the test does) must not render anything; only running
// it as a script does.
if (process.argv[1]?.endsWith('capture.ts') === true) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
