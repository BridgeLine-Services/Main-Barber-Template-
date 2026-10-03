import { test, expect } from '@playwright/test'

/**
 * STAFF INVITATION LIFECYCLE E2E (browser flow).
 *
 * Covers the full invitation-to-first-login workflow: an authorized owner
 * invites a staff member through the dashboard UI, the invitee opens the
 * invitation link and accepts it, and the invitee signs in through the shared
 * /login page and reaches the management dashboard. Plus the existing-account
 * linking flow: a public customer account accepts a staff invitation by
 * authenticating.
 *
 * Test email mechanism: SMTP is not configured in the test environment, so
 * the invite link is read back from the dashboard UI (the API response
 * includes it as a backup for exactly this case). No real email is sent.
 */

const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL || 'owner@e2e.local'
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'E2eOwner!Passw0rd'
const INVITEE_PASSWORD = 'E2eInvitee!Pass1'

test('owner invites a barber; invitee accepts and signs in via /login to the dashboard', async ({ page }) => {
  const email = `e2e-invite-${Date.now()}@example.com`

  // 1. Owner signs in through the shared /login page
  await page.goto('/login')
  await page.getByPlaceholder('you@example.com').fill(OWNER_EMAIL)
  await page.getByPlaceholder('••••••••').fill(OWNER_PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.waitForURL(/dashboard/, { timeout: 30_000 })

  // 2. Owner invites a barber through the staff management UI
  await page.goto('/dashboard/staff')
  await page.getByRole('button', { name: /invite staff/i }).click()
  await page.getByPlaceholder('John Doe').fill('Invited Barber')
  await page.getByPlaceholder('john@barbershop.com').fill(email)
  await page.getByRole('button', { name: /send invite/i }).click()

  // 3. The invitation link is displayed to the owner (backup delivery)
  const linkText = page.getByText(/accept-invitation\?token=/)
  await expect(linkText).toBeVisible({ timeout: 20_000 })
  const inviteUrl = await linkText.textContent()
  expect(inviteUrl).toContain('/accept-invitation?token=')

  // End the owner session so the invitee opens the link as a fresh visitor
  await page.context().clearCookies()

  // 4. Invitee opens the acceptance link as a fresh visitor
  await page.goto(inviteUrl!)
  await expect(page.getByText(/you.?re invited/i)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(email)).toBeVisible()
  await expect(page.getByText(/barber/i).first()).toBeVisible()

  // 5. Invitee accepts and sets their own password
  await page.locator('#password').fill(INVITEE_PASSWORD)
  await page.locator('#confirm').fill(INVITEE_PASSWORD)
  await page.getByRole('button', { name: /accept invitation/i }).click()

  // 6. Auto-login after acceptance routes staff to the management dashboard
  await page.waitForURL(/dashboard/, { timeout: 30_000 })

  // 7. Fresh sign-in through the shared /login page reaches the dashboard
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(INVITEE_PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.waitForURL(/dashboard/, { timeout: 30_000 })
  await expect(page.locator('body')).not.toContainText(/invalid credentials/i)
})

test('an existing customer account accepts a staff invitation by authenticating (secure linking)', async ({ page }) => {
  const email = `e2e-link-${Date.now()}@example.com`

  // 1. Public signup creates a CUSTOMER account
  await page.goto('/login')
  await page.getByRole('button', { name: /don.t have an account\?/i }).click()
  await page.locator('#name').fill('Future Staff')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill('E2eCustomer!Pass1')
  await page.getByRole('button', { name: 'Sign-Up', exact: true }).click()
  await page.waitForURL(/portal/, { timeout: 30_000 })
  await page.context().clearCookies()

  // 2. Owner signs in and invites that existing account
  await page.goto('/login')
  await page.getByPlaceholder('you@example.com').fill(OWNER_EMAIL)
  await page.getByPlaceholder('••••••••').fill(OWNER_PASSWORD)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.waitForURL(/dashboard/, { timeout: 30_000 })
  await page.goto('/dashboard/staff')
  await page.getByRole('button', { name: /invite staff/i }).click()
  await page.getByPlaceholder('John Doe').fill('Future Staff')
  await page.getByPlaceholder('john@barbershop.com').fill(email)
  await page.getByRole('button', { name: /send invite/i }).click()
  const linkText = page.getByText(/accept-invitation\?token=/)
  await expect(linkText).toBeVisible({ timeout: 20_000 })
  const inviteUrl = await linkText.textContent()
  await page.context().clearCookies()

  // 3. Invitee opens the link — the UI detects the existing account and
  //    offers the authenticate-to-link flow instead of account creation
  await page.goto(inviteUrl!)
  await expect(page.getByText(/already have an account/i)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(email)).toBeVisible()

  // 4. Wrong password is refused (no silent acceptance)
  await page.locator('#link-password').fill('WrongPassword!9')
  await page.getByRole('button', { name: /login & accept/i }).click()
  await expect(page.getByText(/didn.t match/i)).toBeVisible({ timeout: 20_000 })

  // 5. Correct password links the account and routes to the dashboard
  await page.locator('#link-password').fill('E2eCustomer!Pass1')
  await page.getByRole('button', { name: /login & accept/i }).click()
  await page.waitForURL(/dashboard/, { timeout: 30_000 })
})
