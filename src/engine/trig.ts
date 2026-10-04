/**
 * Portable trigonometry: an integer angle, a fixed-point sine table and an
 * arctangent table (docs/DESIGN.md pillar 4).
 *
 * `Math.sin`, `Math.cos` and `Math.atan2` are _implementation-approximated_ in
 * ECMAScript — an engine may return any nearby double — and V8 does not return
 * the same one on arm64 as on x86-64: on one Node release, roughly one call in
 * two hundred lands a unit in the last place apart. Everything else the
 * simulation does with a number (`+ − × ÷`, `%`, `Math.sqrt`, `Math.floor`,
 * `Math.round`, `Math.abs`) the specification pins to the bit, with no extended
 * precision and no fused multiply-add. So those three functions were the whole
 * of the portability problem, and this module is the whole of the answer: the
 * simulation takes its trigonometry from here, and `eslint.config.js` bans the
 * engine-defined functions wherever a simulated number is made.
 *
 * ## The representation
 *
 * - **An angle is an integer, 2^22 to the degree** — 360 × 2^22 to the turn, which
 *   fits in 31 bits, so a unit is 4.2e-9 rad. Degrees are what a pack states and
 *   what a pose carries, so the unit is a binary fraction of a degree rather than
 *   of a turn: {@link degreesToAngle} converts any whole or binary-fraction degree
 *   (`30`, `22.5`, `0.375`) **exactly**, rounds anything else to the nearest unit,
 *   half away from zero so that a heading and its mirror image become exact
 *   negatives, and {@link angleToDegrees} is exact the other way.
 * - **Sine is a quarter-wave table of 5,761 Q30 integers, 64 to the degree**: entry
 *   `i` is `sin(i/64 °) × 2^30`, rounded. So every whole degree reads an entry with
 *   no interpolation at all — `sin 30°` is exactly `0.5`, and a bomb on a 30° vector
 *   at two pixels a frame moves exactly one pixel sideways. Between entries the
 *   table is read by quadrant symmetry and interpolated linearly **in integer
 *   arithmetic**, so every value handed out is an exact multiple of 2^-30. Cosine
 *   is the same table a quarter-turn on; the four axes come out exactly `0` and
 *   `±1`, and `sin(−θ)` is exactly `−sin θ`.
 * - **Arctangent is a table of 8,193 integer angles** over the ratios `0…1`. A
 *   vector is reduced to its first octant, the ratio of its smaller to its larger
 *   component is taken with one division, and the table is interpolated and
 *   rounded to a whole unit.
 *
 * ## What it costs in precision
 *
 * Measured against the engine's own functions by `tests/unit/trig.test.ts`, which
 * also holds these bounds: between whole degrees a sine or cosine is within
 * **1.1e-8** of the true value (1.02e-8 at worst, almost all of it the
 * straight-line chord between two entries), and an arctangent is within
 * **5.5e-9 rad**. A position moves by that times its lever — about 370 px for an
 * `aimAtPlayer` flown to the far edge — and the errors add along a path, because
 * each segment starts where the last one ended. Flown over every path the shipped
 * packs held when these tables replaced the engine's functions, the furthest any
 * position moved was **3.6e-6 px**, over a hundred thousand times finer than the
 * half pixel that is the smallest difference anyone could see.
 *
 * ## Why this resolution, and why the tables are built rather than shipped
 *
 * The arcade worked from tables too, but `docs/reference/arcade-reference.md` has
 * not decoded the flight-vector programs that would say at what resolution, so
 * the numbers here are **provisional** — ours, chosen to be invisible at every
 * angle and exact at the ones content is written in. A coarse, arcade-sized table
 * would move every curve by whole pixels, and nothing in the reference supports
 * any particular such move.
 *
 * The tables are built once, at load, from power series evaluated with `+ − × ÷`
 * and `Math.sqrt` alone — operations every engine computes identically — so they
 * are the same everywhere without a 5,761-number literal in the source. Like the
 * RNG stream they are part of the on-disk contract: every golden replay is
 * recorded through them. `tests/unit/trig.test.ts` locks their contents, so a
 * change to them has to be deliberate.
 */

/** Binary-angle units in one degree, 2^22. */
const UNITS_PER_DEGREE = 4_194_304;

/** Binary-angle units in one turn, 360 × 2^22. An angle from this module is an integer in `[0, TURN)`. */
export const TURN = 1_509_949_440;
const HALF_TURN = 754_974_720;
const QUARTER_TURN = 377_487_360;

/** Fixed-point one. A sine table entry is the sine scaled by 2^30 (Q30). */
const ONE = 1_073_741_824;

/** Intervals in the quarter-wave sine table, 64 to the degree; it has one more entry than this. */
const SINE_STEPS = 5760;

/** Binary-angle units per sine interval, `QUARTER_TURN / SINE_STEPS`: 2^16, a 64th of a degree. */
const SINE_SPAN = 65_536;
const SINE_SHIFT = 16;

/** Intervals in the arctangent table over the ratios `0…1`. */
const ARCTAN_STEPS = 8192;

/* -------------------------------------------------------------------------- */
/* Building the tables                                                          */
/* -------------------------------------------------------------------------- */

/**
 * `sin x` for `0 ≤ x ≤ π/4`, as a nested Taylor series: `x(1 − x²/6(1 − x²/20(…)))`.
 * Eleven terms leave a truncation error below 1e-27 at π/4.
 */
function sinSeries(x: number): number {
  const x2 = x * x;
  let r = 1;
  for (let n = 23; n >= 3; n -= 2) r = 1 - (x2 / (n * (n - 1))) * r;
  return x * r;
}

/** `cos x` for `0 ≤ x ≤ π/4`, the same way: `1 − x²/2(1 − x²/12(…))`. */
function cosSeries(x: number): number {
  const x2 = x * x;
  let r = 1;
  for (let n = 22; n >= 2; n -= 2) r = 1 - (x2 / (n * (n - 1))) * r;
  return r;
}

/**
 * `atan t` for `0 ≤ t ≤ 1`. Two half-angle steps, `atan t = 2 atan(t / (1 + √(1 + t²)))`,
 * bring the argument under `tan(π/16) ≈ 0.199`, where sixteen terms of the
 * alternating series leave a truncation error below 1e-24.
 */
function arctanSeries(t: number): number {
  let u = t;
  for (let halving = 0; halving < 2; halving += 1) u = u / (1 + Math.sqrt(1 + u * u));
  const u2 = u * u;
  let r = 0;
  for (let k = 15; k >= 0; k -= 1) r = 1 / (2 * k + 1) - u2 * r;
  return 4 * u * r;
}

function buildSineTable(): Int32Array {
  const table = new Int32Array(SINE_STEPS + 1);
  const step = Math.PI / (2 * SINE_STEPS);
  for (let i = 0; i <= SINE_STEPS; i += 1) {
    // Each series is used only on its own half of the quadrant, where it converges
    // fastest: sine below 45°, and above it the cosine of the complement.
    const value = 2 * i <= SINE_STEPS ? sinSeries(i * step) : cosSeries((SINE_STEPS - i) * step);
    table[i] = Math.round(value * ONE);
  }
  return table;
}

function buildArctanTable(): Int32Array {
  const table = new Int32Array(ARCTAN_STEPS + 1);
  for (let j = 0; j <= ARCTAN_STEPS; j += 1) {
    table[j] = Math.round((arctanSeries(j / ARCTAN_STEPS) * HALF_TURN) / Math.PI);
  }
  return table;
}

const SINE = buildSineTable();
const ARCTAN = buildArctanTable();

/* -------------------------------------------------------------------------- */
/* Reading them                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Wrap any whole number of units into `[0, TURN)`.
 *
 * Almost every angle is already in range, every one this module hands out
 * included. The rest are floor-divided rather than taken `%`, which V8 computes
 * out of line, and every step is exact for a whole number below 2^53: a quotient
 * of two whole numbers that is not itself whole lies at least `1 / TURN` from the
 * nearest one, far further than the division's rounding can move it, so the floor
 * is the true floor, and the multiply back and the subtraction are exact.
 */
function wrap(angle: number): number {
  // `+ 0` turns a −0 into 0, so a heading of −0° is the same angle as 0°.
  if (angle >= 0 && angle < TURN) return angle + 0;
  return angle - Math.floor(angle / TURN) * TURN;
}

/**
 * Q30 sine of an offset in `[0, QUARTER_TURN]`, the first quadrant.
 *
 * The offset is a whole number below 2^29, so the shift and the mask read its
 * bits exactly: the entry below it, and how far past that entry it lies. The
 * interpolation is integer arithmetic carried in doubles — the product is below
 * 2^35, far inside the 2^53 a double holds exactly, and scaling by 2^-16 is exact —
 * so the only rounding is the deliberate one to the nearest whole Q30 unit.
 */
function quarterSine(offset: number): number {
  const index = offset >>> SINE_SHIFT;
  const within = offset & (SINE_SPAN - 1);
  const low = SINE[index] ?? 0;
  if (within === 0) return low;
  const high = SINE[index + 1] ?? 0;
  return low + Math.floor(((high - low) * within + SINE_SPAN / 2) * (1 / SINE_SPAN));
}

/**
 * Q30 sine of a whole-number angle in `[0, TURN)`. A turn of whole degrees is not
 * a power of two, so the quadrant is found by comparison rather than read off the
 * top bits.
 */
function sineQ30(angle: number): number {
  const quadrant =
    angle < HALF_TURN ? (angle < QUARTER_TURN ? 0 : 1) : angle < HALF_TURN + QUARTER_TURN ? 2 : 3;
  const within = angle - quadrant * QUARTER_TURN;
  const magnitude = quarterSine((quadrant & 1) === 0 ? within : QUARTER_TURN - within);
  return quadrant < 2 ? magnitude : -magnitude;
}

/** The angle, in `[0, QUARTER_TURN / 2]`, whose tangent is `ratio` in `[0, 1]`. */
function arctan(ratio: number): number {
  const scaled = ratio * ARCTAN_STEPS;
  const index = Math.floor(scaled);
  const within = scaled - index;
  const low = ARCTAN[index] ?? Number.NaN;
  if (within === 0) return low;
  const high = ARCTAN[index + 1] ?? Number.NaN;
  return low + Math.round((high - low) * within);
}

/* -------------------------------------------------------------------------- */
/* The interface                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Degrees to a binary angle in `[0, TURN)`. Scaling by 2^22 is exact, so a whole
 * or binary-fraction degree converts with no rounding at all; anything finer is
 * rounded to the nearest unit.
 */
export function degreesToAngle(degrees: number): number {
  const units = degrees * UNITS_PER_DEGREE;
  return wrap(units < 0 ? -Math.round(-units) : Math.round(units));
}

/** A binary angle to degrees. Exact: the unit is 2^-22 of a degree. */
export function angleToDegrees(angle: number): number {
  return angle / UNITS_PER_DEGREE;
}

/**
 * Sine of a binary angle: an exact multiple of 2^-30 in `[−1, 1]`.
 *
 * The angle is a whole number of units, which is what {@link degreesToAngle} and
 * {@link atan2Angle} return; any whole number wraps. A non-finite one has no sine,
 * and gets `NaN` as `Math.sin` would give it, rather than the 0 its bits would read
 * as.
 */
export function sine(angle: number): number {
  const wrapped = wrap(angle);
  return Number.isNaN(wrapped) ? Number.NaN : sineQ30(wrapped) * (1 / ONE);
}

/** Cosine of a binary angle: the sine a quarter-turn on. */
export function cosine(angle: number): number {
  return sine(angle + QUARTER_TURN);
}

/**
 * The binary angle of the vector `(x, y)`, measured from +x towards +y — the
 * argument order and sense of `Math.atan2(y, x)`, in `[0, TURN)` rather than
 * `(−π, π]`. A zero vector has no direction and answers 0; callers that care keep
 * their previous heading instead, as every caller in `src/sim/` already does.
 */
export function atan2Angle(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === 0 && ay === 0) return 0;
  const octant = ay <= ax ? arctan(ay / ax) : QUARTER_TURN - arctan(ax / ay);
  const half = x < 0 ? HALF_TURN - octant : octant;
  return y < 0 ? wrap(TURN - half) : half;
}

/** Copies of the two tables, for the test that locks them. */
export function trigTables(): {
  readonly sine: readonly number[];
  readonly arctan: readonly number[];
} {
  return { sine: Array.from(SINE), arctan: Array.from(ARCTAN) };
}
