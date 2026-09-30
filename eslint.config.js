import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Globals that only exist because there is a browser attached: DOM, Canvas and
 * Web Audio. `src/sim/` must run without any of them (docs/DESIGN.md section 9),
 * and `Date`/`performance` are in the list because a simulation that reads the
 * wall clock is no longer deterministic (pillar 4) — time arrives as a fixed
 * step from `src/engine/loop.ts`.
 */
const HOST_GLOBALS = [
  'document',
  'window',
  'self',
  'globalThis',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'fetch',
  'Image',
  'Audio',
  'AudioContext',
  'webkitAudioContext',
  'OfflineAudioContext',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'OffscreenCanvas',
  'ImageData',
  'ImageBitmap',
  'createImageBitmap',
  'Date',
  'performance',
];

/** Why the autoplay pilot may not read a clock. See the rule block below. */
const DETERMINISM =
  'The autoplay pilot must stay reproducible: its only clock is the simulation step ' +
  'count on the view it is handed (docs/ARCHITECTURE.md section 7).';

/** `Math.random()` is banned in sim and engine alike: seed an Rng instead. */
const NO_MATH_RANDOM = {
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: 'Math.random() breaks determinism. Use a seeded Rng from src/engine/rng.ts instead.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'node_modules/',
      // Git-excluded scratch space: probes, one-off harnesses and video frames.
      // See `.prettierignore` for the same entry and the same reason.
      '.scratch/',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // eslint.config.js itself is plain JS and outside the TS program.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Determinism applies to the whole deterministic half of the codebase — and to
  // the autoplay pilot, which is not in that half but must behave as if it were.
  // A persona that consulted `Math.random` or the wall clock would break "same
  // seed, same persona, same run", which is the one property the autoplay tests
  // and the goldens both rest on. It draws from a seeded Rng and its only clock is
  // the simulation's own step count.
  {
    files: ['src/sim/**/*.ts', 'src/engine/**/*.ts', 'src/ui/autoplay.ts'],
    rules: NO_MATH_RANDOM,
  },

  {
    files: ['src/ui/autoplay.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: DETERMINISM },
        { name: 'performance', message: DETERMINISM },
      ],
    },
  },

  /**
   * The key rule, enforced rather than trusted: `src/sim/` never touches the
   * DOM, Canvas or Audio, and never imports from the layers that do. The sim
   * emits events; render and audio subscribe.
   *
   * `tests/unit/sim-boundary.test.ts` is the backstop for anything lint cannot
   * see (dynamic access, new files added with lint disabled).
   */
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...HOST_GLOBALS.map((name) => ({
          name,
          message: `src/sim/ must stay headless: '${name}' is not available there. Emit an event and let src/render/ or src/audio/ react.`,
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/render/**', '**/render', '**/audio/**', '**/audio', '**/ui/**', '**/ui'],
              message:
                'src/sim/ must not import render, audio or ui. Emit an event instead (docs/DESIGN.md section 9).',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts', '*.config.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  prettier,
);
