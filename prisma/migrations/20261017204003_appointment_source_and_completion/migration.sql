-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "bookingCampaign" TEXT,
ADD COLUMN     "bookingSource" "BookingSource",
ADD COLUMN     "completedAt" TIMESTAMP(3);
