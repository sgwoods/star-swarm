/**
 * How a card is worked, and how it says so — one scheme for every screen that
 * waits on a keypress, so a player learns it once.
 *
 * Before this, the same key meant different things on neighbouring screens: fire
 * moved to the next row on the settings screen and chose a game on the selector,
 * Return closed the settings and committed the exit card, and there was no way
 * up a list at all. Each card's hint was true and the three of them disagreed.
 * The scheme is now this, everywhere:
 *
 * | Key           | On every card                                                  |
 * | ------------- | -------------------------------------------------------------- |
 * | `U/D`         | move between rows, wrapping                                    |
 * | `L/R`         | change the value of the row under the cursor                   |
 * | `ENTER`       | take what is highlighted                                       |
 * | `ESC`         | back: close the card, or step back a letter                    |
 *
 * **A card with only one line of choices answers every direction.** The selector
 * is one column, the exit card is one row of two words and initials entry spins
 * one letter, so on those up does what left does and down what right does. A
 * player never presses a direction and sees nothing happen.
 *
 * **Fire takes what is highlighted too**, on every card, exactly as `ENTER` does.
 * It is never *named*: it is Space in two control schemes and Z in the third
 * (`./settings.ts`), and `ENTER` is `start`, which every scheme keeps.
 *
 * **The exit key never takes anything.** It opens the exit card from a game and
 * cancels it on the card, so a double-tap can never be the press that throws a
 * run away (`./flow.ts`, `./pause.ts`). That is why it is not in {@link CardPress}
 * at all: a card that wants it reads it by name, and it cannot leak into
 * `accept` by being folded in here.
 *
 * Two halves, and both are values a Node test can read: {@link cardPress} is what
 * `./flow.ts` hands every card, and {@link keyLine} is the one way a card writes a
 * line of help, so the voice is a function rather than a convention.
 */

import { type InputFrame, wasPressed } from '../engine/input.js';
import type { ControlScheme } from './settings.js';

/**
 * The key names a card may print. Directions are named by axis rather than by
 * key, because arrows and WASD are both a control scheme and the hint has to be
 * true of either.
 */
export const KEY = Object.freeze({
  rows: 'U/D',
  values: 'L/R',
  ok: 'ENTER',
  back: 'ESC',
  pause: 'P',
  exit: 'X',
} as const);

/**
 * The fire key, named for the scheme in force.
 *
 * The one key a card's help never names, because it is Space in two schemes and Z
 * in the third — and the one the attract screen must, because that screen teaches
 * the game rather than a card. So it is named there and only there, and always
 * as the key the player's own scheme binds (`./settings.ts`).
 */
export function fireKeyFor(scheme: ControlScheme): FireKeyName {
  return scheme === 'wasd' ? 'Z' : 'SPACE';
}

export type FireKeyName = 'SPACE' | 'Z';

export type KeyName = (typeof KEY)[keyof typeof KEY] | FireKeyName;

/** What a pair in a help line is: a key, then what it does on this card. */
export type KeyHint = readonly [key: KeyName, verb: string];

/** Air between two pairs on one line. Wider than a word gap, so pairs read apart. */
export const KEY_PAIR_GAP = '   ';

/**
 * One line of help: `U/D MOVE   L/R CHANGE`.
 *
 * Each key, one space, what it does **here**; pairs {@link KEY_PAIR_GAP} apart.
 * The verb is the card's own, because a key named without saying what it does on
 * this card is a shipped bug of its own (`AGENTS.md`); what is shared is which key
 * does which *kind* of thing, and how that is written down.
 */
export function keyLine(...pairs: readonly KeyHint[]): string {
  return pairs.map(([key, verb]) => `${key} ${verb}`).join(KEY_PAIR_GAP);
}

/** The edges a card reacts to on one step. */
export interface CardPress {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
  /** Up or left: back along a card that has only one line of choices. */
  readonly backward: boolean;
  /** Down or right: forward along a card that has only one line of choices. */
  readonly forward: boolean;
  /** `ENTER`, or fire. */
  readonly accept: boolean;
  /** `ESC`. */
  readonly back: boolean;
}

/** Read one step's presses the way every card reads them. */
export function cardPress(previous: InputFrame, frame: InputFrame): CardPress {
  const up = wasPressed(previous, frame, 'up');
  const down = wasPressed(previous, frame, 'down');
  const left = wasPressed(previous, frame, 'left');
  const right = wasPressed(previous, frame, 'right');
  return {
    up,
    down,
    left,
    right,
    backward: up || left,
    forward: down || right,
    accept: wasPressed(previous, frame, 'start') || wasPressed(previous, frame, 'fire'),
    back: wasPressed(previous, frame, 'menu'),
  };
}
