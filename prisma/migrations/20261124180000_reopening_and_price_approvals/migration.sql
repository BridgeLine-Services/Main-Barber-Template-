-- Additive only. Two features: reopening a closed location, and a price request that has a
-- state before it is approved. Nothing existing is altered, renamed or dropped, and no row
-- is deleted.
--
-- The request is a new table rather than a status column on OrganizationServicePriceException
-- because resolveServicePrice applies any exception row it finds: an unapproved request must
-- not be able to change a shop's price by existing.

ALTER TABLE "OrganizationLocation"
  ADD COLUMN "reopenedAt" TIMESTAMP(3);

CREATE TABLE "OrganizationServicePriceRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationServicePriceRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationServicePriceRequest_organizationId_status_idx" ON "OrganizationServicePriceRequest"("organizationId", "status");
CREATE INDEX "OrganizationServicePriceRequest_templateId_businessId_status_idx" ON "OrganizationServicePriceRequest"("templateId", "businessId", "status");
CREATE INDEX "OrganizationServicePriceRequest_businessId_status_idx" ON "OrganizationServicePriceRequest"("businessId", "status");

ALTER TABLE "OrganizationServicePriceRequest" ADD CONSTRAINT "OrganizationServicePriceRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationServicePriceRequest" ADD CONSTRAINT "OrganizationServicePriceRequest_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OrganizationServiceTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
