-- Platform owner role architecture (§8 / Phase 2):
-- PLATFORM_OWNER staff of the platform itself (no business context),
-- plus platform audit actions for business creation and denied access.

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'PLATFORM_OWNER';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PLATFORM_BUSINESS_CREATED';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PLATFORM_ACCESS_DENIED';
