-- Audit actions for business data export (§45) and customer-initiated
-- account deletion (§21 self-service lifecycle completion)

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'DATA_EXPORTED';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CUSTOMER_ACCOUNT_DELETED';
