import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { readPackSource } from '../../src/content/fs.js';
import type { LoadedPack } from '../../src/content/loader.js';
import { loadPack } from '../../src/content/loader.js';
import type { MovementPath } from '../../src/content/schema.js';
import type { CompiledPath, Vec2 } from '../../src/sim/paths.js';
import {
  compilePath,
  DEFAULT_PLAYFIELD,
  OFF_SCREEN_MARGIN,
  pathBounds,
  samplePath,
} from '../../src/sim/paths.js';

/**
 * The paths shipped in `packs/classic/paths/`, flown end to end by the real
 * interpreter.
 *
 * `packs/classic/paths/README.md` records which of the original's entry
 * choreography each file rests on, and which parts of
 * `docs/reference/arcade-reference.md` section 5 are deliberately not authored
 * yet. This test is about the data being *flyable*: it does not assert
 * arcade-derived coordinates, because the reference does not give any — the
 * thirteen ROM scripts' flight vectors were never decoded.
 */

const PACK_DIR = resolve(import.meta.dirname, '..', '..', 'packs', 'classic');

/** The three shapes of reference section 5, one authored path each. */
const ENTRY_PATHS = ['entry-side-file', 'entry-wide-arc', 'entry-long-row'] as const;

/**
 * Somewhere plausible in the formation for `toSlot` to aim at. `pack.json`
 * states slots as logical `(row, column)` because their pixel spacing is
 * unconfirmed, so a preview or a test has to supply pixels of its own.
 */
const SLOT: Vec2 = [88, 72];

let pack: LoadedPack;

beforeAll(() => {
  const { source, errors } = readPackSource(PACK_DIR);
  expect(errors).toEqual([]);
  if (source === undefined) throw new Error('classic pack could not be read');
  const result = loadPack(source);
  if (!result.ok)
    throw new Error(`classic pack failed to load:\n${JSON.stringify(result.errors, null, 2)}`);
  pack = result.pack;
});

function compile(path: MovementPath, mirror: boolean): CompiledPath {
  return compilePath(path, { mirror, slot: SLOT, playfield: DEFAULT_PLAYFIELD });
}

describe('the Classic entry paths', () => {
  it('ships one path per perceived entry shape, and no more', () => {
    expect([...pack.paths.keys()].sort()).toEqual([...ENTRY_PATHS].sort());
  });

  it.each(ENTRY_PATHS)('%s flies from off screen into its slot', (id) => {
    const path = pack.paths.get(id);
    expect(path).toBeDefined();
    if (path === undefined) return;

    for (const mirror of [false, true]) {
      const compiled = compile(path, mirror);

      // It terminates, and takes a sane amount of time doing it: an entry that
      // lasts a tenth of a second or half a minute is a content bug.
      expect(Number.isFinite(compiled.totalFrames)).toBe(true);
      expect(compiled.totalFrames).toBeGreaterThan(60);
      expect(compiled.totalFrames).toBeLessThan(600);

      // It starts off screen — that is what an entry path is — and ends in the
      // slot the environment named, whichever way round it is flown.
      expect(compiled.start.x < 0 || compiled.start.x > DEFAULT_PLAYFIELD.width).toBe(true);
      const end = samplePath(compiled, compiled.totalFrames);
      expect(end.x).toBeCloseTo(SLOT[0], 6);
      expect(end.y).toBeCloseTo(SLOT[1], 6);
      expect(end.done).toBe(true);

      // Nothing between those two points wanders further off screen than a
      // sprite's width — the check section 8 step 2 will make formal.
      const bounds = pathBounds(compiled);
      expect(bounds.minX).toBeGreaterThanOrEqual(-OFF_SCREEN_MARGIN);
      expect(bounds.maxX).toBeLessThanOrEqual(DEFAULT_PLAYFIELD.width + OFF_SCREEN_MARGIN);
      expect(bounds.minY).toBeGreaterThanOrEqual(-OFF_SCREEN_MARGIN);
      expect(bounds.maxY).toBeLessThanOrEqual(DEFAULT_PLAYFIELD.height + OFF_SCREEN_MARGIN);
    }
  });

  it.each(ENTRY_PATHS)('%s moves on every frame of its flight', (id) => {
    // A stalled frame means a zero-length or misordered segment, which reads as
    // a stutter on screen and is invisible in a still.
    const path = pack.paths.get(id);
    if (path === undefined) throw new Error(`missing path ${id}`);
    const compiled = compile(path, false);
    for (let frame = 1; frame < Math.floor(compiled.totalFrames); frame += 1) {
      const a = samplePath(compiled, frame - 1);
      const b = samplePath(compiled, frame);
      expect(Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)).toBeGreaterThan(0.5);
    }
  });

  it('declares a mirrored variant on every entry path', () => {
    // Reference section 5: the mirror bit is per bug, so half a wave flies the
    // reflection of the other half. A path that cannot be mirrored cannot fill
    // the right-hand side of a wave.
    for (const id of ENTRY_PATHS) expect(pack.paths.get(id)?.mirror).toBe(true);
  });

  it('enters from the left as authored, and from the right when mirrored', () => {
    // Reference section 5 gives the starting side for shapes 2 and 3 ("first
    // group from the left", "starting from the left"); shape 1 enters from both
    // at once, which is this same path with half the slots mirrored.
    for (const id of ENTRY_PATHS) {
      const path = pack.paths.get(id);
      if (path === undefined) throw new Error(`missing path ${id}`);
      expect(compile(path, false).start.x).toBeLessThan(0);
      expect(compile(path, true).start.x).toBeGreaterThan(DEFAULT_PLAYFIELD.width);
    }
  });
});
