-- Staff invite temporary-credential email (best-effort SMTP delivery).
-- Enum value ADD is safe: no table rewrite, existing rows unaffected.
ALTER TYPE "NotificationType" ADD VALUE 'STAFF_INVITE';
