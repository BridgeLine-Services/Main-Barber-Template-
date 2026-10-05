-- CreateEnum
CREATE TYPE "CommissionRateType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "CommissionSource" AS ENUM ('SERVICE', 'PRODUCT', 'TIP');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "TipsCommissionMode" AS ENUM ('EXCLUDED', 'PASS_THROUGH', 'PERCENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_ENABLED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_DISABLED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_RATE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_MANUAL_ADJUSTMENT';
ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_REFUND_ADJUSTED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_PAYOUT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_ENTRY_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_PARTICIPATION_CHANGED';

-- CreateTable
CREATE TABLE "CommissionSettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "barberSelfViewEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultRateType" "CommissionRateType" NOT NULL DEFAULT 'PERCENT',
    "defaultRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "defaultRateFixed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "productCommissionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "productRateType" "CommissionRateType" NOT NULL DEFAULT 'PERCENT',
    "productRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "productRateFixed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tipsMode" "TipsCommissionMode" NOT NULL DEFAULT 'EXCLUDED',
    "tipsCommissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "includeNoShowFees" BOOLEAN NOT NULL DEFAULT false,
    "calculateOnUnpaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "barberId" TEXT,
    "serviceId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "rateType" "CommissionRateType" NOT NULL DEFAULT 'PERCENT',
    "ratePercent" DOUBLE PRECISION,
    "rateFixed" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarberCommissionParticipation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "participates" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BarberCommissionParticipation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "paymentId" TEXT,
    "source" "CommissionSource" NOT NULL,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rateType" "CommissionRateType" NOT NULL,
    "ratePercent" DOUBLE PRECISION,
    "rateFixed" DOUBLE PRECISION,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "refundAdjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionSettings_businessId_key" ON "CommissionSettings"("businessId");

-- CreateIndex
CREATE INDEX "CommissionRule_businessId_idx" ON "CommissionRule"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRule_businessId_scopeKey_key" ON "CommissionRule"("businessId", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BarberCommissionParticipation_barberId_key" ON "BarberCommissionParticipation"("barberId");

-- CreateIndex
CREATE UNIQUE INDEX "BarberCommissionParticipation_businessId_barberId_key" ON "BarberCommissionParticipation"("businessId", "barberId");

-- CreateIndex
CREATE INDEX "CommissionEntry_businessId_barberId_createdAt_idx" ON "CommissionEntry"("businessId", "barberId", "createdAt");

-- CreateIndex
CREATE INDEX "CommissionEntry_businessId_status_idx" ON "CommissionEntry"("businessId", "status");

-- CreateIndex
CREATE INDEX "CommissionEntry_businessId_createdAt_idx" ON "CommissionEntry"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "CommissionEntry_paymentId_idx" ON "CommissionEntry"("paymentId");

-- AddForeignKey
ALTER TABLE "CommissionSettings" ADD CONSTRAINT "CommissionSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarberCommissionParticipation" ADD CONSTRAINT "BarberCommissionParticipation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarberCommissionParticipation" ADD CONSTRAINT "BarberCommissionParticipation_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
