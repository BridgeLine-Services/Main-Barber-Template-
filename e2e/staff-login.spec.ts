import { test, expect } from '@playwright/test'

/**
 * Staff E2E: owner login → dashboard → manage appointments.
 *
 * Credentials come from env so no secret is committed; defaults match the
 * seed script's generated owner account placeholder (seed forces a password
 * change — for E2E, seed a dedicated E2E owner or set E2E_OWNER_EMAIL /
 * E2E_OWNER_PASSWORD to a known test account).
 */

const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL || 'owner@e2e.local'
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'E2eOwner!Passw0rd'

test('staff can log in and reach the dashboard', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('you@example.com').fill(OWNER_EMAIL)
  await page.getByPlaceholder('••••••••').fill(OWNER_PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()

  // Redirected into the dashboard (or the forced password-change page when
  // the seeded account still requires it — both prove authentication worked)
  await page.waitForURL(/dashboard|change-password/, { timeout: 30_000 })
  await expect(page.locator('body')).not.toContainText(/invalid credentials/i)
})

test('dashboard requires authentication (unauthenticated redirect)', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForURL(/login/, { timeout: 20_000 })
})
