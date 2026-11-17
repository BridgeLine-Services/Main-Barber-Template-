# Reliability hardening — engineering report (2026-11-17)

Branch: `reliability/production-hardening`, cut from `main` @ `27b9c46`.
Baseline was measured on an untouched worktree of `main` at that commit, then the
same suites were run on the branch. Nothing was pushed to `main`; no production
database, deployment, provider setting or repository setting was touched.

**Headline:** the platform was not rebuilt and no working feature was replaced. The
work is additive: one new migration (new table only), new scripts, new libraries,
new tests and new documentation. Existing commands, routes, models, booking engine,
queue engine and authentication are unchanged.

---

## A. Repository audit

**Inspected:** the whole repository, then in depth: `package.json`,
`prisma/schema.prisma` (62 models, 58 migrations), `scripts/backup.ts`,
`scripts/vercel-build.mjs`, `scripts/env-doctor.ts`, `scripts/check-env-drift.mjs`,
`.github/workflows/ci.yml`, `.github/workflows/vercel-diagnostics.yml`,
`vercel.json`, `src/lib/{rate-limit,tenant,observability,logger,prisma,health,
trusted-storage-url}.ts`, `src/app/api/health/route.ts`, `src/app/api/cron/*`,
`prisma/rls/production-rls.sql`, `docs/{OPERATIONS,LAUNCH-READINESS,
MIGRATION-RECOVERY,RELEASE-ACCEPTANCE,TENANT-ISOLATION}.md`, and the test suite
layout (92 suites).

**Existing architecture preserved:** Next.js App Router with 178 API routes; Prisma
on PostgreSQL; multi-tenant by `businessId` with application-level filtering in
`src/lib/tenant.ts`; NextAuth session registry; Upstash-backed rate limiting with a
deliberate fail-closed behaviour; Vercel deploy via `scripts/vercel-build.mjs`
(validate → migrate deploy → build); three Vercel cron jobs
(reminders, memberships, review-requests) protected by `CRON_SECRET`; Vercel Blob
for media through `src/lib/trusted-storage-url.ts`.

**Existing protections found and kept:** cron bearer-token auth with 401 on
mismatch; fail-closed shared limiter with 503 (not 429) on store outage; signed
storage URLs with tenant checks; audit logging; emergency-access and session
revocation; overlap-prevention exclusion constraints on appointments
(`20260904000000`, `20260905000001`); `Appointment.idempotencyKey @unique`;
per-route `businessId` scoping pinned by `tenant-isolation` and
`cross-tenant-matrix` suites; structured observability that already sanitises
context and never blocks a request.

**Weaknesses identified**

1. `scripts/backup.ts` called `process.exit()` from helpers, so a failed restore or
   failed validation skipped `finally`: scratch databases and temp dumps leaked.
2. No independent recovery copy: a provider-level loss took the only backup with it.
3. Backups were never restored in production terms — `--verify` proved a restore
   into a scratch DB but not row/foreign-key/tenant/migration parity.
4. No backup encryption, checksum, retention policy, freshness monitoring or
   alerting at all; `BackupRun` history did not exist.
5. Media (logos, photos) had no backup path; a DB restore pointed at files that
   could be gone.
6. `/api/health` was a single check with no liveness/readiness distinction, so a
   degraded optional integration and a database outage looked the same.
7. Rate-limit store outages were invisible: fail-closed (correct) but silent
   (incorrect), with no recovery detection.
8. No independent critical alert channel; a monitoring-provider outage took the
   alerts with it.
9. Owner-facing status was a launch checklist, not "is my shop working right now".
10. RLS is documented as disabled (0 of 51 tables). Enabling it as-is would be a
    false guarantee, because the app connects as the table owner.
11. Repository is public (re-verified 2026-11-17), which the release docs already
    flag as an outstanding owner decision.

---

## B. File-by-file changes

| File | Previous behaviour | New behaviour | Why | Tests |
| --- | --- | --- | --- | --- |
| `scripts/backup.ts` | helpers called `process.exit()`; verify checked only that the dump restored; no FK/row/tenant/migration parity; no timeout; errors could print the DB URL | helpers throw `BackupFailure`; only `main()` sets an exit code; a cleanup registry runs on every path (and in reverse acquisition order); scratch DB dropped and temp file removed on failure; row-count parity for 7 key tables; **every** single-column FK checked via the catalog; tenant-orphan check; migration-count parity; cross-version `SET transaction_timeout` lines dropped for restore; per-command timeout; all output redacted; `--file` mode verifies any artifact; `--json`. `--verify`, `--keep`, `--url`, `--out` unchanged | the defect in Part 3.2 and the honesty gap in Part 3.3 | `tests/backup-failure-modes.test.ts` (22), `tests/backup-safety.test.ts` (56) |
| `scripts/backup-offsite.ts` | did not exist | dump → gzip → AES-256-GCM → upload → head/size → read back → authenticate → decompress/hash compare → optional full restore → manifest → retention → `BackupRun` → alert on failure / recovery on success; single-run lock with stale reclaim; exit 3 for "not configured" | Part 3.1 layers 2–3 | `tests/backup-offsite.test.ts` (20) |
| `scripts/media-backup.ts` | did not exist | copies every blob encrypted to `media/<pathname>.enc`, checks size and checksum on write and read-back, keeps an index, reports missing originals, never deletes anything | Part 4 | `tests/media-backup.test.ts` (21) |
| `scripts/alert-test.ts` | did not exist | `npm run alert:test` proves a real critical alert is delivered | Part 7 acceptance | `tests/alerts.test.ts` (23) |
| `scripts/backup-freshness.ts` | did not exist | alerts when the newest **verified** backup is older than `BACKUP_MAX_AGE_HOURS` | Part 3.1, Part 7 | `tests/health-readiness.test.ts` |
| `scripts/rls-plan.ts` | did not exist | classifies every Prisma model (root / direct / indirect / global) from the schema; `--check` fails on an unclassified model | Part 8 | run: 62 models, 0 unclassified |
| `scripts/lib/backup-storage.ts` | did not exist | provider-neutral storage: S3-compatible (SigV4, no new dependency) and localfs; path-traversal guard; explicit "not configured" with the exact missing names | Part 3.1, Part 13 | `tests/backup-safety.test.ts`, `tests/failure-simulation.test.ts` |
| `src/lib/backup/crypto.ts` | did not exist | AES-256-GCM with magic header, key id, authenticated payload; accepts base64/hex; rejects truncated/tampered/wrong-key | Part 3.1 | `tests/backup-safety.test.ts` |
| `src/lib/backup/manifest.ts` | did not exist | retention buckets with enforced floors; `assertRetentionSafe`; `isVerified` | Part 3.1 layer 3 | `tests/backup-safety.test.ts` |
| `src/lib/backup/media-plan.ts` | did not exist | pure copy planner + owner sentence | Part 4 | `tests/media-backup.test.ts` |
| `src/lib/alerts.ts` | did not exist | two independent channels, bounded timeout, retry for critical, duplicate suppression, severity floor (recovery exempt), delivery status, sanitised context, test alert | Part 7 | `tests/alerts.test.ts` |
| `src/app/api/health/route.ts` | database check only, `{status}` body | unchanged contract (`healthy`/`degraded`, 200/503), plus `checks.database` and a short commit id; logs detail server-side only | Part 6 | `tests/health-readiness.test.ts` |
| `src/app/api/health/ready/route.ts` | did not exist | readiness: `200` bookable, `503` only when a **critical** dependency fails; names and statuses only | Part 6 | `tests/health-readiness.test.ts` |
| `src/lib/health.ts` | did not exist | liveness vs readiness, per-check role (critical / required_for_writes / optional), backup freshness evaluation, media/encryption checks, `ownerStatusFromReadiness` | Parts 6, 15 | `tests/health-readiness.test.ts` (23) |
| `src/lib/system-status.ts` | did not exist | owner-facing wording with tones `good/watch/action/off`; never says Redis, database, server, HTTP, token | Part 15 | `tests/system-status.test.ts` (34) |
| `src/lib/rate-limit.ts` | fail-closed, silent | unchanged thresholds and 503/429 split; adds outage counter, short credential-free failure kind, last success/failure timestamps, one alert per incident, recovery notice; `checkRateLimitStoreHealth` probe does not spend allowance | Part 5 | `tests/rate-limit-recovery.test.ts` (22) + the 4 existing suites (unchanged) |
| `src/lib/env-registry.ts` | no backup/alert variables | 20 new optional entries in two new categories (`BACKUP`, `ALERTS`) with format, secret flag, how-to-obtain, how-to-fix and feature mapping; nothing made mandatory | Part 13 | `npm run env:drift`, `architecture:check` |
| `scripts/generate-env-template.ts` | printed existing categories | includes `BACKUP` and `ALERTS` so `.env.example` stays generated, not hand-edited | Part 13 | `npm run env:template` (generated) |
| `src/app/(dashboard)/dashboard/factory-status/page.tsx` | launch checklist only | adds a **Right now** panel (one plain sentence per owner concern) above the unchanged checklist; no `Date.now()` during render | Part 15 | `tests/system-status.test.ts`, lint rule |
| `prisma/schema.prisma` | — | new `BackupRun` model (history only) | Parts 3, 6 | `prisma validate` |
| `package.json` | — | new scripts: `db:backup:offsite`, `db:backup:freshness`, `media:backup`, `alert:test`, `test:backup`, `test:operations`; both new suites appended to `test:ci` and `test:all` | Parts 3, 21 | `node -e` parse, suite run |
| `.github/workflows/ci.yml` | backup verify existed | installs `postgresql-client`; runs `test:backup`, `test:operations`, a real off-site round trip with `BACKUP_VERIFY_RESTORE=true` against the seeded DB, and the freshness watchdog. Existing steps untouched | Parts 3.3, 21 | CI file reviewed |

Nothing was deleted. No existing test was weakened or removed.

## C. New files

Scripts: `backup-offsite.ts`, `media-backup.ts`, `alert-test.ts`,
`backup-freshness.ts`, `rls-plan.ts`, `lib/backup-storage.ts`.
Libraries: `src/lib/backup/{crypto,manifest,media-plan}.ts`, `src/lib/alerts.ts`,
`src/lib/health.ts`, `src/lib/system-status.ts`, `src/app/api/health/ready/route.ts`.
Tests: `backup-safety`, `backup-offsite`, `backup-failure-modes`, `media-backup`,
`alerts`, `rate-limit-recovery`, `health-readiness`, `system-status`,
`failure-simulation`.
Docs: `DISASTER-RECOVERY.md`, `RLS-STAGING-PLAN.md`, this report; §5 appended to
`OPERATIONS.md`.
Migration: `prisma/migrations/20261117090000_backup_run_history/`.

## D. Database changes

- **One migration, additive:** `CREATE TABLE "BackupRun"` + two indexes, `IF NOT EXISTS`,
  no existing table touched, no data rewritten. Rollback = deploy the previous
  application (the table is simply unused). No destructive statement, no
  `migrate reset`, no `db push`.
- **No policy applied.** `prisma/rls/production-rls.sql` is untouched; the staged
  plan and role requirements are in `docs/RLS-STAGING-PLAN.md`.
- **No new constraint or index on existing tables.** Overlap exclusion and
  `idempotencyKey @unique` are preserved as-is.
- Requires staging: applying RLS, and switching the runtime role. Requires owner
  approval: any production restore or cutover.

## E. Redundancy implementation

| Layer | Mechanism | Honest status |
| --- | --- | --- |
| Primary DB | provider automated backups + PITR (documented steps) | **Owner action outstanding**; nothing was enabled from code |
| Independent copy | encrypted, checksummed, read-back-verified off-site object in a second provider | Implemented + tested; **storage bucket and key not created** |
| Archive/retention | 7 daily / 4 weekly / 6 monthly, floor of 3 verified, refuses to delete the last copy | Implemented + tested |
| Media | encrypted copy at preserved pathnames, originals never deleted | Implemented + tested; **bucket not created** |
| Integrity | SHA-256 of plaintext and object, authenticated decryption, size and hash on read-back | Tested (corruption detected) |
| Restore proof | scratch restore + row counts + all FKs + tenant orphans + migration parity | Tested against real PostgreSQL 15 |
| Redis | fail-closed preserved, outage counted, alerted once, recovery detected and announced, probe spends no allowance | Tested |
| Monitoring | liveness, readiness, backup freshness, encryption/storage gaps, optional integrations separated | Tested |
| Alerting | two channels, retry, dedupe, floor, recovery notices, sanitised payloads | Implemented + tested; **no real webhook configured** |
| Restoration | 11-step runbook, no automatic cutover, quarterly rehearsal | Documented; **no rehearsal performed** |

## F. Testing evidence

Baseline = untouched `main` @ `27b9c46` in a separate worktree, same database, same
environment. "After" = this branch.

| Check | Before | After | Result |
| --- | --- | --- | --- |
| `architecture:check` | passed (592 files) | passed (618 files) | no regression |
| `test:architecture` | passed | passed | no regression |
| `lint` | 0 errors / 103 warnings | 0 errors / 103 warnings | no regression |
| `typecheck` (`tsc --noEmit`) | clean | clean | no regression |
| `npx prisma validate` / `generate` | valid | valid | pass |
| `test:tenant` (`tenant-isolation`) | 22/0 | 22/0 | no regression |
| `test:matrix` (`cross-tenant-matrix`) | cannot run (needs live server :3000) | same | **not run, unchanged** |
| `test:booking` | 20/0 | 20/0 | no regression |
| `booking-rules` | 25/0 | 25/0 | no regression |
| `booking-concurrency` | 13/0 | 13/0 | no regression |
| `test:queue` | 47/0 | 47/0 | no regression |
| `test:reliability` | 5/0 | 5/0 | no regression |
| `observability` | 6/0 | 6/0 | no regression |
| `plain-language` | 3/0 | 3/0 | no regression |
| `security-hardening` | 34/0 | 34/0 | no regression |
| `notification-resilience` | cannot run (needs live server) | same | **not run, unchanged** |
| `rate-limit-store-failure` | 15/0 | 15/0 | no regression |
| `rate-limit-store-health` | 6/0 | 6/0 | no regression |
| `rate-limit-outcomes` | 23/0 | 23/0 | no regression |
| `rate-limit-ip` | 19/0 | 19/0 | no regression |
| `tenant-key-sync` | 6/0 | 6/0 | no regression |
| `db:backup-verify` | dump + restore only | full parity suite, PASS | strengthened |
| `test:backup` (new) | n/a | 121 assertions passing | pass |
| `test:operations` (new) | n/a | 124 assertions passing | pass |
| `env:drift` / `env:doctor` | — | see G (not yet run in this session) | pending |
| `npm run build` | OK | OK (after the Next.js security nudge retry) | pass |
| `test:e2e` / `test:a11y` | Playwright, needs browsers + live server | not run | **not run** |

`test:all` was **not** run end to end: several suites in it are live-server suites
(`cross-tenant-matrix`, `notification-resilience`, owner-registration,
co-owner-permissions) and Playwright suites need browsers. Every DB-backed suite
listed above was run individually on both sides instead. That gap is stated rather
than hidden.

## G. Remaining requirements

1. **Code still needed:** `withTenant()` transaction helper and routing the
   tenant-scoped query paths through it (prerequisite to RLS); `scripts/rls-plan.ts`
   wired into CI; optional media-restore drill command.
2. **Vercel:** confirm the plan suits commercial clients (cron granularity, function
   duration) — the brief's own open item; add `BACKUP_*`/`ALERT_*` variables to the
   production environment; redeploy.
3. **Database provider:** enable automated backups + PITR + retention + failure
   notifications; create the runtime role split for RLS on staging.
4. **Redis:** confirm the Upstash plan's connection limits; keep credentials present
   so the limiter never falls back to per-instance memory in production.
5. **Backup storage:** create the second-provider bucket with versioning/immutability,
   a bucket-scoped key, and `BACKUP_ENCRYPTION_KEY` stored independently.
6. **Monitoring:** configure `ALERT_WEBHOOK_URL` (second provider from
   `OBSERVABILITY_WEBHOOK_URL`), run `npm run alert:test`, and schedule
   `db:backup:offsite` + `db:backup:freshness` on a long-job scheduler.
7. **Legal review:** not performed. Nothing here constitutes legal approval.
8. **Accessibility review:** independent human review not performed; automated
   a11y/contrast suites not run in this session.
9. **Owner decisions:** repository visibility (currently **public**), branch
   protection and required CI checks, per-client deployment/secrets separation,
   hosting plan, licensing, support model.
10. **Real barbershop acceptance:** not performed. Gate 6 cannot be closed by code.

## H. Deployment recommendation

**READY FOR STAGING.**

Evidence: every DB-backed suite that ran on baseline still passes identically;
lint, typecheck, schema validation and the production build pass; the new code is
additive with one new-table migration; the backup path is now proven by restore
rather than by upload; 245 new assertions cover the failure modes that previously
had no test. Not "production" because provider backups/PITR, the off-site bucket,
the alert webhook, staging-side RLS, repository protection and a real barbershop
acceptance have not been completed, and no restore rehearsal has been timed.
