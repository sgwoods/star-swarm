import { resolve } from 'node:path';

import { defineConfig, type Plugin } from 'vite';

import { buildIdentity, buildIdentityJson } from './scripts/build-identity.js';
import { HOST, STAR_SWARM, stampPage, whoamiMiddleware } from './scripts/localhost.js';
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

/**
 * Make every server and every page of this project say which project it is —
 * the localhost agreement's half that lives in Vite (`scripts/localhost.ts`).
 *
 * Every server Vite runs here answers `GET /whoami` with the project, the port
 * it is really on, its pid and the short commit: the dev server, `npm run
 * preview`, the record and capture commands' servers and Playwright's. That
 * answer is what lets `npm run dev` prove an older copy is its own before
 * stopping it, and what `--status` reads.
 *
 * Every page the dev server sends — the game, the shelf, `/lab`, the capture and
 * record pages — is stamped on its way out: the port in the tab title, a
 * favicon, and a small label with the name, port and commit.
 *
 * `apply: 'serve'` is what keeps all of it out of the published game, exactly as
 * it does for `/lab`: the plugin does not exist during `vite build`, so a built
 * page is the document in the repository, titled `Star Swarm` and nothing else.
 * `tests/unit/lab-dev-only.test.ts` builds the bundle to check. A preview serves
 * that built bundle, so it answers `/whoami` but stamps nothing.
 */
function localIdentity(): Plugin {
  let version = '';
  const whoami = whoamiMiddleware(STAR_SWARM, () => version);
  return {
    name: 'star-swarm:local-identity',
    apply: 'serve',
    config() {
      version = buildIdentity({ mode: 'dev' }).commit;
    },
    configureServer(server) {
      server.middlewares.use(whoami);
    },
    configurePreviewServer(server) {
      server.middlewares.use(whoami);
    },
    transformIndexHtml(html, context) {
      const address = context.server?.httpServer?.address();
      const port =
        typeof address === 'object' && address !== null
          ? address.port
          : context.server?.config.server.port;
      return port === undefined ? html : stampPage(html, STAR_SWARM, { port, version });
    },
  };
}

/**
 * The pages a build publishes, and nothing else: the game, and the shelf of other
 * players' variations beside it (`shelf.html`, `src/ui/shelf-page.ts`). `lab.html`
 * and `capture.html` are root documents too, and are left out on purpose — Vite
 * builds the inputs it is given, so a page not named here never ships.
 * `tests/unit/lab-dev-only.test.ts` holds this list.
 */
const PAGES = {
  index: resolve(import.meta.dirname, 'index.html'),
  shelf: resolve(import.meta.dirname, 'shelf.html'),
};

export default defineConfig({
  // Relative base so a built bundle also works when served from a subpath
  // (e.g. GitHub Pages), which section 12 lists as a later candidate.
  base: './',
  plugins: [buildIdentityRoute(), labRoute(), localIdentity()],
  // The localhost agreement (README, "Local ports"): 127.0.0.1 only, and the
  // block's default port. `strictPort` is the half that matters — without it
  // Vite walks upwards from a busy port, and out of the block.
  // `scripts/dev-server.ts` chooses another port inside the block instead.
  server: { host: HOST, port: STAR_SWARM.preferred, strictPort: true },
  preview: { host: HOST, port: STAR_SWARM.preferred, strictPort: true },
  build: { target: 'es2022', sourcemap: true, rolldownOptions: { input: PAGES } },
});

export { buildIdentityRoute, labRoute, localIdentity, PAGES };
