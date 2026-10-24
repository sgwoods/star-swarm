/**
 * A shelf submission is one variation, and nothing else.
 *
 * The shelf (`shelf/`, `src/ui/shelf.ts`) takes variations from people outside
 * the project, and the point of taking only variations is that a variation is
 * data: `npm run validate-packs` can prove one loads and plays, so whoever curates
 * the shelf is asked whether it is good and never whether it works. A pull
 * request that adds a shelf entry **and** a pack, a rule or a line of code is not
 * that any more — it is a whole game, or a change to the program, and those are
 * not accepted from outside the project yet (`CONTRIBUTING.md`). This refuses it
 * on its own pull request rather than leaving it for a reader to notice.
 *
 * Usage, as CI runs it on a pull request:
 *
 * ```sh
 * git diff --name-status HEAD^1 HEAD | tsx scripts/shelf-submission.ts "$AUTHOR_ASSOCIATION"
 * ```
 *
 * The argument is GitHub's `author_association` for the pull request. The
 * project's own people — `OWNER`, `MEMBER`, `COLLABORATOR` — change the shelf
 * alongside the code as any other change does, and are not held to this. A pull
 * request that does not touch `shelf/` is not a submission, and is not either.
 *
 * **What it guards against is a mistake, not malice.** A pull request's checks
 * run the workflow the pull request itself carries, so one that rewrites
 * `.github/workflows/ci.yml` can leave this out — and shows that file in its diff
 * to whoever reads it. Nothing here is designed for an adversary at scale; the
 * shelf is curated, and a submission that is not one file under `shelf/` is
 * never one the curator has to read to refuse.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The associations GitHub gives the project's own people. */
export const MAINTAINERS: readonly string[] = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/** A shelf entry's path: one JSON document directly under `shelf/`. */
const ENTRY = /^shelf\/[^/]+\.json$/;

/** One line of `git diff --name-status`: a status letter or two, then one or two paths. */
interface Change {
  readonly status: string;
  readonly paths: readonly string[];
}

/** Parse `git diff --name-status` output. Blank lines are ignored. */
export function parseNameStatus(text: string): readonly Change[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [status = '', ...paths] = line.split('\t');
      return { status, paths };
    });
}

export type Verdict =
  | { readonly ok: true; readonly reason: string }
  | { readonly ok: false; readonly reason: string; readonly outside: readonly string[] };

/**
 * Whether a pull request's changes are a shelf submission it may be.
 *
 * A submission may add an entry or change one; it may not delete or rename one —
 * an entry is somebody's, and taking one off the shelf is the curator's act — and
 * it may change nothing outside `shelf/`, nor the directory's own README.
 */
export function judgeSubmission(association: string, changes: readonly Change[]): Verdict {
  if (MAINTAINERS.includes(association)) {
    return { ok: true, reason: `${association}: the project's own change, not a submission` };
  }
  const touchesShelf = changes.some((change) =>
    change.paths.some((path) => path.startsWith('shelf/')),
  );
  if (!touchesShelf) return { ok: true, reason: 'not a shelf submission: it touches no shelf/' };
  const outside = changes
    .filter(
      (change) =>
        !(change.status === 'A' || change.status === 'M') ||
        !change.paths.every((path) => ENTRY.test(path)),
    )
    .map((change) => `${change.status} ${change.paths.join(' -> ')}`);
  if (outside.length === 0) {
    const entries = changes.flatMap((change) => change.paths);
    return { ok: true, reason: `a shelf submission: ${entries.join(', ')}` };
  }
  return {
    ok: false,
    reason:
      'A shelf submission adds or changes variations under shelf/ and nothing else. ' +
      'This pull request also changes what is listed below. Whole games, packs and ' +
      'code are not accepted from outside the project yet — see CONTRIBUTING.md.',
    outside,
  };
}

function main(): void {
  const association = process.argv[2] ?? '';
  const verdict = judgeSubmission(association, parseNameStatus(readFileSync(0, 'utf8')));
  if (verdict.ok) {
    console.log(`shelf-submission: OK — ${verdict.reason}`);
    return;
  }
  console.error(`shelf-submission: ${verdict.reason}`);
  for (const line of verdict.outside) console.error(`  ${line}`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
