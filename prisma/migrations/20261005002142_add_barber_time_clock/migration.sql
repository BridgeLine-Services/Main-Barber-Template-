-- CreateEnum
CREATE TYPE "PayPeriodType" AS ENUM ('WEEKLY', 'BIWEEKLY');

-- CreateTable
CREATE TABLE "TimeClockSettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyOvertimeThresholdHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "weeklyOvertimeThresholdHours" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "payPeriodType" "PayPeriodType" NOT NULL DEFAULT 'WEEKLY',
    "payPeriodAnchorDate" TIMESTAMP(3) NOT NULL DEFAULT '2024-01-01 00:00:00 +00:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeClockSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarberTimeClockAccess" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "canViewTeamRecords" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BarberTimeClockAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeClockEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockOutAt" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeClockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeClockBreak" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeClockBreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeClockEntryRevision" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changedByName" TEXT NOT NULL,
    "changedByEmail" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "originalValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeClockEntryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeClockSettings_businessId_key" ON "TimeClockSettings"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BarberTimeClockAccess_barberId_key" ON "BarberTimeClockAccess"("barberId");

-- CreateIndex
CREATE UNIQUE INDEX "BarberTimeClockAccess_businessId_barberId_key" ON "BarberTimeClockAccess"("businessId", "barberId");

-- CreateIndex
CREATE INDEX "TimeClockEntry_businessId_barberId_clockInAt_idx" ON "TimeClockEntry"("businessId", "barberId", "clockInAt");

-- CreateIndex
CREATE INDEX "TimeClockEntry_businessId_clockInAt_idx" ON "TimeClockEntry"("businessId", "clockInAt");

-- CreateIndex
CREATE INDEX "TimeClockBreak_businessId_entryId_idx" ON "TimeClockBreak"("businessId", "entryId");

-- CreateIndex
CREATE INDEX "TimeClockEntryRevision_businessId_entryId_createdAt_idx" ON "TimeClockEntryRevision"("businessId", "entryId", "createdAt");

-- AddForeignKey
ALTER TABLE "TimeClockSettings" ADD CONSTRAINT "TimeClockSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarberTimeClockAccess" ADD CONSTRAINT "BarberTimeClockAccess_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarberTimeClockAccess" ADD CONSTRAINT "BarberTimeClockAccess_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockEntry" ADD CONSTRAINT "TimeClockEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockEntry" ADD CONSTRAINT "TimeClockEntry_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockBreak" ADD CONSTRAINT "TimeClockBreak_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeClockEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockEntryRevision" ADD CONSTRAINT "TimeClockEntryRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeClockEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One OPEN break per entry (app-side check + database backstop):
-- a crashed client racing two break-starts cannot create overlapping breaks.
CREATE UNIQUE INDEX "TimeClockBreak_one_open_per_entry"
  ON "TimeClockBreak"("entryId")
  WHERE "endedAt" IS NULL;
