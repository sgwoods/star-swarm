/**
 * The playability pass of `npm run validate-packs`, run end to end by the real
 * script against two trees: the repository's own, which has to pass, and one with
 * a deliberately unplayable pack in it, which has to fail — for being unplayable,
 * with the stage, the check and the reason named.
 *
 * Both halves, because either alone proves nothing. A gate that passes the shipped
 * packs could be checking nothing; a gate that fails the fixture could be failing
 * everything. `docs/ROADMAP.md`'s Milestone 3 exit check is the second half: a
 * pack that fails validation for being unplayable rather than merely malformed.
 *
 * It lives in `tests/sim/` rather than beside `tests/unit/validate-packs.test.ts`
 * because it flies every stage of every variant, which takes seconds: the unit
 * file's throwaway trees fly nothing or one toy stage.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'validate-packs.ts');
const FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'unplayable');

/**
 * Flying every shipped stage measured about 15 s when the pass landed and about 36 s
 * once all thirteen Classic scripts did (53 flights, on an Apple-silicon laptop);
 * this leaves room for a CI box several times slower than that.
 */
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

describe('the shipped packs', () => {
  let result: RunResult;
  beforeAll(() => {
    result = validate(join(REPO_ROOT, 'packs'));
  }, TIMEOUT);

  it('pass, every stage of every variant flown', () => {
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('classic: OK');
    for (const id of ['classic', 'deep-sea', 'swarm-remix']) {
      expect(result.output).toMatch(
        new RegExp(`playability ${id}: \\d+ stage\\(s\\) flown by .* — playable`),
      );
    }
    // The demonstration declares no personas and is flown by Classic's, which
    // share its rules document; the report says so rather than leaving it implied.
    expect(result.output).toContain('(borrowed from classic)');
  });
});

describe('a pack that loads and cannot be played', () => {
  /**
   * `tests/fixtures/unplayable/` layered over a copy of the Classic pack, exactly
   * as a forged overlay is: three stages, each broken in a way no schema or
   * reference check can see.
   */
  let root: string;
  let result: RunResult;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'star-swarm-unplayable-'));
    const packs = join(root, 'packs');
    mkdirSync(packs, { recursive: true });
    cpSync(join(REPO_ROOT, 'packs', 'classic'), join(packs, 'classic'), { recursive: true });
    cpSync(join(FIXTURE, 'packs', 'unplayable'), join(packs, 'unplayable'), { recursive: true });
    cpSync(join(FIXTURE, 'variants'), join(root, 'variants'), { recursive: true });
    result = validate(packs);
  }, TIMEOUT);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes every structural pass, so what fails it is playability alone', () => {
    expect(result.output).toContain('unplayable: OK');
    expect(result.output).toContain('variants/unplayable.json: OK');
    expect(result.code).toBe(1);
    for (const line of result.output.split('\n')) {
      if (line.startsWith('    ')) expect(line.trim()).toMatch(/^playability /);
    }
  });

  it('fails the dive that sweeps off the side, against the path file, from both sides', () => {
    const lines = linesUnder(result.output, 'unplayable/paths/dive-overboard.json');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('playability dive:');
    expect(lines[0]).toContain('off the left side');
    expect(lines[0]).toContain('mirrored');
    expect(lines[0]).toContain('off the right side');
  });

  it('fails the stage nothing can reach, as a stall and as unclearable', () => {
    const lines = linesUnder(result.output, 'unplayable/stages/ledge.json');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^playability finishes: ledge as stage 2 of unplayable/);
    expect(lines[0]).toContain('still on the stage after 10800 steps on 16 of 16 seeds');
    expect(lines[1]).toMatch(/^playability clearable: ledge as stage 2 of unplayable/);
    expect(lines[1]).toContain('cleared 0 of 16 seeds and needs 8');
    expect(lines[1]).toContain('statistical');
  });

  it('fails the stage whose fleet cannot be built, with the engine’s own reason', () => {
    const lines = linesUnder(result.output, 'unplayable/stages/crowded.json');
    expect(lines[0]).toMatch(/^playability entry: crowded as stage 4 of unplayable/);
    expect(lines[0]).toContain('no free slot left for role "drone"');
  });

  it('blames no stage that is not at fault', () => {
    // Clearing a stage builds the next one on the same step. Each flight answers
    // only its own stage, so `crowded` failing to build is not reported against
    // the Classic challenge stage flown before it.
    expect(result.output).not.toContain('classic/stages/');
    expect(result.output).not.toContain('unplayable/stages/overboard.json');
  });
});
