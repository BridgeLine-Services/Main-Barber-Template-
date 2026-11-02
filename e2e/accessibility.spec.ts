import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Accessibility E2E (Section 14 / WCAG 2.1 AA verification).
 *
 * Automated axe checks on the surfaces customers and staff actually use:
 * home page, booking wizard, services page, and the staff login page.
 * Automated scanning is necessary but not sufficient — keyboard traps,
 * screen-reader announcements, and reduced-motion behavior still require
 * the manual checklist in docs/TESTING.md.
 */

const pagesToScan = [
  { name: 'Home (public visitor)', url: '/' },
  { name: 'Booking wizard', url: '/book' },
  { name: 'Services', url: '/services' },
  { name: 'Staff login', url: '/login' },
]

for (const pageToScan of pagesToScan) {
  test(`axe: no WCAG A/AA violations on ${pageToScan.name} (${pageToScan.url})`, async ({ page }) => {
    const response = await page.goto(pageToScan.url)
    test.skip(response === null, `${pageToScan.url} did not load — is the app running with a seeded database?`)
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length })),
    ).toEqual([])
  })
}

test('keyboard: booking page is fully focusable via keyboard only', async ({ page }) => {
  await page.goto('/book')
  await page.waitForLoadState('domcontentloaded')
  // Tab through: focus must land on real focusable elements, never vanish.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    const active = await page.evaluate(() => document.activeElement?.tagName)
    expect(active).toBeTruthy()
    expect(['BODY', 'HTML']).not.toContain(active)
  }
})

/**
 * Authenticated dashboard surfaces.
 *
 * The scans above cover what a visitor sees. The owner's workspace was never
 * scanned, which is where colour-coded status, icon-only buttons and dense
 * tables live — exactly the places contrast and labelling failures hide.
 * Runs only when the owner fixture is available (CI provides it).
 */
const ownerEmail = process.env.E2E_OWNER_EMAIL
const ownerPassword = process.env.E2E_OWNER_PASSWORD

const dashboardPages = [
  { name: 'Dashboard home', url: '/dashboard' },
  { name: 'Settings — Security (2FA)', url: '/dashboard/settings?tab=security' },
  { name: 'Settings — Branding & Theme', url: '/dashboard/settings?tab=branding' },
]

test.describe('authenticated dashboard', () => {
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

  for (const target of dashboardPages) {
    test(`axe: no WCAG A/AA violations on ${target.name} (${target.url})`, async ({ page }) => {
      const response = await page.goto(target.url)
      test.skip(response === null, `${target.url} did not load`)
      await page.waitForLoadState('networkidle')

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      expect(
        results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length })),
      ).toEqual([])
    })
  }
})
