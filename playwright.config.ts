import { defineConfig, devices } from '@playwright/test';

import { blockText, inBlock, STAR_SWARM } from './scripts/localhost.js';

/**
 * The dev server's default port, unless `STAR_SWARM_PORT` says otherwise — and
 * either way inside the project's block (README, "Local ports").
 *
 * `reuseExistingServer` is on outside CI, which is a trap when two checkouts of
 * this repo are open at once: the second run silently tests the first one's dev
 * server. Overriding the port is how a second worktree runs its own.
 */
const PORT = Number(process.env.STAR_SWARM_PORT ?? STAR_SWARM.preferred);
if (!inBlock(STAR_SWARM, PORT)) {
  throw new Error(`STAR_SWARM_PORT must be inside ${blockText(STAR_SWARM)}, not ${String(PORT)}`);
}

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Plain `vite`, not `npm run dev`: a test run must never stop somebody's dev
  // server, and replacing an older copy is what `npm run dev` does.
  // `vite.config.ts` already binds 127.0.0.1 with `strictPort`.
  webServer: {
    command: `npx vite --port ${String(PORT)}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
