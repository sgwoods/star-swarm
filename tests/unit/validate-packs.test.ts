import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * `npm run validate-packs` is a CI gate (docs/DESIGN.md section 11), so it has to
 * actually reject things. These tests run the real script against throwaway pack
 * trees and check its exit code.
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

function writePack(packsRoot: string, name: string, files: Readonly<Record<string, string>>): void {
  for (const [relativePath, contents] of Object.entries(files)) {
    const full = join(packsRoot, name, relativePath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
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
});

describe('the real packs/ tree in this repo', () => {
  it('passes', () => {
    expect(validate(join(REPO_ROOT, 'packs')).code).toBe(0);
  });
});

describe('a well-formed pack', () => {
  it('passes and reports how many documents it checked', () => {
    const root = makePacksRoot();
    writePack(root, 'classic', {
      'pack.json': JSON.stringify({ id: 'classic', name: 'Classic' }),
      'aliens/drone.json': JSON.stringify({ id: 'drone', role: 'bee' }),
      'paths/left-hook.json': JSON.stringify({ id: 'left-hook', segments: [] }),
    });
    const result = validate(root);
    expect(result.code).toBe(0);
    expect(result.output).toContain('2 document(s) checked');
  });
});

describe('malformed packs are rejected', () => {
  it('fails on invalid JSON', () => {
    const root = makePacksRoot();
    writePack(root, 'broken', {
      'pack.json': JSON.stringify({ id: 'broken' }),
      'aliens/drone.json': '{ "id": "drone",, }',
    });
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('invalid JSON');
  });

  it('fails when content has no pack.json', () => {
    const root = makePacksRoot();
    writePack(root, 'orphan', { 'aliens/drone.json': JSON.stringify({ id: 'drone' }) });
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('no pack.json');
  });

  it('fails when pack.json has no id', () => {
    const root = makePacksRoot();
    writePack(root, 'nameless', {
      'pack.json': JSON.stringify({ name: 'Nameless' }),
      'aliens/drone.json': JSON.stringify({ id: 'drone' }),
    });
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('"id"');
  });

  it('fails when pack.json id disagrees with the directory name', () => {
    const root = makePacksRoot();
    writePack(root, 'classic', {
      'pack.json': JSON.stringify({ id: 'not-classic' }),
      'aliens/drone.json': JSON.stringify({ id: 'drone' }),
    });
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('but the directory is');
  });

  it('fails on a content document that is not an object', () => {
    const root = makePacksRoot();
    writePack(root, 'listy', {
      'pack.json': JSON.stringify({ id: 'listy' }),
      'aliens/drone.json': JSON.stringify([{ id: 'drone' }]),
    });
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('expected a JSON object');
  });

  it('fails on a content document with no id', () => {
    const root = makePacksRoot();
    writePack(root, 'anon', {
      'pack.json': JSON.stringify({ id: 'anon' }),
      'stages/one.json': JSON.stringify({ kind: 'normal' }),
    });
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('non-empty string "id"');
  });

  it('fails on an unexpected directory inside a pack', () => {
    const root = makePacksRoot();
    writePack(root, 'strays', {
      'pack.json': JSON.stringify({ id: 'strays' }),
      'aliens/drone.json': JSON.stringify({ id: 'drone' }),
      'music/theme.json': JSON.stringify({ id: 'theme' }),
    });
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('unexpected directory');
  });

  it('fails on a loose JSON file inside a pack', () => {
    const root = makePacksRoot();
    writePack(root, 'loose', {
      'pack.json': JSON.stringify({ id: 'loose' }),
      'drone.json': JSON.stringify({ id: 'drone' }),
    });
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('loose JSON file');
  });

  it('fails on a JSON file outside any pack directory', () => {
    const root = makePacksRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'stray.json'), JSON.stringify({ id: 'stray' }), 'utf8');
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('outside any pack directory');
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const root = makePacksRoot();
    writePack(root, 'many', {
      'pack.json': JSON.stringify({ id: 'many' }),
      'aliens/a.json': '{ broken',
      'aliens/b.json': JSON.stringify({ role: 'bee' }),
    });
    const result = validate(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain('2 problem(s)');
  });
});
