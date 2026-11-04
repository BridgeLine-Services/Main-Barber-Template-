import { test, expect } from '@playwright/test'

/**
 * Dashboard smoke coverage.
 *
 * Every dashboard page is a server component feeding a client view. A bad query,
 * a missing guard or a rename shows up as a blank screen or a raw error string,
 * neither of which the unit suites catch. This walks the real navigation as an
 * owner and asserts each page actually renders something a person can read.
 *
 * It is deliberately shallow: presence, not content. Empty-state wording is
 * covered by the list view components themselves.
 */

const ownerEmail = process.env.E2E_OWNER_EMAIL
const ownerPassword = process.env.E2E_OWNER_PASSWORD

const routes = [
  '/dashboard',
  '/dashboard/appointments',
  '/dashboard/calendar',
  '/dashboard/customers',
  '/dashboard/services',
  '/dashboard/barbers',
  '/dashboard/reviews',
  '/dashboard/marketing',
  '/dashboard/ecommerce',
  '/dashboard/gift-cards',
  '/dashboard/inventory',
  '/dashboard/loyalty',
  '/dashboard/closures',
  '/dashboard/audit-log',
  '/dashboard/settings?tab=security',
  '/dashboard/settings?tab=branding',
]

// What a leaked exception looks like in the DOM.
const errorSignatures = /application error|something went wrong|cannot read propert|is not a function|prisma|ECONNREFUSED|\[object Object\]|NaN/i

test.describe('dashboard smoke', () => {
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

  for (const route of routes) {
    test(`${route} renders for the owner`, async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('pageerror', (error) => consoleErrors.push(String(error)))

      const response = await page.goto(route)
      expect(response?.status(), `${route} should not error`).toBeLessThan(400)
      await page.waitForLoadState('networkidle')

      const body = (await page.locator('body').innerText()).trim()
      expect(body.length, `${route} rendered nothing`).toBeGreaterThan(20)
      expect(body).not.toMatch(errorSignatures)
      expect(consoleErrors, `${route} threw in the browser`).toEqual([])
    })
  }
})
