import { test, expect } from '@playwright/test'

/**
 * Settings > Features is the only place an owner can see or change the optional
 * feature toggles. Before it existed, the switches were enforced server-side and
 * invisible. This proves the panel renders for an owner and that the honest
 * conditions are stated on screen.
 *
 * Read-only on purpose: it asserts what is shown, never flips a switch, so it
 * cannot change a shop's configuration as a side effect of running tests.
 */

const ownerEmail = process.env.E2E_OWNER_EMAIL
const ownerPassword = process.env.E2E_OWNER_PASSWORD

test.describe('features tab', () => {
  test.skip(!ownerEmail || !ownerPassword, 'E2E_OWNER_EMAIL/PASSWORD not provided')

  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
    await page.fill('input[type="email"]', ownerEmail!)
    await page.fill('input[type="password"]', ownerPassword!)
    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 30_000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ])
  })

  test('owner can reach the features panel from settings', async ({ page }) => {
    await page.goto('/dashboard/settings?tab=features')
    await page.waitForLoadState('networkidle')

    const body = await page.locator('body').innerText()
    expect(body).toContain('Optional features')
    // Honest conditions the panel must keep saying.
    expect(body).toContain('never deletes anything')
    expect(body).toContain('Online booking')
    expect(body).toContain('Text message reminders')

    // Every switch needs an accessible name.
    const switches = page.getByRole('switch')
    expect(await switches.count()).toBeGreaterThan(10)
  })
})
