# Launch gates and recovery targets — evidence as of 2026-11-17

Companion to `docs/RELEASE-ROBUSTNESS-2026-11-17.md` (audit and file-by-file
changes). This page answers one question per gate: **what has been shown, and what
has not.** Nothing here is marked PASS because code exists.

Legend: **PASS** demonstrated here, **PARTIAL** partly demonstrated,
**BLOCKED** needs something this environment cannot provide (provider credentials,
a person, a browser, a real shop).

## Gate 1 — Infrastructure

| Check | Status | Evidence |
| --- | --- | --- |
| Production build | PASS | `npm run build` completes; all routes emitted |
| Database connectivity | PASS | full suite against PostgreSQL 15; `/api/health` returned 200 on the built app |
| Redis limiter | PARTIAL | fail-closed and recovery behaviour covered by tests; no Upstash credentials here, so `env:doctor` reports them missing |
| Primary provider backups | BLOCKED | provider setting; numbered steps in `docs/DISASTER-RECOVERY.md` §1.1 |
| Independent off-site backups | PARTIAL | ran end to end: dump → encrypt → upload → read back → restore (68 tables, 58 migrations). No real bucket exists yet |
| Media backups | BLOCKED (scheduled job ready) | `media-backup` workflow now mirrors every indexed photo daily and then proves one can be recovered; `media:backup` reports `NOT CONFIGURED` with exit 3 and no alert. Needs the Blob token and destination secrets |
| Restoration works | PASS | `db:backup:rehearse` restored from the stored copy in **5 s**, 0 foreign-key violations, 58 migrations |
| Monitoring | PASS | `/api/health`, `/api/health/ready`, freshness watchdog, alert-channel readiness check |
| Rollback | PARTIAL | `docs/ROLLBACK.md` and the `deploy:migration-check` gate; no Vercel project here to promote |

## Gate 2 — Security

| Check | Status | Evidence |
| --- | --- | --- |
| Authentication / sessions | PASS | existing session suites unchanged and green |
| Permissions / roles | PASS | `security-hardening` 34/0, role and co-owner suites unchanged |
| Tenant isolation (application layer) | PASS | `tenant-isolation` 22/0, `tenant-key-sync` 6/0 |
| Database-level isolation (RLS) | PARTIAL, now proven offline | policies executed against a throwaway copy of the real schema as the runtime role: 18/18 checks, cross-tenant reads/writes refused, fail-closed with no tenant set, setting cleared at COMMIT. Found and fixed a genuinely unprotected table (`SmsConsentLog`) and a role-name mismatch between stage 1 and stage 2. **Still not applied to production** (`docs/RLS-STAGING-PLAN.md` §7) |
| Secrets protected | PASS | `architecture:check`, `env:drift`, secret scan clean; no credential in any new file |
| Audit logging | PASS | existing audit-log suite unchanged |
| Cron endpoints | PASS | all three require `CRON_SECRET` and answer 401 (asserted in `failure-simulation`) |

## Gate 3 — Functionality

| Check | Status | Evidence |
| --- | --- | --- |
| Booking / cancel / reschedule | PASS | `booking` 20/0, `booking-rules` 25/0, `booking-concurrency` 13/0 |
| Walk-in queue | PASS | `queue` 47/0 |
| Dashboards, staff, portals | PASS | every DB-backed suite matches the untouched baseline exactly |
| Duplicate-booking protection | PASS | unique `idempotencyKey` plus database overlap exclusion, asserted in two suites |

## Gate 4 — Usability

| Check | Status | Evidence |
| --- | --- | --- |
| Plain language | PASS | `plain-language`, `system-status` 34/0 (no infrastructure words in owner copy) |
| Error messages | PASS | new surfaces use the Part 2 sentences; existing UI untouched |
| Accessibility | PARTIAL | static audit: 0 violations, 7 structural notes; human review outstanding (`docs/ACCESSIBILITY-REVIEW.md`) |
| Mobile / touch | BLOCKED | needs a browser and a person |

## Gate 5 — Business readiness

| Check | Status | Evidence |
| --- | --- | --- |
| Commercial hosting suitability | BLOCKED | owner decision; plan limits must be confirmed |
| Licensing / legal review | BLOCKED | no qualified legal review has been done, and none is claimed |
| Client separation procedures | PASS (documented) | `docs/CLIENT-DEPLOYMENT.md` |
| Repository protection | BLOCKED | repository is public; settings need owner authorisation |
| Support / onboarding procedures | PARTIAL | handover pack documented; no support rota exists |

## Gate 6 — Real barbershop acceptance

**BLOCKED.** No shop has run a day on this build. Owner onboarding, barber
onboarding, walk-ins, day close and a support handoff need a real shop and a real
person. A green build does not close this gate.

## Recovery targets (Part 19)

Measured on the disposable test database, which is far smaller than a live shop.
The value of the drill is that the procedure is now one command that prints the
number; the production figure must be measured on production-sized data.

| Metric | Target | Status |
| --- | --- | --- |
| Database RPO | 15 min (PITR) | BLOCKED — needs provider PITR |
| Database RTO | 1 hour | PARTIAL — 5 s measured on the test database; procedure proven, production-sized figure not measured |
| Daily / weekly / monthly retention | 7 d / 4 w / 6 m | PASS — enforced in code with a floor of 3 verified copies |
| Backup verification | weekly automated | PARTIAL — CI and the scheduled workflow both do it; the workflow is unconfigured until secrets exist |
| Full recovery rehearsal | quarterly | PARTIAL — one rehearsal performed 2026-11-17 (5 s, 68 tables, 58 migrations); procedure is one command (`npm run db:backup:rehearse`) |
| Critical alert delivery | tested end to end | BLOCKED — `npm run alert:test` needs a real webhook |
| Booking integrity | no duplicate confirmed bookings | PASS — database idempotency plus overlap exclusion |

## How to move a BLOCKED row to PASS

1. Provider backups and PITR → `docs/DISASTER-RECOVERY.md` §1.1, then `npm run db:backup-verify`.
2. Off-site bucket → §2.1–2.2, then `npm run db:backup:offsite` and `npm run db:backup:rehearse`.
3. Media bucket → set the Blob token, then `npm run media:backup` and `npm run media:restore-check`.
4. Alert channels → set `ALERT_WEBHOOK_URL`, then `npm run alert:test`.
5. Repository settings → `docs/CLIENT-DEPLOYMENT.md` §3, by the owner.
6. Browser and human checks → `docs/ACCESSIBILITY-REVIEW.md`, section "How to close this".
7. A real shop → Gate 6. No command substitutes for it.
