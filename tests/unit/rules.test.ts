import { describe, expect, it } from 'vitest';

import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../../src/render/canvas.js';
import {
  CLASSIC_RULES,
  fromRomX,
  maxXFor,
  shotWindowsFor,
  SPRITE_X_ORIGIN,
  STARFIELD_SPEED_MAX,
  STARFIELD_SPEED_MIN,
  starfieldSpeedByte,
} from '../../src/sim/rules.js';

describe('the playfield the sim believes in', () => {
  it('matches the display, without importing it', () => {
    // src/sim/ may not reach into src/render/, so the two declare the size
    // independently. This is the test that stops them drifting apart.
    expect(CLASSIC_RULES.playfield.width).toBe(LOGICAL_WIDTH);
    expect(CLASSIC_RULES.playfield.height).toBe(LOGICAL_HEIGHT);
  });
});

describe('ROM sprite-X conversion', () => {
  it("puts the fighter's left limit at column 0", () => {
    expect(SPRITE_X_ORIGIN).toBe(0x12);
    expect(fromRomX(0x12)).toBe(0);
  });

  it('keeps the verified travel span intact', () => {
    expect(fromRomX(0xe1) - fromRomX(0x12)).toBe(0xe1 - 0x12);
  });
});

describe('the starfield speed byte', () => {
  it('is the verified ROM formula', () => {
    for (let stage = 0; stage < 40; stage += 1) {
      const expected = 0x40 + ((Math.min(stage, 16) * 4) & 0x70);
      expect(starfieldSpeedByte(stage)).toBe(expected);
    }
  });

  it('steps every four stages through five values', () => {
    expect([1, 2, 3].map(starfieldSpeedByte)).toEqual([0x40, 0x40, 0x40]);
    expect(starfieldSpeedByte(4)).toBe(0x50);
    expect(starfieldSpeedByte(8)).toBe(0x60);
    expect(starfieldSpeedByte(12)).toBe(0x70);
    expect(starfieldSpeedByte(16)).toBe(0x80);
  });

  it('plateaus from stage 16 rather than climbing forever', () => {
    for (const stage of [16, 17, 40, 255]) {
      expect(starfieldSpeedByte(stage)).toBe(STARFIELD_SPEED_MAX);
    }
  });

  it('never leaves the five-value range', () => {
    for (let stage = 0; stage < 300; stage += 1) {
      const byte = starfieldSpeedByte(stage);
      expect(byte).toBeGreaterThanOrEqual(STARFIELD_SPEED_MIN);
      expect(byte).toBeLessThanOrEqual(STARFIELD_SPEED_MAX);
      expect((byte - STARFIELD_SPEED_MIN) % 0x10).toBe(0);
    }
  });
});

describe('mode-dependent rules', () => {
  it('picks the travel limit for the mode', () => {
    expect(maxXFor(CLASSIC_RULES.player, 'single')).toBe(CLASSIC_RULES.player.maxX);
    expect(maxXFor(CLASSIC_RULES.player, 'dual')).toBe(CLASSIC_RULES.player.dualMaxX);
  });

  it('picks the shot windows for the mode', () => {
    expect(shotWindowsFor(CLASSIC_RULES.shots, 'single')).toHaveLength(1);
    expect(shotWindowsFor(CLASSIC_RULES.shots, 'dual')).toHaveLength(2);
  });
});

describe('the Classic rules are the verified arcade values', () => {
  it('caps player shots at 2 and enemy bullets at 8', () => {
    expect(CLASSIC_RULES.shots.cap).toBe(2);
    expect(CLASSIC_RULES.enemyBullets.cap).toBe(8);
  });

  it('starts 3 fighters on the factory bonus setting', () => {
    expect(CLASSIC_RULES.lives.startingShips).toBe(3);
    expect(CLASSIC_RULES.lives.bonusSetting).toBe(1);
    expect(CLASSIC_RULES.lives.bonusCeiling).toBe(1_000_000);
  });

  it('steps 1 then 2 pixels', () => {
    expect(CLASSIC_RULES.player.stepPattern).toEqual([1, 2]);
  });

  it("draws the dual fighter's second ship 15 px right", () => {
    expect(CLASSIC_RULES.player.secondShipOffsetX).toBe(0x0f);
  });
});
