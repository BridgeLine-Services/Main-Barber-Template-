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
| Global / platform | not owned by a shop | `BackupRun`, `PlatformSetting`, session and job tables | **no** tenant policy; protected by role grants and application checks |

The current schema has 89 Prisma models: 85 classify as tenant-root, direct,
indirect, or organization-scoped; 4 are explicitly global. The map is generated from
the schema, not hand-written: `scripts/rls-plan.ts` classifies every model by its
business/organization key or relational path. `tests/rls-reconciliation.test.ts`
compares each classified model with the staged SQL policy groups, including indirect
children and models that intentionally have both shop and organization scopes.
Adding a model therefore fails the coverage test instead of silently escaping review.

This is still a policy template, not proof that all runtime paths can supply those
transaction-local contexts. In particular, organization routes currently resolve
membership in application code but do not set `app.current_organization_id`; the
full application has not been run as `barber_app` with these policies enabled.

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

Application change: `src/lib/tenant-context.ts` exposes `withTenant(businessId, fn)`;
it writes `app.current_business_id` transaction-locally and runs the callback on that
transaction client. It is used by selected application paths, not every tenant-sensitive
query. The public tenant resolver still decides which shop a request belongs to; RLS
coverage cannot be treated as complete until all relevant reads and writes pass through
the appropriate transaction context.

---

## 4. Staging sequence

Each step has a gate; a failed gate stops the sequence.

| # | Step | Gate |
| --- | --- | --- |
| 1 | Generate the table map: `npx tsx scripts/rls-plan.ts` | every model classified; count recorded |
| 2 | Create the three roles on a **staging** database | verification queries in §2 pass |
| 3 | Point staging `DATABASE_URL` at `barber_app`, no RLS | `npm run test:all` passes unchanged |
| 4 | Route every approved tenant-scoped read/write path through `withTenant()`; add a separate organization transaction context before org-scoped policies are considered usable | suite passes; `npm run test:tenant`, `test:matrix`, and organization tests pass |
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

## 7. Historical SQL enforcement evidence (2026-11-17; not current proof)

An earlier revision of `npm run test:rls-enforcement` passed against a disposable
scratch database. That result is historical: the staged SQL and harness have since
changed to cover indirect models, organization policies, and role-based support access.
The revised harness has not been run in this workspace, and no staging environment has
proven the deployed application works as `barber_app`. Do not cite the old result as
proof of the current policy template.

The current harness is designed to copy schema only, seed synthetic tenants, apply the
role and policy templates to an isolated scratch database, and run assertions as
`barber_app` plus the separate `barber_platform` group role. It must run successfully
before relying on the updated SQL. It does not use `DATABASE_URL` as a target fallback.

### Historical findings and current safeguards

The earlier run found a missing `SmsConsentLog` policy and mismatched role names.
The current static coverage test derives model classes from `schema.prisma` and
compares direct, indirect, organization, and root classes against the SQL policy
sets. It additionally covers `Schedule`, `OrderItem`, `TwoFactorRecoveryCode`,
`OrganizationInvitation`, and models that carry both business and organization keys.
The updated policies have not yet been executed in PostgreSQL.

The previous `app.platform_staff` session-variable bypass has been removed. The
staged policy now checks membership in `barber_platform`, and stage 1 deliberately
does not grant that role to `barber_app`. A separate support login and audited
application path are still deployment prerequisites; the SQL test of the group role
alone does not prove the application support workflow is audited.

### What this does and does not license

No current run proves the revised SQL against PostgreSQL or the app against a
non-owner role. Production remains unverified and RLS remains disabled there. The
staging gates in §4 and §5 are still required; the accurate status is that the
static model-policy map and test harness have been improved, not that the second
layer is live or currently proven.

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

---

## 8. Reconciliation: the gift-card tables, and the organization layer

Two additions since this plan was written, both handled without enabling anything.

### 8.1 The gift-card gap

`20261005014500_add_gift_cards` turns RLS **on** for `GiftCardSettings`, `GiftCard` and
`GiftCardTransaction` and creates no policy. On the table-owner role this is invisible; on
`barber_app` it is a fail-closed outage. The staged SQL now includes all three business-key
policies, but that closes the design gap only in the template; no live database was inspected
or changed during this work.

The report-only reconciliation command requires an explicit, verified target:

```bash
RLS_RECONCILIATION_DATABASE_URL=<verified-staging-url> npm run db:rls-reconcile
RLS_RECONCILIATION_DATABASE_URL=<verified-staging-url> npm run db:rls-reconcile -- --enforce
```

It reports tables with RLS enabled but missing `FORCE` or all policies. It does not emit generic
SQL because business, organization, and indirect policies require different keys. The static
`tests/rls-reconciliation.test.ts` now verifies model-to-policy coverage and preserves the rule
that migrations do not enable policies. The explicit live check requires all gift-card policies
to be forced in the disposable/staging database.

**Consequence for rollout:** do not switch the runtime role until the matching policies are
applied and verified on isolated staging. The database remains unchanged by this code work.

### 8.2 The organization layer

The organization layer has both shop-keyed and organization-keyed rows. The staged policy
uses `businessId` for shop access, `organizationId` (or the organization root's `id`) for
organization access, and attaches both policies to `OrganizationLocation`,
`StaffLocationAssignment`, and `CustomerLocationLink`, which carry both keys.
`OrganizationInvitation` and `OrganizationServicePriceRequest` are included in the
organization-keyed set.

The organization policy uses `app.current_organization_id`, but no application helper currently
sets that value. Therefore these policies are not ready for application enforcement; a future
change must add and test an authorized transaction-local organization context before staging
RLS can be enabled.

`Schedule`, `OrderItem`, and `TwoFactorRecoveryCode` have no direct businessId column and are
scoped through `Barber`, `ShopOrder`, and `User` respectively. The planner and policy coverage
test explicitly classify these indirect relationships. `RestoreDrill` is platform recovery
evidence and remains global, like `StripeEvent`.
