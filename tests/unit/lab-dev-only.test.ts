import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import type { Rolldown } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

import { labRoute } from '../../vite.config.js';

/**
 * `/lab` is a **dev-build route** (`docs/DESIGN.md` section 8 step 3, and the
 * Milestone 1 task that adds it), and so are the two clip pages beside it: the
 * page `npm run capture` renders a replay on, and the page `npm run record`
 * records a live run on. Two claims are easy to make and easy to break later, so
 * they are checked rather than trusted:
 *
 *  1. They do not ship. `vite build` builds `index.html` and whatever that
 *     reaches; nothing on that graph may reach `src/ui/lab/`, and the plugin
 *     that serves the route must not exist outside the dev server.
 *  2. They are not on the game's code path, so they cannot slow the game down.
 *
 * Both reduce to the same static question — who imports `src/ui/lab/` — which the
 * first block answers cheaply. The last block then builds the bundle and looks,
 * because "a player who never records downloads not one byte of the recorder"
 * (`docs/ROADMAP.md`, "Capturing gameplay video") is a claim about the build, and
 * a claim about the build is settled by the build.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = join(REPO_ROOT, 'src');
const LAB = join(SRC, 'ui', 'lab');

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, extensions));
    else if (extensions.some((extension) => name.endsWith(extension))) out.push(path);
  }
  return out;
}

describe('the lab never reaches the production bundle', () => {
  it('is not reachable from the game entry point', () => {
    const offenders = filesUnder(SRC, ['.ts'])
      .filter((file) => !file.startsWith(LAB))
      .filter((file) =>
        /(?:from|import)\s*\(?\s*['"][^'"]*ui\/lab\//.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('is not referenced from index.html', () => {
    const html = readFileSync(join(REPO_ROOT, 'index.html'), 'utf8');
    expect(html).not.toMatch(/lab/i);
    expect(html).not.toMatch(/capture/i);
    expect(html).not.toMatch(/record/i);
  });

  // Three pages live there: the previewer, the page `npm run capture` drives
  // (`scripts/capture.ts`) and the page `npm run record` serves
  // (`scripts/record.ts`). Each is its own root document for the same reason.
  it.each([
    ['lab.html', '/src/ui/lab/main.ts'],
    ['capture.html', '/src/ui/lab/capture.ts'],
    ['record.html', '/src/ui/lab/record.ts'],
  ])('%s is its own entry document, which the build is never given', (document, entry) => {
    // It exists at the root so the dev server can serve it; Vite's only build
    // input is `index.html`, so a root HTML file it is not told about is simply
    // not built.
    const html = readFileSync(join(REPO_ROOT, document), 'utf8');
    expect(html).toMatch(entry);
    const viteConfig = readFileSync(join(REPO_ROOT, 'vite.config.ts'), 'utf8');
    expect(viteConfig).not.toMatch(/rollupOptions/);
  });

  it('serves the route from a plugin that only exists while developing', () => {
    expect(labRoute().apply).toBe('serve');
  });
});

describe('the bundle, built', () => {
  const chunks: Rolldown.OutputChunk[] = [];
  let files: string[] = [];

  beforeAll(async () => {
    // The real build, from the real config, kept in memory: nothing is written.
    const { build } = await import('vite');
    const result = await build({ root: REPO_ROOT, logLevel: 'silent', build: { write: false } });
    const outputs = Array.isArray(result) ? result : [result];
    for (const output of outputs) {
      if (!('output' in output)) throw new Error('expected a build, not a watcher');
      for (const item of output.output) {
        files.push(item.fileName);
        if (item.type === 'chunk') chunks.push(item);
      }
    }
    files = files.sort();
  });

  it('is index.html and what it reaches, and no other page', () => {
    expect(chunks.map((chunk) => relative(REPO_ROOT, chunk.facadeModuleId ?? ''))).toEqual([
      'index.html',
    ]);
    expect(files.filter((file) => file.endsWith('.html'))).toEqual(['index.html']);
  });

  it('holds no module of the lab, the capture page or the record page', () => {
    const shipped = chunks.flatMap((chunk) => chunk.moduleIds).map((id) => relative(REPO_ROOT, id));
    // The two commands too: `scripts/` is not off limits as a whole, because the
    // pack manager runs the playability pass's structural half from it.
    const devOnly = (id: string): boolean =>
      id.startsWith('src/ui/lab/') || id === 'scripts/capture.ts' || id === 'scripts/record.ts';
    expect(shipped.filter(devOnly)).toEqual([]);
    // The check is only as good as its list: the game's own modules are there.
    expect(shipped).toContain('src/main.ts');
  });

  it('ships the replay player the attract demo uses, and not the recorder beside it', () => {
    // `src/engine/replay.ts` is in the bundle, because a game with no personas plays
    // its attract demo from a log. `recordInput` is in the same module, and is what
    // a recording session wraps the keyboard with — so it is the one piece of the
    // recorder the game could carry without importing the lab, and it is not there.
    const replay = chunks
      .map((chunk) => chunk.modules[join(REPO_ROOT, 'src', 'engine', 'replay.ts')])
      .find((module) => module !== undefined);
    expect(replay?.renderedExports).toContain('createReplaySource');
    expect(replay?.renderedExports).not.toContain('recordInput');
  });
});

/** The middleware, exercised directly: no dev server, no network. */
function rewrite(url: string | undefined): string | undefined {
  const plugin = labRoute();
  const { configureServer } = plugin;
  if (typeof configureServer !== 'function') throw new Error('expected a configureServer hook');

  let middleware: ((req: { url?: string }, res: unknown, next: () => void) => void) | undefined;
  const server = {
    middlewares: {
      use(handler: (req: { url?: string }, res: unknown, next: () => void) => void) {
        middleware = handler;
      },
    },
  };
  // The hook's signature is Vite's full dev server; the plugin touches only
  // `middlewares.use`, so the stub above is everything it needs.
  (configureServer as (dev: typeof server) => void)(server);
  if (middleware === undefined) throw new Error('the plugin registered no middleware');

  const request: { url?: string } = url === undefined ? {} : { url };
  middleware(request, {}, () => undefined);
  return request.url;
}

describe('the /lab URL', () => {
  it.each(['/lab', '/lab/'])('maps %s onto lab.html', (url) => {
    expect(rewrite(url)).toBe('/lab.html');
  });

  it('keeps a query string', () => {
    expect(rewrite('/lab?path=entry-side-file')).toBe('/lab.html?path=entry-side-file');
  });

  it.each(['/', '/index.html', '/src/main.ts', '/labour', undefined])('leaves %s alone', (url) => {
    expect(rewrite(url)).toBe(url);
  });
});
