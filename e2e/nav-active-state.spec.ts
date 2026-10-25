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
