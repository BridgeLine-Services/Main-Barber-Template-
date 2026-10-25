import { test, expect } from '@playwright/test'

/**
 * Navigation regression: mutually exclusive active states for routes that
 * share a URL prefix (Online Shop /dashboard/ecommerce vs Shop Orders
 * /dashboard/ecommerce/orders), plus the Branding → Dashboard Preview and
 * System → Deactivate destinations.
 *
 * The sidebar marks the active destination with aria-current="page" on the
 * nav link; a parent item that is the URL-prefix of another item must match
 * EXACTLY so visiting the child never double-highlights the parent.
 */

const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL || 'owner@e2e.local'
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'E2eOwner!Passw0rd'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('you@example.com').fill(OWNER_EMAIL)
  await page.getByPlaceholder('••••••••').fill(OWNER_PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.waitForURL(/dashboard/, { timeout: 30_000 })
})


/** Expand a collapsible sidebar section or group (idempotent). */
const expand = async (
  page: import('@playwright/test').Page,
  headerName: RegExp,
) => {
  const header = page.locator('aside nav').getByRole('button', { name: headerName })
  if ((await header.getAttribute('aria-expanded')) !== 'true') {
    await header.click()
  }
}

/** Sidebar links matching the given accessible name. */
const navLink = (page: import('@playwright/test').Page, name: string) =>
  page.locator('aside nav').getByRole('link', { name, exact: true })

test('ecommerce parent route highlights Online Shop only', async ({ page }) => {
  await page.goto('/dashboard/ecommerce')
  await expect(navLink(page, 'Online Shop')).toHaveAttribute('aria-current', 'page')
  await expect(navLink(page, 'Shop Orders')).not.toHaveAttribute('aria-current', 'page')
})

test('ecommerce/orders highlights Shop Orders only, survives reload', async ({ page }) => {
  await page.goto('/dashboard/ecommerce/orders')
  await expect(navLink(page, 'Shop Orders')).toHaveAttribute('aria-current', 'page')
  await expect(navLink(page, 'Online Shop')).not.toHaveAttribute('aria-current', 'page')

  await page.reload()
  await expect(navLink(page, 'Shop Orders')).toHaveAttribute('aria-current', 'page')
  await expect(navLink(page, 'Online Shop')).not.toHaveAttribute('aria-current', 'page')
})

test('browser back and forward keep the active state correct', async ({ page }) => {
  await page.goto('/dashboard/ecommerce')
  await expect(navLink(page, 'Online Shop')).toHaveAttribute('aria-current', 'page')

  await navLink(page, 'Shop Orders').click()
  await page.waitForURL(/ecommerce\/orders/)
  await expect(navLink(page, 'Shop Orders')).toHaveAttribute('aria-current', 'page')
  await expect(navLink(page, 'Online Shop')).not.toHaveAttribute('aria-current', 'page')

  await page.goBack()
  await page.waitForURL(/\/dashboard\/ecommerce$/)
  await expect(navLink(page, 'Online Shop')).toHaveAttribute('aria-current', 'page')
  await expect(navLink(page, 'Shop Orders')).not.toHaveAttribute('aria-current', 'page')
})

test('Branding group exposes Dashboard Preview and it opens the settings tab', async ({ page }) => {
  await expand(page, /website section/i)
  await expand(page, /branding section/i)
  const link = navLink(page, 'Dashboard Preview')
  await expect(link).toBeVisible()
  await link.click()
  await page.waitForURL(/dashboard\/settings\?tab=dashboard-preview/)
  await expect(navLink(page, 'Dashboard Preview')).toHaveAttribute('aria-current', 'page')
})

test('Branding & Theme consolidates typography and website design; legacy tab URLs normalize', async ({ page }) => {
  await expand(page, /website section/i)
  await expand(page, /branding section/i)
  // No separate Website Appearance / Typography destinations remain
  await expect(navLink(page, 'Website Appearance')).toHaveCount(0)
  await expect(navLink(page, 'Typography')).toHaveCount(0)

  const link = navLink(page, 'Branding & Theme')
  await link.click()
  await page.waitForURL(/dashboard\/settings\?tab=branding/)

  // The merged page contains the integrated Typography and Website Design
  // (appearance + real-site preview) sections.
  await expect(page.locator('main')).toContainText('Typography', { timeout: 15_000 })
  await expect(page.locator('main')).toContainText('Website')

  // Legacy bookmark URLs normalize to the consolidated page
  for (const legacy of ['appearance', 'typography']) {
    await page.goto(`/dashboard/settings?tab=${legacy}`)
    await page.waitForURL(/dashboard\/settings\?tab=branding/)
    await expect(navLink(page, 'Branding & Theme')).toHaveAttribute('aria-current', 'page')
  }
})

test('System group exposes Deactivate pointing at the existing danger-zone flow', async ({ page }) => {
  await expand(page, /system section/i)
  const link = navLink(page, 'Deactivate')
  await expect(link).toBeVisible()
  await link.click()
  await page.waitForURL(/dashboard\/settings\?tab=danger-zone/)
  await expect(navLink(page, 'Deactivate')).toHaveAttribute('aria-current', 'page')
  // The guarded management UI itself renders (no deactivation occurs by
  // merely visiting it).
  await expect(page.locator('main')).toContainText(/danger zone/i, { timeout: 15_000 })
})

/**
 * Barber sidebar organization (Overview + System with the two personal
 * groups). Runs when barber credentials are supplied; skipped otherwise so
 * CI stays honest rather than reporting an unrun check as passing.
 */
const BARBER_EMAIL = process.env.E2E_BARBER_EMAIL
const BARBER_PASSWORD = process.env.E2E_BARBER_PASSWORD

test.describe('barber navigation', () => {
  test.skip(!BARBER_EMAIL || !BARBER_PASSWORD, 'E2E_BARBER_EMAIL/PASSWORD not provided')

  test('barber sees the shared Overview/System hierarchy without owner-only items', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('you@example.com').fill(BARBER_EMAIL!)
    await page.getByPlaceholder('••••••••').fill(BARBER_PASSWORD!)
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await page.waitForURL(/dashboard/, { timeout: 30000 })

    const nav = page.locator('aside nav')
    await expect(nav.getByRole('button', { name: /overview section/i })).toHaveCount(1)
    await expect(nav.getByRole('button', { name: /system section/i })).toHaveCount(1)
    await expect(nav.getByRole('button', { name: /website section/i })).toHaveCount(0)

    const expand = async (label: RegExp) => {
      const header = nav.getByRole('button', { name: label })
      if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
    }
    await expand(/^system section/i)
    await expand(/^My Profile and Schedule section/i)
    await expand(/^My Work and Pay section/i)

    const hrefs = await nav.getByRole('link').evaluateAll((els) =>
      els.map((e) => e.getAttribute('href')),
    )
    for (const href of [
      '/barber-mode', '/dashboard', '/dashboard/calendar', '/dashboard/appointments',
      '/dashboard/profile', '/dashboard/schedule', '/dashboard/closures',
      '/dashboard/services', '/dashboard/portfolio', '/dashboard/my-commissions',
      '/dashboard/my-time-clock', '/dashboard/my-payroll',
    ]) {
      expect(hrefs).toContain(href)
    }
    for (const ownerOnly of [
      '/dashboard/settings', '/dashboard/staff', '/dashboard/payroll',
      '/dashboard/commissions', '/dashboard/factory-launch', '/dashboard/ecommerce',
      '/dashboard/gift-cards', '/dashboard/analytics', '/dashboard/inventory',
    ]) {
      expect(hrefs).not.toContain(ownerOnly)
    }

    await page.goto('/dashboard/my-commissions')
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1)
    await expect(nav.locator('a[aria-current="page"]')).toContainText('My Commissions')
  })
})
