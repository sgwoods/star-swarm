import { defineConfig, devices } from '@playwright/test';

/**
 * Vite's default, unless `STAR_SWARM_PORT` says otherwise.
 *
 * `reuseExistingServer` is on outside CI, which is a trap when two checkouts of
 * this repo are open at once: the second run silently tests the first one's dev
 * server. Overriding the port is how a second worktree runs its own.
 */
const PORT = Number(process.env.STAR_SWARM_PORT ?? 5173);

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
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
