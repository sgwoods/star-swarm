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

/**
 * The `Math` functions ECMAScript leaves to the engine: each may return any nearby
 * double, and V8's land a unit in the last place apart between arm64 and x86-64.
 * `Math.sqrt`, `Math.floor`, `Math.round` and `Math.abs` are not here — those are
 * specified to the bit. The exponent operator is restricted below for the same
 * reason.
 */
const ENGINE_DEFINED_MATH = [
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atan2',
  'atanh',
  'cbrt',
  'cos',
  'cosh',
  'exp',
  'expm1',
  'hypot',
  'log',
  'log10',
  'log1p',
  'log2',
  'pow',
  'sin',
  'sinh',
  'tan',
  'tanh',
];

const PORTABLE =
  'is engine-defined and differs between CPU architectures, so a replay would not survive a ' +
  'change of machine. Trigonometry comes from src/engine/trig.ts (docs/ARCHITECTURE.md section 3).';

/**
 * Banned wherever a simulated number is made: `Math.random()`, because a seeded
 * Rng is the only randomness, and every engine-defined function, because the
 * simulation is bit-identical across machines and a golden compares it exactly.
 */
const DETERMINISTIC_MATH = {
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: 'Math.random() breaks determinism. Use a seeded Rng from src/engine/rng.ts instead.',
    },
    ...ENGINE_DEFINED_MATH.map((property) => ({
      object: 'Math',
      property,
      message: `Math.${property}() ${PORTABLE}`,
    })),
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "BinaryExpression[operator='**']", message: `The ** operator ${PORTABLE}` },
    { selector: "AssignmentExpression[operator='**=']", message: `The **= operator ${PORTABLE}` },
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

  // Determinism applies to the whole deterministic half of the codebase — the
  // content modules the sim calls during a step included — and to the autoplay
  // pilot, which is not in that half but must behave as if it were. A persona that
  // consulted `Math.random` or the wall clock would break "same seed, same persona,
  // same run", which is the one property the autoplay tests and the goldens both
  // rest on. It draws from a seeded Rng and its only clock is the simulation's own
  // step count.
  {
    files: ['src/sim/**/*.ts', 'src/engine/**/*.ts', 'src/content/**/*.ts', 'src/ui/autoplay.ts'],
    rules: DETERMINISTIC_MATH,
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
