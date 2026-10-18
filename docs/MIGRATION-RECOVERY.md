# Migration recovery runbook (Vercel build failures at `prisma migrate deploy`)

This runbook covers the deployment-blocking Prisma errors that surface in the
Vercel build log while running `node scripts/vercel-build.mjs`:

- **P3018** — a migration failed while applying; the database now records it as a failed migration.
- **P3009** — `migrate deploy` refuses to run because the `_prisma_migrations` table already contains a failed migration.
- **P3005** — the database already contains schema objects but has no Prisma migration history (a schema was applied outside migrations, for example with `prisma db push`).

The build log now contains everything needed to classify the state before any
repair is attempted:

1. **Migration-state report** — `Reporting the database migration state (prisma migrate status)` lists which migrations are applied and which are pending, and names any failed migration.
2. **Terminal error** — names the exact failing migration and points to this document.

Never repair by guessing. Always establish the database state first with the
read-only checks below.

## Safety rules

- Never `prisma migrate reset`, `DROP DATABASE`, or `prisma db push` against the production database.
- Never delete rows from `_prisma_migrations` to make a deployment pass.
- Mark a migration as applied (`prisma migrate resolve --applied`) only after **proving its intended schema changes are already present** in the database.
- Mark a migration as rolled back (`prisma migrate resolve --rolled-back`) only after **proving it left no partial changes** (Postgres migration SQL runs transactionally, so an aborted migration normally leaves nothing behind, but verify, do not assume).
- Verify the target database first (see below); Preview and Production environments must not be assumed to share a database.

## Step 1 — Read-only state inspection (no writes)

Run these with the same `DATABASE_URL` the deployment uses (never print the value):

```sql
-- Which migration record is stuck? (expect exactly one row)
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE finished_at IS NULL AND rolled_back_at IS NULL;

-- What did the failed attempt record? (sanitized excerpt; may contain error text)
SELECT left(logs, 500) FROM _prisma_migrations
WHERE migration_name = '<FAILED_MIGRATION>' AND finished_at IS NULL;

-- Did the failed migration leave any of its objects behind?
-- (adjust the object list to the migration's own SQL)
SELECT to_regclass('public.ReviewRequest') AS review_request_table;
SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS status_values
FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'ReviewRequestStatus';

-- Is there business data in the affected table? (must be checked before any repair)
SELECT count(*) FROM "ReviewRequest";
```

Also run, from the repository root (read-only diff of database vs. expected schema):

```bash
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma
```

`No difference detected` proves the database already matches the schema the
migrations are supposed to produce end-to-end.

## Step 2 — Classify, then repair

**The build performs Step 2 automatically whenever the evidence matches a
verified shape** (see `scripts/vercel-build.mjs` and
`scripts/check-review-request-state.mjs`): a failed record for
`20261017170000_automated_review_requests` triggers a read-only state
verification, and either the prototype-shape repair (Case B) or the
current-schema-push baseline (Case A) runs on its own. If the database
matches neither shape — or contains data rows in `ReviewRequest` — the build
changes nothing and prints the combined evidence of both evaluations; the
manual commands below then apply, using that evidence to decide the case.

### Case A — Failed record + the migration's objects already exist (schema was pushed outside migrations)

Observed shape: the failed record's `logs` contain an `already exists` error
(42710 duplicate type / 42701 duplicate column), and Step 1 shows the failed
migration's objects present while later migrations are pending.

This happens when the schema (or part of it) was applied with `prisma db push`
before the migrations ran. The failed migration record itself left no changes
(its transaction aborted), but its intended objects exist from the push.

**If the objects match exactly what the failed migration creates** (they came
from the same era of the schema), repair with:

```bash
npx prisma migrate resolve --applied <FAILED_MIGRATION>
npx prisma migrate deploy
```

then deploy again. The remaining migrations apply for real, in order.

**If `prisma migrate diff` shows no difference against the full current
schema** (the database was pushed from the current schema, so later
migrations' effects are also already present), baseline the pending ones too:

```bash
npx prisma migrate resolve --applied <FAILED_MIGRATION>
# for each migration the state report lists as pending, whose effects the
# empty diff proved present:
npx prisma migrate resolve --applied <PENDING_MIGRATION_1> ...
npx prisma migrate deploy   # expect "No pending migrations to apply."
```

Reference: https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining

### Case B — Failed record + no partial changes + objects absent

The migration genuinely failed (bad SQL, transient outage) and its transaction
rolled back completely: Step 1 shows the objects absent and the affected table
either absent or empty.

```bash
npx prisma migrate resolve --rolled-back <FAILED_MIGRATION>
npx prisma migrate deploy
```

This is the same repair the build script performs automatically for the one
known-recoverable failed migration
(`20261017203707_review_requests_booking_source_analytics`).

### Case C — P3005: schema without migration history

The state report shows all migrations pending and deploy fails with P3005
("The database schema is not empty"). The database was created outside
migrations. Follow the official baselining workflow: prove with
`prisma migrate diff` that the live schema matches the expected end state,
then mark the migrations as applied (Case A's baseline procedure) — never
resolve blindly, and never reset the database.

## Step 3 — Verify, then deploy

1. Re-run `npx prisma migrate status` — expect no failed migrations and no unexpected pending migrations.
2. Re-run `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma` — expect `No difference detected`.
3. Deploy; the build's migration-state report in the Vercel log should list no pending migrations and `next build` proceeds.

## Incident reference (2026-10-17/18, verified on disposable databases)

Every production deployment after commit `7625d73` failed ~40–55s into the
build with P3009. The disposable-database reproductions confirmed the repair
matrix used above:

| Scenario (disposable DB) | First failure | Repair applied | Result |
| --- | --- | --- | --- |
| Fresh install, 48 migrations | none | not needed | build exit 0 |
| Upgrade: history to `20261016193000`-era, then deploy | none | not needed | build exit 0 |
| P3009 record for `20261017203707…` (old conflict) | P3009 | auto-recovery in build script | build exit 0 |
| Prototype-era `db push` on top of pre-review-request history | P3018 (42701) then P3009 | automatic: verification passes -> `resolve --applied 20261017170000…` -> deploy | build exit 0 |
| Current-schema `db push` on top of pre-review-request history | P3018 (42701) then P3009 | automatic: fingerprint verification -> `resolve --applied` for the 5 migrations | build exit 0 |
| State matching neither verified shape | P3009 | none (by design) — build stops with the combined evidence of both evaluations | build exit 1, nothing changed |
