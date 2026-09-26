/**
 * Content schemas — `docs/DESIGN.md` section 7 (content model) and section 6
 * (rules layer). Everything a pack can contain is described here, and nothing
 * loads without passing through one of these.
 *
 * **This file is the platform, not the game.** Star Swarm's Classic pack is the
 * first game in an arcade lineage, not the only one, so nothing specific to it
 * belongs in these types. Concretely: enemy *roles* are free-form ids declared by
 * the pack rather than a `bee | butterfly | boss` enum; per-role numbers in the
 * rules are records keyed by those ids; formations are data; scoring is a base
 * value plus a rule rather than a lookup table; and every ramp is a literal table
 * of rows with its own plateau. A differently shaped game in the same category is
 * another pack plus another `rules.json`, with no change here.
 *
 * Conventions used throughout:
 *
 * - Distances are logical pixels on the 224×288 playfield.
 * - Durations are **simulation frames** at the fixed 60 Hz step, never seconds
 *   or milliseconds — except sound envelopes, which are seconds because the
 *   synth is not on the fixed step.
 * - Speeds are pixels per simulation frame (the player moves 1.5 px/frame).
 * - Angles are degrees, clockwise positive, 0 pointing down the screen.
 * - Objects are strict: an unknown key is an error, because the commonest
 *   failure in generated content is a misspelt field that silently does nothing.
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Identifiers and the references to them. Kept permissive enough for both
 * styles the design plan uses (`left-hook`, `swirl8`, `classicLeftHook`) and
 * strict enough to be safe in a filename or a URL fragment.
 */
export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'must be alphanumeric, with - or _ inside');

/**
 * A reference to another document's `id`. Structurally identical to an id; the
 * distinction is what `loader.ts` resolves and what it does not.
 */
export const refSchema = idSchema;

/** A point on the playfield. */
export const vec2Schema = z.tuple([z.number(), z.number()]);

/** Pixels per simulation frame. */
const speedSchema = z.number().positive();

/** A count of simulation frames. */
const framesSchema = z.number().int().nonnegative();

/**
 * A table of rows plus the rule for what happens past the last one.
 *
 * Plateau behaviour is *data*, not a fallback the engine picks: the arcade
 * original neither freezes at its hardest row nor keeps climbing, it cycles the
 * final few rows forever — and its two ramps do it over different periods
 * (`docs/DESIGN.md` section 7.3). So each table states its own plateau, and
 * `resolveRow` below is the only interpretation of it.
 */
export function plateauTableSchema<T extends z.ZodType>(row: T) {
  return z.strictObject({
    rows: z.array(row),
    /**
     * How many of the final rows to cycle once the index runs past the end.
     * `1` holds the last row forever; `0` (or omitted) means the same thing.
     * Must not exceed `rows.length`.
     */
    repeatLast: z.number().int().nonnegative().default(1),
  });
}

export type PlateauTable<T> = { readonly rows: readonly T[]; readonly repeatLast: number };

/**
 * Resolve a zero-based index against a table, applying its plateau. Returns
 * `undefined` only for an empty table.
 */
export function resolveRow<T>(table: PlateauTable<T>, index: number): T | undefined {
  const length = table.rows.length;
  if (length === 0 || index < 0) return undefined;
  if (index < length) return table.rows[index];
  const period = Math.min(table.repeatLast, length);
  if (period <= 1) return table.rows[length - 1];
  return table.rows[length - period + ((index - length) % period)];
}

/**
 * How far a value may be trusted, and why.
 *
 * Arcade-derived packs mix numbers taken from a disassembly with numbers chosen
 * by whoever built the pack, and the difference decides whether a later
 * correction may change them. Carrying that as data rather than as a comment is
 * what lets it survive the move out of source and into a `rules.json`, and what
 * lets a test assert it is still there.
 */
export const CONFIDENCE_LEVELS = ['verified', 'provisional'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const provenanceEntrySchema = z.strictObject({
  confidence: z.enum(CONFIDENCE_LEVELS),
  /** Where a verified value came from, or why a provisional one was chosen. */
  note: z.string().min(1).optional(),
});

export type ProvenanceEntry = z.infer<typeof provenanceEntrySchema>;

/**
 * Field path inside the same document → how far that value may be trusted.
 * Paths are the dotted form `formatFieldPath` prints, e.g. `player.minX` or
 * `player.shot.windows.dual[1]`, and the loader rejects one that names nothing.
 */
export const provenanceSchema = z.record(z.string().min(1), provenanceEntrySchema).default({});

export type Provenance = z.infer<typeof provenanceSchema>;

/**
 * A rectangular hit window, as the offset from the *subject's* anchor to the
 * *target's* anchor.
 *
 * Windows are data rather than constants in the collision code because one
 * fighter mode can need two of them with a deliberate dead gap in between, which
 * no box intersection expresses.
 */
export const hitWindowSchema = z.strictObject({
  dxMin: z.number(),
  dxMax: z.number(),
  dyMin: z.number(),
  dyMax: z.number(),
});

export type HitWindow = z.infer<typeof hitWindowSchema>;

/** A single fighter, or the dual fighter a rescue wins back. */
export const FIGHTER_MODES = ['single', 'dual'] as const;
export type FighterMode = (typeof FIGHTER_MODES)[number];

/* -------------------------------------------------------------------------- */
/* 7.4 Sprite                                                                   */
/* -------------------------------------------------------------------------- */

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. Entry 0 is conventionally clear. */
export const colourSchema = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    'must be a #rgb/#rgba/#rrggbb/#rrggbbaa colour',
  );

/**
 * A pixel row: one character per pixel, each a palette index in hex, with `.`
 * as a readable synonym for index 0.
 */
const spriteRowSchema = z
  .string()
  .regex(/^[0-9a-fA-F.]*$/, 'rows use hex palette indices, or "." for index 0');

export const spriteSchema = z
  .strictObject({
    id: idSchema,
    /** Square side in pixels. The design plan's sprites are 16×16. */
    size: z.number().int().min(1).max(64),
    palette: z.array(colourSchema).min(1).max(16),
    /** One entry per animation frame; two for a wing flap, four for an explosion. */
    frames: z.array(z.array(spriteRowSchema)).min(1),
    /** Simulation frames each animation frame is held. Omitted means the caller decides. */
    frameDuration: z.number().int().positive().optional(),
  })
  .superRefine((sprite, ctx) => {
    const maxIndex = sprite.palette.length - 1;
    sprite.frames.forEach((rows, frame) => {
      if (rows.length !== sprite.size) {
        ctx.addIssue({
          code: 'custom',
          path: ['frames', frame],
          message: `expected ${String(sprite.size)} rows to match "size", found ${String(rows.length)}`,
        });
      }
      rows.forEach((row, y) => {
        if (row.length !== sprite.size) {
          ctx.addIssue({
            code: 'custom',
            path: ['frames', frame, y],
            message: `expected ${String(sprite.size)} characters to match "size", found ${String(row.length)}`,
          });
        }
        for (const char of row) {
          const index = char === '.' ? 0 : Number.parseInt(char, 16);
          if (index > maxIndex) {
            ctx.addIssue({
              code: 'custom',
              path: ['frames', frame, y],
              message: `palette index ${char} is out of range; "palette" has ${String(sprite.palette.length)} entries`,
            });
            break;
          }
        }
      });
    });
  });

export type Sprite = z.infer<typeof spriteSchema>;

/* -------------------------------------------------------------------------- */
/* 7.4 Sound                                                                    */
/* -------------------------------------------------------------------------- */

export const WAVEFORMS = ['square', 'triangle', 'sine', 'sawtooth', 'noise'] as const;
export const waveformSchema = z.enum(WAVEFORMS);

/** A steady pitch, or a sweep from the first value to the second, in hertz. */
const pitchSchema = z.union([
  z.number().positive(),
  z.tuple([z.number().positive(), z.number().positive()]),
]);

/** One note or burst. A single-step sound states these at the top level instead. */
const soundStepSchema = z.strictObject({
  freq: pitchSchema,
  /** Seconds. The synth is not on the fixed step, so sounds are in wall time. */
  duration: z.number().positive(),
  wave: waveformSchema.optional(),
  volume: z.number().min(0).max(1).optional(),
});

export const soundSchema = z
  .strictObject({
    id: idSchema,
    wave: waveformSchema,
    freq: pitchSchema.optional(),
    /** `[attack, hold, release]` in seconds. */
    envelope: z
      .tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative()])
      .optional(),
    vibrato: z
      .strictObject({ rate: z.number().positive(), depth: z.number().min(0).max(1) })
      .optional(),
    volume: z.number().min(0).max(1).optional(),
    /** Square-wave duty cycle, 0…1. Ignored by the other waveforms. */
    duty: z.number().min(0).max(1).optional(),
    /**
     * A jingle: successive steps rather than one tone. The design plan wants
     * short original tunes for start, capture, rescue and challenge results
     * (section 5) without a second content type for them.
     */
    sequence: z.array(soundStepSchema).min(1).optional(),
  })
  .refine((sound) => sound.freq !== undefined || sound.sequence !== undefined, {
    message: 'a sound needs either "freq" or a "sequence"',
    path: ['freq'],
  });

export type Sound = z.infer<typeof soundSchema>;

/* -------------------------------------------------------------------------- */
/* 7.2 Movement path                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The segment types `docs/DESIGN.md` section 7.2 fixes. `speed` is optional
 * wherever a segment can sensibly inherit the speed the previous segment left
 * behind — the plan's own example omits it on `loop` and `lissajous`.
 */
export const pathSegmentSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('line'), to: vec2Schema, speed: speedSchema.optional() }),
  z.strictObject({
    type: z.literal('bezier'),
    to: vec2Schema,
    c1: vec2Schema,
    c2: vec2Schema,
    speed: speedSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('arc'),
    radius: z.number().positive(),
    /** Degrees of turn. */
    degrees: z.number().positive(),
    dir: z.enum(['cw', 'ccw']),
    speed: speedSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('loop'),
    radius: z.number().positive(),
    turns: z.number().positive(),
    dir: z.enum(['cw', 'ccw']),
    speed: speedSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('lissajous'),
    ax: z.number(),
    ay: z.number(),
    fx: z.number(),
    fy: z.number(),
    duration: framesSchema,
    /** Degrees of phase offset between the two axes. */
    phase: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal('sine'),
    amplitude: z.number(),
    /** Pixels travelled per full transverse cycle. */
    wavelength: z.number().positive(),
    duration: framesSchema,
    speed: speedSchema.optional(),
  }),
  z.strictObject({ type: z.literal('wait'), frames: framesSchema }),
  z.strictObject({
    type: z.literal('aimAtPlayer'),
    speed: speedSchema,
    /** Frames to keep flying after the heading is taken. Omitted means until off screen. */
    duration: framesSchema.optional(),
  }),
  z.strictObject({ type: z.literal('toSlot'), speed: speedSchema.optional() }),
  z.strictObject({ type: z.literal('exitBottom'), speed: speedSchema.optional() }),
  z.strictObject({
    type: z.literal('fire'),
    count: z.number().int().positive().default(1),
    sound: refSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('trigger'),
    ability: idSchema,
    params: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export type PathSegment = z.infer<typeof pathSegmentSchema>;

export const pathSchema = z.strictObject({
  id: idSchema,
  /**
   * Whether a left/right mirrored variant of this path exists. A wave slot's
   * own `mirror` flag chooses between them (`docs/DESIGN.md` section 7.3).
   */
  mirror: z.boolean().default(false),
  /** Where the path begins. Entry paths start off screen; omitted means "wherever the flyer already is". */
  start: vec2Schema.optional(),
  segments: z.array(pathSegmentSchema).min(1),
});

export type MovementPath = z.infer<typeof pathSchema>;

/* -------------------------------------------------------------------------- */
/* 7.1 Alien                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The ability registry of `docs/DESIGN.md` section 7.5: engine behaviours a
 * pack switches on and tunes. Parameters are passed through unvalidated here —
 * each ability validates its own when the registry lands in Milestone 3.
 */
export const ABILITY_TYPES = [
  'captureBeam',
  'splitOnHit',
  'transform',
  'shield',
  'teleport',
  'spawnMinions',
  'mirrorPlayer',
] as const;

export const abilitySchema = z
  .looseObject({ type: z.enum(ABILITY_TYPES) })
  .describe('an entry in the engine ability registry, plus its parameters');

export const FIRE_PATTERNS = ['none', 'straight', 'aimed', 'spread'] as const;

export const alienSchema = z.strictObject({
  id: idSchema,
  /**
   * A role id the pack itself defines — the rules layer keys its per-role
   * numbers by the same ids, and the formation says which role fills each slot.
   * Deliberately not an enum: the classic roles are Classic's vocabulary, not
   * the platform's.
   */
  role: idSchema,
  hp: z.number().int().positive().default(1),
  sprite: refSchema,
  /**
   * What a damaged alien looks like, one entry per hit already taken:
   * `hitSprites[0]` replaces `sprite` once it has survived one hit. Fewer
   * entries than `hp − 1` is fine — the last one holds. The arcade boss turning
   * from green to blue on its first hit is exactly this field, and it is data
   * rather than a branch in the renderer because a two-hit enemy is one pack's
   * idea, not the platform's.
   */
  hitSprites: z.array(refSchema).default([]),
  /**
   * How much this alien widens the hit window tested against it, per side.
   *
   * Zero — the default — is the arcade's own behaviour: the original bakes enemy
   * size into the single window it tests and has no per-enemy hitbox
   * (`src/sim/collision.ts`). A pack that wants a fatter alien says so here.
   */
  hitPadding: z
    .strictObject({
      x: z.number().nonnegative().default(0),
      y: z.number().nonnegative().default(0),
    })
    .prefault({}),
  /**
   * Scoring is a *rule*, not a table: the base value, doubled when the target
   * is moving, plus any bonus (`docs/DESIGN.md` section 4). Storing 50/100 as
   * two independent numbers loses the rule and gets latched bonuses wrong.
   */
  score: z.strictObject({
    base: z.number().int().nonnegative(),
    /** Overrides the rules-layer multiplier for this alien alone. */
    movingMultiplier: z.number().positive().optional(),
  }),
  fire: z
    .strictObject({
      pattern: z.enum(FIRE_PATTERNS).default('straight'),
      shotsPerDive: z.number().int().nonnegative().default(0),
      /** Minimum simulation frames between this alien's own shots. */
      cooldownFrames: framesSchema.optional(),
      /**
       * For `spread`: one bullet per entry, offset from the aim by that many
       * degrees. The default is a single bullet along the aim, so `spread` with
       * nothing stated behaves as `aimed` rather than as nothing at all.
       */
      spreadOffsets: z.array(z.number()).default([0]),
    })
    .optional(),
  dive: z
    .strictObject({
      paths: z.array(refSchema).min(1),
      /** Relative likelihood of this alien being chosen to dive. */
      weight: z.number().nonnegative().default(1),
      /**
       * Whether a diver that leaves the bottom of the screen comes back.
       *
       * The arcade's bees and butterflies re-enter from the top and rejoin the
       * formation; its transformed trio leaves for good
       * (`docs/reference/arcade-reference.md` sections 5 and 6). Which of the two
       * an alien does is therefore the alien's business, not the engine's.
       */
      returns: z.boolean().default(true),
    })
    .optional(),
  abilities: z.array(abilitySchema).default([]),
  /** Event name → sound id. Open-keyed so a pack can name its own events. */
  sounds: z.record(z.string(), refSchema).default({}),
});

export type Alien = z.infer<typeof alienSchema>;

/* -------------------------------------------------------------------------- */
/* 7.3 Stage                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One alien in one entry wave.
 *
 * A wave is an **ordered list of slots, not a type plus a count**: the arcade
 * waves are mixed (wave 2 is four bosses and four butterflies) and each alien
 * carries its own mirror and trailing flags (`docs/DESIGN.md` section 7.3).
 * Field names settled here, since the plan states the constraint rather than
 * the spelling:
 *
 * - `alien` — required; there is no sensible default.
 * - `path` — optional, overriding the wave's `entryPath`. One of the two must
 *   be present, which the wave checks rather than the slot.
 * - `mirror` — defaults to `false`: fly the path as authored.
 * - `trailing` — defaults to `false`: launch alongside the previous slot rather
 *   than behind it. This is the ROM's per-pair delay bit.
 * - `home` — optional index into the formation's `slots`. Omitted means "the
 *   next free slot for this alien's role", which is what a hand-written pack
 *   wants; Classic states it, because its waves are identity-addressed.
 */
export const waveSlotSchema = z.strictObject({
  alien: refSchema,
  path: refSchema.optional(),
  mirror: z.boolean().default(false),
  trailing: z.boolean().default(false),
  home: z.number().int().nonnegative().optional(),
});

export type WaveSlot = z.infer<typeof waveSlotSchema>;

export const waveSchema = z
  .strictObject({
    /** Simulation frames after the stage starts. */
    at: framesSchema,
    /** Default path for every slot that does not name its own. */
    entryPath: refSchema.optional(),
    /** Frames between successive launches within the wave. */
    spacing: framesSchema.default(0),
    slots: z.array(waveSlotSchema).min(1),
  })
  .superRefine((wave, ctx) => {
    if (wave.entryPath !== undefined) return;
    wave.slots.forEach((slot, index) => {
      if (slot.path === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['slots', index, 'path'],
          message: 'no path: the slot must name one, or the wave must set "entryPath"',
        });
      }
    });
  });

export type Wave = z.infer<typeof waveSchema>;

export const STAGE_KINDS = ['normal', 'challenge', 'boss'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const stageSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(STAGE_KINDS).default('normal'),
  formation: refSchema,
  waves: z.array(waveSchema).default([]),
  diveRules: z
    .strictObject({
      maxConcurrent: z.number().int().nonnegative(),
      /** `[min, max]` frames between dive launches. */
      intervalFrames: z.tuple([framesSchema, framesSchema]),
    })
    .optional(),
  /** Free-form multipliers applied over the rules layer for this stage only. */
  modifiers: z.record(z.string(), z.number()).default({}),
});

export type Stage = z.infer<typeof stageSchema>;

/* -------------------------------------------------------------------------- */
/* Formation                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where aliens live once they have settled. Slots are logical `(row, column)`
 * pairs; the pixel mapping is an optional `grid`, because the arcade column
 * positions are confirmed (`docs/DESIGN.md` section 4) while their pixel
 * spacing is not yet.
 *
 * Formations live in `pack.json` rather than a sixth content directory:
 * section 9 fixes the five directories, and a formation is a table rather than
 * a document per instance — the same reason the palette lives there.
 */
export const formationSchema = z.strictObject({
  id: idSchema,
  grid: z
    .strictObject({
      originX: z.number(),
      originY: z.number(),
      columnSpacing: z.number().positive(),
      rowSpacing: z.number().positive(),
    })
    .optional(),
  slots: z
    .array(
      z.strictObject({
        row: z.number().int(),
        column: z.number().int(),
        /** Which role fills this slot; matched against an alien's `role`. */
        role: idSchema,
      }),
    )
    .default([]),
  /**
   * Slots that hold a captured player ship rather than an alien. The arcade has
   * one per boss, which is why capture is modelled per captor rather than as a
   * single global flag (`docs/DESIGN.md` section 4).
   */
  captiveSlots: z
    .array(
      z.strictObject({
        row: z.number().int(),
        column: z.number().int(),
        /** Index into `slots` of the alien that owns this captive slot. */
        captor: z.number().int().nonnegative(),
      }),
    )
    .default([]),
});

export type Formation = z.infer<typeof formationSchema>;

/** The pixel mapping a formation gets if it states none: index *is* the pixel. */
export const DEFAULT_FORMATION_GRID = Object.freeze({
  originX: 0,
  originY: 0,
  columnSpacing: 1,
  rowSpacing: 1,
});

/**
 * A formation's coordinate axes: the distinct column and row indices its slots
 * use, in screen order (left to right, top to bottom).
 *
 * This is the platform's model of a formation — *N* column coordinates and *M*
 * row coordinates, with every slot addressing them by index rather than owning a
 * position of its own. It is what makes animating a whole formation cost `N + M`
 * numbers instead of one per enemy, and it is why the arcade's sway and breathe
 * are cheap enough to run at all (`docs/reference/arcade-reference.md` section
 * 5). Captive slots count: the arcade's captured-fighter row is one of its six.
 *
 * The rules layer's breathe displacements are indexed by position in these two
 * arrays, which is the one thing that ties a `rules.json` to a formation. A
 * displacement table shorter than an axis simply leaves the remaining
 * coordinates still, so a pack carrying formations of different widths is not a
 * load error; `tests/unit/classic-pack.test.ts` is what holds the shipped pair
 * to each other.
 */
export function formationAxes(formation: Formation): {
  readonly columns: readonly number[];
  readonly rows: readonly number[];
} {
  const columns = new Set<number>();
  const rows = new Set<number>();
  for (const slot of formation.slots) {
    columns.add(slot.column);
    rows.add(slot.row);
  }
  for (const slot of formation.captiveSlots) {
    columns.add(slot.column);
    rows.add(slot.row);
  }
  const ascending = (a: number, b: number): number => a - b;
  return { columns: [...columns].sort(ascending), rows: [...rows].sort(ascending) };
}

/* -------------------------------------------------------------------------- */
/* Stage sequence                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What plays at each position, with its own plateau.
 *
 * Normal and challenge stages advance on **separate** sequences, because the
 * arcade original folds them at different points — the entry choreography
 * cycles its last three from stage 24 while the difficulty ramp cycles its last
 * four from stage 27 (`docs/DESIGN.md` section 7.3). One global "end of ramp"
 * rule cannot hold both.
 */
export const stageSequenceSchema = z.strictObject({
  normal: plateauTableSchema(refSchema).default({ rows: [], repeatLast: 1 }),
  challenge: plateauTableSchema(refSchema).default({ rows: [], repeatLast: 1 }),
});

export type StageSequence = z.infer<typeof stageSequenceSchema>;

/**
 * A rank's partial override of the pack's sequence. Partial on purpose: the
 * arcade original varies the combat sequence by rank but shares one challenge
 * cycle, and restating the shared half four times invites them to drift.
 */
export const stageSequenceOverrideSchema = z.strictObject({
  normal: plateauTableSchema(refSchema).optional(),
  challenge: plateauTableSchema(refSchema).optional(),
});

export type StageSequenceOverride = z.infer<typeof stageSequenceOverrideSchema>;

/* -------------------------------------------------------------------------- */
/* Pack manifest                                                                */
/* -------------------------------------------------------------------------- */

export const packManifestSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  version: z.string().min(1).default('0.0.0'),
  description: z.string().optional(),
  /** The pack-wide palette of `docs/DESIGN.md` section 5. */
  palette: z.array(colourSchema).default([]),
  /**
   * The enemy roles this pack uses, declared up front so that everything which
   * keys by role — aliens, formation slots, the rules layer's per-role numbers —
   * can be cross-checked even before a single alien exists. This is what keeps
   * roles out of the engine's own types: the pack supplies the vocabulary.
   */
  roles: z.record(idSchema, z.strictObject({ label: z.string().optional() })).default({}),
  /** Formation id → formation. The key must equal the formation's own `id`. */
  formations: z.record(idSchema, formationSchema).default({}),
  /**
   * Simulation event name → sound id: what the game sounds like, as data.
   *
   * `src/audio/sfx.ts` subscribes to simulation events and looks the event's
   * name up here, so a pack decides which effect plays for firing, for a kill or
   * for a stage start without a line of code naming any of them. Open-keyed for
   * the same reason `alien.sounds` is — the event vocabulary belongs to the
   * game, not to the platform.
   */
  sounds: z.record(z.string(), refSchema).default({}),
  /**
   * The badges that add up to the stage number, each with the sprite that draws
   * it (`docs/DESIGN.md` section 4: "denominations 1, 5, 10, 20, 30, 50").
   *
   * Data rather than a table in the HUD because the denominations are this
   * game's: a sibling in the lineage counts stages differently, or not at all,
   * and an empty list is a game with no badge row. Order does not matter — the
   * greedy decomposition sorts them, since it is only correct largest-first.
   */
  stageBadges: z
    .array(
      z.strictObject({
        value: z.number().int().positive(),
        sprite: refSchema,
      }),
    )
    .default([]),
  stageSequence: stageSequenceSchema.default({
    normal: { rows: [], repeatLast: 1 },
    challenge: { rows: [], repeatLast: 1 },
  }),
});

export type PackManifest = z.infer<typeof packManifestSchema>;

/* -------------------------------------------------------------------------- */
/* Section 6 — the rules layer                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One row of the per-stage difficulty table.
 *
 * The ramp is a **table, not a curve**. It is not monotonic — several arcade
 * stages are deliberately easier than the one before — so rows are stored
 * literally and never interpolated (`docs/DESIGN.md` section 7.3). The per-role
 * numbers are records keyed by role id, so a pack with different roles needs no
 * change here.
 */
export const difficultyRowSchema = z.strictObject({
  /** Selector for which bomb-drop enable flags are set this stage. */
  bombEnable: z.number().int().nonnegative().default(0),
  /** Role id → launch counter. Higher launches that role more often. */
  launchRates: z.record(idSchema, z.number().int().nonnegative()).default({}),
  maxDivers: z.number().int().nonnegative().default(0),
  /** The raised limit that replaces `maxDivers` once the stage has run a while. */
  maxDiversBump: z.number().int().nonnegative().default(0),
  /** How readily a captor attempts a capture. Not a probability; a rate parameter. */
  captureRate: z.number().int().nonnegative().default(0),
  /**
   * How many enemies may remain before bombing becomes continuous. A threshold
   * on the live count, not a timer — "the last few get nastier" is this number.
   */
  continuousBombingAt: z.number().int().nonnegative().default(0),
  /** Swap in the alternative attack-vector table for this stage. */
  reloadAttackVectors: z.boolean().default(false),
  /** Swap in the alternative bombing-vector table for this stage. */
  reloadBombVectors: z.boolean().default(false),
});

export type DifficultyRow = z.infer<typeof difficultyRowSchema>;

/**
 * A difficulty rank.
 *
 * Rank is a **selector over whole data sets, not a multiplier**
 * (`docs/DESIGN.md` section 6): it chooses the per-stage table *and* the stage
 * sequence, and the two plateau independently. Modelling it as a scalar over
 * one data set cannot reproduce that, so every rank carries its own tables.
 */
export const difficultyRankSchema = z.strictObject({
  label: z.string().optional(),
  /** Indexed by stage number − 1, including challenge stages. */
  stageTable: plateauTableSchema(difficultyRowSchema),
  /** Overrides the pack's own sequence for this rank, half at a time. */
  stageSequence: stageSequenceOverrideSchema.optional(),
});

export type DifficultyRank = z.infer<typeof difficultyRankSchema>;

export const extraLifeAwardSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none') }),
  z.strictObject({
    mode: z.literal('thresholds'),
    first: z.number().int().positive(),
    /** A second one-off threshold. Omitted means the first is the only one. */
    second: z.number().int().positive().optional(),
    /** Repeat interval after `second`. Omitted means no repeats. */
    repeat: z.number().int().positive().optional(),
  }),
]);

export type ExtraLifeAward = z.infer<typeof extraLifeAwardSchema>;

export const rulesSchema = z.strictObject({
  id: idSchema,
  name: z.string().optional(),

  /**
   * The logical playfield every distance in this file is measured on. Stated
   * here rather than taken from the display: the simulation has to know how big
   * the world is without knowing anything about a canvas.
   */
  playfield: z.strictObject({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),

  lives: z.strictObject({
    default: z.number().int().positive(),
    options: z.array(z.number().int().positive()).default([]),
  }),

  extraLives: z.strictObject({
    /** The award in force, for the default starting-life count. */
    award: extraLifeAwardSchema,
    /**
     * The award ceiling, as the two numbers that produce it rather than as the
     * score it works out to.
     *
     * The arcade original does not compare the score with a threshold. It reads
     * a fixed pair of score *digits* and compares `floor(score / unit) mod
     * modulus` with the pending threshold, which is carried in the same units
     * and advanced by the repeat interval each time one is paid. So a threshold
     * that reaches `modulus` can never match again, and the awards simply stop:
     * with 20,000 / 70,000 / every 70,000 the thresholds run 2, 7, 14 … 98 and
     * then 105, which no two digits can hold (`docs/reference/arcade-reference.md`
     * section 3). The last extra life is therefore at 980,000 — not a round
     * million, and not the same score for every setting, which is why the
     * ceiling is the mechanism and not a number.
     *
     * Both omitted means awards never stop.
     */
    thresholdUnit: z.number().int().positive().optional(),
    thresholdModulus: z.number().int().positive().optional(),
    /**
     * Which of `options` the cabinet is set to, as a zero-based index into the
     * options that apply to the starting-life count in play. Omitted means
     * `award` is used whatever that count is; present, it is what makes a
     * cabinet started on more lives award a *different* set of thresholds
     * rather than the same ones, which is the arcade behaviour and is silently
     * wrong if the setting is keyed on nothing.
     */
    setting: z.number().int().nonnegative().optional(),
    /**
     * The settings a cabinet could offer. Which are on offer depends on the
     * starting-ship count, so each option says which counts it applies to.
     */
    options: z
      .array(
        z.strictObject({
          startingLives: z.array(z.number().int().positive()).min(1),
          award: extraLifeAwardSchema,
        }),
      )
      .default([]),
  }),

  player: z.strictObject({
    /**
     * Pixels moved on successive frames while the stick is held, cycled in
     * order — the cadence, not an average.
     *
     * A one-element pattern is a constant speed, so a game with smooth movement
     * writes `[3]`. The arcade original alternates 1 and 2 px, averaging 1.5,
     * and that alternation is audible in the feel of the controls: replacing it
     * with its own average is a behaviour change, which is why the pattern
     * rather than the average is what a pack states.
     */
    stepPattern: z.array(z.number().positive()).min(1),
    /**
     * Total player shots in flight, **not** per ship: a dual fighter still gets
     * this many, each becoming a spread. Doubling it makes the dual fighter far
     * stronger than the original (`docs/DESIGN.md` section 4).
     */
    maxShots: z.number().int().positive(),
    /** Holding fire repeats. The arcade has no edge detection, so the cap sets the rate. */
    autoFire: z.boolean().default(true),

    /** The row the fighter sits on, and how big it is. */
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),

    /** Travel limits for the sprite's left edge. */
    minX: z.number(),
    maxX: z.number(),
    /** The right limit while the fighter is dual. Omitted means `maxX`. */
    dualMaxX: z.number().optional(),
    /** Where a dual fighter's second ship sits, relative to the anchor. */
    secondShipOffsetX: z.number().default(0),

    /** One enemy bullet against one ship. A dual fighter is tested twice. */
    hitWindow: hitWindowSchema,
    /** Frames the fighter is off the field after a hit. */
    respawnFrames: framesSchema,

    /** The shot the fighter fires. */
    shot: z.strictObject({
      speed: speedSchema,
      width: z.number().positive(),
      height: z.number().positive(),
      /** Where the muzzle is drawn, relative to the firing anchor. */
      muzzleOffsetX: z.number().default(0),
      /**
       * Hit windows by fighter mode. A mode may list more than one, and the
       * gap between two of them is deliberate rather than an oversight — see
       * `hitWindowSchema`.
       */
      windows: z.strictObject({
        single: z.array(hitWindowSchema).min(1),
        dual: z.array(hitWindowSchema).min(1),
      }),
    }),
  }),

  enemies: z.strictObject({
    /** Global cap across every enemy, not per enemy. */
    maxBullets: z.number().int().nonnegative(),
    /**
     * How many frames one full pass over the enemy population takes.
     *
     * The arcade original does **not** advance every enemy every frame: object
     * state runs on a four-frame round robin at 15 Hz, with the objects split
     * across the four frames (`docs/DESIGN.md` section 4). That cadence is what
     * paces launches and, later, dives — a game that steps every enemy every
     * frame launches things four times too eagerly and cannot be retro-fitted
     * without redoing the dive work. `1` means "every enemy, every frame", which
     * is what a game without the round robin says.
     *
     * Positions still advance every frame; it is the state machine that takes
     * turns. See `src/sim/enemies.ts`.
     */
    updatePhases: z.number().int().positive().default(1),
    /**
     * Role id → the bomb timer that role starts every stage with. Loaded
     * unconditionally at stage start, independent of the difficulty table.
     */
    bomberReadyTimers: z.record(idSchema, z.number().int().nonnegative()).default({}),
    /** Every enemy bullet, whoever fired it. */
    bullet: z.strictObject({
      speed: speedSchema,
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    /**
     * How the attack director turns a difficulty row into dives.
     *
     * The row says how *eagerly* each role attacks and how many may attack at
     * once (`difficultyRowSchema`); it does not say how often the launcher runs
     * or what one launch costs. Those live here, so the ramp stays a table of
     * literal rows with no multiplier hiding behind it — change a number here
     * and every stage changes together, which is exactly the distinction
     * between a rule and a difficulty curve.
     *
     * The launcher runs once per round robin (`updatePhases` frames) and grants
     * every role `baseLaunchRate` plus that role's own rate from the row, then
     * launches one diver per `launchCost` of accumulated credit.
     */
    dive: z
      .strictObject({
        /**
         * Credit every role is granted per launch tick, before its row rate.
         *
         * Must be positive for a row of all-zero rates to attack at all, which
         * the arcade's stage 1 requires: its three launch counters are 0 and it
         * certainly dives. A rate of zero is the floor of the ramp, not silence.
         */
        baseLaunchRate: z.number().nonnegative().default(1),
        /** Credit one launch costs. Higher means a longer gap at the same rate. */
        launchCost: z.number().positive().default(1),
        /**
         * Frames of diving after which a row's `maxDiversBump` replaces its
         * `maxDivers`. Zero means the bump is in force from the first dive.
         */
        bumpAfterFrames: framesSchema.default(0),
        /**
         * The path a diver flies to rejoin the formation, having left the bottom
         * of the screen and re-entered at the top. It is compiled from the
         * re-entry point, so it states no `start` and ends in `toSlot`. Omitted
         * means divers that leave the bottom are gone for good.
         */
        returnPath: refSchema.optional(),
        /** The y a diver re-enters at, above the top of the playfield. */
        reentryY: z.number().default(0),
      })
      .prefault({}),
    /**
     * When an enemy may drop a bomb at all, over and above its own delay.
     *
     * Both fields are thresholds on the game's state rather than rates: the
     * arcade original has no entry bombing on its first stage, and bombing turns
     * continuous once few enough enemies are left — the row's
     * `continuousBombingAt` is that count, and this is what continuous means.
     */
    bombing: z
      .strictObject({
        /**
         * First stage on which an enemy still flying its entry path may bomb.
         * Omitted means never: entering enemies hold their fire on every stage.
         */
        entryFromStage: z.number().int().positive().optional(),
        /**
         * The inter-shot delay that replaces an alien's own once the live enemy
         * count has fallen to the row's `continuousBombingAt`. Omitted leaves
         * each alien's own delay in force, so the threshold does nothing.
         */
        continuousCooldownFrames: framesSchema.optional(),
        /**
         * The headings a bomb may be launched along, in degrees.
         *
         * **A bomb travels along one of a fixed set of vectors, not along a
         * heading computed to the pixel.** The arcade original drives its bombs
         * from a bombing flight-vector table
         * (`docs/reference/arcade-reference.md` section 6, parameter 9), and the
         * difference is the whole feel of being shot at: an exactly-aimed bomb
         * fired from above is unavoidable, while a quantised one can be
         * side-stepped, which is why the original is dodgeable at all. An
         * `aimed` alien picks the vector nearest the fighter; a `straight` one
         * ignores the table and drops down the screen.
         *
         * One entry is a game whose bombs all travel the same way.
         */
        vectors: z.array(z.number()).min(1).default([0]),
        /**
         * The alternative table a row's `reloadBombVectors` swaps in — the
         * arcade's "reload bombing flight vector table pointer after stage 8".
         * Omitted means the row's flag changes nothing.
         */
        altVectors: z.array(z.number()).min(1).optional(),
      })
      .prefault({}),
  }),

  stages: z
    .strictObject({
      /** The stage number a new game starts on. */
      firstStage: z.number().int().positive().default(1),
    })
    .prefault({}),

  /**
   * How the settled formation moves.
   *
   * Both motions animate the formation's **coordinate axes** — the `N` column X
   * values and `M` row Y values of {@link formationAxes} — and never individual
   * enemies, which is the whole reason they are cheap and the reason a
   * differently shaped formation inherits them for free. Which axis is which is
   * the formation's business; how far and how fast they move is this pack's.
   */
  formation: z
    .strictObject({
      /**
       * Rigid side-to-side travel while the entry waves are still arriving: every
       * column coordinate moves together, the rows do not move at all, and the
       * direction reverses at ±`amplitude`, making a triangle wave.
       *
       * It ends when the last wave has arrived **and** the offset passes back
       * through zero, so whatever comes next starts from an exactly centred
       * formation. Omitted means a formation that does not sway.
       */
      sway: z
        .strictObject({
          amplitude: z.number().nonnegative(),
          /** Pixels moved per step. */
          stepPixels: z.number().positive(),
          /** Frames between steps. The arcade's 4 is its 15 Hz task rate. */
          stepFrames: z.number().int().positive(),
        })
        .optional(),
      /**
       * The accordion the formation breathes once it is full: an expansion and a
       * contraction, moving each coordinate by its own amount.
       *
       * `columns` and `rows` are **signed displacements at full expansion**, one
       * per entry of {@link formationAxes} in the same order, so a negative
       * column value moves that column left. Per-coordinate rather than a single
       * amplitude because the arcade's displacements differ per coordinate by a
       * uniform step, which is what keeps the expanded formation evenly spaced
       * rather than merely wider (`docs/reference/arcade-reference.md` section 5).
       */
      breathe: z
        .strictObject({
          /** Steps from rest to full expansion; the contraction takes as many. */
          steps: z.number().int().positive(),
          stepFrames: z.number().int().positive(),
          columns: z.array(z.number()).default([]),
          rows: z.array(z.number()).default([]),
        })
        .optional(),
      /**
       * The stage kinds on which either motion runs at all. The arcade runs
       * neither on a challenge stage, because nothing settles into formation
       * there, so Classic leaves `challenge` out.
       */
      animatedStageKinds: z
        .array(z.enum(STAGE_KINDS))
        .default([...STAGE_KINDS])
        .describe('stage kinds whose formation sways and breathes'),
    })
    .prefault({}),

  /**
   * The scrolling backdrop's speed, as the *formula* rather than a table.
   *
   * The byte it produces is a hardware register shadow, not a pixel rate: what
   * it looks like is the renderer's business, which is what keeps this a rules
   * value the simulation can emit without knowing anything is drawn. Omitted
   * means a game with no scrolling backdrop, and the byte is then always 0.
   */
  starfield: z
    .strictObject({
      speed: z.strictObject({
        /** `base + ((min(stage, plateauStage) * stageMultiplier) AND mask)`. */
        base: z.number().int().nonnegative(),
        stageMultiplier: z.number().int().nonnegative(),
        mask: z.number().int().nonnegative(),
        /** Stage past which the speed stops climbing. */
        plateauStage: z.number().int().nonnegative(),
      }),
    })
    .optional(),

  challengeStages: z.strictObject({
    enabled: z.boolean().default(true),
    /** The first challenge stage number. */
    firstStage: z.number().int().positive(),
    /** And then every this many stages. */
    everyStages: z.number().int().positive(),
  }),

  capture: z
    .strictObject({
      enabled: z.boolean().default(false),
      /** Captive slots a single captor may hold. */
      slotsPerCaptor: z.number().int().nonnegative().default(1),
      /**
       * A global cap across all captors, or `null` for "only `slotsPerCaptor`
       * limits it". The arcade original enforces exactly one held fighter, ever
       * (`docs/reference/arcade-reference.md` section 7), so the Classic pack sets
       * 1; a pack with several independent captors can leave it null.
       */
      maxHeldTotal: z.number().int().nonnegative().nullable().default(null),
      /** Being captured on the last fighter ends the game — a distinct loss condition. */
      lastFighterCaptureEndsGame: z.boolean().default(false),
      /** The player cannot fire while a beam has hold of the ship. */
      disablesFireWhileBeamed: z.boolean().default(false),
    })
    .prefault({}),

  rescue: z
    .strictObject({
      enabled: z.boolean().default(false),
      /** A captor killed in formation does not release; it must be attacking. */
      requiresCaptorAttacking: z.boolean().default(true),
      /** The freed ship cannot be shot by its own player while docking. */
      freedShipInvulnerableWhileDocking: z.boolean().default(true),
      /** Enemies already diving return to formation when a rescue happens. */
      divingEnemiesReturnToFormation: z.boolean().default(true),
    })
    .prefault({}),

  dualFighter: z
    .strictObject({
      enabled: z.boolean().default(false),
      /** Bullets per shot. Still one shot against `player.maxShots`. */
      bulletsPerShot: z.number().int().positive().default(2),
    })
    .prefault({}),

  scoring: z
    .strictObject({
      /** What a moving target's base value is multiplied by. */
      movingMultiplier: z.number().positive().default(2),
      /**
       * Escort bonus added to a captor's value, indexed by escort count. Latched
       * when it launches, so killing its escorts first does not reduce it — which
       * a flat score table gets wrong (`docs/DESIGN.md` section 4).
       */
      escortBonus: z
        .strictObject({
          latchedAtLaunch: z.boolean().default(true),
          byEscortCount: z.array(z.number().int().nonnegative()).default([]),
        })
        .prefault({}),
      /** Bonus for destroying a whole transform group, indexed by transform cycle. */
      transformGroupBonus: plateauTableSchema(z.number().int().nonnegative()).optional(),
      challenge: z
        .strictObject({
          /** Bonus per group of eight cleared, indexed by challenge-stage ordinal. */
          groupBonus: plateauTableSchema(z.number().int().nonnegative()),
          /** Awarded once at stage end, per enemy hit. */
          perHit: z.number().int().nonnegative().default(0),
          /** Awarded instead of `perHit` when every enemy was destroyed. */
          perfect: z.number().int().nonnegative().default(0),
          /** `true` means `perfect` *replaces* the per-hit bonus rather than adding to it. */
          perfectReplacesPerHit: z.boolean().default(true),
          /**
           * Points at the moment of impact, indexed by challenge-stage ordinal,
           * or `null` for none. Indexed rather than scalar because the arcade
           * original's value differs per challenge stage and cycles rather than
           * plateauing — 100, then 160 for seven, then back to 100 — on a period
           * of its own that the group bonus does not share
           * (`docs/reference/arcade-reference.md` section 8).
           */
          impactAward: plateauTableSchema(z.number().int().nonnegative()).nullable().default(null),
        })
        .optional(),
    })
    .prefault({}),

  /**
   * Mid-dive metamorphosis: one alien becomes a group of another type.
   * `types` names aliens in the pack and is cross-checked by the loader.
   */
  transform: z
    .strictObject({
      enabled: z.boolean().default(false),
      /** First stage it can happen on. */
      fromStage: z.number().int().positive().default(1),
      /**
       * It fires once **fewer than** this many enemies remain — a strict
       * comparison, which the ROM settles: `f_1A80` returns while the live count
       * is greater than or equal to the threshold
       * (`docs/reference/arcade-reference.md` section 6).
       */
      remainingThreshold: z.number().int().nonnegative().default(0),
      /** How many stages each entry in `types` holds for before the next. */
      stagesPerType: z.number().int().positive().default(1),
      /** Alien ids, cycled. */
      types: z.array(refSchema).default([]),
      /** How many appear together. */
      groupSize: z.number().int().positive().default(1),
      /**
       * Which roles may transform, in the order they are considered: the first
       * settled enemy of the first role that has one is taken. Ordered rather
       * than a set because the arcade prefers its bee role and falls back to its
       * butterfly role only when no bee is left. Empty means any role.
       */
      fromRoles: z.array(idSchema).default([]),
      /**
       * Frames the chosen enemy pulses in place before the group appears — the
       * tell that warns the player. Zero means it happens instantly.
       */
      tellFrames: framesSchema.default(0),
      /** How many times per stage it may happen. The arcade allows exactly one. */
      perStage: z.number().int().positive().default(1),
    })
    .optional(),

  difficulty: z.strictObject({
    defaultRank: idSchema,
    /** Rank id → its whole data set. */
    ranks: z.record(idSchema, difficultyRankSchema),
  }),

  /**
   * How far each value above may be trusted, keyed by its own field path.
   *
   * A pack derived from a real machine holds a mixture of numbers read out of a
   * disassembly and numbers someone chose, and only the second kind may be
   * retuned. The loader checks every path here names a field that exists, so
   * the marking cannot quietly outlive the value it describes.
   */
  provenance: provenanceSchema,
});

export type Rules = z.infer<typeof rulesSchema>;

/* -------------------------------------------------------------------------- */
/* The content kinds, and how to find their schema                              */
/* -------------------------------------------------------------------------- */

/** The five content directories of `docs/DESIGN.md` section 9. */
export const CONTENT_DIRS = ['aliens', 'paths', 'stages', 'sprites', 'sounds'] as const;
export type ContentDir = (typeof CONTENT_DIRS)[number];

/** One document per file, keyed by the directory it lives in. */
export const DOCUMENT_SCHEMAS = {
  aliens: alienSchema,
  paths: pathSchema,
  stages: stageSchema,
  sprites: spriteSchema,
  sounds: soundSchema,
} as const satisfies Record<ContentDir, z.ZodType>;

/** Singular names, for error messages that read like English. */
export const CONTENT_KIND_NAMES = {
  aliens: 'alien',
  paths: 'path',
  stages: 'stage',
  sprites: 'sprite',
  sounds: 'sound',
} as const satisfies Record<ContentDir, string>;
