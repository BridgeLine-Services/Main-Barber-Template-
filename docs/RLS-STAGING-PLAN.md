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
