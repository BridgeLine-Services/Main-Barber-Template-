-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'SESSIONS_REVOKED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionsValidAfter" TIMESTAMP(3);
