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

/** The attack paths: one per role, plus the transform group's. */
const DIVE_PATHS = ['dive-drone', 'dive-wing', 'dive-warden', 'dive-transform'] as const;

/**
 * Formation slots a dive is flown from, with the side each would sweep towards.
 *
 * The outermost columns are the whole point: a dive sweeps *outwards*, so the
 * widest excursion any enemy makes is the one an enemy in column 0 or column 9
 * makes, and that is the case that has to stay on screen.
 */
const DIVE_STARTS: readonly { readonly at: Vec2; readonly mirror: boolean }[] = [
  { at: [32, 108], mirror: false },
  { at: [80, 56], mirror: false },
  { at: [96, 96], mirror: false },
  { at: [112, 84], mirror: true },
  { at: [160, 72], mirror: true },
  { at: [176, 108], mirror: true },
];

/** Where the fighter sits, for a dive segment that aims at it. */
const PLAYER: Vec2 = [112, 248];

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
  it('ships one path per perceived entry shape, plus the attack paths', () => {
    expect([...pack.paths.keys()].sort()).toEqual(
      [...ENTRY_PATHS, ...DIVE_PATHS, 'dive-return'].sort(),
    );
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

/**
 * The attack paths.
 *
 * These carry a constraint the entry paths do not: a dive is flown **from
 * wherever the enemy already is**, so it must state no `start` and must use only
 * the segment types that are relative to the flyer's pose. A dive built from
 * absolute `line` or `bezier` targets would drag all forty enemies through the
 * same piece of screen, and no assertion about one starting position would
 * notice. See `packs/classic/paths/README.md`.
 */
describe('the Classic dive paths', () => {
  /** The segment types whose geometry is relative to where the flyer already is. */
  const RELATIVE = new Set([
    'arc',
    'loop',
    'lissajous',
    'sine',
    'wait',
    'aimAtPlayer',
    'toSlot',
    'exitBottom',
    'fire',
    'trigger',
  ]);

  function dive(id: string, at: Vec2, mirror: boolean): CompiledPath {
    const path = pack.paths.get(id);
    if (path === undefined) throw new Error(`missing path ${id}`);
    return compilePath(path, {
      mirror,
      slot: SLOT,
      player: PLAYER,
      playfield: DEFAULT_PLAYFIELD,
      start: at,
      heading: 0,
    });
  }

  it.each(DIVE_PATHS)('%s is flown from the slot it left, not from a stated start', (id) => {
    const path = pack.paths.get(id);
    if (path === undefined) throw new Error(`missing path ${id}`);
    expect(path.start).toBeUndefined();
    for (const segment of path.segments) {
      expect([id, segment.type, RELATIVE.has(segment.type)]).toEqual([id, segment.type, true]);
    }
    // And it fans both ways from one file, as the entry paths do.
    expect(path.mirror).toBe(true);
  });

  it.each(DIVE_PATHS)('%s leaves the bottom of the screen from every slot', (id) => {
    for (const { at, mirror } of DIVE_STARTS) {
      const compiled = dive(id, at, mirror);
      const end = samplePath(compiled, compiled.totalFrames);

      // It terminates, and takes a plausible time doing it: a dive over in half a
      // second or lasting ten is a content bug.
      expect(Number.isFinite(compiled.totalFrames)).toBe(true);
      expect(compiled.totalFrames).toBeGreaterThan(60);
      expect(compiled.totalFrames).toBeLessThan(600);

      // Confirmed behaviour (reference section 5): divers leave by the bottom.
      // Whether they come back is the alien's own `dive.returns`.
      expect(end.done).toBe(true);
      expect(end.y).toBeGreaterThanOrEqual(DEFAULT_PLAYFIELD.height);
    }
  });

  it.each(DIVE_PATHS)('%s stays on screen sideways, sweeping outwards from any column', (id) => {
    // The outward sweep is the widest case and the one a radius chosen by eye
    // gets wrong. A sprite is 16 px, so an anchor inside [0, width − 16] keeps the
    // whole sprite on the playfield rather than merely its anchor.
    for (const { at, mirror } of DIVE_STARTS) {
      const bounds = pathBounds(dive(id, at, mirror));
      expect([id, at, bounds.minX >= 0]).toEqual([id, at, true]);
      expect([id, at, bounds.maxX <= DEFAULT_PLAYFIELD.width - 16]).toEqual([id, at, true]);
      expect(bounds.minY).toBeGreaterThanOrEqual(at[1] - OFF_SCREEN_MARGIN);
    }
  });

  it('scripts the transform group’s shots on its path, and nobody else’s', () => {
    // The trio "fires on the way down" is a moment in its dive; the roles' own
    // bombing is a timer the difficulty row governs, so no other path fires.
    const fires = (id: string): number =>
      dive(id, [112, 84], false).events.filter((event) => event.kind === 'fire').length;
    expect(fires('dive-transform')).toBeGreaterThan(0);
    for (const id of ['dive-drone', 'dive-wing', 'dive-warden']) expect(fires(id)).toBe(0);
    for (const id of ENTRY_PATHS) {
      const path = pack.paths.get(id);
      expect(path?.segments.some((segment) => segment.type === 'fire')).toBe(false);
    }
  });

  it('homes with toSlot and nothing else on the way back', () => {
    const path = pack.paths.get('dive-return');
    expect(path?.segments.map((segment) => segment.type)).toEqual(['toSlot']);
    expect(path?.start).toBeUndefined();
    // Compiled from above the top of the screen, it lands exactly in the slot.
    const compiled = compilePath(path ?? { id: 'x', mirror: false, segments: [] }, {
      slot: SLOT,
      playfield: DEFAULT_PLAYFIELD,
      start: [40, -16],
      heading: 0,
    });
    const end = samplePath(compiled, compiled.totalFrames);
    expect(end.x).toBeCloseTo(SLOT[0], 6);
    expect(end.y).toBeCloseTo(SLOT[1], 6);
  });
});
