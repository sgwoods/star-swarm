import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  distinctColours,
  emittedSteps,
  exactPalette,
  ffmpegArgs,
  logRequest,
  parseCaptureArgs,
  planPalettes,
  requireFfmpeg,
  resolveReplay,
} from '../../scripts/capture.js';

/**
 * The parts of `npm run capture` that need neither a browser nor `ffmpeg`: the
 * flags, which steps become frames, the encoding recipe and what a replay name
 * resolves to. The render itself is a command whose output a person looks at;
 * `docs/media/README.md` says which clip it made and how it was checked.
 */

describe('the capture flags', () => {
  it('takes the shape the roadmap names', () => {
    const options = parseCaptureArgs([
      '--replay',
      'dual-fighter',
      '--from',
      '2600',
      '--to',
      '5400',
      '--fps',
      '10',
    ]);
    expect(options).toMatchObject({ replay: 'dual-fighter', from: 2600, to: 5400, fps: 10 });
    expect(options).toMatchObject({ scale: 1, colors: 256 });
  });

  it.each([
    [[], /--replay is required/],
    [['--replay', 'x', '--fps', '7'], /does not divide 60/],
    [['--replay', 'x', '--colors', '300'], /at most 256/],
    [['--replay', 'x', '--from', '10', '--to', '5'], /before --from/],
    [['--replay', 'x', '--scale', '1.5'], /whole number/],
    [['--replay', 'x', '--speed', '2'], /unknown option --speed/],
    [['--replay'], /needs a value/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseCaptureArgs(argv)).toThrow(message);
  });
});

describe('which steps become frames', () => {
  it('is every sixth step at 10 fps, both ends inclusive', () => {
    expect(emittedSteps(2600, 2620, 10)).toEqual([2600, 2606, 2612, 2618]);
    expect(emittedSteps(1, 1, 60)).toEqual([1]);
  });

  it('turns a span into the frame count the clip will have', () => {
    expect(emittedSteps(2600, 5400, 10)).toHaveLength(467);
  });
});

describe('the encoding recipe, as flags', () => {
  const gif = ffmpegArgs({ frames: 'f/%05d.png', fps: 10, scale: 2, colors: 256, out: 'a.gif' });
  const filter = gif[gif.indexOf('-vf') + 1];

  it('scales nearest-neighbour and never dithers', () => {
    expect(filter).toContain('scale=iw*2:ih*2:flags=neighbor');
    expect(filter).toContain('palettegen=max_colors=256');
    expect(filter).toContain('paletteuse=dither=none');
  });

  it('reads the frames at the output rate rather than resampling time', () => {
    expect(gif.slice(gif.indexOf('-framerate'), gif.indexOf('-framerate') + 2)).toEqual([
      '-framerate',
      '10',
    ]);
    expect(filter).not.toMatch(/fps=/);
  });

  it('reads exact palettes instead of generating one, when it is given them', () => {
    const shared = ffmpegArgs({
      frames: 'f/%05d.png',
      fps: 10,
      scale: 2,
      colors: 256,
      out: 'a.gif',
      palette: { path: 'p.rgb', perFrame: false },
    });
    const at = shared.indexOf('p.rgb');
    expect(shared.slice(at - 7, at + 1)).toEqual([
      '-f',
      'rawvideo',
      '-pixel_format',
      'rgb24',
      '-video_size',
      '16x16',
      '-i',
      'p.rgb',
    ]);
    expect(shared[shared.indexOf('-lavfi') + 1]).toBe(
      '[0:v]scale=iw*2:ih*2:flags=neighbor[x];[x][1:v]paletteuse=dither=none',
    );
    expect(shared.join(' ')).not.toMatch(/palettegen/);

    // One palette image per frame, at the frames' rate, each taken by its frame.
    const perFrame = ffmpegArgs({
      frames: 'f/%05d.png',
      fps: 10,
      scale: 1,
      colors: 256,
      out: 'a.gif',
      palette: { path: 'p.rgb', perFrame: true },
    });
    const from = perFrame.indexOf('p.rgb');
    expect(perFrame.slice(from - 3, from + 1)).toEqual(['-framerate', '10', '-i', 'p.rgb']);
    expect(perFrame[perFrame.indexOf('-lavfi') + 1]).toMatch(/paletteuse=dither=none:new=1$/);
  });

  it('keeps the scaler for MP4 and refuses anything else', () => {
    const mp4 = ffmpegArgs({ frames: 'f', fps: 10, scale: 3, colors: 256, out: 'a.mp4' });
    expect(mp4[mp4.indexOf('-vf') + 1]).toBe('scale=iw*3:ih*3:flags=neighbor');
    expect(() => ffmpegArgs({ frames: 'f', fps: 10, scale: 1, colors: 2, out: 'a.webp' })).toThrow(
      /\.gif or \.mp4/,
    );
  });
});

describe('a missing ffmpeg', () => {
  it('fails naming the tool, not with a stack trace', () => {
    expect(() => {
      requireFfmpeg('star-swarm-no-such-ffmpeg');
    }).toThrow(/needs star-swarm-no-such-ffmpeg on the PATH.*external tool rather than a package/);
  });
});

describe('resolving a replay', () => {
  it('takes a golden with its own cabinet and starting stage', () => {
    const { request, golden } = resolveReplay('dual-fighter', undefined);
    expect(golden).toBe(true);
    expect(request.stage).toBe(20);
    // `unbombedCabinet`: the golden's rules, not the pack's.
    expect(request.rules.enemies.maxBullets).toBe(0);
    expect(request.replay.steps).toBe(7_400);
  });

  it('refuses a stage for a golden, and a name that is neither a golden nor a log', () => {
    expect(() => resolveReplay('dual-fighter', 3)).toThrow(/golden's own/);
    expect(() => resolveReplay('dual-figther', undefined)).toThrow(/no golden named/);
  });
});

describe('an exact palette', () => {
  it('is every colour in the frames once, and nothing else', () => {
    const rgb = Uint8Array.from([2, 5, 5, 2, 4, 5, 2, 5, 5, 255, 0, 0, 0, 0, 0]);
    expect(distinctColours(rgb)).toEqual([0x000000, 0x020405, 0x020505, 0xff0000]);

    const palette = exactPalette([0x020405, 0x020505]);
    expect(palette).toHaveLength(256 * 3);
    expect([...palette.subarray(0, 6)]).toEqual([2, 4, 5, 2, 5, 5]);
    // Unused entries repeat the first colour rather than adding black.
    expect([...palette.subarray(765)]).toEqual([2, 4, 5]);
    expect(() => exactPalette([])).toThrow(/at least one colour/);
    expect(() => exactPalette(Array.from({ length: 257 }, (_, i) => i))).toThrow(/do not fit/);
  });

  /** A tiny truecolour PNG, so `ffmpeg` can read frames the test made. */
  function png(width: number, height: number, rgb: readonly number[]): Buffer {
    const chunk = (type: string, data: Buffer): Buffer => {
      const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const check = Buffer.alloc(4);
      check.writeUInt32BE(crc32(body));
      return Buffer.concat([length, body, check]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 2, 0, 0, 0], 8);
    const rows: number[] = [];
    for (let y = 0; y < height; y += 1)
      rows.push(0, ...rgb.slice(y * width * 3, (y + 1) * width * 3));
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.from(rows))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }

  const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

  // The two near-blacks a fading ember left in the first recorded run, which
  // \`palettegen\` folded into one entry; the command is not run where there is no
  // ffmpeg, so neither is this.
  it.skipIf(!hasFfmpeg)('survives the encode, shared or one per frame', () => {
    const dir = mkdtempSync(join(tmpdir(), 'star-swarm-palette-'));
    try {
      // Four colours a frame and six in all, the two near-blacks among them.
      const pixels = [2, 5, 5, 2, 4, 5, 0, 0, 0, 255, 255, 255, 2, 4, 5, 2, 5, 5];
      writeFileSync(join(dir, '00001.png'), png(3, 2, pixels));
      writeFileSync(join(dir, '00002.png'), png(3, 2, [...pixels].reverse()));
      const frames = join(dir, '%05d.png');
      const decode = (input: string[]): Buffer =>
        spawnSync(
          'ffmpeg',
          [
            '-loglevel',
            'error',
            ...input,
            '-fps_mode',
            'passthrough',
            '-f',
            'rawvideo',
            '-pix_fmt',
            'rgb24',
            '-',
          ],
          { maxBuffer: 1 << 20 },
        ).stdout;
      const source = decode(['-framerate', '10', '-i', frames]);

      for (const [colors, kind] of [
        [256, 'shared'],
        [4, 'per-frame'],
      ] as const) {
        const plan = planPalettes(source, 3 * 2 * 3, colors);
        expect(plan.kind).toBe(kind);
        if (plan.kind === 'none') continue;
        const path = join(dir, `${kind}.rgb`);
        writeFileSync(path, plan.palettes);
        const out = join(dir, `${kind}.gif`);
        const args = ffmpegArgs({
          frames,
          fps: 10,
          scale: 1,
          colors,
          out,
          palette: { path, perFrame: kind === 'per-frame' },
        });
        expect(spawnSync('ffmpeg', args).status).toBe(0);
        expect(decode(['-i', out]).equals(source), kind).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('planning the palettes', () => {
  /** Frames of two pixels each, from colours. */
  const frames = (...colours: number[][]): Uint8Array =>
    Uint8Array.from(
      colours
        .flat()
        .flatMap((colour) => [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff]),
    );

  it('shares one palette while every colour in the clip fits it', () => {
    const plan = planPalettes(frames([1, 2], [2, 3]), 6, 3);
    expect(plan).toMatchObject({ kind: 'shared', colours: 3 });
    expect(plan.kind !== 'none' && plan.palettes.length).toBe(768);
  });

  it('gives each frame its own when the clip has too many and no frame does', () => {
    const plan = planPalettes(frames([1, 2], [3, 4], [5, 5]), 6, 2);
    expect(plan).toMatchObject({ kind: 'per-frame', colours: 5 });
    if (plan.kind === 'none') throw new Error('expected palettes');
    expect(plan.palettes.length).toBe(3 * 768);
    // The third frame's palette is its one colour, repeated.
    expect([...plan.palettes.subarray(2 * 768, 2 * 768 + 6)]).toEqual([0, 0, 5, 0, 0, 5]);
  });

  it('says there is nothing exact when one frame alone is too many', () => {
    expect(planPalettes(frames([1, 2], [3, 3]), 6, 1)).toEqual({
      kind: 'none',
      colours: 3,
      busiest: 2,
    });
  });
});

describe('what a log plays on', () => {
  it('is the shipped Classic rules and pack, from the stage asked for', () => {
    const { request } = resolveReplay('dual-fighter', undefined);
    const log = logRequest(request.replay, 4);
    expect(log.packs).toEqual(['classic']);
    expect(log.stage).toBe(4);
    expect(log.rules.enemies.maxBullets).not.toBe(0);
    expect(logRequest(request.replay, undefined)).not.toHaveProperty('stage');
  });
});
