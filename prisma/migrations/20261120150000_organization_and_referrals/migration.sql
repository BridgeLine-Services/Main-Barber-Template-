-- Priority 2 (multi-location organization layer) and Priority 5A (referral attribution).
-- Additive only: new tables and two new enum types. No existing table, column or row is
-- altered. Business remains the operational tenant; OrganizationLocation joins to it with
-- ON DELETE RESTRICT so deleting an organization can never delete a shop.
--
-- Rollback: drop the tables in reverse dependency order, then the two enum types. Because
-- nothing existing was altered, rollback cannot lose business data.
--
-- Staged rollout (see docs/ORGANIZATION-ARCHITECTURE-PROPOSAL.md):
--   stage 1 schema and relationships  <- this migration
--   stage 2 membership, stage 3 read-only reporting, stage 4 assignments,
--   stage 5 organization settings, stage 6 approved write operations.
-- Row-level security for these tables is staged separately in prisma/rls/production-rls.sql.

-- CreateEnum
CREATE TYPE "OrganizationMemberRole" AS ENUM ('ORGANIZATION_OWNER', 'CORPORATE_ADMIN', 'REGIONAL_MANAGER', 'FRANCHISE_OWNER');

-- CreateEnum
CREATE TYPE "OrganizationMemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganizationMemberRole" NOT NULL,
    "status" "OrganizationMemberStatus" NOT NULL DEFAULT 'INVITED',
    "regions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "region" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffLocationAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffLocationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationBrandSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "brandGuidelinesUrl" TEXT,
    "allowedOverrides" TEXT[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationBrandSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationReportingConfiguration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule" TEXT NOT NULL DEFAULT 'weekly',
    "recipients" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationReportingConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationServiceTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "defaultPriceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationServiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationServicePriceException" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "reason" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationServicePriceException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationAnnouncement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL,
    "audienceValues" TEXT[],
    "authorId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationConfigAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationConfigAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerLocationLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerLocationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralProgram" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "codePrefix" TEXT NOT NULL DEFAULT 'REF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralAttribution" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "referrerCustomerId" TEXT,
    "code" TEXT,
    "source" TEXT,
    "campaign" TEXT,
    "appointmentId" TEXT,
    "firstBookingAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_status_idx" ON "OrganizationMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationLocation_businessId_key" ON "OrganizationLocation"("businessId");

-- CreateIndex
CREATE INDEX "OrganizationLocation_organizationId_status_idx" ON "OrganizationLocation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OrganizationLocation_region_idx" ON "OrganizationLocation"("region");

-- CreateIndex
CREATE INDEX "StaffLocationAssignment_businessId_effectiveFrom_effectiveT_idx" ON "StaffLocationAssignment"("businessId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "StaffLocationAssignment_organizationId_userId_idx" ON "StaffLocationAssignment"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffLocationAssignment_userId_businessId_effectiveFrom_key" ON "StaffLocationAssignment"("userId", "businessId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationBrandSettings_organizationId_key" ON "OrganizationBrandSettings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationReportingConfiguration_organizationId_metric_key" ON "OrganizationReportingConfiguration"("organizationId", "metric");

-- CreateIndex
CREATE INDEX "OrganizationServiceTemplate_organizationId_active_idx" ON "OrganizationServiceTemplate"("organizationId", "active");

-- CreateIndex
CREATE INDEX "OrganizationServicePriceException_businessId_idx" ON "OrganizationServicePriceException"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationServicePriceException_templateId_businessId_key" ON "OrganizationServicePriceException"("templateId", "businessId");

-- CreateIndex
CREATE INDEX "OrganizationAnnouncement_organizationId_publishedAt_idx" ON "OrganizationAnnouncement"("organizationId", "publishedAt");

-- CreateIndex
CREATE INDEX "OrganizationConfigAudit_organizationId_createdAt_idx" ON "OrganizationConfigAudit"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerLocationLink_organizationId_customerId_idx" ON "CustomerLocationLink"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerLocationLink_customerId_businessId_key" ON "CustomerLocationLink"("customerId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralProgram_businessId_key" ON "ReferralProgram"("businessId");

-- CreateIndex
CREATE INDEX "ReferralCode_code_idx" ON "ReferralCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_businessId_code_key" ON "ReferralCode"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_businessId_customerId_key" ON "ReferralCode"("businessId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralAttribution_customerId_key" ON "ReferralAttribution"("customerId");

-- CreateIndex
CREATE INDEX "ReferralAttribution_businessId_createdAt_idx" ON "ReferralAttribution"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralAttribution_referrerCustomerId_idx" ON "ReferralAttribution"("referrerCustomerId");

-- CreateIndex
CREATE INDEX "ReferralAttribution_source_idx" ON "ReferralAttribution"("source");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationLocation" ADD CONSTRAINT "OrganizationLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationLocation" ADD CONSTRAINT "OrganizationLocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLocationAssignment" ADD CONSTRAINT "StaffLocationAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationBrandSettings" ADD CONSTRAINT "OrganizationBrandSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationReportingConfiguration" ADD CONSTRAINT "OrganizationReportingConfiguration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationServiceTemplate" ADD CONSTRAINT "OrganizationServiceTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationServicePriceException" ADD CONSTRAINT "OrganizationServicePriceException_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OrganizationServiceTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationAnnouncement" ADD CONSTRAINT "OrganizationAnnouncement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationConfigAudit" ADD CONSTRAINT "OrganizationConfigAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLocationLink" ADD CONSTRAINT "CustomerLocationLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

