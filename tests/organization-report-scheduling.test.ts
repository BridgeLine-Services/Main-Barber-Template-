import assert from 'node:assert/strict'
import test from 'node:test'
import { DateTime } from 'luxon'
import { buildOrganizationReport } from '../src/lib/organization/reporting'
import { buildOrganizationReportEmail, nextOrganizationReportAt } from '../src/lib/organization/scheduled-report'
import { organizationReportDeliveryRetry, organizationReportIdempotencyKey } from '../src/lib/organization/report-delivery'

test('daily report scheduling follows the selected local time zone across DST', () => {
  const before = DateTime.fromObject(
    { year: 2026, month: 3, day: 7, hour: 10, minute: 0 },
    { zone: 'America/New_York' },
  ).toJSDate()
  const next = nextOrganizationReportAt('daily', 'America/New_York', before)
  assert.ok(next)
  const local = DateTime.fromJSDate(next, { zone: 'America/New_York' })
  assert.equal(local.hour, 9)
  assert.equal(local.day, 8)
})

test('weekly reports run Monday at 9 AM and monthly reports run on the first at 9 AM', () => {
  const mondayBeforeNine = DateTime.fromObject(
    { year: 2026, month: 11, day: 2, hour: 8, minute: 0 },
    { zone: 'America/Los_Angeles' },
  ).toJSDate()
  const weekly = nextOrganizationReportAt('weekly', 'America/Los_Angeles', mondayBeforeNine)
  assert.ok(weekly)
  const weeklyLocal = DateTime.fromJSDate(weekly, { zone: 'America/Los_Angeles' })
  assert.equal(weeklyLocal.weekday, 1)
  assert.equal(weeklyLocal.hour, 9)

  const firstAfterNine = new Date('2026-11-01T17:00:00.000Z')
  const monthly = nextOrganizationReportAt('monthly', 'UTC', firstAfterNine)
  assert.ok(monthly)
  const monthlyLocal = DateTime.fromJSDate(monthly, { zone: 'UTC' })
  assert.equal(monthlyLocal.day, 1)
  assert.equal(monthlyLocal.month, 12)
  assert.equal(monthlyLocal.hour, 9)
})

test('invalid time zones do not create an executable schedule', () => {
  assert.equal(nextOrganizationReportAt('weekly', 'Not/A-Timezone', new Date()), null)
})

test('transient report email failures retry with bounded delays and permanent errors stop', () => {
  const now = Date.UTC(2026, 10, 25, 12)
  const retry = organizationReportDeliveryRetry(1, { responseCode: 421 }, now)
  assert.equal(retry.retryAt?.getTime(), now + 60_000)
  assert.match(retry.message, /another attempt is scheduled/i)

  const finalAttempt = organizationReportDeliveryRetry(4, { code: 'ETIMEDOUT' }, now)
  assert.equal(finalAttempt.retryAt, null)
  assert.match(finalAttempt.message, /several attempts/i)

  const permanent = organizationReportDeliveryRetry(1, { responseCode: 550 }, now)
  assert.equal(permanent.retryAt, null)
})

test('scheduled report idempotency keys are stable per occurrence', () => {
  const occurrence = new Date('2026-11-25T09:00:00.000Z')
  const key = organizationReportIdempotencyKey('config-1', occurrence)
  assert.equal(organizationReportIdempotencyKey('config-1', occurrence), key)
  assert.notEqual(organizationReportIdempotencyKey('config-1', new Date(occurrence.getTime() + 60_000)), key)
})

test('scheduled report email contains organization totals, not location or customer identities', () => {
  const report = buildOrganizationReport(
    'private-organization-id',
    [{
      businessId: 'private-location-id',
      name: 'Private Shop Name',
      region: 'North',
      status: 'active',
      grossRevenueCents: 12500,
      refundsCents: 500,
      netRevenueCents: 12000,
      commissionsCents: 4000,
      recordedExpensesCents: null,
      appointments: 12,
      completed: 10,
      cancelled: 2,
      newCustomers: 5,
      returningCustomers: 4,
      activeMemberships: 6,
      membershipRevenueCents: null,
      utilisationPercent: 60,
      staffCount: 3,
    }],
    { generatedAt: '2026-11-25T09:00:00.000Z', rangeLabel: 'the last 7 days' },
  )
  const email = buildOrganizationReportEmail(report)

  assert.match(email, /organization business summary/i)
  assert.match(email, /Net revenue: \$120\.00/)
  assert.doesNotMatch(email, /private-organization-id|private-location-id|Private Shop Name/)
  assert.match(email, /No customer names, contact details, appointment histories/i)
})
