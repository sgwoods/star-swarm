import { describe, expect, it } from 'vitest';

import {
  emittedSteps,
  ffmpegArgs,
  parseCaptureArgs,
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
    expect(request.replay.steps).toBe(5_400);
  });

  it('refuses a stage for a golden, and a name that is neither a golden nor a log', () => {
    expect(() => resolveReplay('dual-fighter', 3)).toThrow(/golden's own/);
    expect(() => resolveReplay('dual-figther', undefined)).toThrow(/no golden named/);
  });
});
