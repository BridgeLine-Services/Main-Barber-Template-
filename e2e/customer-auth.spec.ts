import { test, expect } from '@playwright/test'

/**
 * Customer authentication E2E (shared Login / Sign-Up entry point).
 *
 * Covers the customer halves of the unified auth contract:
 *   B — public Sign-Up through /register creates a CUSTOMER, auto-signs-in,
 *        and the server role router lands the session on /portal.
 *   C — an existing customer signs in through /login and reaches /portal
 *        (never /dashboard).
 *   D — with a signed-in customer session, direct-URL /dashboard access and
 *        direct /api/dashboard/* calls are denied server-side.
 *
 * Uses a unique email per run so tests are isolated and re-runnable.
 */

const PASSWORD = 'E2eCustomer!123' // satisfies passwordPolicySchema (10+, upper/lower/digit)

test('customer can sign up from the public entry point and lands on /portal', async ({ page }) => {
  const email = `e2e-signup-${Date.now()}@example.com`

  await page.goto('/register')
  await page.locator('#name').fill('E2E Signup')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(PASSWORD)
  await page.locator('#confirmPassword').fill(PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()

  // Auto-login → /auth/redirect → server router sends CUSTOMER to /portal
  await page.waitForURL(/\/portal/, { timeout: 30_000 })

  // The fresh customer sees the customer-portal surface (empty state), not
  // the management portal
  await expect(page.getByText(/welcome|no upcoming appointments/i).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('link', { name: /book now|book an appointment/i }).first()).toBeVisible({ timeout: 10_000 })
})

test('existing customer can sign in and is routed to /portal', async ({ page }) => {
  const email = `e2e-existing-${Date.now()}@example.com`

  // Create the "existing" account through the public API first
  const res = await page.request.post('/api/auth/register', {
    data: { name: 'E2E Existing', email, password: PASSWORD },
  })
  expect(res.ok()).toBeTruthy()

  await page.goto('/login')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(PASSWORD)
  await page.getByRole('button', { name: /sign in|log in/i }).click()

  // Server role router: CUSTOMER → /portal (never /dashboard)
  await page.waitForURL(/\/portal/, { timeout: 30_000 })
})

test('signed-in customer is denied management pages and APIs', async ({ page }) => {
  const email = `e2e-lockout-${Date.now()}@example.com`
  await page.request.post('/api/auth/register', {
    data: { name: 'E2E Lockout', email, password: PASSWORD },
  })

  await page.goto('/login')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(PASSWORD)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/portal/, { timeout: 30_000 })

  // Direct URL to the management portal → server gate redirects to /portal
  await page.goto('/dashboard')
  await page.waitForURL(/\/portal/, { timeout: 20_000 })

  // Nested management route → same server-side rejection
  await page.goto('/dashboard/appointments')
  await page.waitForURL(/\/portal/, { timeout: 20_000 })

  // Direct API call with the authenticated customer session → denied,
  // and never returns management data
  const api = await page.request.get('/api/dashboard/appointments')
  expect([401, 403]).toContain(api.status())
  const body = await api.text()
  expect(body).not.toContain('"businessId"')
  expect(body).not.toContain('"revenue"')

  const analytics = await page.request.get('/api/dashboard/analytics')
  expect([401, 403]).toContain(analytics.status())
})
