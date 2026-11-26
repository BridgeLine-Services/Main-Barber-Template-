-- Referral reward ledger. Additive only: two new tables, no existing column touched.
-- sourceKey is unique per shop, which is what makes issuing a reward idempotent: a retried
-- webhook or a double-clicked button cannot pay a customer twice.

CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reason" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "referralId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReferralRewardEvent" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralRewardEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralReward_businessId_sourceKey_key" ON "ReferralReward"("businessId", "sourceKey");
CREATE INDEX "ReferralReward_businessId_customerId_status_idx" ON "ReferralReward"("businessId", "customerId", "status");
CREATE INDEX "ReferralReward_businessId_status_expiresAt_idx" ON "ReferralReward"("businessId", "status", "expiresAt");
CREATE INDEX "ReferralRewardEvent_businessId_createdAt_idx" ON "ReferralRewardEvent"("businessId", "createdAt");
CREATE INDEX "ReferralRewardEvent_rewardId_idx" ON "ReferralRewardEvent"("rewardId");

ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralRewardEvent" ADD CONSTRAINT "ReferralRewardEvent_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "ReferralReward"("id") ON DELETE CASCADE ON UPDATE CASCADE;
