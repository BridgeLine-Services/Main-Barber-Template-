-- ═══════════════════════════════════════════════════════════════════════
-- PRODUCTION ROW-LEVEL SECURITY TEMPLATE (Requirement 9, defense-in-depth)
-- ═══════════════════════════════════════════════════════════════════════
-- THIS FILE IS NOT A PRISMA MIGRATION. Do not move it into
-- prisma/migrations/ — the template app (Prisma + pooled shared role)
-- does not set per-request session variables, so `FORCE ROW LEVEL
-- SECURITY` applied blindly WOULD BREAK EVERY QUERY. See
-- docs/TENANT-ISOLATION.md §"Database-level RLS".
--
-- REPRODUCIBLE APPLICATION (Master Task Part 2):
--   DATABASE_ADMIN_URL=<owner-role connection URL> npm run db:apply-rls
--   npm run db:rls-status          (verification report; --enforce = fail)
--
-- It is a ready-to-run script for the DBA of a production deployment
-- where the runtime uses a SEPARATE, NON-OWNER database role and sets
-- `app.business_id` per request/transaction (e.g. via a transactional
-- proxy such as PgBouncer in session mode, Prisma $transaction with
-- SET LOCAL, or a per-request connection in the service layer).
--
-- WHAT THIS BUYS YOU
--   Even if an application-level bug forgets a `businessId` filter,
--   the database itself refuses to return another tenant's rows, and
--   refuses cross-tenant writes. Application-level scoping (see
--   src/lib/tenant.ts, requireAuth/requireOwner guards and
--   tests/cross-tenant-matrix.test.ts) remains the PRIMARY control;
--   this is the second, independent layer.
--
-- DEPLOYMENT PREREQUISITES
--   1. Two roles: one for migrations/DDL (table owner), one for the
--      app runtime (NON-superuser, NON-table-owner, NO BYPASSRLS):
--        DO NOT connect the template app to the owner role anymore.
--   2. The runtime sets, inside EVERY transaction:
--        SET LOCAL app.business_id = '<business id>';
--      and for platform-staff requests:
--        SET LOCAL app.platform_staff = '1';
--   3. Take a backup first. Test on a staging copy of the database.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Roles (adjust names/passwords via your secret manager) ─────────
-- Skip if you already provisioned these; shown for a fresh deployment.
-- CREATE ROLE barbershop_owner LOGIN;            -- migrations/DDL only
-- CREATE ROLE barbershop_app   LOGIN NOBYPASSRLS; -- runtime only

-- The runtime role must never own tenant tables and must not bypass RLS.
ALTER ROLE barbershop_app NOBYPASSRLS;

-- ─── 2. Which tables carry the tenant key directly ────────────────────
-- Models with a `businessId` column (auto-generated from schema.prisma;
-- regenerate when adding business-scoped models):
--   User, Barber, AvailabilityOverride, Service, MediaAsset, BusinessSEO,
--   RetentionSettings, Customer, Appointment, BlockedTime, Review,
--   WaitlistEntry, NotificationLog, AuditLog, BusinessClosure,
--   BusinessRewardProgram, CustomerTagAssignment, CancellationRecord,
--   NoShowPolicy, InventoryItem, MarketingCampaign, WebsiteContent,
--   BookingQuestion, RescheduleHistory, PortalVerificationChallenge,
--   PortalSession, Faq
-- Indirectly scoped — RESOLVED by migration 20260927153000, which
--   denormalizes businessId (trigger-maintained) onto BarberService,
--   BarberRewardProgram and AppointmentIntakeResponse.
-- Tenant-root tables (their `id` IS the tenant key):
--   Business, Schedule

DO $$
DECLARE
  -- Tables with a direct businessId column. Keep in sync with
  -- prisma/schema.prisma; the architecture test guards app-level
  -- scoping, this list guards database-level scoping.
  t_direct TEXT[] := ARRAY[
    'User','Barber','AvailabilityOverride','Service','MediaAsset',
    'BusinessSEO','RetentionSettings','Customer','Appointment',
    'BlockedTime','Review','WaitlistEntry','NotificationLog','AuditLog',
    'BusinessClosure','BusinessRewardProgram','CustomerTagAssignment',
    'CancellationRecord','NoShowPolicy','InventoryItem','MarketingCampaign',
    'WebsiteContent','BookingQuestion','RescheduleHistory',
    'PortalVerificationChallenge','PortalSession','Faq',
    -- Newly denormalized (migration 20260927153000): businessId is
    -- trigger-maintained from the parent record, never app-supplied.
    'BarberService','BarberRewardProgram','AppointmentIntakeResponse',
    -- Payment ledger (migration 20260927163000)
    'Payment'
  ];
  tbl TEXT;
BEGIN
  -- (a) Direct tenant tables: businessId column is the tenant key.
  FOREACH tbl IN ARRAY t_direct LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',  tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (
          -- platform staff (deployment-operated support access)
          COALESCE(current_setting('app.platform_staff', true), '0') = '1'
          -- or: row belongs to the caller's tenant
          OR "businessId" = NULLIF(current_setting('app.business_id', true), '')
        )
        WITH CHECK (
          COALESCE(current_setting('app.platform_staff', true), '0') = '1'
          OR "businessId" = NULLIF(current_setting('app.business_id', true), '')
        )
    $f$, tbl);
  END LOOP;

  -- (b) Tenant-root table: the row's own id is the tenant key.
  FOREACH tbl IN ARRAY ARRAY['Business','Schedule'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',  tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (
          COALESCE(current_setting('app.platform_staff', true), '0') = '1'
          OR "id" = NULLIF(current_setting('app.business_id', true), '')
        )
        WITH CHECK (
          COALESCE(current_setting('app.platform_staff', true), '0') = '1'
          OR "id" = NULLIF(current_setting('app.business_id', true), '')
        )
    $f$, tbl);
  END LOOP;
END $$;

-- (c) The formerly indirectly-scoped tables (BarberService,
--     BarberRewardProgram, AppointmentIntakeResponse) now carry a
--     trigger-maintained businessId (migration 20260927153000) and are
--     included in t_direct above — no documented gap remains.

-- ─── 3. Runtime role grants (least privilege) ──────────────────────────
-- The app role gets DML only — no schema changes, no role management.
GRANT USAGE ON SCHEMA public TO barbershop_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO barbershop_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO barbershop_app;

-- ─── 4. How the runtime sets the tenant per transaction ────────────────
-- Example (Prisma, per request):
--   await prisma.$transaction(async (tx) => {
--     await tx.$executeRaw`SELECT set_config('app.business_id', ${businessId}, true)`
--     // ... tenant queries via tx only ...
--   })
-- `true` = transaction-local: reverts automatically at COMMIT/ROLLBACK,
-- so a pooled connection can never leak one tenant's setting to another.
-- Platform-staff requests (support tooling) instead set
-- set_config('app.platform_staff', '1', true) and set NO business_id.
