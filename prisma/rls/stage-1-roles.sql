-- ============================================================================
-- RLS staging, stage 1: the role split. NOT APPLIED. Requires owner approval.
--
-- Run this as the database owner (the role that owns the application tables),
-- on a STAGING database first. It creates roles and grants only; it enables no
-- policy and changes no data. docs/RLS-STAGING-PLAN.md holds the full sequence.
--
-- Replace the password placeholders before running and never commit real values.
-- ============================================================================

-- 1. Migration owner: keeps owning the schema, runs `prisma migrate deploy`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barber_migrator') THEN
    CREATE ROLE barber_migrator LOGIN PASSWORD 'REPLACE_ME_MIGRATOR';
  END IF;
END $$;

-- 2. Application runtime role: serves traffic. NOT a superuser, NOT the table
--    owner, and explicitly denied BYPASSRLS. This is the property that makes
--    policies real once they exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barber_app') THEN
    CREATE ROLE barber_app LOGIN PASSWORD 'REPLACE_ME_APP';
  END IF;
END $$;

ALTER ROLE barber_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- 3. Platform administrator role: the only role allowed to see every tenant,
--    used by audited support paths. Give it to nobody by default.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barber_platform') THEN
    CREATE ROLE barber_platform NOLOGIN;
  END IF;
END $$;
GRANT barber_platform TO barber_app;

-- 4. Hand ownership to the migration owner, then grant the runtime role DML
--    only. Re-run the GRANT block whenever a migration adds a table.
GRANT USAGE ON SCHEMA public TO barber_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO barber_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO barber_app;
ALTER DEFAULT PRIVILEGES FOR ROLE barber_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO barber_app;
ALTER DEFAULT PRIVILEGES FOR ROLE barber_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO barber_app;

-- 5. Verification: all three rows must read as expected before stage 2.
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles
 WHERE rolname IN ('barber_migrator', 'barber_app', 'barber_platform')
 ORDER BY rolname;
