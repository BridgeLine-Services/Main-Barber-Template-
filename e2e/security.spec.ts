import { test, expect } from '@playwright/test'

/**
 * Security E2E (Section 15: attempts to bypass frontend restrictions).
 *
 * These tests use the BROWSER to attack the API the way a malicious
 * user would: direct URL access, forged IDs, and cross-business access
 * attempts. Server-side enforcement must reject every one.
 *
 * The in-depth cross-tenant matrix (many businesses, manipulated IDs,
 * role escalation) lives in tests/cross-tenant-matrix.test.ts, which runs
 * against a live server with a seeded multi-business database.
 */

test('unauthenticated calls to dashboard APIs are rejected', async ({ request }) => {
  const endpoints = [
    { method: 'GET', url: '/api/dashboard/appointments' },
    { method: 'GET', url: '/api/dashboard/customers' },
    { method: 'GET', url: '/api/dashboard/barbers' },
    { method: 'GET', url: '/api/dashboard/business/export' },
    { method: 'GET', url: '/api/dashboard/audit-logs' },
  ]
  for (const ep of endpoints) {
    const res = await request.fetch(ep.url, { method: ep.method, maxRedirects: 0 })
    expect(
      [401, 403, 404].includes(res.status()),
      `${ep.method} ${ep.url} must reject unauthenticated access, got ${res.status()}`,
    ).toBe(true)
  }
})

test('guessed/forged IDs do not expose other records', async ({ request }) => {
  // Forged confirmation number → no data leak, no oracle beyond 404
  const forged = await request.get('/appointment/NOT-A-REAL-CONFIRMATION-12345')
  expect([404, 200]).toContain(forged.status()) // 200 allowed only if page renders a generic "not found" view
  if (forged.status() === 200) {
    const html = await forged.text()
    // The public footer legitimately shows the business contact email, so we
    // assert the not-found view renders and no OTHER email (e.g. a leaked
    // customer record) is present.
    expect(html.toLowerCase()).toMatch(/couldn.t find|not found|no appointment/)
    const emails: string[] = html.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []
    const nonPublic = emails.filter((e) => !e.endsWith('@yourbarbershop.com') && !e.endsWith('@example.com'))
    expect(nonPublic, 'forged confirmation number leaked a record email').toEqual([])
  }

  // Forged customer id on the dashboard API → rejected without a session
  const res = await request.get('/api/dashboard/customers/cleartextforgedid123')
  expect([401, 403, 404]).toContain(res.status())
})

test('dashboard pages are not reachable by direct URL without a session', async ({ page }) => {
  for (const path of ['/dashboard/customers', '/dashboard/settings', '/dashboard/media']) {
    await page.goto(path)
    await page.waitForURL(/login|dashboard\/setup/, { timeout: 20_000 }).catch(() => {
      // no redirect is acceptable ONLY if the page renders nothing sensitive
    })
    const body = await page.textContent('body')
    expect(body, `${path} leaked data without authentication`).not.toMatch(/@.*\.(com|net|org)/)
  }
})

test('customer portal endpoints require a portal session', async ({ request }) => {
  const res = await request.get('/api/public/portal/data-export')
  expect([401, 404, 429]).toContain(res.status())
  const del = await request.post('/api/public/portal/delete-account', {
    data: { confirm: 'DELETE' },
  })
  expect([401, 404, 429]).toContain(del.status())
})
