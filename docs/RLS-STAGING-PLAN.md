# Staged database-level RLS plan (tenant isolation, layer 2)

Status: **designed and rehearsable, deliberately NOT enabled.** No policy in this
plan has been applied to any environment. The application-level tenant filter
remains the primary protection.

Why this document exists: `prisma/rls/production-rls.sql` already contains a
correct policy set, and `docs/TENANT-ISOLATION.md` records that RLS is disabled by
design (0 of 51 tables protected). Enabling it without the role split below does
not create protection — it creates a false guarantee, because the application
connects as the table owner, and **a table owner bypasses RLS unless
`FORCE ROW LEVEL SECURITY` is set, and a superuser bypasses it always.** The
sequence below is the only safe way to get real protection without locking every
shop out.

---

## 1. What is being protected

| Class | Definition | Examples | RLS treatment |
| --- | --- | --- | --- |
| Tenant root | owns rows by identity | `Business` | policy on `id = current_tenant()` |
| Directly scoped | has `businessId` | `Appointment`, `Customer`, `Barber`, `Service`, `Payment`, `Product`, `InventoryItem`, `Membership`, `GiftCard`, `WaitlistEntry`, `Review`, `AuditLog` | policy on `businessId = current_tenant()` |
| Indirectly scoped | reaches a tenant through a parent | `AppointmentItem` → `Appointment`, `PaymentItem` → `Payment`, `CommissionEntry` → `Barber` | policy with an `EXISTS` join on the parent |
| Global / platform | not owned by a shop | `User` (identity), `BackupRun`, `PlatformSetting`, session and job tables | **no** tenant policy; protected by role grants and application checks |

The current inventory is 51 tenant-scoped models plus the global tables listed in
`prisma/rls/production-rls.sql` §39–69. The map is generated from the schema, not
hand-written: `scripts/rls-plan.ts` reads `prisma/schema.prisma`, classifies every
model by the presence of `businessId` or a relational path to it, and refuses to
emit a plan if any model is unclassified. Adding a model later therefore fails the
plan instead of silently escaping protection.

---

## 2. The role split (prerequisite, not optional)

| Role | Used by | Rights |
| --- | --- | --- |
| `barber_migrator` | `prisma migrate deploy` | owns the schema; runs DDL; **never** serves traffic |
| `barber_app` | the running application | `SELECT/INSERT/UPDATE/DELETE` on application tables; **not** superuser; **not** the table owner; no `BYPASSRLS` |
| `barber_platform` | platform-admin tooling and audited support actions | membership in a bypass role, only for explicitly audited paths |

Verification (must all hold before any policy is applied):

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
 WHERE rolname IN ('barber_migrator','barber_app','barber_platform');
-- barber_app: rolsuper = false, rolbypassrls = false
SELECT current_user, pg_get_userbyid(relowner) AS owner
  FROM pg_class WHERE relname = 'Appointment';
-- owner must be barber_migrator, not barber_app
```

Switching `DATABASE_URL` to `barber_app` is a **separate, reversible change** and
is tested before any policy exists: the full suite must pass with the runtime role
and no RLS, proving the role has the grants the application actually needs.

---

## 3. Transaction-local tenant context

Every request must set the tenant for the transaction, never for the connection:

```sql
SET LOCAL app.current_business_id = '<businessId>';
```

`SET LOCAL` is scoped to the transaction, so a pooled connection cannot leak one
shop's context into the next request. The policies read it through one helper:

```sql
CREATE OR REPLACE FUNCTION current_tenant() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_business_id', true), '')
$$;
```

An unset or empty value returns `NULL`, which makes every comparison false: a
query outside a tenant transaction returns **zero rows**, never every row. That
failure mode is chosen deliberately — leaking nothing is better than leaking all.

Application change (one place, not 178 routes): `src/lib/prisma.ts` exposes a
`withTenant(businessId, fn)` helper that opens a transaction, issues `SET LOCAL`,
and runs the callback. The existing `src/lib/tenant.ts` resolution stays exactly as
it is: it still decides *which* tenant a request belongs to, and the database now
independently enforces it.

---

## 4. Staging sequence

Each step has a gate; a failed gate stops the sequence.

| # | Step | Gate |
| --- | --- | --- |
| 1 | Generate the table map: `npx tsx scripts/rls-plan.ts` | every model classified; count recorded |
| 2 | Create the three roles on a **staging** database | verification queries in §2 pass |
| 3 | Point staging `DATABASE_URL` at `barber_app`, no RLS | `npm run test:all` passes unchanged |
| 4 | Add `withTenant()` and route the tenant-scoped read/write paths through it | suite passes; `npm run test:tenant`, `test:matrix` pass |
| 5 | Apply policies **without** `FORCE` to staging | app still works; cross-tenant reads return zero rows |
| 6 | Apply `FORCE ROW LEVEL SECURITY` on staging | app still works as `barber_app`; migrations as `barber_migrator` still run |
| 7 | Run the isolation matrix (`npm run test:matrix`) with a second seeded shop | zero cross-tenant rows in every direction |
| 8 | Take a verified backup, then repeat on production in a maintenance window | `db:backup-verify` PASS within 24h of the change |
| 9 | Monitor `tenant_isolation_violation` alerts for 7 days | no violations; if any, roll back at step 9 |

Rollback for every step: `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` (policies
remain, inert) and restore `DATABASE_URL`. This is non-destructive and takes
seconds; that is why RLS is applied table-by-table in one transaction per table.

---

## 5. Tests that must exist before enabling

- Cross-tenant **read** returns zero rows for every protected table.
- Cross-tenant **write** is rejected with a policy error, not silently dropped.
- A write with no tenant context fails (proves `NULL` is not "all tenants").
- Two concurrent transactions on pooled connections see their own tenant only
  (the `SET LOCAL` leak test).
- Platform-admin access works only through the audited path and is recorded in
  `AuditLog`.
- `FORCE RLS` is on, and `barber_app` is neither owner nor superuser (catalog
  assertion, not a comment).
- Rollback: disabling RLS restores the previous behaviour exactly.

`tests/tenant-isolation.test.ts`, `tests/cross-tenant-matrix.test.ts` and
`tests/tenant-key-sync.test.ts` already cover the application layer and must keep
passing untouched; the assertions above are additive.

---

## 6. Why it is not enabled today

1. The runtime role split is a provider/dashboard action, not application code, and
   this repository does not hold production credentials.
2. Enabling policies while the application still connects as the owner would add
   latency and risk with **zero** protection gained.
3. `withTenant()` changes the shape of every tenant-scoped query. It must be
   proven on staging with the full suite before it touches production, per the
   zero-regression rule.

Until all three are done, isolation rests on `src/lib/tenant.ts` plus the
per-query `businessId` filters that `tests/tenant-isolation.test.ts` and
`tests/cross-tenant-matrix.test.ts` pin. That protection is real; it is simply
one layer instead of two.

---

## 7. Stage 2 has now been executed and proven (2026-11-17)

Until this round the policy file had never run against a database. `npm run
test:rls-enforcement` (`tests/rls-enforcement.test.ts`) now closes that gap:

1. copies the development schema and data into a throwaway database with
   `pg_dump` (it never writes to the development database);
2. applies `prisma/rls/stage-1-roles.sql` and then `prisma/rls/production-rls.sql`
   exactly as a deployment would;
3. connects as `barber_app` and tries to break out.

Result on a copy of the real schema: **18 checks passed, 0 failed.** Specifically,
as the runtime role:

- a session given tenant A sees exactly A's appointments and exactly one Business
  row, and the same holds for tenant B;
- a session with no tenant set sees **nothing** (fail closed, not fail open);
- a write into another tenant is refused by the database, and leaves no row;
- a cross-tenant UPDATE and DELETE change **zero** rows;
- `app.business_id` is gone after `COMMIT`, so a pooled connection cannot leak one
  tenant's setting into the next request;
- `barber_app` cannot create a table (no DDL), and is neither superuser nor
  `BYPASSRLS`;
- a session that explicitly asks for support access sees every tenant.

### Two real defects the proof found

1. **`SmsConsentLog` had a `businessId` column and no policy.** It is the TCPA
   consent ledger. Under the old file it would have been the single tenant table
   still readable across shops. It is now in the policy list, and the test fails if
   any table with a `businessId` column lacks forced RLS or a `tenant_isolation`
   policy, so a future model cannot quietly reopen the hole.
2. **Stage 1 and stage 2 used different role names.** Stage 1 created
   `barber_migrator` / `barber_app` / `barber_platform`; the policy file referenced
   `barbershop_app` / `barbershop_owner`. A deployment that followed the plan in
   order would have failed at `ALTER ROLE`. Both files now use the stage-1 names,
   and `scripts/apply-rls.ts` substitutes `RLS_APP_ROLE` for any override.

### What this does and does not license

It proves the SQL is correct and the isolation holds on a real copy. It does
**not** mean production is protected: production still connects as the table
owner, so the policies are not installed there. The three conditions in §6 stand.
The honest summary is now "the second layer is built and proven offline", not "the
second layer is unverified".

One weakness is recorded rather than hidden: the `app.platform_staff = '1'` escape
hatch is a session setting, so any code able to run SQL on the runtime connection
can use it. It contains application bugs; it does not contain a compromised
application. §3 of `prisma/rls/production-rls.sql` explains how to move that escape
to role membership if you ever need the stronger guarantee.

## How the enforcement test runs (and why it cannot lie)

`npm run test:rls-enforcement` proves the stage-2 policies in a real PostgreSQL, and
it is deliberately boring about where its data comes from:

1. It connects with explicit test-only settings (`RLS_TEST_HOST`, `RLS_TEST_PORT`,
   `RLS_TEST_ADMIN_USER`, `RLS_TEST_ADMIN_PASSWORD`, `RLS_TEST_APP_USER`,
   `RLS_TEST_SOURCE_DB`, `RLS_TEST_PROBE_DB`). `DATABASE_URL` is never used as a
   fallback, because a test that creates and drops databases must not be pointed at
   whatever a shell happens to export.
2. It copies the **schema only** into a uniquely named scratch database. No shop or
   customer record is read, copied or printed.
3. It creates two synthetic tenants of its own (business, customer, barber, service
   and appointment each, with `.invalid` contact details), so the result does not
   depend on seed data or on what a developer happens to have locally.
4. It applies `stage-1-roles.sql`, then generates a password for the runtime role for
   that disposable run only (`ALTER ROLE`), leaving the placeholder in the file.
5. It applies `production-rls.sql` and then connects as the runtime role, asserting
   that the runtime and administrative sessions really are different roles.
6. It drops the scratch database in a `finally` block.

The copy step is deliberately forgiving about the client version and unforgiving about
everything else: settings the target server does not recognise are dropped and named,
and every other statement is applied exactly as dumped. A dump that fails still stops
the run, names the failing side (dump or restore) and the offending statement, with
connection strings and passwords redacted.

Skip versus failure is explicit. Locally, a missing PostgreSQL prints `SKIPPED` with
the reason and exits 3, and says plainly that enforcement was not verified. In CI
(`RLS_TEST_REQUIRED=true`, or any GitHub Actions run) the same conditions are
failures, because a security test that did not run must never appear green. This
changes nothing about production: RLS is still **not enabled** there, and a passing
run proves the policies work, not that they are live.
