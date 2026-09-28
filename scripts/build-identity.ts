/**
 * Where a build's identity comes from: this repository, and the clock.
 *
 * Node-only — it shells out to `git` — and therefore the impure half of the pair
 * whose pure half is `src/ui/build-info.ts`. The plugin in `vite.config.ts` is
 * the only caller: it puts what this returns into the bundle *and* into the
 * `build.json` a running page polls, from one serialisation, so the two can never
 * disagree about what was built.
 *
 * **No number here is written down.** The commit is the repository's, the dirty
 * flag is `git status`, the date is the clock, and the mode is which Vite command
 * is running. That is the whole point: a version an author has to remember to
 * bump is exactly the hand-maintained fact this project keeps finding stale
 * (`AGENTS.md`).
 *
 * Every git call is allowed to fail. A tarball with no `.git`, or a machine with
 * no git at all, gets an identity that says `unknown` — a build that cannot
 * identify itself must say so rather than claim to be a clean release.
 */

import { execFileSync } from 'node:child_process';

import type { BuildIdentity, BuildMode } from '../src/ui/build-info.js';

/** What {@link buildIdentity} reports when git cannot be asked. */
export const UNKNOWN_COMMIT = 'unknown';

/** Characters of the commit hash the stamp shows. Git's own short default. */
const COMMIT_LENGTH = 7;

/** Run git, or return `undefined`. Never throws, never prints. */
function git(args: readonly string[], cwd: string): string | undefined {
  try {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      // Swallow git's stderr: "not a git repository" is an answer here, not an
      // error worth putting in a build log.
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

export interface BuildIdentityOptions {
  readonly mode: BuildMode;
  /** Repository to read. Defaults to the process's working directory. */
  readonly cwd?: string;
  /** The clock. Injectable so a test can pin the date it derives. */
  readonly now?: Date;
}

/**
 * Derive the identity of the build being made right now.
 *
 * `builtAt` is truncated to whole seconds and `builtAtMs` is the same instant, so
 * the timestamp a reader sees and the number "newer" is decided on are the same
 * moment rather than two roundings of it.
 */
export function buildIdentity(options: BuildIdentityOptions): BuildIdentity {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();

  const commit = git(['rev-parse', `--short=${String(COMMIT_LENGTH)}`, 'HEAD'], cwd);
  const status = git(['status', '--porcelain'], cwd);

  const builtAtMs = Math.floor(now.getTime() / 1000) * 1000;
  return {
    commit: commit ?? UNKNOWN_COMMIT,
    // No answer from git is not the same as a clean tree, and must not read like
    // one: if we cannot tell, we say modified.
    dirty: status === undefined ? true : status.length > 0,
    mode: options.mode,
    builtAt: new Date(builtAtMs).toISOString().replace('.000Z', 'Z'),
    builtAtMs,
  };
}

/**
 * The identity as the bytes that are both substituted into the bundle and served
 * as `build.json`. One serialiser, so a page's own identity and the one it polls
 * are the same shape down to the key order.
 */
export function buildIdentityJson(build: BuildIdentity): string {
  return JSON.stringify(build);
}
