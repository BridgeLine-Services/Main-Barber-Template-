import { test, expect } from '@playwright/test'

/**
 * Public visitor booking E2E (Section 15: real customer booking workflow).
 *
 * Walks the complete guest booking wizard:
 *   visit website → select service → select barber → select date →
 *   select time → enter customer information → review → confirm →
 *   view confirmation
 *
 * Requires a running app with a seeded business (npm run db:setup && db:seed).
 */

test('guest can complete a full booking and see a confirmation', async ({ page }) => {
  // 1. Arrive on the public website
  await page.goto('/')
  await expect(page).toHaveTitle(/.+/) // business name rendered via SEO metadata

  // 2. Open the booking wizard
  await page.goto('/book')
  await expect(page.getByRole('heading', { name: /select a service/i })).toBeVisible()

  // 3. Select the first service card
  const serviceCard = page.locator('[role="button"]').filter({ has: page.locator('h3') }).first()
  await serviceCard.click()
  await expect(page.getByRole('heading', { name: /select a barber/i })).toBeVisible()

  // 4. Choose "First Available"
  await page
    .locator('[role="button"]')
    .filter({ hasText: /first available/i })
    .first()
    .click()

  // 5. "First Available" resolves the earliest concrete slot and can skip the
  //    date/time steps entirely when that slot is unambiguous. Only pick a
  //    date/time manually if the wizard actually shows them.
  const detailsVisible = page.getByRole('heading', { name: /your details/i })
  const dateHeading = page.getByRole('heading', { name: /select a date|choose a date|pick a date/i })
  const skippedToDetails = await detailsVisible.isVisible().catch(() => false)

  if (!skippedToDetails) {
    // Wait for either outcome: auto-advance to details, or a date picker
    await Promise.race([
      detailsVisible.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {}),
      dateHeading.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {}),
    ])

    if (await detailsVisible.isVisible().catch(() => false)) {
      // Wizard auto-advanced with an earliest slot — nothing to pick
    } else if (await dateHeading.isVisible().catch(() => false)) {
      const dateButton = page.getByRole('button', { name: /has available slots/i }).first()
      await dateButton.waitFor({ state: 'visible', timeout: 20_000 })
      await dateButton.click()

      const timeButton = page.locator('button:enabled').filter({ hasText: /am|pm/i }).first()
      await timeButton.waitFor({ state: 'visible', timeout: 20_000 })
      await timeButton.click()
    } else {
      // Fallback: click the first enabled date-looking button
      const dateButton = page.locator('button:enabled').filter({ hasText: /\d/ }).first()
      await dateButton.waitFor({ state: 'visible', timeout: 20_000 })
      await dateButton.click()
      const timeButton = page.locator('button:enabled').filter({ hasText: /am|pm/i }).first()
      await timeButton.waitFor({ state: 'visible', timeout: 20_000 })
      await timeButton.click()
    }
  }

  // 6. Enter customer information (guest booking — no account required)
  await expect(page.getByRole('heading', { name: /your details/i })).toBeVisible()
  await page.getByPlaceholder('John', { exact: true }).fill('E2E')
  await page.getByPlaceholder('Doe', { exact: true }).fill('Tester')
  await page.getByPlaceholder('john.doe@example.com').fill(`e2e-${Date.now()}@example.com`)
  await page.getByPlaceholder('(555) 000-0000').fill('(555) 555-0100')
  await page.getByRole('button', { name: /continue|next/i }).first().click()

  // 7. Review & confirm — acknowledge booking policies first (required by the app)
  await expect(page.getByRole('heading', { name: /review & confirm/i })).toBeVisible()
  const policyCheckbox = page.getByRole('checkbox')
  if (await policyCheckbox.count()) {
    await policyCheckbox.first().check()
  }
  await page.getByRole('button', { name: /confirm appointment/i }).click()

  // 8. Confirmation page with a confirmation number
  await expect(page.getByText(/confirmation/i).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('body')).toContainText(/E2E|booked|appointment/i)
})
