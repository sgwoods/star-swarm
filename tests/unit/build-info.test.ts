import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';

import { buildIdentityRoute } from '../../vite.config.js';

import { buildIdentity, buildIdentityJson, UNKNOWN_COMMIT } from '../../scripts/build-identity.js';
import {
  BUILD,
  BUILD_IDENTITY_FILE,
  buildId,
  buildIdentityUrl,
  type BuildIdentity,
  compareBuilds,
  createUpdateWatcher,
  isUpdate,
  parseBuildIdentity,
  UNKNOWN_BUILD,
} from '../../src/ui/build-info.js';
import {
  ATTRACT_LINE_Y,
  ATTRACT_NOTICE,
  buildCode,
  buildDate,
  buildLine,
  CORNER_NOTICE,
  CORNER_RIGHT,
  CORNER_ROW_0_CELLS,
  CORNER_ROW_0_Y,
  CORNER_ROW_1_CELLS,
  CORNER_ROW_1_Y,
  noticeVisible,
  shortBuildDate,
} from '../../src/ui/build-stamp.js';
import { TOP_BAND_HEIGHT } from '../../src/ui/hud.js';
import { CELL } from '../../src/render/text.js';
import { LOGICAL_WIDTH } from '../../src/render/canvas.js';
import { classicRules } from '../helpers/rules.js';

/**
 * The build stamp and the new-build detector.
 *
 * Three things are worth testing here and the rest is arithmetic:
 *
 *  1. **The identity is derived, not written down.** A version somebody has to
 *     remember to bump is the hand-maintained fact this project keeps finding
 *     stale, so the test compares what `scripts/build-identity.ts` produces
 *     against a *separate* `git` call and against the clock it was handed.
 *  2. **The comparison.** Same, newer, a rollback, and unreachable — the last of
 *     which is the one a player actually meets.
 *  3. **A failed poll is silent.** No throw, no change on screen, and a
 *     detection already made is not retracted by going offline.
 *
 * Everything is headless: the watcher's only impurity is the `load` function it
 * is handed, which is the whole reason it takes one.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/** A plausible identity to vary one field of at a time. */
function identity(overrides: Partial<BuildIdentity> = {}): BuildIdentity {
  return {
    commit: 'a1b2c3d',
    dirty: false,
    mode: 'release',
    builtAt: '2026-09-27T14:03:11Z',
    builtAtMs: Date.parse('2026-09-27T14:03:11Z'),
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Derived, never written down                                                 */
/* -------------------------------------------------------------------------- */

describe('the identity is derived from the repository and the clock', () => {
  it('reports the commit git reports, asked independently', () => {
    const fromGit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    expect(buildIdentity({ mode: 'release', cwd: REPO_ROOT }).commit).toBe(fromGit);
  });

  it('reports the working tree as dirty exactly when git does', () => {
    const porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(buildIdentity({ mode: 'release', cwd: REPO_ROOT }).dirty).toBe(porcelain.trim() !== '');
  });

  it('dates the build from the clock it is handed, to the whole second', () => {
    const now = new Date('2026-09-27T14:03:11.789Z');
    const build = buildIdentity({ mode: 'release', cwd: REPO_ROOT, now });
    expect(build.builtAt).toBe('2026-09-27T14:03:11Z');
    // The timestamp a reader sees and the number "newer" is decided on must be
    // the same instant, not two roundings of it.
    expect(build.builtAtMs).toBe(Date.parse(build.builtAt));
  });

  it('carries the mode it is told, so a dev build cannot look like a release', () => {
    expect(buildIdentity({ mode: 'dev', cwd: REPO_ROOT }).mode).toBe('dev');
    expect(buildIdentity({ mode: 'release', cwd: REPO_ROOT }).mode).toBe('release');
  });

  it('says unknown outside a checkout rather than inventing a release', () => {
    // A directory with no repository above it. `git` fails, and every failure
    // has to read as "cannot tell", including the dirty flag.
    const build = buildIdentity({ mode: 'release', cwd: '/', now: new Date(0) });
    if (build.commit !== UNKNOWN_COMMIT) {
      // Someone has a repository at the filesystem root. Nothing to prove here.
      return;
    }
    expect(build.dirty).toBe(true);
  });

  it('writes no version, date or commit into the browser modules', () => {
    // The structural half of "derived, not a literal": neither module may carry
    // a commit-shaped or date-shaped constant of its own. `UNKNOWN_BUILD` is the
    // one hard-coded identity and every field of it says so.
    for (const file of ['src/ui/build-info.ts', 'src/ui/build-stamp.ts']) {
      const text = readFileSync(join(REPO_ROOT, file), 'utf8');
      const literals = [...text.matchAll(/'(\d{4}-\d{2}-\d{2}[^']*|[0-9a-f]{7,40})'/g)].map(
        (match) => match[1],
      );
      expect(literals, `${file} should derive the build identity, not state it`).toEqual([]);
    }
    expect(UNKNOWN_BUILD.commit).toBe('unknown');
    expect(UNKNOWN_BUILD.builtAt).toBe('');
    expect(UNKNOWN_BUILD.builtAtMs).toBe(0);
  });

  it('is the unknown build when nothing was substituted into the bundle', () => {
    // Vitest is not the Vite plugin: `__BUILD_IDENTITY__` is absent here, so
    // `BUILD` must be the identity that admits it knows nothing.
    expect(BUILD).toEqual(UNKNOWN_BUILD);
  });

  it('serialises one document for both the bundle and the served file', () => {
    const build = identity();
    expect(parseBuildIdentity(JSON.parse(buildIdentityJson(build)))).toEqual(build);
  });
});

/* -------------------------------------------------------------------------- */
/* Reading a served document                                                   */
/* -------------------------------------------------------------------------- */

describe('parsing a served identity', () => {
  it('accepts a well-formed document', () => {
    expect(parseBuildIdentity(JSON.parse(JSON.stringify(identity())))).toEqual(identity());
  });

  it.each([
    ['not an object', 42],
    ['null', null],
    ['an array', []],
    ['a missing commit', { ...identity(), commit: undefined }],
    ['an empty commit', { ...identity(), commit: '' }],
    ['a non-boolean dirty flag', { ...identity(), dirty: 'yes' }],
    ['an unknown mode', { ...identity(), mode: 'staging' }],
    ['a non-string date', { ...identity(), builtAt: 1 }],
    ['a non-numeric timestamp', { ...identity(), builtAtMs: '1790517269000' }],
    ['a negative timestamp', { ...identity(), builtAtMs: -1 }],
    ['a NaN timestamp', { ...identity(), builtAtMs: Number.NaN }],
  ])('rejects %s', (_what, value) => {
    expect(parseBuildIdentity(value)).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* The comparison                                                             */
/* -------------------------------------------------------------------------- */

describe('comparing the running build against the served one', () => {
  it('is the same build when every field matches', () => {
    expect(compareBuilds(identity(), identity())).toBe('same');
    expect(isUpdate('same')).toBe(false);
  });

  it('is newer when the served build was made later', () => {
    const served = identity({ commit: 'ddddddd', builtAtMs: identity().builtAtMs + 1000 });
    expect(compareBuilds(identity(), served)).toBe('newer');
    expect(isUpdate('newer')).toBe(true);
  });

  it('is unknown when there is nothing to compare against', () => {
    expect(compareBuilds(identity(), undefined)).toBe('unknown');
    expect(compareBuilds(identity(), parseBuildIdentity('<!doctype html>'))).toBe('unknown');
    expect(isUpdate('unknown')).toBe(false);
  });

  it('calls a rollback differs rather than newer, and still advises a refresh', () => {
    const rolledBack = identity({ commit: 'ddddddd', builtAtMs: identity().builtAtMs - 1000 });
    expect(compareBuilds(identity(), rolledBack)).toBe('differs');
    expect(isUpdate('differs')).toBe(true);
  });

  it('notices a rebuild of the same commit at the same instant only if something moved', () => {
    // Same commit, same second, but the tree was dirty for one of them: two
    // different builds, and `buildId` is what keeps them apart.
    const dirtied = identity({ dirty: true });
    expect(buildId(dirtied)).not.toBe(buildId(identity()));
    expect(compareBuilds(identity(), dirtied)).toBe('differs');
  });

  it('treats a bundle that knows nothing as older than any real build', () => {
    expect(compareBuilds(UNKNOWN_BUILD, identity())).toBe('newer');
  });
});

/* -------------------------------------------------------------------------- */
/* The poller                                                                 */
/* -------------------------------------------------------------------------- */

/** Let every already-queued microtask and timer callback run. */
const settled = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('the update watcher', () => {
  const watcherOn = (load: () => Promise<unknown>, everySteps = 10) =>
    createUpdateWatcher({ local: identity(), load, everySteps });

  it('starts knowing nothing and claiming nothing', () => {
    const watcher = watcherOn(() => Promise.resolve(identity()));
    expect(watcher.comparison).toBe('unknown');
    expect(watcher.available).toBe(false);
    expect(watcher.checks).toBe(0);
  });

  it('reports the same build when the server is serving it', async () => {
    const watcher = watcherOn(() => Promise.resolve(identity()));
    expect(await watcher.check()).toBe('same');
    expect(watcher.available).toBe(false);
  });

  it('reports an update when the server has moved on', async () => {
    const served = identity({ builtAtMs: identity().builtAtMs + 1000 });
    const watcher = watcherOn(() => Promise.resolve(served));
    expect(await watcher.check()).toBe('newer');
    expect(watcher.available).toBe(true);
  });

  it('is silent when the fetch fails', async () => {
    let calls = 0;
    const watcher = watcherOn(() => {
      calls += 1;
      return Promise.reject(new Error('ERR_CONNECTION_REFUSED'));
    });
    await expect(watcher.check()).resolves.toBe('unknown');
    expect(watcher.available).toBe(false);
    expect(watcher.failures).toBe(1);
    expect(calls).toBe(1);
  });

  it('is silent when `load` throws synchronously', async () => {
    const watcher = watcherOn(() => {
      throw new Error('no fetch here');
    });
    await expect(watcher.check()).resolves.toBe('unknown');
    expect(watcher.failures).toBe(1);
  });

  it('is silent when there is nothing to poll', async () => {
    // A host with no `build.json` serves its 404 page, which parses to nothing.
    const watcher = watcherOn(() => Promise.resolve('<html>404</html>'));
    await expect(watcher.check()).resolves.toBe('unknown');
    expect(watcher.available).toBe(false);
    expect(watcher.failures).toBe(1);
  });

  it('does not retract a detection when the next poll fails', async () => {
    let served: unknown = identity({ builtAtMs: identity().builtAtMs + 1000 });
    const watcher = watcherOn(() =>
      served === undefined ? Promise.reject(new Error('offline')) : Promise.resolve(served),
    );
    expect(await watcher.check()).toBe('newer');
    served = undefined;
    expect(await watcher.check()).toBe('newer');
    expect(watcher.failures).toBe(1);
    expect(watcher.available).toBe(true);
  });

  it('polls on the first step and then on its cadence', async () => {
    let calls = 0;
    const watcher = watcherOn(() => {
      calls += 1;
      return Promise.resolve(identity());
    });

    // `step()` is deliberately synchronous and fire-and-forget, so the poll it
    // starts is awaited by letting the queue drain rather than by calling
    // `check()` — which would itself be a second poll.
    watcher.step();
    await settled();
    expect(calls).toBe(1);

    for (let step = 1; step < 10; step += 1) watcher.step();
    await settled();
    expect(calls).toBe(1);

    watcher.step();
    await settled();
    expect(calls).toBe(2);
  });

  it('never runs two polls at once', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const watcher = watcherOn(async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return identity();
    });

    const first = watcher.check();
    const second = watcher.check();
    await settled();
    expect(calls).toBe(1);
    release?.();
    expect(await first).toBe('same');
    expect(await second).toBe('same');
    expect(watcher.checks).toBe(1);
  });

  it('refuses a cadence that is not a whole number of steps', () => {
    expect(() => watcherOn(() => Promise.resolve(identity()), 0)).toThrow(RangeError);
    expect(() => watcherOn(() => Promise.resolve(identity()), 1.5)).toThrow(RangeError);
  });
});

/* -------------------------------------------------------------------------- */
/* The URL                                                                    */
/* -------------------------------------------------------------------------- */

describe('where the poll goes', () => {
  it('is relative to the document, so a subpath deployment works', () => {
    expect(buildIdentityUrl('https://example.test/star-swarm/', 7)).toBe(
      `https://example.test/star-swarm/${BUILD_IDENTITY_FILE}?t=7`,
    );
    expect(buildIdentityUrl('https://example.test/star-swarm/index.html', 7)).toBe(
      `https://example.test/star-swarm/${BUILD_IDENTITY_FILE}?t=7`,
    );
  });

  // What this does and does not prove: every poll asks for a URL no cache has
  // seen, which settles it on a host whose caches key on the whole URL. It says
  // nothing about a CDN that keys on the path alone — GitHub Pages is one, and
  // `docs/ARCHITECTURE.md` §2 carries the measurement. No unit test can stand in
  // for that; only the live site can.
  it('varies with every poll, so a whole-URL cache has never seen it', () => {
    const first = buildIdentityUrl('https://example.test/', 1);
    const second = buildIdentityUrl('https://example.test/', 2);
    expect(first).not.toBe(second);
  });
});

/* -------------------------------------------------------------------------- */
/* What it says on screen                                                     */
/* -------------------------------------------------------------------------- */

describe('the stamp strings', () => {
  it('shows the build date, with and without the century', () => {
    expect(buildDate(identity())).toBe('2026-09-27');
    expect(shortBuildDate(identity())).toBe('26-09-27');
  });

  it('admits it when there is no date', () => {
    expect(buildDate(UNKNOWN_BUILD)).toBe('????-??-??');
  });

  it('is a bare commit only for a clean release build', () => {
    expect(buildCode(identity())).toBe('a1b2c3d');
    expect(buildCode(identity({ dirty: true }))).toBe('a1b2c3d+');
    expect(buildCode(identity({ mode: 'dev' }))).toBe('a1b2c3dDEV');
    expect(buildCode(identity({ mode: 'dev', dirty: true }))).toBe('a1b2c3d+DEV');
  });

  it('spells the whole identity out on one attract line', () => {
    expect(buildLine(identity({ mode: 'dev', dirty: true }))).toBe('2026-09-27 a1b2c3d+DEV');
  });

  it('fits the gaps the HUD leaves, in the worst case and for the notice', () => {
    // The measurement that matters: the corner rows sit right of `HIGH SCORE`
    // and right of the high-score value, and one cell over either puts the stamp
    // through the arcade's own text. `src/ui/build-stamp.ts` has the arithmetic.
    for (const build of [
      identity(),
      identity({ dirty: true }),
      identity({ mode: 'dev' }),
      identity({ mode: 'dev', dirty: true }),
      UNKNOWN_BUILD,
    ]) {
      expect(shortBuildDate(build).length).toBeLessThanOrEqual(CORNER_ROW_0_CELLS);
      expect(buildCode(build).length).toBeLessThanOrEqual(CORNER_ROW_1_CELLS);
    }
    expect(CORNER_NOTICE.length).toBeLessThanOrEqual(CORNER_ROW_1_CELLS);
    // The attract line is centred on a 224-pixel playfield at 8 pixels a cell.
    expect(buildLine(identity({ mode: 'dev', dirty: true })).length * 8).toBeLessThanOrEqual(224);
    expect(ATTRACT_NOTICE.length * 8).toBeLessThanOrEqual(224);
  });

  it('blinks the notice half the period on and half off', () => {
    expect(noticeVisible(0, 60)).toBe(false);
    expect(noticeVisible(59, 60)).toBe(false);
    expect(noticeVisible(60, 60)).toBe(true);
    expect(noticeVisible(119, 60)).toBe(true);
    expect(noticeVisible(120, 60)).toBe(false);
    // A negative or zero cadence must not divide by nothing or index backwards.
    expect(noticeVisible(-10, 60)).toBe(false);
    expect(() => noticeVisible(10, 0)).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Where it lands                                                             */
/* -------------------------------------------------------------------------- */

describe('the stamp stays out of the way', () => {
  it('keeps both corner rows inside the top HUD band', () => {
    // The whole reason the corner is acceptable during play: the top band is the
    // HUD's, so nothing here is ever drawn over the playfield.
    for (const y of [CORNER_ROW_0_Y, CORNER_ROW_1_Y]) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + CELL).toBeLessThanOrEqual(TOP_BAND_HEIGHT);
    }
    expect(CORNER_RIGHT).toBe(LOGICAL_WIDTH);
  });

  it('puts the attract line between the prompt and the fighter', () => {
    // Derived from the pack rather than asserted: the fighter's row is
    // `player.y` in `packs/classic/rules.json`, so authoring a different
    // playfield moves this test rather than leaving it true by luck.
    const PROMPT_Y = 226;
    expect(ATTRACT_LINE_Y).toBeGreaterThanOrEqual(PROMPT_Y + CELL);
    expect(ATTRACT_LINE_Y + CELL).toBeLessThanOrEqual(classicRules().player.y);
  });
});

/* -------------------------------------------------------------------------- */
/* The plugin that stamps and serves it                                       */
/* -------------------------------------------------------------------------- */

/**
 * The seam the hosted build depends on: the identity in the bundle and the
 * identity in `build.json` must be the same bytes, or a page compares itself
 * against something else and reports an update that is not there.
 *
 * Exercised through the plugin's own hooks with stubs, like
 * `tests/unit/lab-dev-only.test.ts` does the `/lab` route — no dev server, no
 * build, no network.
 */
describe('the build-identity plugin', () => {
  interface Served {
    readonly headers: Record<string, string>;
    readonly body: string | undefined;
    readonly passedThrough: boolean;
  }

  function driveMiddleware(plugin: Plugin, url: string | undefined): Served {
    const { configureServer } = plugin;
    if (typeof configureServer !== 'function') throw new Error('expected a configureServer hook');

    type Handler = (req: { url?: string }, res: unknown, next: () => void) => void;
    let middleware: Handler | undefined;
    const server = {
      middlewares: {
        use(handler: Handler) {
          middleware = handler;
        },
      },
    };
    (configureServer as (dev: typeof server) => void)(server);
    if (middleware === undefined) throw new Error('the plugin registered no middleware');

    const headers: Record<string, string> = {};
    let body: string | undefined;
    let passedThrough = false;
    const res = {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      end(chunk: string) {
        body = chunk;
      },
    };
    middleware(url === undefined ? {} : { url }, res, () => {
      passedThrough = true;
    });
    return { headers, body, passedThrough };
  }

  /** Run the `config` hook, which is what derives the identity. */
  function stamp(command: 'serve' | 'build'): { plugin: Plugin; defined: string } {
    const plugin = buildIdentityRoute();
    const { config } = plugin;
    if (typeof config !== 'function') throw new Error('expected a config hook');
    const result = (config as (config: unknown, env: { command: string }) => unknown)(
      {},
      { command },
    ) as { define: Record<string, string> };
    const defined = result.define.__BUILD_IDENTITY__ ?? '';
    return { plugin, defined };
  }

  it('substitutes a JSON string the browser module can parse back', () => {
    const { defined } = stamp('build');
    // A string literal, not an object literal: `src/ui/build-info.ts` reads it
    // through the same parser it reads a polled document with.
    const inner = JSON.parse(defined) as unknown;
    expect(typeof inner).toBe('string');
    const build = parseBuildIdentity(JSON.parse(inner as string));
    expect(build).toBeDefined();
    expect(build?.mode).toBe('release');
    expect(build?.commit).toBe(buildIdentity({ mode: 'release', cwd: REPO_ROOT }).commit);
  });

  it('calls a dev server a dev build', () => {
    const { defined } = stamp('serve');
    const build = parseBuildIdentity(JSON.parse(JSON.parse(defined) as string));
    expect(build?.mode).toBe('dev');
  });

  it('serves the same bytes it substituted, uncacheable', () => {
    const { plugin, defined } = stamp('serve');
    const served = driveMiddleware(plugin, `/${BUILD_IDENTITY_FILE}`);
    expect(served.passedThrough).toBe(false);
    expect(served.body).toBe(JSON.parse(defined));
    expect(served.headers['Cache-Control']).toBe('no-store');
    expect(served.headers['Content-Type']).toContain('application/json');
  });

  it('serves it with a cache-busting query too', () => {
    const { plugin } = stamp('serve');
    expect(driveMiddleware(plugin, `/${BUILD_IDENTITY_FILE}?t=1`).passedThrough).toBe(false);
  });

  it.each(['/', '/index.html', '/src/main.ts', '/build.json.map', undefined])(
    'leaves %s to the rest of the server',
    (url) => {
      const { plugin } = stamp('serve');
      const served = driveMiddleware(plugin, url);
      expect(served.passedThrough).toBe(true);
      expect(served.body).toBeUndefined();
    },
  );

  it('emits the same document into the build output', () => {
    const { plugin, defined } = stamp('build');
    const { generateBundle } = plugin;
    if (typeof generateBundle !== 'function') throw new Error('expected a generateBundle hook');

    const emitted: Array<{ fileName?: string; source?: unknown }> = [];
    const context = {
      emitFile(file: { fileName?: string; source?: unknown }) {
        emitted.push(file);
      },
    };
    (generateBundle as (this: typeof context) => void).call(context);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.fileName).toBe(BUILD_IDENTITY_FILE);
    expect(emitted[0]?.source).toBe(JSON.parse(defined));
  });
});
