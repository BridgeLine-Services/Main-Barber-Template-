-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "firstAvailableBookingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "serviceId" TEXT;

-- CreateIndex
CREATE INDEX "MediaAsset_serviceId_idx" ON "MediaAsset"("serviceId");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

