-- ─────────────────────────────────────────────────────────────────────────────
-- CORRECTIVE MIGRATION — 2026-10-17 migration-conflict repair (root cause P3018)
--
-- The superseded prototype migration `20261017170000_automated_review_requests`
-- creates `ReviewRequestStatus` (PENDING|SENT|CLICKED|COMPLETED|FAILED) and a
-- `ReviewRequest` table with a channel/destination/token shape. Because that
-- migration runs earlier in every history path and has already been APPLIED to
-- databases that attempted deployment on 2026-10-17 (it may not be rewritten —
-- rewriting it would invalidate the applied checksums on those databases), this
-- migration must CONVERT that prototype into the canonical implementation.
--
-- Data safety:
--   * The prototype `ReviewRequest` table cannot hold data on any reachable
--     database: it was created by 20261017170000, and no application build or
--     deployment ever succeeded while that migration was in the applied state
--     (this migration failed everywhere it was attempted, and the Vercel build
--     runs `prisma migrate deploy` before `next build`).
--   * Pre-existing business, appointment, and customer data is untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- Remove the superseded prototype objects (created by 20261017170000)
DROP TABLE "ReviewRequest";
DROP TYPE "ReviewRequestStatus";

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('WEBSITE', 'GOOGLE', 'INSTAGRAM', 'FACEBOOK', 'DIRECT', 'REFERRAL', 'UNKNOWN');

-- CreateEnum (canonical)
CREATE TYPE "ReviewRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SUPPRESSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "emailOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ReviewRequestSettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "destinationUrl" TEXT,
    "delayHours" INTEGER NOT NULL DEFAULT 24,
    "emailSubject" TEXT,
    "messageTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRequestSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "customerId" TEXT,
    "destinationUrl" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ReviewRequestStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "failureCategory" TEXT,
    "failureDetail" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequestSettings_businessId_key" ON "ReviewRequestSettings"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_appointmentId_key" ON "ReviewRequest"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_idempotencyKey_key" ON "ReviewRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ReviewRequest_businessId_status_idx" ON "ReviewRequest"("businessId", "status");

-- CreateIndex
CREATE INDEX "ReviewRequest_businessId_createdAt_idx" ON "ReviewRequest"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewRequest_status_scheduledFor_idx" ON "ReviewRequest"("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "ReviewRequestSettings" ADD CONSTRAINT "ReviewRequestSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
