import { defineConfig, devices } from '@playwright/test'

/**
 * E2E / accessibility / security browser test configuration.
 *
 * These tests run a REAL browser against a REAL running instance. They
 * require:
 *   - a PostgreSQL database with the schema migrated and the seed applied
 *     (npm run db:setup && npm run db:seed)
 *   - the app started via the webServer below (or an externally started
 *     server on the same port)
 *
 * Seed credentials (see README "Login Credentials & App Modes" and
 * prisma/seed.ts) are read from env; defaults match the seed script.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // booking tests share one database: run serially
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : {
        command: 'npm run start',
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
