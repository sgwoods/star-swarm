import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { labRoute } from '../../vite.config.js';

/**
 * `/lab` is a **dev-build route** (`docs/DESIGN.md` section 8 step 3, and the
 * Milestone 1 task that adds it). Two claims are easy to make and easy to break
 * later, so they are checked rather than trusted:
 *
 *  1. It does not ship. `vite build` builds `index.html` and whatever that
 *     reaches; nothing on that graph may reach `src/ui/lab/`, and the plugin
 *     that serves the route must not exist outside the dev server.
 *  2. It is not on the game's code path, so it cannot slow the game down.
 *
 * Both reduce to the same static question — who imports `src/ui/lab/` — which is
 * why this is a cheap unit test rather than a build-output diff.
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
  });

  it('has its own entry document, which the build is never given', () => {
    // `lab.html` exists at the root so the dev server can serve it; Vite's only
    // build input is `index.html`, so a root HTML file it is not told about is
    // simply not built.
    const lab = readFileSync(join(REPO_ROOT, 'lab.html'), 'utf8');
    expect(lab).toMatch('/src/ui/lab/main.ts');
    const viteConfig = readFileSync(join(REPO_ROOT, 'vite.config.ts'), 'utf8');
    expect(viteConfig).not.toMatch(/rollupOptions/);
  });

  it('serves the route from a plugin that only exists while developing', () => {
    expect(labRoute().apply).toBe('serve');
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
