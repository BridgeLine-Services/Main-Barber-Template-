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
//
// The technical tokens are matched as whole words. A bare /NaN/i matches the word
// "Maintenance", because mainte-NAN-ce contains it, and that turned three healthy
// dashboard pages red: the dashboard shows a Maintenance card, and the audit log and
// security settings show the Maintenance group in the navigation. A leak detector that
// fires on an ordinary English word is a broken detector, not a finding.
const errorSignatures = new RegExp([
  'application error',
  'something went wrong',
  'cannot read propert',
  'is not a function',
  '\\bprisma\\b',
  'ECONNREFUSED',
  '\\[object Object\\]',
  '\\bNaN\\b',
].join('|'), 'i')

/** Cookies captured once, then handed to each test's context. */
let sessionCookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>['cookies'] = []

test.describe('dashboard smoke', () => {
  test.skip(!ownerEmail || !ownerPassword, 'E2E_OWNER_EMAIL/PASSWORD not provided')

  // Sign in once for the whole file instead of once per route. Seventeen logins in a
  // row is a burst through the authentication rate limiter, and it was both slow and
  // the most likely source of intermittent failures on a loaded CI runner. The session
  // is real either way: same credentials, same cookie, same guard.
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
    await page.fill('input[type="email"]', ownerEmail!)
    await page.fill('input[type="password"]', ownerPassword!)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 })
    expect(page.url(), 'the owner must land on the dashboard after signing in').toMatch(/\/dashboard/)
    sessionCookies = (await context.storageState()).cookies
    await context.close()
  })

  test.beforeEach(async ({ context }) => {
    if (sessionCookies.length === 0) throw new Error('the owner session was not captured')
    await context.addCookies(sessionCookies)
  })

  for (const route of routes) {
    test(`${route} renders for the owner`, async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('pageerror', (error) => consoleErrors.push(String(error)))

      const response = await page.goto(route)
      // A session that silently failed to establish sends every route to /login, where
      // the assertions below would all pass on the login page itself. That is how a
      // smoke test goes green while nothing behind the door is being checked.
      expect(page.url(), `${route} must be reached signed in, not bounced to login`).not.toMatch(/\/login/)
      expect(response?.status(), `${route} should not error`).toBeLessThan(400)
      await page.waitForLoadState('networkidle')

      const body = (await page.locator('body').innerText()).trim()
      expect(body.length, `${route} rendered nothing`).toBeGreaterThan(20)
      expect(body).not.toMatch(errorSignatures)
      expect(consoleErrors, `${route} threw in the browser`).toEqual([])
    })
  }

  test('the header shows a human role label, never an internal identifier', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    // The role is rendered in the navigation panel, not in a <header>. The original
    // locator waited for an element this layout does not have, which is a test defect,
    // not a product defect: the assertion below is the one that matters.
    const panel = page.getByRole('complementary').first()
    const text = await panel.innerText()
    // The badge used to print userRole.toLowerCase(), so an owner saw "owner" and a
    // co-owner saw "business_admin". Either is a leak of an internal identifier.
    // Lowercase identifiers (what userRole.toLowerCase() produced) and shouting
    // uppercase tokens are both leaks; the business name may legitimately contain
    // the word "Barber", so the check is case- and token-specific.
    expect(text).not.toMatch(/business_admin|platform_owner/)
    expect(text).not.toMatch(/\b(BARBER|OWNER|BUSINESS_ADMIN|PLATFORM_OWNER|CUSTOMER)\b/)
    expect(text).toMatch(/Owner|Co-owner|Barber|Platform Owner/)
  })
})
