/**
 * What build is this, and is a newer one being served?
 *
 * **Nothing here is written down by hand.** The identity is derived from the
 * repository and the clock by `scripts/build-identity.ts` and substituted into
 * the bundle by the plugin in `vite.config.ts`; a version number somebody has to
 * remember to bump is the hand-maintained fact this project keeps catching
 * itself on (`AGENTS.md`, "the documentation is four layers"). If the
 * substitution did not happen — a bundler that is not ours, a unit test
 * importing this module — the identity is {@link UNKNOWN_BUILD}, which says so
 * rather than inventing a release.
 *
 * The module is split the way `src/audio/synth.ts` is, and for the same reason:
 * everything here is pure or takes its impurity as an argument, so the
 * comparison and the poller are testable on the Node-only test environment.
 * Drawing lives next door in `./build-stamp.ts`, which is what keeps this file
 * importable from `vite.config.ts` for the one constant both sides need.
 *
 * It deliberately imports nothing at all.
 */

/* -------------------------------------------------------------------------- */
/* The identity                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `dev` is a build the Vite dev server made when it started; `release` is one
 * `vite build` wrote. The distinction is not cosmetic — a dev build's stamp is
 * the moment the server booted, not the moment you last edited a file — so it is
 * carried in the data rather than inferred from the URL.
 */
export type BuildMode = 'dev' | 'release';

export interface BuildIdentity {
  /** Short commit the build was made from, or `unknown` outside a checkout. */
  readonly commit: string;
  /** Was the working tree modified? `true` also when git could not be asked. */
  readonly dirty: boolean;
  readonly mode: BuildMode;
  /** When the build was made: ISO 8601 UTC to the second, e.g. `2026-09-27T14:03:11Z`. */
  readonly builtAt: string;
  /** Epoch milliseconds of {@link builtAt}. What "newer" is decided on. */
  readonly builtAtMs: number;
}

/**
 * The identity of a build that will not say what it is.
 *
 * Every field is the honest answer rather than a plausible one: no commit, a
 * tree that must be assumed modified, and a build time of zero, which is older
 * than anything a real build can carry — so a poll against a real `build.json`
 * reports `newer` rather than `same`.
 */
export const UNKNOWN_BUILD: BuildIdentity = Object.freeze({
  commit: 'unknown',
  dirty: true,
  mode: 'dev',
  builtAt: '',
  builtAtMs: 0,
});

/** The static document a running page polls. Served beside `index.html`. */
export const BUILD_IDENTITY_FILE = 'build.json';

/**
 * One string that changes whenever any part of the identity does.
 *
 * Derived rather than stored, so it cannot drift from the fields it summarises —
 * the same trap `check:count` exists for on the documentation side.
 */
export function buildId(build: BuildIdentity): string {
  return [build.builtAtMs, build.commit, build.dirty ? 'dirty' : 'clean', build.mode].join('-');
}

/**
 * Read an identity out of whatever a fetch produced.
 *
 * Total: anything that is not a well-formed identity is `undefined`, never a
 * throw and never a half-filled object. A page that cannot understand what is
 * being served must behave exactly like a page that could not reach it.
 */
export function parseBuildIdentity(value: unknown): BuildIdentity | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const { commit, dirty, mode, builtAt, builtAtMs } = raw;
  if (typeof commit !== 'string' || commit === '') return undefined;
  if (typeof dirty !== 'boolean') return undefined;
  if (mode !== 'dev' && mode !== 'release') return undefined;
  if (typeof builtAt !== 'string') return undefined;
  if (typeof builtAtMs !== 'number' || !Number.isFinite(builtAtMs) || builtAtMs < 0) {
    return undefined;
  }
  return { commit, dirty, mode, builtAt, builtAtMs };
}

/* -------------------------------------------------------------------------- */
/* The comparison                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What the last poll found.
 *
 * `differs` is not the same as `newer` and is not folded into it: a rollback
 * serves an *older* build than the one in the tab, and refreshing is still the
 * right advice, but calling that "newer" would be a claim the data does not
 * support.
 */
export type BuildComparison = 'same' | 'newer' | 'differs' | 'unknown';

/** Does this comparison mean the page is not running what is being served? */
export function isUpdate(comparison: BuildComparison): boolean {
  return comparison === 'newer' || comparison === 'differs';
}

/** Compare the running build against what the server is handing out. */
export function compareBuilds(
  local: BuildIdentity,
  served: BuildIdentity | undefined,
): BuildComparison {
  if (served === undefined) return 'unknown';
  if (buildId(served) === buildId(local)) return 'same';
  return served.builtAtMs > local.builtAtMs ? 'newer' : 'differs';
}

/* -------------------------------------------------------------------------- */
/* The poller                                                                  */
/* -------------------------------------------------------------------------- */

export interface UpdateWatcherOptions {
  /** The build the page is running. */
  readonly local: BuildIdentity;
  /**
   * Fetch the served identity document. Whatever it resolves to is handed to
   * {@link parseBuildIdentity}; a rejection is a missed poll and nothing more.
   */
  readonly load: () => Promise<unknown>;
  /**
   * Simulation steps between polls. Required rather than defaulted, because a
   * cadence written here would be a second copy of `STEP_HZ`.
   */
  readonly everySteps: number;
}

export interface UpdateWatcher {
  /** The last poll's verdict. `unknown` until one has succeeded. */
  readonly comparison: BuildComparison;
  /** Shorthand for {@link isUpdate} of {@link comparison}. */
  readonly available: boolean;
  /** Polls that have settled, successful or not. */
  readonly checks: number;
  /** Polls that produced nothing usable — unreachable, or not an identity. */
  readonly failures: number;
  /**
   * Advance one simulation step, polling when one is due. Never throws, never
   * blocks, and never runs two polls at once.
   */
  step: () => void;
  /** Poll now. Resolves with the new {@link comparison} and never rejects. */
  check: () => Promise<BuildComparison>;
}

/**
 * Poll a served identity on the simulation's own clock.
 *
 * Steps rather than milliseconds, like every other timer in `src/ui/`
 * (`src/ui/flow.ts`): the loop stops stepping when the tab is hidden, so the
 * polling stops with it and resumes on return, which is the behaviour you want
 * from a tab nobody is looking at.
 *
 * Two properties this is built for, both of them about not being annoying:
 *
 * - **A failed poll is silent.** No console noise, no thrown error, no visible
 *   change. A player on a train sees exactly what a player online sees.
 * - **A failed poll never retracts a detection.** Once a newer build is known to
 *   exist, going offline does not make the notice flicker away and back.
 */
export function createUpdateWatcher(options: UpdateWatcherOptions): UpdateWatcher {
  const { local, load, everySteps } = options;
  if (!Number.isInteger(everySteps) || everySteps < 1) {
    throw new RangeError('everySteps must be a positive whole number of simulation steps');
  }

  let comparison: BuildComparison = 'unknown';
  let checks = 0;
  let failures = 0;
  /** Starts below zero so the very first `step()` polls. */
  let steps = -1;
  let inFlight: Promise<BuildComparison> | undefined;

  function settle(result: BuildComparison): BuildComparison {
    checks += 1;
    if (result === 'unknown') failures += 1;
    if (result !== 'unknown' || !isUpdate(comparison)) comparison = result;
    inFlight = undefined;
    return comparison;
  }

  function check(): Promise<BuildComparison> {
    if (inFlight !== undefined) return inFlight;
    // `Promise.resolve().then(load)` rather than `load()`, so a `load` that
    // throws synchronously is a missed poll like any other rather than an
    // exception in the caller's frame.
    inFlight = Promise.resolve()
      .then(load)
      .then((value) => settle(compareBuilds(local, parseBuildIdentity(value))))
      .catch(() => settle('unknown'));
    return inFlight;
  }

  return {
    get comparison(): BuildComparison {
      return comparison;
    },
    get available(): boolean {
      return isUpdate(comparison);
    },
    get checks(): number {
      return checks;
    },
    get failures(): number {
      return failures;
    },
    step(): void {
      steps += 1;
      if (steps % everySteps === 0) void check();
    },
    check,
  };
}

/* -------------------------------------------------------------------------- */
/* The browser's half                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Where to poll, given the document's base URL.
 *
 * Relative to the document rather than absolute, because `vite.config.ts` sets
 * `base: './'` so a built bundle also works from a subpath — a hosted build at
 * `/star-swarm/` must poll `/star-swarm/build.json`, not `/build.json`.
 *
 * The cache-buster is belt and braces alongside `cache: 'no-store'`: a static
 * host that ignores the header still cannot serve a stale answer to a URL it has
 * never seen.
 */
export function buildIdentityUrl(base: string, cacheBust: number): string {
  const url = new URL(BUILD_IDENTITY_FILE, base);
  url.searchParams.set('t', String(cacheBust));
  return url.href;
}

/**
 * A {@link UpdateWatcherOptions.load} that fetches {@link BUILD_IDENTITY_FILE}.
 *
 * The `navigator.onLine === false` short-circuit is there to keep a browser that
 * *knows* it is offline from logging a refused request to its own devtools every
 * minute. It is not a correctness check — `onLine` is true behind a captive
 * portal, so the fetch still has to be allowed to fail, and the watcher treats
 * both the same way.
 */
export function fetchServedIdentity(): () => Promise<unknown> {
  return async () => {
    if (navigator.onLine === false) throw new Error('build identity: offline');
    const response = await fetch(buildIdentityUrl(document.baseURI, Date.now()), {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(`build identity: HTTP ${String(response.status)}`);
    return (await response.json()) as unknown;
  };
}

/* -------------------------------------------------------------------------- */
/* What was substituted into this bundle                                       */
/* -------------------------------------------------------------------------- */

/**
 * The JSON the plugin in `vite.config.ts` substitutes, verbatim.
 *
 * A string rather than an object literal on purpose: the bundle and the served
 * `build.json` are then the *same* bytes from the *same* serialiser, and the
 * running page reads its own identity through the very parser it reads the
 * served one with.
 */
declare const __BUILD_IDENTITY__: string | undefined;

function injectedBuild(): BuildIdentity {
  if (typeof __BUILD_IDENTITY__ !== 'string') return UNKNOWN_BUILD;
  try {
    return parseBuildIdentity(JSON.parse(__BUILD_IDENTITY__)) ?? UNKNOWN_BUILD;
  } catch {
    return UNKNOWN_BUILD;
  }
}

/** The build this bundle is. */
export const BUILD: BuildIdentity = injectedBuild();
