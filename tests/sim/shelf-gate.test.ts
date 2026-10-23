/**
 * The shelf's half of `npm run validate-packs`, run end to end by the real script
 * over a tree made for the purpose: the Convoy pack and game as the reference, and
 * a shelf of three variations of it — one that plays, one that loads and cannot
 * be played, and one that names a pack this build does not have.
 *
 * This is the gate a submission meets on its own pull request (`CONTRIBUTING.md`,
 * `shelf/README.md`), so both halves matter: an entry that works is flown and
 * passed, and one that does not is refused for the right reason, named by its
 * file, before anybody reads it. Convoy is the reference because it plays one
 * stage, so flying its variations costs seconds rather than minutes.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'validate-packs.ts');
const TIMEOUT = 180_000;

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

/** The report lines filed under one document, as `formatContentErrors` groups them. */
function linesUnder(output: string, file: string): string[] {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => line.trim() === `${file}:`);
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('    ')) break;
    out.push(line.trim());
  }
  return out;
}

const convoy = JSON.parse(readFileSync(join(REPO_ROOT, 'variants', 'convoy.json'), 'utf8')) as {
  readonly autoplay: { readonly personas: ReadonlyArray<Record<string, unknown>> };
} & Record<string, unknown>;
const classic = JSON.parse(readFileSync(join(REPO_ROOT, 'variants', 'classic.json'), 'utf8')) as {
  readonly autoplay: { readonly personas: ReadonlyArray<Record<string, unknown>> };
};

/** A variation of Convoy as a submitter saves one: the export, an id, an author. */
function variation(id: string, name: string, overrides: Record<string, unknown>): string {
  const { description: _description, order: _order, ...exported } = convoy;
  return `${JSON.stringify({ ...exported, id, name, author: 'BOB', derivedFrom: 'convoy', ...overrides }, null, 2)}\n`;
}

/** A tree of Convoy alone, and a shelf holding `entries` by file name. */
function tree(entries: Readonly<Record<string, string>>): { root: string; packs: string } {
  const root = mkdtempSync(join(tmpdir(), 'star-swarm-shelf-'));
  const packs = join(root, 'packs');
  mkdirSync(packs, { recursive: true });
  cpSync(join(REPO_ROOT, 'packs', 'convoy'), join(packs, 'convoy'), { recursive: true });
  mkdirSync(join(root, 'variants'));
  cpSync(join(REPO_ROOT, 'variants', 'convoy.json'), join(root, 'variants', 'convoy.json'));
  mkdirSync(join(root, 'shelf'));
  for (const [file, text] of Object.entries(entries))
    writeFileSync(join(root, 'shelf', file), text);
  return { root, packs };
}

/** Convoy on five ships: a variation that plays. */
const LONG_HAUL = variation('long-haul', 'LONG HAUL', { lives: 5 });

/**
 * Convoy with its strongest persona flown as a panicking beginner: it loads, it
 * builds, every stage stays on screen — and the gate's pilots are no longer a
 * ladder, which is a finding of the flown half and nothing earlier.
 */
const UPSIDE_DOWN = (() => {
  const beginner = classic.autoplay.personas[0] ?? {};
  const personas = convoy.autoplay.personas.map((persona) =>
    persona.id === 'expert' ? { ...beginner, id: 'expert', label: 'EXPERT' } : persona,
  );
  return variation('upside-down', 'UPSIDE DOWN', {
    autoplay: { ...convoy.autoplay, personas },
  });
})();

/** A pack nobody installed: refused before anything is flown. */
const CORAL_RUN = variation('coral-run', 'CORAL RUN', { packs: ['convoy', 'coral'] });

describe('a shelf with a good entry and two bad ones', () => {
  let made: { root: string; packs: string };
  let result: RunResult;

  beforeAll(() => {
    made = tree({
      'long-haul.json': LONG_HAUL,
      'upside-down.json': UPSIDE_DOWN,
      'coral-run.json': CORAL_RUN,
    });
    result = validate(made.packs);
  }, TIMEOUT);

  afterAll(() => {
    rmSync(made.root, { recursive: true, force: true });
  });

  it('fails, so the pull request carrying them is refused', () => {
    expect(result.code).toBe(1);
  });

  it('passes the one that plays: judged, what it changes said, and flown', () => {
    expect(result.output).toContain(
      'shelf/long-haul.json: OK — "LONG HAUL" by BOB, from convoy: Starts with 5 ships — CONVOY starts with 3',
    );
    expect(result.output).toMatch(/playability long-haul: \d+ stage\(s\) flown by .* — playable/);
    expect(linesUnder(result.output, 'shelf/long-haul.json')).toEqual([]);
  });

  it('refuses the one that loads and cannot be played, by its own file, as unplayable', () => {
    expect(result.output).toContain('shelf/upside-down.json: OK');
    const lines = linesUnder(result.output, 'shelf/upside-down.json');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^playability /);
    expect(lines.join('\n')).toMatch(/playability ordered:/);
  });

  it('refuses the one that names a pack this build does not have, before flying anything', () => {
    expect(linesUnder(result.output, 'shelf/coral-run.json')).toEqual([
      'packs[1]: no pack with id "coral" is installed',
    ]);
    expect(result.output).not.toMatch(/playability coral-run/);
  });

  it('leaves the reference game as it is', () => {
    expect(result.output).toContain('variants/convoy.json: OK');
    expect(result.output).toMatch(/playability convoy: \d+ stage\(s\) flown by .* — playable/);
  });
});

describe('a shelf whose entries all play', () => {
  it(
    'passes',
    () => {
      const made = tree({ 'long-haul.json': LONG_HAUL });
      try {
        const result = validate(made.packs);
        expect(result.code, result.output).toBe(0);
      } finally {
        rmSync(made.root, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );
});
