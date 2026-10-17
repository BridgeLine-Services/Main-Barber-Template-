-- ─────────────────────────────────────────────────────────────────────────────
-- CORRECTIVE MIGRATION — 2026-10-17 migration-conflict repair (root cause P3018)
--
-- `20261017170000_automated_review_requests` already added `"completedAt"`
-- TIMESTAMP(3) and `"bookingSource"` (as TEXT) to `"Appointment"` in every
-- history path, so this migration must NOT re-add those columns (duplicate
-- column errors). It must also CONVERT `bookingSource` from the prototype TEXT
-- column to the canonical `BookingSource` enum type.
--
-- Method notes:
--   * DROP + ADD is used instead of ALTER COLUMN TYPE so the table is not
--     rewritten and the GiST exclusion constraint is not rebuilt.
--   * Data safety: the TEXT column was created by 20261017170000 and was never
--     exposed by a successful deployment (the Vercel build runs migrations
--     before `next build`, and no build succeeded while this prototype was in
--     the applied state), so it cannot hold values on any reachable database.
--     NULL is the documented, intended value for pre-attribution history
--     ("null = pre-§8 history; reported as UNKNOWN, never fabricated").
--   * `completedAt` already exists with the identical TIMESTAMP(3) type and is
--     intentionally left untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "bookingCampaign" TEXT;
ALTER TABLE "Appointment" DROP COLUMN "bookingSource";
ALTER TABLE "Appointment" ADD COLUMN "bookingSource" "BookingSource";
