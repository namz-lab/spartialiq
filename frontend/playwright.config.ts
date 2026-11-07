import { defineConfig, devices } from '@playwright/test'

/**
 * Browser-level checks for the responsive system.
 *
 * WHY testDir IS OUTSIDE src/
 * Vitest's include glob is `src/**\/*.{test,spec}.*` (vite.config.ts line 97).
 * A Playwright spec under src/ would be collected by `vitest run` and crash
 * it, because the two runners' `test` globals are not the same object.
 * Keeping browser specs in e2e/ keeps the two suites from seeing each other.
 *
 * The nine viewports Phase 28 names live in the spec rather than as Playwright
 * projects: they belong to individual assertions (a 320px page and a 1536px
 * page are checked for different things), not to the whole run.
 */
export default defineConfig({
  testDir: './e2e',

  // Layout assertions are deterministic; a retry would only mask a real
  // failure or a flaky dev-server start.
  retries: 0,
  // The dev server is a single Vite process. Parallel workers hammering it
  // during cold transform is the main source of noise here.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:5174',
    // Artifacts only on failure: a green run should not leave 80 screenshots.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  /**
   * Vite is started by Playwright and torn down after. `reuseExistingServer`
   * means a dev server already running is used as-is, so this does not fight
   * your own terminal.
   *
   * The backend proxy target may well be down; that is fine and deliberate.
   * These tests assert LAYOUT, and every screen must survive its data failing
   * to load — which exercises Phase 23's error state for free.
   */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
