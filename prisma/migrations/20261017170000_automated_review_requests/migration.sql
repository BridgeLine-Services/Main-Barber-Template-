ALTER TABLE "RetentionSettings" ADD COLUMN "reviewRequestsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RetentionSettings" ADD COLUMN "reviewRequestDelayHours" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "RetentionSettings" ADD COLUMN "reviewDestinationUrl" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN "bookingSource" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "bookingSourceRef" TEXT;
CREATE TYPE "ReviewRequestStatus" AS ENUM ('PENDING', 'SENT', 'CLICKED', 'COMPLETED', 'FAILED');
CREATE TABLE "ReviewRequest" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "destination" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "status" "ReviewRequestStatus" NOT NULL DEFAULT 'PENDING',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "clickedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewRequest_appointmentId_key" UNIQUE ("appointmentId"),
  CONSTRAINT "ReviewRequest_token_key" UNIQUE ("token"),
  CONSTRAINT "ReviewRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReviewRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReviewRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReviewRequest_businessId_status_scheduledAt_idx" ON "ReviewRequest"("businessId", "status", "scheduledAt");
CREATE INDEX "ReviewRequest_customerId_idx" ON "ReviewRequest"("customerId");
