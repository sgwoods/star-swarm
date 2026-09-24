import { defineConfig } from 'vitest/config';

/**
 * Two projects, both on the Node environment: there is no DOM in either, which
 * is what proves `src/sim/` stays headless (docs/DESIGN.md section 9).
 *
 * - `unit` — pure functions across the whole tree.
 * - `sim`  — headless simulation runs and golden replays.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'sim',
          environment: 'node',
          include: ['tests/sim/**/*.test.ts'],
        },
      },
    ],
  },
});
