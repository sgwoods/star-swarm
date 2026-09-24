import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so a built bundle also works when served from a subpath
  // (e.g. GitHub Pages), which section 12 lists as a later candidate.
  base: './',
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});
