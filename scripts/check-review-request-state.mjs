// Read-only verification for the 2026-10-18 deployment incident
// (failed migration 20261017170000_automated_review_requests, P3009/P3018).
//
// Prints one JSON line describing the exact database state relevant to the
// incident, so scripts/vercel-build.mjs can decide — with evidence, never by
// assumption — whether the auto-repair documented in docs/MIGRATION-RECOVERY.md
// (Case B) is safe. This script NEVER writes to the database: every statement
// below is a SELECT against catalog tables plus one row count.
//
// Requires @prisma/client to be generated (the Vercel build runs
// `prisma generate` in postinstall before this can run).
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const report = {
  failedRecordCount: null,
  failedRecordName: null,
  enumValues: null,
  reviewRequestPresent: null,
  reviewRequestColumns: null,
  reviewRequestRows: null,
  laterMigrationsApplied: null,
  bookingSourceEnumPresent: null,
  reviewRequestSettingsPresent: null,
  customerEmailOptOutPresent: null,
  retentionReviewRequestsEnabledPresent: null,
  notificationReviewRequestPresent: null,
  appointmentBookingCampaignPresent: null,
  appointmentBookingSourceIsEnum: null,
  waitlistClaimedPresent: null,
  notes: [],
}

const note = (message) => report.notes.push(message)

async function safely(label, run) {
  try {
    return await run()
  } catch (error) {
    note(`${label}: ${String(error?.message || error).slice(0, 200)}`)
    return null
  }
}

try {
  const failed = await safely('failed-record query', () => db.$queryRaw`
    SELECT count(*)::int AS count, max(migration_name) AS name
    FROM _prisma_migrations
    WHERE finished_at IS NULL AND rolled_back_at IS NULL
  `)
  if (failed) {
    report.failedRecordCount = Number(failed[0]?.count)
    report.failedRecordName = failed[0]?.name ?? null
  }

  const enumRow = await safely('enum query', () => db.$queryRaw`
    SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS values
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'ReviewRequestStatus'
  `)
  report.enumValues = enumRow?.[0]?.values ?? null

  const tables = await safely('table-presence query', () => db.$queryRaw`
    SELECT
      to_regclass('public."ReviewRequest"') IS NOT NULL AS review_request,
      to_regclass('public."ReviewRequestSettings"') IS NOT NULL AS review_request_settings
  `)
  if (tables) {
    report.reviewRequestPresent = Boolean(tables[0]?.review_request)
    report.reviewRequestSettingsPresent = Boolean(tables[0]?.review_request_settings)
  }

  const columns = await safely('column query', () => db.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'ReviewRequest'
    ORDER BY ordinal_position
  `)
  if (columns) {
    report.reviewRequestColumns = columns.map((row) => row.column_name)
  }

  if (report.reviewRequestPresent) {
    const rows = await safely('row-count query', () => db.$queryRaw`
      SELECT count(*)::int AS count FROM "ReviewRequest"
    `)
    if (rows) report.reviewRequestRows = Number(rows[0]?.count)
  } else {
    report.reviewRequestRows = null
  }

  const later = await safely('later-migration query', () => db.$queryRaw`
    SELECT count(*)::int AS count FROM _prisma_migrations
    WHERE migration_name IN (
      '20261017203707_review_requests_booking_source_analytics',
      '20261017203731_review_request_notification_type',
      '20261017204003_appointment_source_and_completion',
      '20261017210000_sync_waitlist_claimed_drift'
    )
    AND finished_at IS NOT NULL
  `)
  if (later) report.laterMigrationsApplied = Number(later[0]?.count)

  const bookingSource = await safely('booking-source query', () => db.$queryRaw`
    SELECT count(*)::int AS count FROM pg_type WHERE typname = 'BookingSource'
  `)
  if (bookingSource) report.bookingSourceEnumPresent = Number(bookingSource[0]?.count) > 0

  const customerFlags = await safely('customer-column query', () => db.$queryRaw`
    SELECT
      count(*) FILTER (WHERE column_name = 'emailOptOut')::int AS email_opt_out,
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_name = 'RetentionSettings' AND column_name = 'reviewRequestsEnabled') AS review_requests_enabled
    FROM information_schema.columns
    WHERE table_name = 'Customer'
  `)
  if (customerFlags) {
    report.customerEmailOptOutPresent = Number(customerFlags[0]?.email_opt_out) > 0
    report.retentionReviewRequestsEnabledPresent = Number(customerFlags[0]?.review_requests_enabled) > 0
  }

  // Fingerprints of the four later review-request migrations, for the
  // docs/MIGRATION-RECOVERY.md Case A baseline decision.
  const notificationType = await safely('notification-type query', () => db.$queryRaw`
    SELECT count(*)::int AS count FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NotificationType' AND e.enumlabel = 'REVIEW_REQUEST'
  `)
  if (notificationType) report.notificationReviewRequestPresent = Number(notificationType[0]?.count) > 0

  const appointmentSource = await safely('appointment-source query', () => db.$queryRaw`
    SELECT
      count(*) FILTER (WHERE column_name = 'bookingCampaign')::int AS booking_campaign,
      count(*) FILTER (WHERE column_name = 'bookingSource' AND udt_name = 'BookingSource')::int AS booking_source_enum
    FROM information_schema.columns
    WHERE table_name = 'Appointment'
  `)
  if (appointmentSource) {
    report.appointmentBookingCampaignPresent = Number(appointmentSource[0]?.booking_campaign) > 0
    report.appointmentBookingSourceIsEnum = Number(appointmentSource[0]?.booking_source_enum) > 0
  }

  const waitlistClaimed = await safely('waitlist-claimed query', () => db.$queryRaw`
    SELECT count(*)::int AS count FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'WaitlistStatus' AND e.enumlabel = 'CLAIMED'
  `)
  if (waitlistClaimed) report.waitlistClaimedPresent = Number(waitlistClaimed[0]?.count) > 0
} finally {
  await db.$disconnect()
}

process.stdout.write(`${JSON.stringify(report)}\n`)
