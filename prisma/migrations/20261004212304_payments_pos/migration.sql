-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentKind" ADD VALUE 'CANCELLATION_FEE';
ALTER TYPE "PaymentKind" ADD VALUE 'NO_SHOW_FEE';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CASH';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterTable
ALTER TABLE "Barber" ADD COLUMN     "commissionRate" DOUBLE PRECISION,
ADD COLUMN     "tipsOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "stripeCustomerId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "barberId" TEXT,
ADD COLUMN     "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentSettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowBarberCheckout" BOOLEAN NOT NULL DEFAULT true,
    "tipsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tipPresets" JSONB,
    "taxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "taxRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depositsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "depositType" TEXT NOT NULL DEFAULT 'PERCENT',
    "depositValue" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "cancellationFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cancellationFeeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "noShowFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "noShowFeeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cardOnFileEnabled" BOOLEAN NOT NULL DEFAULT false,
    "commissionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "commissionRatePercent" DOUBLE PRECISION,
    "receiptsEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSettings_businessId_key" ON "PaymentSettings"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeEvent_eventId_key" ON "StripeEvent"("eventId");

-- CreateIndex
CREATE INDEX "Payment_barberId_idx" ON "Payment"("barberId");

-- CreateIndex
CREATE INDEX "Payment_businessId_createdAt_idx" ON "Payment"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_businessId_barberId_createdAt_idx" ON "Payment"("businessId", "barberId", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettings" ADD CONSTRAINT "PaymentSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
