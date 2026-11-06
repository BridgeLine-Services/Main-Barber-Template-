import { test, expect } from '@playwright/test'

/**
 * Responsive coverage at the widths real people use.
 *
 * A barbershop owner runs the dashboard from a phone behind the chair, and
 * customers book from a phone too. The unit suites and the desktop smoke run
 * cannot see a page that is wider than the screen, so this measures the actual
 * rendered width against the viewport at phone (390x844) and tablet (768x1024)
 * sizes, and fails if the page scrolls sideways.
 *
 * Threshold is 2px: sub-pixel rounding in flex layouts is not a defect, a
 * 40px-wide table hanging off the edge is.
 */

const ownerEmail = process.env.E2E_OWNER_EMAIL
const ownerPassword = process.env.E2E_OWNER_PASSWORD

const OVERFLOW_TOLERANCE = 2

const ownerRoutes = [
  '/dashboard',
  '/dashboard/appointments',
  '/dashboard/calendar',
  '/dashboard/customers',
  '/dashboard/services',
  '/dashboard/barbers',
  '/dashboard/analytics',
  '/dashboard/settings?tab=branding',
]

const publicRoutes = ['/', '/barbers', '/gallery', '/book']

const viewports = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
]

async function horizontalOverflow(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    }
  })
}

test.describe('responsive layout', () => {
  for (const viewport of viewports) {
    for (const route of publicRoutes) {
      test(`${viewport.name} ${route} fits the screen`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        const response = await page.goto(route)
        expect(response?.status(), `${route} should not error`).toBeLessThan(400)
        await page.waitForLoadState('networkidle')

        const { scrollWidth, clientWidth } = await horizontalOverflow(page)
        expect(
          scrollWidth,
          `${route} at ${viewport.width}px is ${scrollWidth - clientWidth}px wider than the screen`
        ).toBeLessThanOrEqual(clientWidth + OVERFLOW_TOLERANCE)
      })
    }
  }

  test.describe('dashboard', () => {
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

    for (const viewport of viewports) {
      for (const route of ownerRoutes) {
        test(`${viewport.name} ${route} fits the screen`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
          const response = await page.goto(route)
          expect(response?.status(), `${route} should not error`).toBeLessThan(400)
          await page.waitForLoadState('networkidle')

          const { scrollWidth, clientWidth } = await horizontalOverflow(page)
          expect(
            scrollWidth,
            `${route} at ${viewport.width}px is ${scrollWidth - clientWidth}px wider than the screen`
          ).toBeLessThanOrEqual(clientWidth + OVERFLOW_TOLERANCE)

          // Primary action must stay reachable one-thumb, not pushed off-screen.
          const main = page.locator('main, [role="main"]').first()
          if (await main.count()) {
            const box = await main.boundingBox()
            expect(box?.width ?? 0).toBeLessThanOrEqual(viewport.width + OVERFLOW_TOLERANCE)
          }
        })
      }
    }
  })
})
