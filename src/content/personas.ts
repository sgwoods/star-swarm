/**
 * An **autoplay persona** — how well the game is played, declared as data.
 *
 * A variant says which game a player may start and which rank its difficulty
 * presets choose; this says how well the cabinet plays that game by itself. The
 * two belong in the same document for the same reason: both are properties of the
 * *framing* of a run rather than things in the game world. An alien, a path or a
 * sprite is content and lives in a pack; a difficulty preset and a persona are
 * not, and live in `variants/<id>.json`.
 *
 * Four properties this module exists to keep:
 *
 * - **A persona describes a player, never the game.** There is deliberately
 *   nowhere in this shape to put a rules field, a difficulty row, a score
 *   multiplier or a stage number. Every field below is a bound on what the pilot
 *   in `src/ui/autoplay.ts` may *notice* or *do* with the same two controls a
 *   human has. A persona that could reach the rules layer would be a difficulty
 *   setting with a misleading name — the exact mistake
 *   {@link DifficultyPreset} exists to avoid from the other side.
 * - **The engine has no `if persona === …` in it.** Every field is read by name
 *   and interpreted the same way for every persona, so the four Classic ships are
 *   four rows of JSON and a fifth is a fifth row. Nothing under `src/` names a
 *   persona.
 * - **The units are the game's own**: pixels of the pack's playfield and
 *   *simulation steps*, never seconds and never a normalised 0…1 "skill". A
 *   fraction that means "how good" is a magic number wearing a label; 18 steps of
 *   reaction and 9 pixels of aim tolerance are claims a reader can check against
 *   the fighter's 1.5 px/frame cadence and the ±5 px shot window.
 * - **Validated the way a pack and a variant are**: the schema first, strictly,
 *   then the references — a duplicate id, or a `defaultPersona` naming nothing.
 *   A failure carries the document and the field.
 *
 * Every numeric field is **required**. A persona with defaults would be a persona
 * whose interesting numbers live in this file rather than in the document, which
 * is the same failure `src/sim/` avoids by holding no constants: a number the
 * pilot needs that a document cannot state is a number no variant can change.
 */

import { z } from 'zod';

import { idSchema } from './schema.js';

/**
 * One way of playing, and the whole of what the pilot reads.
 *
 * The eight fields are eight *axes*, each independently observable in a run:
 * given two personas differing in one field, a watcher can say which is which.
 * That is the bar for adding a ninth — a field nobody could see the effect of is
 * a knob, not an axis.
 */
export const personaSchema = z.strictObject({
  id: idSchema,
  /** What the settings row shows. Short: it sits in a 24-cell fixed-advance row. */
  label: z.string().min(1),
  /** A line under the row, for what this persona is like to watch. */
  description: z.string().optional(),

  /**
   * How stale the world it acts on is, in simulation steps.
   *
   * The pilot keeps the last `reactionSteps` views and decides from the *oldest*
   * one, so a persona with 18 here is steering by where the bombs were 0.3 s ago.
   * This is the axis that makes a beginner look like a person rather than a
   * broken bot: it arrives late to everything, including its own dodges.
   */
  reactionSteps: z.number().int().min(0).max(240),

  /**
   * How far off the target's column it will still pull the trigger, in pixels.
   *
   * The shot's own window is ±5 px wide (`player.shot.windows.single`), so a
   * tolerance under that is a pilot that only fires when the shot can actually
   * land, and a tolerance well over it is a pilot spraying rockets past things.
   * It costs a sloppy persona twice: the shot misses, *and* both of its two
   * rocket slots are busy when something arrives.
   */
  aimTolerance: z.number().min(0).max(224),

  /**
   * How far up the screen it notices something coming for it, in pixels.
   *
   * Measured as the gap between the threat and the fighter's own row, so the
   * playfield height is "sees everything the moment it launches" and 80 is "does
   * not react until it is nearly on top of you".
   */
  threatHorizon: z.number().min(0).max(512),

  /**
   * Clearance it tries to keep between itself and a threat's column, in pixels.
   *
   * Under the fighter's own 16 px width this is a pilot that dodges into the
   * bomb it was dodging; well over it is a pilot that leaves room.
   */
  dodgeMargin: z.number().min(0).max(112),

  /**
   * How reliably it keeps a rocket slot free for the thing about to kill it,
   * 0…1.
   *
   * **The cap that binds a player is two.** `player.maxShots` is 2 and there is
   * no edge detection, so a held button means both slots are permanently
   * occupied by rockets on their way off the top of the screen — and the diver in
   * your face gets nothing. (The eight-slot cap is the *enemies'*,
   * `enemies.maxBullets`.) At 1 the pilot always holds the second rocket back
   * while a threat is inside its horizon; at 0 it fires whenever it is lined up
   * on anything at all.
   */
  shotDiscipline: z.number().min(0).max(1),

  /**
   * Chance per decision of a wasted reversal, 0…1.
   *
   * Only ever applied while a threat is inside the horizon, which is what makes
   * it read as panic rather than as noise: the fighter dithers exactly when
   * standing still would have been fine, and gets itself cornered against a wall.
   * At 0 the pilot commits to the side it chose.
   */
  panic: z.number().min(0).max(1),

  /**
   * How often it answers an incoming diver by lining up under it and shooting
   * rather than sidestepping, 0…1.
   *
   * The most *visible* axis of the eight, and the one that separates a very good
   * pilot from a great one: at 1 the screen fills with enemies dying on the way
   * down, and a moving target is worth double (`resolveMovingMultiplier`). At 0
   * every diver is something to run away from.
   */
  engage: z.number().min(0).max(1),

  /**
   * Will it go after the dual fighter?
   *
   * A persona that says yes walks *into* a tractor beam on purpose and later
   * lines up under the captor while the pair is attacking, which is the manual's
   * rescue condition — two fighters if it works, one fewer if it does not. A
   * persona that says no treats a beam as one more thing to dodge.
   */
  rescue: z.boolean().default(false),
});

export type Persona = z.infer<typeof personaSchema>;

/**
 * The autoplay block of a variant document.
 *
 * Absent, or present with an empty list, means this game offers no autoplay and
 * the settings row is not shown — the same rule the `GAME` row follows on a
 * one-variant cabinet. There is no derived fallback, because there is nothing
 * honest to derive one *from*: a rank is a table the rules already declare, and
 * nobody has ever written down how well this game should be played.
 */
export const variantAutoplaySchema = z.strictObject({
  /** The personas offered, in menu order. */
  personas: z.array(personaSchema).default([]),
  /** Which one the `AUTOPLAY` row lands on first. Must name one above. */
  defaultPersona: idSchema.optional(),
});

/** What the front end needs to resolve a persona setting. Structural, like `PresetChoice`. */
export interface PersonaChoice {
  readonly personas: readonly Persona[];
}

/**
 * The persona with this id, or `undefined` for "autoplay is off".
 *
 * An id the variant does not offer reads as off rather than as the first persona:
 * a settings document outlives the build it was written against, and silently
 * watching the cabinet play itself as somebody else is worse than not watching.
 */
export function personaOf(variant: PersonaChoice, id: string | undefined): Persona | undefined {
  if (id === undefined) return undefined;
  return variant.personas.find((persona) => persona.id === id);
}

/** The persona a variant names as its own default, if it named one that exists. */
export function defaultPersonaOf(
  personas: readonly Persona[],
  declared: string | undefined,
): Persona | undefined {
  if (declared === undefined) return undefined;
  return personas.find((persona) => persona.id === declared);
}
