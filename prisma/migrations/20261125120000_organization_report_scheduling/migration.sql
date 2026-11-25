ALTER TYPE "NotificationType" ADD VALUE 'ORGANIZATION_REPORT';

ALTER TABLE "OrganizationReportingConfiguration"
  ADD COLUMN "reportingPeriodDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "deliveryMethod" TEXT NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "nextRunAt" TIMESTAMP(3),
  ADD COLUMN "lastDeliveryStatus" TEXT,
  ADD COLUMN "lastDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "lastDeliveryError" TEXT;

CREATE INDEX "OrganizationReportingConfiguration_metric_enabled_nextRunAt_idx"
  ON "OrganizationReportingConfiguration"("metric", "enabled", "nextRunAt");

ALTER TABLE "NotificationLog"
  ADD COLUMN "organizationReportingConfigurationId" TEXT;

CREATE INDEX "NotificationLog_organizationReportingConfigurationId_idx"
  ON "NotificationLog"("organizationReportingConfigurationId");

ALTER TABLE "NotificationLog"
  ADD CONSTRAINT "NotificationLog_organizationReportingConfigurationId_fkey"
  FOREIGN KEY ("organizationReportingConfigurationId")
  REFERENCES "OrganizationReportingConfiguration"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
