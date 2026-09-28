-- Booking rules: Business.minAdvanceBookingMinutes / .maxBookingWindowDays /
-- .bufferMinutes / .cancellationDeadlineHours, Service.bufferMinutes.
-- The FK adjustments on AppointmentIntakeResponse / BarberRewardProgram /
-- BarberService reconcile pre-existing schema drift (optional soft-reference
-- businessId columns, ON DELETE SET NULL) so migration history matches
-- schema.prisma on fresh deployments.

-- DropForeignKey
ALTER TABLE "AppointmentIntakeResponse" DROP CONSTRAINT "AppointmentIntakeResponse_businessId_fkey";

-- DropForeignKey
ALTER TABLE "BarberRewardProgram" DROP CONSTRAINT "BarberRewardProgram_businessId_fkey";

-- DropForeignKey
ALTER TABLE "BarberService" DROP CONSTRAINT "BarberService_businessId_fkey";

-- DropIndex
DROP INDEX "AppointmentIntakeResponse_businessId_idx";

-- DropIndex
DROP INDEX "BarberRewardProgram_businessId_idx";

-- DropIndex
DROP INDEX "BarberService_businessId_idx";

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancellationDeadlineHours" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "maxBookingWindowDays" INTEGER,
ADD COLUMN     "minAdvanceBookingMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "bufferMinutes" INTEGER;

-- AddForeignKey
ALTER TABLE "BarberService" ADD CONSTRAINT "BarberService_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarberRewardProgram" ADD CONSTRAINT "BarberRewardProgram_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentIntakeResponse" ADD CONSTRAINT "AppointmentIntakeResponse_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
