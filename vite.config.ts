import { defineConfig, type Plugin } from 'vite';

import { buildIdentity, buildIdentityJson } from './scripts/build-identity.js';
import { BUILD_IDENTITY_FILE } from './src/ui/build-info.js';

/**
 * Stamp the build with its identity, and serve that identity as a static file a
 * running page can poll.
 *
 * One derivation ({@link buildIdentity}) feeds both halves, so the bundle and the
 * `build.json` beside it are the same bytes:
 *
 * - `define` substitutes the JSON into `src/ui/build-info.ts`, which parses it
 *   back with the very parser it reads a polled document with.
 * - In development the same JSON is served at `/build.json` by middleware; in a
 *   build it is emitted into `dist/`. A hosted deployment therefore needs to do
 *   nothing but publish `dist/` — `build.json` is already in it.
 *
 * **The consequence worth knowing, because it is the one question this cannot
 * answer for you:** the identity is computed when Vite reads its config, so a dev
 * server's stamp is the moment `npm run dev` started. Editing a source file
 * reloads the page but does not re-stamp it; only restarting the dev server (or
 * touching this file, which restarts it) does.
 * `docs/ARCHITECTURE.md` §2 has the whole table.
 */
function buildIdentityRoute(): Plugin {
  let json = '';
  return {
    name: 'star-swarm:build-identity',
    config(_config, env) {
      json = buildIdentityJson(
        buildIdentity({ mode: env.command === 'build' ? 'release' : 'dev' }),
      );
      return { define: { __BUILD_IDENTITY__: JSON.stringify(json) } };
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== `/${BUILD_IDENTITY_FILE}`) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        // The one file that must never be cached: it is how a page learns it is
        // stale. A host that caches it makes the detector permanently blind.
        res.setHeader('Cache-Control', 'no-store');
        res.end(json);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: BUILD_IDENTITY_FILE, source: json });
    },
  };
}

/**
 * Serve the `/lab` preview harness (docs/DESIGN.md section 8 step 3) at a tidy
 * URL during development.
 *
 * `apply: 'serve'` is the whole safety story: the plugin exists only while the
 * dev server runs, and `lab.html` is not one of the build's entry points — Vite
 * builds `index.html` and whatever it reaches, and the game never imports
 * `src/ui/lab/`. So the harness cannot end up in a production bundle, and it is
 * not on the game's code path either.
 */
function labRoute(): Plugin {
  return {
    name: 'star-swarm:lab-route',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url;
        if (url === '/lab' || url === '/lab/') req.url = '/lab.html';
        else if (url?.startsWith('/lab?')) req.url = `/lab.html${url.slice('/lab'.length)}`;
        next();
      });
    },
  };
}

export default defineConfig({
  // Relative base so a built bundle also works when served from a subpath
  // (e.g. GitHub Pages), which section 12 lists as a later candidate.
  base: './',
  plugins: [buildIdentityRoute(), labRoute()],
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});

export { buildIdentityRoute, labRoute };
