/**
 * The playable core's rules, as one typed module — an **interim** one.
 *
 * Every number the playable core needs that is *policy* rather than mechanism
 * lives here: movement cadence and limits, the shot cap, hit windows, lives and
 * extra-life thresholds, the starfield speed. The simulation reads them; it
 * never hard-codes them, which is why the shapes here are plain data with no
 * behaviour attached.
 *
 * `src/content/` is now the real rules layer (docs/DESIGN.md section 6, layer 1):
 * `packs/classic/rules.json`, validated by `src/content/schema.ts`, read through
 * `src/content/rules.ts`. This module predates it by one PR and has not been
 * rewired to it yet — that is a separately filed follow-up. Until then, note
 * that `src/content/schema.ts` also exports a type called `Rules`, and it is the
 * canonical one; a module that ever needs both must alias. Nothing imports both
 * today, so the two coexist without a collision.
 *
 * Values marked **verified** come from `docs/reference/arcade-reference.md`,
 * which carries the ROM routine behind each one. Values marked **provisional**
 * are ours: the reference either does not cover them or lists them unresolved.
 * Keep that distinction in the comments — it is the difference between a number
 * that may not be changed and one that may.
 */

/**
 * A rectangular hit window, expressed as the offset from the *subject's* anchor
 * to the *target's* anchor. Windows are data, never constants inside
 * `collision.ts`, because the dual fighter needs two of them with a dead gap in
 * between and later packs need their own.
 */
export interface HitWindow {
  readonly dxMin: number;
  readonly dxMax: number;
  readonly dyMin: number;
  readonly dyMax: number;
}

/** A single fighter, or the dual fighter won back by a rescue (Milestone 2). */
export type FighterMode = 'single' | 'dual';

/**
 * ROM sprite-X byte at which a sprite's left edge is screen column 0.
 *
 * The reference gives the fighter's travel limits as raw ROM bytes: `$12`…`$E1`
 * for a single fighter, `$D1` for a dual one, whose second ship is drawn at
 * X + `$0F`. The ROM's sprite X is offset from the visible playfield, and the
 * reference does not trace that offset, so this is **provisional**: the constant
 * to change if it is ever traced.
 *
 * The geometry pins it to within a pixel. `$12`…`$E1` is 207 positions of
 * travel, which a 16-px fighter turns into 223 of the playfield's 224 columns —
 * so exactly one column goes unvisited whatever the origin is, and the only
 * choice left is which end it sits at. Taking the origin as `$12` puts the left
 * limit flush against column 0.
 */
export const SPRITE_X_ORIGIN = 0x12;

/** Convert a ROM sprite-X byte to a logical playfield column. */
export function fromRomX(romX: number): number {
  return romX - SPRITE_X_ORIGIN;
}

export interface PlayerRules {
  /**
   * Pixels moved on successive frames while the stick is held, cycled in order.
   * **Verified:** the ROM XORs a flag with 1 every call and steps 1 px when the
   * result is non-zero, 2 px when it is zero — so 1, 2, 1, 2 …, averaging
   * 1.5 px/frame (≈ 91 px/s). The flag is cleared whenever the stick is
   * neutral, so the first frame of any new movement is always a 1-px step.
   * Do not replace this with a float velocity: the cadence is the feel.
   */
  readonly stepPattern: readonly number[];
  /** Left travel limit, logical column of the sprite's left edge. **Verified** (`$12`). */
  readonly minX: number;
  /** Right travel limit for a single fighter. **Verified** (`$E1`). */
  readonly maxX: number;
  /** Right travel limit for a dual fighter. **Verified** (`$D1`). */
  readonly dualMaxX: number;
  /** Where the dual fighter's second ship is drawn. **Verified** (`$0F` = 15). */
  readonly secondShipOffsetX: number;
  /** Row the fighter sits on. **Provisional** — not in the reference. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * Window for an enemy bullet hitting one ship. **Verified** as Δx ∈ [−6, +6]
   * and Δy ∈ [−3, +3] *in the ROM's half-scaled Y units*, so the Y half is
   * doubled here into playfield pixels.
   */
  readonly hitWindow: HitWindow;
  /** Steps the fighter is off the field after a hit. **Provisional**. */
  readonly respawnSteps: number;
}

export interface ShotRules {
  /**
   * Player shots in flight, **in total**. **Verified** as 2, and it is 2 whether
   * the fighter is single or dual: the ROM has exactly two rocket slots and a
   * dual fighter's shot is one rocket object drawn double-width. Making this
   * "2 per ship" is the single most common way to get Milestone 1 wrong.
   */
  readonly cap: number;
  /**
   * Rows a shot climbs per step. **Provisional** — the reference gives no shot
   * speed, and it is worth knowing that this number *is* the fire rate: with no
   * edge detection and a hard cap of two, how fast shots leave the screen is the
   * only thing that decides how often you may fire again.
   */
  readonly speed: number;
  readonly width: number;
  readonly height: number;
  /** Where the muzzle sits relative to the fighter's anchor, for rendering. */
  readonly muzzleOffsetX: number;
  /**
   * Hit windows by fighter mode. **Verified:** a single fighter's shot tests one
   * window, Δx ∈ [−5, +5]; a dual fighter's tests two, Δx ∈ [−6, +4] and
   * Δx ∈ [+9, +19], with Δx ∈ [+5, +8] deliberately dead. The 15-unit gap
   * between window centres is the second ship's `$0F` offset.
   *
   * The Δy half is **provisional**; the reference does not give it.
   */
  readonly windows: Readonly<Record<FighterMode, readonly HitWindow[]>>;
}

export interface EnemyBulletRules {
  /** **Verified:** at most 8 enemy bullets exist at once, globally. */
  readonly cap: number;
  /** **Provisional** — the reference gives no bullet speed. */
  readonly speed: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One extra-life DIP setting: a first threshold, a second, and a repeat
 * interval, any of which may be absent. **Verified** — this triple covers every
 * row of both threshold tables, which is why the rules layer models it this way
 * rather than as a list of scores.
 */
export interface BonusThresholds {
  readonly first: number | null;
  readonly second: number | null;
  readonly repeat: number | null;
}

export interface LivesRules {
  /** **Verified:** switch-selectable 2, 3, 4 or 5; the factory default is 3. */
  readonly startingShips: number;
  /** Index into the eight DIP settings. **Verified:** the factory default is 1. */
  readonly bonusSetting: number;
  /**
   * Score past which no further extra life is awarded. **Medium confidence** in
   * the reference (secondary source, not confirmed in code).
   */
  readonly bonusCeiling: number;
}

export interface StageRules {
  /** First stage of a game. */
  readonly firstStage: number;
  /**
   * Scales the Milestone 1 stand-in formation's inter-shot delays; `0` silences
   * it. The stand-in has all 40 enemies sitting still and firing straight down,
   * which at their nominal rates is far deadlier than the real game, so the
   * default holds them well back. Milestone 2 deletes this along with the
   * stand-in and drives enemy fire from the per-stage difficulty table.
   */
  readonly standInFireRate: number;
}

/**
 * Playfield bounds, in the sim's own coordinates.
 *
 * They match `src/render/canvas.ts`'s logical size, but they are declared here
 * rather than imported from it: `src/sim/` may not reach into `src/render/`, and
 * a simulation that knows the size of a canvas is a simulation that has started
 * to care about being drawn. `tests/unit/rules.test.ts` asserts the two agree.
 */
export interface PlayfieldRules {
  readonly width: number;
  readonly height: number;
}

export interface Rules {
  readonly playfield: PlayfieldRules;
  readonly player: PlayerRules;
  readonly shots: ShotRules;
  readonly enemyBullets: EnemyBulletRules;
  readonly lives: LivesRules;
  readonly stages: StageRules;
}

/**
 * Extra-life thresholds by DIP setting, for cabinets started with 2, 3 or 4
 * fighters. **Verified** against the operator manual and MAME's dipswitch block.
 */
export const BONUS_TABLE_SHIPS_2_TO_4: readonly BonusThresholds[] = Object.freeze([
  { first: 20_000, second: 60_000, repeat: 60_000 },
  { first: 20_000, second: 70_000, repeat: 70_000 }, // factory default
  { first: 20_000, second: 80_000, repeat: 80_000 },
  { first: 20_000, second: 60_000, repeat: null },
  { first: 30_000, second: 80_000, repeat: null },
  { first: 30_000, second: 100_000, repeat: 100_000 },
  { first: 30_000, second: 120_000, repeat: 120_000 },
  { first: null, second: null, repeat: null },
]);

/**
 * The same eight settings for a cabinet started with 5 fighters. **Verified** —
 * and the reason there are two tables rather than one: the available thresholds
 * depend on the starting-ship count, so a single table keyed by setting alone
 * would award the wrong bonuses on a 5-ship cabinet.
 */
export const BONUS_TABLE_SHIPS_5: readonly BonusThresholds[] = Object.freeze([
  { first: 30_000, second: 100_000, repeat: 100_000 },
  { first: 30_000, second: 120_000, repeat: 120_000 }, // factory default
  { first: 30_000, second: 150_000, repeat: 150_000 },
  { first: 30_000, second: 150_000, repeat: null },
  { first: 30_000, second: null, repeat: null },
  { first: 30_000, second: 100_000, repeat: null },
  { first: 30_000, second: 120_000, repeat: null },
  { first: null, second: null, repeat: null },
]);

/** The DIP setting the cabinet shipped on. **Verified** for both tables. */
export const FACTORY_BONUS_SETTING = 1;

/** No further extra life past this score. */
export const BONUS_CEILING = 1_000_000;

/**
 * Starfield scroll speed byte for a stage.
 *
 * **Verified formula:** the ROM computes `$40 + ((min(stage, 16) × 4) AND $70)`
 * at the start of every stage, giving the five values `$40 $50 $60 $70 $80`,
 * one step every four stages, plateauing from stage 16. The byte is a *hardware
 * register shadow*, not a pixel rate — converting it to a visible scroll rate is
 * unresolved item 4 in the reference, and that conversion lives in
 * `src/render/starfield.ts` where it can be corrected without touching the sim.
 */
export function starfieldSpeedByte(stage: number): number {
  const clamped = Math.min(Math.max(Math.trunc(stage), 0), 16);
  return 0x40 + ((clamped * 4) & 0x70);
}

/** Lowest and highest bytes {@link starfieldSpeedByte} can produce. */
export const STARFIELD_SPEED_MIN = 0x40;
export const STARFIELD_SPEED_MAX = 0x80;

/**
 * The Classic rules: the arcade original as a data value.
 *
 * A pack may override any of it (docs/DESIGN.md section 6), which is the whole
 * point of it being data — but the values flagged **verified** above are what
 * "Classic" means, so a change to one of them is a change to the reference too.
 */
export const CLASSIC_RULES: Rules = Object.freeze({
  playfield: Object.freeze({ width: 224, height: 288 }),
  player: Object.freeze({
    stepPattern: Object.freeze([1, 2]),
    minX: fromRomX(0x12),
    maxX: fromRomX(0xe1),
    dualMaxX: fromRomX(0xd1),
    secondShipOffsetX: 0x0f,
    y: 248,
    width: 16,
    height: 16,
    hitWindow: Object.freeze({ dxMin: -6, dxMax: 6, dyMin: -6, dyMax: 6 }),
    respawnSteps: 90,
  }),
  shots: Object.freeze({
    cap: 2,
    speed: 6,
    width: 1,
    height: 4,
    muzzleOffsetX: 7,
    windows: Object.freeze({
      single: Object.freeze([{ dxMin: -5, dxMax: 5, dyMin: -6, dyMax: 6 }]),
      dual: Object.freeze([
        { dxMin: -6, dxMax: 4, dyMin: -6, dyMax: 6 },
        { dxMin: 9, dxMax: 19, dyMin: -6, dyMax: 6 },
      ]),
    }),
  }),
  enemyBullets: Object.freeze({
    cap: 8,
    speed: 2,
    width: 1,
    height: 3,
  }),
  lives: Object.freeze({
    startingShips: 3,
    bonusSetting: FACTORY_BONUS_SETTING,
    bonusCeiling: BONUS_CEILING,
  }),
  stages: Object.freeze({ firstStage: 1, standInFireRate: 0.1 }),
});

/** Right-hand travel limit for a fighter in this mode. */
export function maxXFor(rules: PlayerRules, mode: FighterMode): number {
  return mode === 'dual' ? rules.dualMaxX : rules.maxX;
}

/** The hit windows a shot fired by this fighter carries. */
export function shotWindowsFor(rules: ShotRules, mode: FighterMode): readonly HitWindow[] {
  return rules.windows[mode];
}
