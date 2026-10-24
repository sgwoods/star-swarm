import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { judgeSubmission, parseNameStatus } from '../../scripts/shelf-submission.js';

/**
 * `scripts/shelf-submission.ts`: a pull request from outside the project that
 * touches the shelf is one variation under `shelf/` and nothing else, so whoever
 * curates it is never asked to read a pack or a line of code to refuse it.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'shelf-submission.ts');

const changes = (...lines: readonly string[]) => parseNameStatus(lines.join('\n'));

describe('a shelf submission from outside the project', () => {
  it('may add a variation, or change one', () => {
    expect(judgeSubmission('NONE', changes('A\tshelf/dusk-patrol.json')).ok).toBe(true);
    expect(judgeSubmission('CONTRIBUTOR', changes('M\tshelf/dusk-patrol.json')).ok).toBe(true);
    expect(
      judgeSubmission('FIRST_TIME_CONTRIBUTOR', changes('A\tshelf/one.json', 'A\tshelf/two.json'))
        .ok,
    ).toBe(true);
  });

  it('may change nothing outside shelf/: a pack, the code, the shelf’s own README', () => {
    const verdict = judgeSubmission(
      'NONE',
      changes(
        'A\tshelf/reef-run.json',
        'A\tpacks/coral/pack.json',
        'M\tsrc/main.ts',
        'M\tshelf/README.md',
      ),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.outside).toEqual([
      'A packs/coral/pack.json',
      'M src/main.ts',
      'M shelf/README.md',
    ]);
    expect(verdict.reason).toMatch(/not accepted from outside the project yet/);
  });

  it('may not take an entry off the shelf, or move one: that is the curator’s', () => {
    expect(judgeSubmission('NONE', changes('D\tshelf/dusk-patrol.json')).ok).toBe(false);
    expect(
      judgeSubmission('NONE', changes('R100\tshelf/dusk-patrol.json\tshelf/mine.json')).ok,
    ).toBe(false);
  });

  it('is not what a pull request touching no shelf entry is', () => {
    expect(judgeSubmission('NONE', changes('M\tREADME.md')).ok).toBe(true);
    expect(judgeSubmission('NONE', changes()).ok).toBe(true);
  });

  it('is not what the project’s own people make', () => {
    for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
      expect(judgeSubmission(association, changes('A\tshelf/x.json', 'M\tsrc/main.ts')).ok).toBe(
        true,
      );
    }
  });
});

describe('the script CI runs', () => {
  const run = (association: string, input: string): { code: number; output: string } => {
    try {
      const output = execFileSync(process.execPath, ['--import', 'tsx', SCRIPT, association], {
        cwd: REPO_ROOT,
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { code: 0, output };
    } catch (error) {
      const err = error as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  it('passes one variation and fails, listing what else changed, on more', () => {
    expect(run('NONE', 'A\tshelf/dusk-patrol.json\n').code).toBe(0);
    const refused = run('NONE', 'A\tshelf/dusk-patrol.json\nM\tsrc/main.ts\n');
    expect(refused.code).toBe(1);
    expect(refused.output).toContain('  M src/main.ts');
    expect(refused.output).toContain('CONTRIBUTING.md');
  });
});
