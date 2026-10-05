-- CreateEnum
CREATE TYPE "PayrollPeriodType" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PayrollReportStatus" AS ENUM ('DRAFT', 'REVIEWED', 'EXPORTED', 'FINALIZED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PAYROLL_REPORTING_ENABLED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYROLL_REPORTING_DISABLED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYROLL_SETTINGS_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYROLL_REPORT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYROLL_REPORT_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYROLL_REPORT_EXPORTED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYROLL_REPORT_ADJUSTMENT';

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "payPeriodType" "PayrollPeriodType" NOT NULL DEFAULT 'WEEKLY',
    "payPeriodAnchorDate" TIMESTAMP(3) NOT NULL DEFAULT '2024-01-01 00:00:00 +00:00',
    "customPeriodDays" INTEGER NOT NULL DEFAULT 14,
    "barberSelfView" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollReport" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" "PayrollReportStatus" NOT NULL DEFAULT 'DRAFT',
    "periodType" "PayrollPeriodType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "exportedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollReportLine" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "barberName" TEXT NOT NULL,
    "serviceRevenue" DOUBLE PRECISION NOT NULL,
    "tips" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL,
    "adjustments" DOUBLE PRECISION NOT NULL,
    "regularHours" DOUBLE PRECISION NOT NULL,
    "overtimeHours" DOUBLE PRECISION NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "estimatedPayout" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PayrollReportLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollReportAdjustment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollReportAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSettings_businessId_key" ON "PayrollSettings"("businessId");

-- CreateIndex
CREATE INDEX "PayrollReport_businessId_periodStart_idx" ON "PayrollReport"("businessId", "periodStart");

-- CreateIndex
CREATE INDEX "PayrollReport_businessId_status_createdAt_idx" ON "PayrollReport"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PayrollReportLine_businessId_reportId_idx" ON "PayrollReportLine"("businessId", "reportId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollReportLine_reportId_barberId_key" ON "PayrollReportLine"("reportId", "barberId");

-- CreateIndex
CREATE INDEX "PayrollReportAdjustment_businessId_reportId_barberId_idx" ON "PayrollReportAdjustment"("businessId", "reportId", "barberId");

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReport" ADD CONSTRAINT "PayrollReport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReportLine" ADD CONSTRAINT "PayrollReportLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "PayrollReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReportLine" ADD CONSTRAINT "PayrollReportLine_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReportAdjustment" ADD CONSTRAINT "PayrollReportAdjustment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "PayrollReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReportAdjustment" ADD CONSTRAINT "PayrollReportAdjustment_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
