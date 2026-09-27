-- Business soft deactivation + audit actions
ALTER TABLE "Business" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'BUSINESS_DEACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'BUSINESS_REACTIVATED';
