ALTER TABLE "Customer" ADD COLUMN "marketingSmsConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "smsOptedOutAt" TIMESTAMP(3);

CREATE TYPE "SmsConsentCategory" AS ENUM ('TRANSACTIONAL', 'MARKETING');
CREATE TYPE "SmsConsentAction" AS ENUM ('GRANTED', 'DENIED', 'WITHDRAWN', 'RE_GRANTED', 'STOP', 'START');

CREATE TABLE "SmsConsentLog" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "category" "SmsConsentCategory" NOT NULL,
  "action" "SmsConsentAction" NOT NULL,
  "disclosure" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "ipAddress" TEXT,
  "providerEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmsConsentLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SmsConsentLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SmsConsentLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SmsConsentLog_businessId_customerId_category_createdAt_idx" ON "SmsConsentLog"("businessId", "customerId", "category", "createdAt");
CREATE INDEX "SmsConsentLog_businessId_phone_idx" ON "SmsConsentLog"("businessId", "phone");
CREATE UNIQUE INDEX "SmsConsentLog_businessId_providerEventId_key" ON "SmsConsentLog"("businessId", "providerEventId");
