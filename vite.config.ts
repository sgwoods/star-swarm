import { defineConfig, type Plugin } from 'vite';

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
  plugins: [labRoute()],
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});

export { labRoute };
