-- Barber-shop template: staff <-> barber profile linking is now editable, so
-- audit-log the change with a dedicated action.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_BARBER_LINK_CHANGED';
