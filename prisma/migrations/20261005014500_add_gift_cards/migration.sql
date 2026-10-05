-- Gift cards: optional, owner-controlled system (see docs/GIFT-CARDS.md)

-- CreateEnum
CREATE TYPE "GiftCardType" AS ENUM ('DIGITAL', 'PHYSICAL');

-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('PENDING', 'ACTIVE', 'DEPLETED');

-- CreateEnum
CREATE TYPE "GiftCardTransactionType" AS ENUM ('PURCHASE', 'REDEMPTION', 'REFUND', 'ADJUSTMENT');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'GIFT_CARD';

-- CreateTable
CREATE TABLE "GiftCardSettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "denominations" JSONB,
    "defaultValidityMonths" INTEGER NOT NULL DEFAULT 12,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCardSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "code" TEXT NOT NULL,
    "type" "GiftCardType" NOT NULL DEFAULT 'DIGITAL',
    "initialValue" DOUBLE PRECISION NOT NULL,
    "remainingBalance" DOUBLE PRECISION NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "purchaserName" TEXT NOT NULL,
    "purchaserEmail" TEXT,
    "purchaserCustomerId" TEXT,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "message" TEXT,
    "purchasePaymentId" TEXT,
    "soldByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardTransaction" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "type" "GiftCardTransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "paymentId" TEXT,
    "appointmentId" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardSettings_businessId_key" ON "GiftCardSettings"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_code_key" ON "GiftCard"("code");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_purchasePaymentId_key" ON "GiftCard"("purchasePaymentId");

-- CreateIndex
CREATE INDEX "GiftCard_businessId_status_idx" ON "GiftCard"("businessId", "status");

-- CreateIndex
CREATE INDEX "GiftCard_businessId_createdAt_idx" ON "GiftCard"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_businessId_giftCardId_idx" ON "GiftCardTransaction"("businessId", "giftCardId");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_businessId_type_createdAt_idx" ON "GiftCardTransaction"("businessId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "GiftCardSettings" ADD CONSTRAINT "GiftCardSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation RLS (same policy shape as every other tenant table)
ALTER TABLE "GiftCardSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiftCard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GiftCardTransaction" ENABLE ROW LEVEL SECURITY;
