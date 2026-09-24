/**
 * Seeded deterministic RNG (docs/DESIGN.md pillar 4).
 *
 * `Math.random()` is banned in `src/sim/` and `src/engine/` — lint enforces it —
 * because a replay is only reproducible if every random draw is. Everything here
 * is 32-bit integer arithmetic via `Math.imul` and `>>>`, so the same seed
 * produces the same sequence on every engine and platform, with no dependence on
 * floating-point rounding order.
 *
 * The generator is sfc32 (128-bit state), seeded by splitmix32 so that even
 * seeds like `0` and `1` start in well-mixed, unrelated places.
 */

/** Serialisable generator state: four uint32s. Save it, restore it, resume. */
export type RngState = readonly [number, number, number, number];

export interface Rng {
  /** Next raw draw, a uint32 in [0, 2^32). */
  nextUint32: () => number;
  /** Next draw as a float in [0, 1). */
  next: () => number;
  /** Integer in [min, max), min inclusive and max exclusive. */
  int: (minInclusive: number, maxExclusive: number) => number;
  /** Float in [min, max). */
  float: (min: number, max: number) => number;
  /** True with probability `p`; `p <= 0` never, `p >= 1` always. */
  chance: (p: number) => boolean;
  /** Uniform element of a non-empty array. */
  pick: <T>(items: readonly T[]) => T;
  /** Fisher-Yates shuffle of a copy; the input is left alone. */
  shuffled: <T>(items: readonly T[]) => T[];
  /** Current state, for saving alongside a replay. */
  getState: () => RngState;
  /** Restore a previously captured state. */
  setState: (state: RngState) => void;
  /** Independent generator positioned exactly where this one is. */
  clone: () => Rng;
}

/**
 * splitmix32: turns a single 32-bit seed into a stream of well-mixed uint32s.
 * Used only to fill sfc32's state.
 */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/**
 * FNV-1a over UTF-16 code units, so a seed can be a human-readable string like
 * `'challenge-3'` and still resolve to the same number everywhere.
 */
export function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) throw new RangeError('Numeric seed must be finite');
    // Fold the whole double into 32 bits so 2 ** 32 and 0 are not the same seed.
    const hi = Math.floor(seed / 0x1_0000_0000);
    return (Math.imul(seed >>> 0, 0x01000193) ^ (hi >>> 0)) >>> 0;
  }

  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Derive sfc32's four state words from one seed. */
export function seedToState(seed: number | string): RngState {
  const mix = splitmix32(hashSeed(seed));
  return [mix(), mix(), mix(), mix()];
}

/** Is this argument a saved state rather than a seed? */
function isRngState(value: number | string | RngState): value is RngState {
  return Array.isArray(value);
}

/** Create a generator from a seed, or resume one from a saved state. */
export function createRng(seed: number | string | RngState): Rng {
  let [a, b, c, d] = isRngState(seed) ? seed : seedToState(seed);

  // sfc32 needs a non-zero state; an all-zero state is a fixed point.
  if ((a | b | c | d) === 0) d = 1;

  function nextUint32(): number {
    // sfc32.
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t >>> 0;
  }

  const rng: Rng = {
    nextUint32,

    // 2 ** -32, so the result lands in [0, 1) with the full 32 bits of entropy.
    next: () => nextUint32() * 2.3283064365386963e-10,

    int(minInclusive, maxExclusive) {
      const lo = Math.ceil(minInclusive);
      const hi = Math.floor(maxExclusive);
      const span = hi - lo;
      if (!(span > 0)) {
        throw new RangeError(
          `Empty integer range [${String(minInclusive)}, ${String(maxExclusive)})`,
        );
      }
      // Rejection sampling keeps the distribution exactly uniform; modulo alone
      // would bias the low end whenever span does not divide 2 ** 32.
      const limit = 0x1_0000_0000 - (0x1_0000_0000 % span);
      let draw = nextUint32();
      while (draw >= limit) draw = nextUint32();
      return lo + (draw % span);
    },

    float: (min, max) => min + rng.next() * (max - min),

    chance(p) {
      if (p <= 0) return false;
      if (p >= 1) return true;
      return rng.next() < p;
    },

    pick(items) {
      if (items.length === 0) throw new RangeError('Cannot pick from an empty array');
      return items[rng.int(0, items.length)] as (typeof items)[number];
    },

    shuffled(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i + 1);
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },

    getState: () => [a, b, c, d] as RngState,

    setState(state) {
      [a, b, c, d] = state;
      if ((a | b | c | d) === 0) d = 1;
    },

    clone: () => createRng(rng.getState()),
  };

  return rng;
}
