-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'LOGOUT';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET';
ALTER TYPE "AuditAction" ADD VALUE 'APPOINTMENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'HOURS_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'POLICIES_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'FAQ_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'FAQ_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'FAQ_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'WEBSITE_CONTENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDIA_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_INVITED';
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_INVITATION_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_INVITATION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_DEACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_ROLE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'CUSTOMER_LINKED';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'CUSTOMER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "customerId" TEXT;

-- CreateTable
CREATE TABLE "StaffInvitation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "barberId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvitation_tokenHash_key" ON "StaffInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffInvitation_businessId_email_idx" ON "StaffInvitation"("businessId", "email");

-- CreateIndex
CREATE INDEX "StaffInvitation_businessId_createdAt_idx" ON "StaffInvitation"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_customerId_key" ON "User"("customerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

