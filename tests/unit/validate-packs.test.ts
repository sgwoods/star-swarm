import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { minimalRules } from '../helpers/rules.js';

/**
 * `npm run validate-packs` is a CI gate (`docs/DESIGN.md` section 11), so it has
 * to actually reject things. These tests run the real script against throwaway
 * pack trees and check its exit code and its report.
 *
 * The script delegates its schema and reference passes to `loadPack`, so what is
 * exercised here is the end-to-end gate — layout, parsing, schemas, references
 * and the per-file report — rather than the loader in isolation
 * (`content-loader.test.ts` covers that).
 */

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'validate-packs.ts');

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    rmSync(temporaryDirs.pop() as string, { recursive: true, force: true });
  }
});

function makePacksRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'star-swarm-packs-'));
  temporaryDirs.push(dir);
  return join(dir, 'packs');
}

interface RunResult {
  readonly code: number;
  readonly output: string;
}

function validate(packsRoot: string): RunResult {
  try {
    const output = execFileSync(process.execPath, ['--import', 'tsx', SCRIPT, packsRoot], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function writePack(
  packsRoot: string,
  name: string,
  files: Readonly<Record<string, unknown>>,
): void {
  for (const [relativePath, contents] of Object.entries(files)) {
    const full = join(packsRoot, name, relativePath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
  }
}

/** A pack with one of everything, which validates. Tests break one piece at a time. */
const GOOD = {
  'pack.json': {
    id: 'good',
    name: 'Good',
    roles: { drone: { label: 'Drone' } },
    formations: { grid: { id: 'grid', slots: [{ row: 0, column: 0, role: 'drone' }] } },
    stageSequence: { normal: { rows: ['stage-01'] } },
  },
  'sprites/drone.json': {
    id: 'drone',
    size: 2,
    palette: ['#0000', '#fff'],
    frames: [['.1', '1.']],
  },
  'sounds/pop.json': { id: 'pop', wave: 'noise', freq: 220 },
  'paths/left-hook.json': {
    id: 'left-hook',
    segments: [{ type: 'line', to: [112, 200], speed: 1.5 }],
  },
  'aliens/drone.json': {
    id: 'drone',
    role: 'drone',
    sprite: 'drone',
    score: { base: 50 },
    sounds: { death: 'pop' },
  },
  'stages/stage-01.json': {
    id: 'stage-01',
    formation: 'grid',
    waves: [{ at: 0, entryPath: 'left-hook', slots: [{ alien: 'drone' }] }],
  },
} as const;

/** `GOOD`, with the named files replaced. */
function goodExcept(overrides: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { ...GOOD, ...overrides };
}

function expectRejected(files: Readonly<Record<string, unknown>>, contains: string): RunResult {
  const root = makePacksRoot();
  writePack(root, 'good', files);
  const result = validate(root);
  expect(result.code).toBe(1);
  expect(result.output).toContain(contains);
  return result;
}

describe('empty and absent trees', () => {
  it('succeeds when packs/ does not exist', () => {
    const result = validate(join(makePacksRoot(), 'nope'));
    expect(result.code).toBe(0);
    expect(result.output).toContain('nothing to validate');
  });

  it('succeeds on an empty packs/', () => {
    const root = makePacksRoot();
    mkdirSync(root, { recursive: true });
    expect(validate(root).code).toBe(0);
  });

  it('succeeds on a pack skeleton of empty content directories', () => {
    const root = makePacksRoot();
    for (const dir of ['aliens', 'paths', 'stages', 'sprites', 'sounds']) {
      mkdirSync(join(root, 'classic', dir), { recursive: true });
      writeFileSync(join(root, 'classic', dir, '.gitkeep'), '', 'utf8');
    }
    const result = validate(root);
    expect(result.code).toBe(0);
    expect(result.output).toContain('empty skeleton');
  });

  it('succeeds on a manifest and rules with no content at all — the Classic skeleton', () => {
    const root = makePacksRoot();
    writePack(root, 'bare', {
      'pack.json': { id: 'bare', name: 'Bare' },
      'rules.json': minimalRules('bare'),
    });
    const result = validate(root);
    expect(result.code).toBe(0);
    expect(result.output).toContain('rules.json');
  });
});

describe('the real packs/ tree in this repo', () => {
  it('passes', () => {
    const result = validate(join(REPO_ROOT, 'packs'));
    expect(result.code).toBe(0);
    expect(result.output).toContain('classic: OK');
  });
});

describe('a well-formed pack', () => {
  it('passes and reports what it found', () => {
    const root = makePacksRoot();
    writePack(root, 'good', GOOD);
    const result = validate(root);
    expect(result.code).toBe(0);
    expect(result.output).toContain('1 alien(s)');
    expect(result.output).toContain('1 formation(s)');
  });
});

describe('layout problems are rejected', () => {
  it('fails on invalid JSON', () => {
    expectRejected(goodExcept({ 'aliens/drone.json': '{ "id": "drone",, }' }), 'invalid JSON');
  });

  it('fails when content has no pack.json', () => {
    const root = makePacksRoot();
    writePack(root, 'orphan', { 'sounds/pop.json': { id: 'pop', wave: 'noise', freq: 220 } });
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('no pack.json');
  });

  it('fails when pack.json id disagrees with the directory name', () => {
    expectRejected(
      goodExcept({ 'pack.json': { ...GOOD['pack.json'], id: 'elsewhere' } }),
      'but the pack directory is',
    );
  });

  it('fails on an unexpected directory inside a pack', () => {
    expectRejected(goodExcept({ 'music/theme.json': { id: 'theme' } }), 'unexpected directory');
  });

  it('fails on a loose JSON file inside a pack', () => {
    expectRejected(goodExcept({ 'drone.json': { id: 'drone' } }), 'loose JSON file');
  });

  it('fails on a JSON file outside any pack directory', () => {
    const root = makePacksRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'stray.json'), JSON.stringify({ id: 'stray' }), 'utf8');
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('outside any pack directory');
  });
});

describe('a malformed document of each content type is rejected', () => {
  it('alien: a score without a base', () => {
    const result = expectRejected(
      goodExcept({
        'aliens/drone.json': {
          id: 'drone',
          role: 'drone',
          sprite: 'drone',
          score: { formation: 50, diving: 100 },
        },
      }),
      'aliens/drone.json',
    );
    expect(result.output).toContain('score.base');
  });

  it('alien: a role the pack never declares', () => {
    expectRejected(
      goodExcept({ 'aliens/drone.json': { ...GOOD['aliens/drone.json'], role: 'drome' } }),
      'not declared in pack.json',
    );
  });

  it('path: an unknown segment type', () => {
    expectRejected(
      goodExcept({
        'paths/left-hook.json': { id: 'left-hook', segments: [{ type: 'warp', to: [0, 0] }] },
      }),
      'paths/left-hook.json',
    );
  });

  it('stage: a wave slot with no path and no wave-level entryPath', () => {
    const result = expectRejected(
      goodExcept({
        'stages/stage-01.json': {
          id: 'stage-01',
          formation: 'grid',
          waves: [{ at: 0, slots: [{ alien: 'drone' }] }],
        },
      }),
      'waves[0].slots[0].path',
    );
    expect(result.output).toContain('must set "entryPath"');
  });

  it('sprite: a row that does not match the declared size', () => {
    expectRejected(
      goodExcept({
        'sprites/drone.json': {
          id: 'drone',
          size: 2,
          palette: ['#0000', '#fff'],
          frames: [['.1', '1..']],
        },
      }),
      '2 characters',
    );
  });

  it('sound: neither a freq nor a sequence', () => {
    expectRejected(
      goodExcept({ 'sounds/pop.json': { id: 'pop', wave: 'noise' } }),
      'sounds/pop.json',
    );
  });

  it('manifest: a formation whose key and id disagree', () => {
    expectRejected(
      goodExcept({
        'pack.json': {
          ...GOOD['pack.json'],
          formations: { grid: { id: 'lattice', slots: [{ row: 0, column: 0, role: 'drone' }] } },
        },
      }),
      'formations.grid.id',
    );
  });

  it('rules: a default rank that is not declared', () => {
    expectRejected(
      goodExcept({
        'rules.json': {
          ...minimalRules('good'),
          difficulty: { defaultRank: 'Z', ranks: { A: { stageTable: { rows: [] } } } },
        },
      }),
      'difficulty.defaultRank',
    );
  });

  it('any type: an unknown field, rather than dropping it silently', () => {
    expectRejected(
      goodExcept({ 'sounds/pop.json': { id: 'pop', wave: 'noise', freq: 220, vol: 1 } }),
      'sounds/pop.json',
    );
  });
});

describe('cross-references are checked after the schemas pass', () => {
  it('fails on an alien pointing at a sprite that is not there', () => {
    const result = expectRejected(
      goodExcept({ 'aliens/drone.json': { ...GOOD['aliens/drone.json'], sprite: 'ghost' } }),
      'no sprite with id "ghost"',
    );
    expect(result.output).toContain('good/aliens/drone.json');
    expect(result.output).toContain('sprite:');
  });

  it('fails on a stage sequence naming a stage that is not there', () => {
    expectRejected(
      goodExcept({
        'pack.json': { ...GOOD['pack.json'], stageSequence: { normal: { rows: ['stage-99'] } } },
      }),
      'stageSequence.normal.rows[0]',
    );
  });
});

describe('the report', () => {
  it('lists every problem at once rather than stopping at the first', () => {
    const root = makePacksRoot();
    writePack(
      root,
      'good',
      goodExcept({
        'aliens/drone.json': {
          ...GOOD['aliens/drone.json'],
          sprite: 'ghost',
          sounds: { death: 'silence' },
        },
      }),
    );
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('2 problem(s)');
  });

  it('groups problems under the file they came from', () => {
    const result = expectRejected(
      goodExcept({ 'aliens/drone.json': { ...GOOD['aliens/drone.json'], sprite: 'ghost' } }),
      'good/aliens/drone.json:',
    );
    expect(result.output).toContain('1 problem(s)');
  });
});
