-- Requirement 27/33: audit feature-configuration changes.
ALTER TYPE "AuditAction" ADD VALUE 'FEATURE_CONFIG_UPDATED';
