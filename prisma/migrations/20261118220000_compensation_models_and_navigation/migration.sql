-- Approved by the owner on 2026-11-18 (docs/MIGRATION-PROPOSALS-COMPENSATION-NAV.md).
-- Additive only: one enum, three nullable columns, one nullable JSON column.
-- No table is dropped, renamed or rewritten, and no existing row changes value:
-- COMMISSION is the default, so every current barber is paid exactly as before.

-- CreateEnum
CREATE TYPE "CompensationModel" AS ENUM ('COMMISSION', 'HOURLY', 'BOOTH_RENTAL', 'HYBRID');

-- AlterTable
ALTER TABLE "Barber" ADD COLUMN "compensationModel" "CompensationModel" NOT NULL DEFAULT 'COMMISSION',
ADD COLUMN "hourlyRate" DOUBLE PRECISION,
ADD COLUMN "boothRentAmount" DOUBLE PRECISION,
ADD COLUMN "boothRentPeriod" TEXT;

-- AlterTable
ALTER TABLE "WebsiteContent" ADD COLUMN "navigation" JSONB;

-- Rollback (run by hand if this must be undone; nothing here is destructive):
--   ALTER TABLE "WebsiteContent" DROP COLUMN "navigation";
--   ALTER TABLE "Barber" DROP COLUMN "compensationModel", DROP COLUMN "hourlyRate",
--     DROP COLUMN "boothRentAmount", DROP COLUMN "boothRentPeriod";
--   DROP TYPE "CompensationModel";
