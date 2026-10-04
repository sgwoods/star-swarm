import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { ESLint } from 'eslint';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The key rule from docs/DESIGN.md section 9:
 *
 *   `sim/` never touches the DOM, Canvas or Audio. Sim emits events; render and
 *   audio subscribe. That's what makes headless tests and replays possible.
 *
 * Convention is not enforcement, so this file checks it two ways:
 *
 *  1. A static scan of the real `src/sim/` tree — cheap, and it runs even on
 *     files that disabled lint for the line.
 *  2. A live ESLint run against a deliberately illegal probe file, which proves
 *     the lint rules in `eslint.config.js` are actually wired up and would fail
 *     the build. Without this, the rules could be deleted and nothing would
 *     notice.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const SIM_DIR = join(REPO_ROOT, 'src', 'sim');

/** Import specifiers a sim module must never reach for. */
const FORBIDDEN_LAYERS = ['render', 'audio', 'ui'] as const;

/** Host globals that only exist with a browser attached. */
const FORBIDDEN_GLOBALS = [
  'document',
  'window',
  'localStorage',
  'sessionStorage',
  'requestAnimationFrame',
  'AudioContext',
  'OfflineAudioContext',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'OffscreenCanvas',
  'createImageBitmap',
] as const;

/**
 * `Math` functions whose results ECMAScript leaves to the engine, and which differ
 * between arm64 and x86-64. The same list `eslint.config.js` bans; the sim takes
 * its trigonometry from `src/engine/trig.ts`.
 */
const ENGINE_DEFINED_MATH =
  /(?<![\w$.])Math\s*\.\s*(?:a?sinh?|a?cosh?|a?tanh?|atan2|cbrt|exp|expm1|hypot|log(?:10|1p|2)?|pow)\b/;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/**
 * Blank out comments, keeping line numbers intact. Applied before every check:
 * prose about the formation "breathing" past the window is not a violation.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * Also blank out string contents. Used for the host-global and Math.random
 * checks, so `const label = 'window of opportunity'` is not flagged — but *not*
 * for the import check, which is looking at module specifiers, i.e. at strings.
 */
function stripStrings(source: string): string {
  return source
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function tsFilesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries.sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...tsFilesUnder(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** Scan one module's source for boundary violations. */
export function scanSimSource(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const withStrings = stripComments(source).split('\n');
  const withoutStrings = stripStrings(stripComments(source)).split('\n');

  withStrings.forEach((line, index) => {
    const lineNumber = index + 1;
    const code = withoutStrings[index] ?? '';

    for (const layer of FORBIDDEN_LAYERS) {
      // `from '../render/x'`, `import('../audio/y')`, `require('../ui')`.
      const pattern = new RegExp(
        String.raw`(?:from|import|require)\s*\(?\s*['"\`][^'"\`]*\b${layer}\b`,
      );
      if (pattern.test(line)) {
        violations.push({
          file,
          line: lineNumber,
          message: `imports from src/${layer}/ — emit an event instead`,
        });
      }
    }

    for (const global of FORBIDDEN_GLOBALS) {
      if (new RegExp(String.raw`(?<![\w$.])${global}(?![\w$])`).test(code)) {
        violations.push({
          file,
          line: lineNumber,
          message: `references the host global '${global}' — src/sim/ must stay headless`,
        });
      }
    }

    if (/(?<![\w$.])Math\s*\.\s*random\b/.test(code)) {
      violations.push({
        file,
        line: lineNumber,
        message: 'uses Math.random() — seed an Rng from src/engine/rng.ts instead',
      });
    }

    if (ENGINE_DEFINED_MATH.test(code) || code.includes('**')) {
      violations.push({
        file,
        line: lineNumber,
        message: 'uses engine-defined maths — take trigonometry from src/engine/trig.ts',
      });
    }
  });

  return violations;
}

describe('static scan of src/sim/', () => {
  const files = tsFilesUnder(SIM_DIR);

  it('finds the sim directory', () => {
    expect(statSync(SIM_DIR).isDirectory()).toBe(true);
  });

  it('has no boundary violations', () => {
    const violations = files.flatMap((file) =>
      scanSimSource(relative(REPO_ROOT, file), readFileSync(file, 'utf8')),
    );
    expect(
      violations.map(({ file, line, message }) => `${file}:${String(line)} ${message}`),
    ).toEqual([]);
  });
});

describe('the scanner itself', () => {
  // Milestone 0 ships no sim modules, so without these the scan above would pass
  // vacuously and keep passing even if it were broken.
  it.each([
    ["import { drawSprite } from '../render/sprites.js';", 'imports from src/render/'],
    ["import { playSfx } from '../audio/sfx.js';", 'imports from src/audio/'],
    ["const el = document.getElementById('x');", "host global 'document'"],
    ['const w = window.innerWidth;', "host global 'window'"],
    ['const ctx = new AudioContext();', "host global 'AudioContext'"],
    ['const r = Math.random();', 'Math.random()'],
    ['const [dx, dy] = [-Math.sin(r), Math.cos(r)];', 'engine-defined maths'],
    ['const heading = Math.atan2(-dx, dy);', 'engine-defined maths'],
    ['const grid = 10 ** 6;', 'engine-defined maths'],
  ])('catches %j', (source, expected) => {
    const violations = scanSimSource('src/sim/probe.ts', source);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.message.includes(expected))).toBe(true);
  });

  it.each([
    "import { createRng } from '../engine/rng.js';",
    'const events: SimEvent[] = [];',
    'const paths = registry.paths;',
    '// document how the formation breathes',
    "const label = 'window of opportunity';",
    'const length = Math.sqrt(dx * dx + dy * dy);',
    'const [dx, dy] = [-sine(angle), cosine(angle)]; // not Math.sin: it differs by machine',
  ])('does not flag legitimate sim code: %j', (source) => {
    expect(scanSimSource('src/sim/probe.ts', source)).toEqual([]);
  });
});

/**
 * Live ESLint check. The probe file has to exist on disk so the type-aware
 * config can resolve it; it is removed again in `afterAll`.
 */
const PROBE = join(SIM_DIR, '__boundary_probe__.ts');

afterAll(() => {
  rmSync(PROBE, { force: true });
});

describe('eslint enforces the boundary', () => {
  it('reports restricted imports, globals, Math.random and engine-defined maths in src/sim/', async () => {
    writeFileSync(
      PROBE,
      [
        "import { LOGICAL_WIDTH } from '../render/canvas.js';",
        '',
        'export function probe(): number {',
        '  const width = document.body.clientWidth;',
        '  const turn = Math.sin(width) + 2 ** 3;',
        '  return LOGICAL_WIDTH + width + Math.random() + window.innerHeight + turn;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const eslint = new ESLint({ cwd: REPO_ROOT });
    const [result] = await eslint.lintFiles([PROBE]);
    expect(result).toBeDefined();

    const messages = result?.messages ?? [];
    const ruleIds = new Set(messages.map((m) => m.ruleId));
    expect(ruleIds).toContain('no-restricted-imports');
    expect(ruleIds).toContain('no-restricted-globals');
    expect(ruleIds).toContain('no-restricted-properties');
    expect(ruleIds).toContain('no-restricted-syntax');
    // Named rather than counted: Math.random alone would satisfy the rule id, and
    // the engine-defined functions are the half that keeps the goldens exact.
    expect(messages.some((m) => m.message.includes('Math.sin() is engine-defined'))).toBe(true);
    expect(messages.some((m) => m.message.includes('The ** operator is engine-defined'))).toBe(
      true,
    );
    expect(result?.errorCount ?? 0).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it('leaves the same code alone outside src/sim/', async () => {
    // src/render/canvas.ts legitimately uses document and window; if the rules
    // were applied globally the whole render layer would fail to lint.
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const [result] = await eslint.lintFiles([join(REPO_ROOT, 'src', 'render', 'canvas.ts')]);
    const ruleIds = new Set((result?.messages ?? []).map((m) => m.ruleId));
    expect(ruleIds).not.toContain('no-restricted-globals');
  }, 120_000);
});
