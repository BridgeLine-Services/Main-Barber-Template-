-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('WEBSITE', 'GOOGLE', 'INSTAGRAM', 'FACEBOOK', 'DIRECT', 'REFERRAL', 'UNKNOWN');

-- CreateEnum
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
