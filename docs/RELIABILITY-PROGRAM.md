# The Reliability Program

Written for shop owners first, engineers second. Everything below is in the
application today; anything that is not is named as missing rather than implied.

## What it is

A maintenance centre that answers five questions in plain language:

1. Is my website working?
2. Can customers book?
3. Are my customer records safe?
4. Are my backups working?
5. Is anything waiting on me?

## Where to find it

- **Is everything working?** `/dashboard/reliability` (owner). One screen, three
  sections: right now, software and updates, what to do next.
- **Launch checklist** `/dashboard/factory-status`. Per-item detail, technical
  codes kept behind plain summaries.
- **Search readiness** `/dashboard/seo-health`. What search engines cannot read.
- **Health endpoint** `/api/health` and `/api/readiness` for uptime monitors.

## What is checked, and by whom

| Area | Source | Notes |
| --- | --- | --- |
| Database reachable | `src/lib/health.ts` `checkDatabase` | A failed check is never drawn as healthy |
| Booking readiness | `buildReadinessReport` | Business, services, barbers, hours |
| Backup freshness | `checkBackupFreshness` + `evaluateBackupFreshness` | Only a *verified* backup counts, not an existing file |
| Backup encryption | `checkBackupEncryption` | Key present and 32 bytes |
| Media storage | `checkMediaStorage` | Unconfigured reads as not configured |
| Alert delivery | `checkAlerting` | Optional; absent is not a fault |
| Optional integrations | `checkOptionalIntegrations` | Existing feature ≠ working integration |
| Software support | `src/lib/platform-reliability/dependency-monitor.ts` | Vendor support needs live data; without it the answer is "could not check" |

## The four states you will see

- **Healthy** everything that was checked passed.
- **Needs attention** working now, will not stay that way without a small action.
- **Action required** something is broken or unsafe right now.
- **Not configured / could not check** the check did not run. This is never
  reported as healthy, because not knowing is not the same as being fine.

## Repairs: three classes

Classification lives in `dependency-monitor.ts` as a type, not a comment, so a
caller cannot accidentally treat an upgrade as routine.

**Automatic** (safe, additive, reversible): regenerate the Prisma client, re-run
diagnostics, reconcile generated files, run a backup verification, produce a
report. Only a same-line patch may ever qualify.

**Approval required** (a person decides): any minor or major dependency or
runtime upgrade, database migrations, authentication, payments, permissions,
production configuration.

**Manual specialist review**: suspected data corruption, a failed production
restore, a credential compromise, unexplained cross-tenant access, a failed
security-critical database operation.

The program never deletes customer records, changes ownership, disables
authentication, alters permissions, bypasses tenant isolation, changes payment
behaviour, or touches a production schema on its own.

## How backups are verified

A backup object existing proves nothing. Verification means the archive was read
back, its manifest matched, and the database dump was restored into a disposable
database and queried. `scripts/backup-freshness.ts` and the archive workflow do
the read-back; the off-site rehearsal in CI restores into a scratch database.
Restores are never run against production.

## What to do when an alert appears

1. Read the sentence, not the code. It names what happened and what it means.
2. If it says action required, deal with that one first.
3. If it says could not check, nothing is broken; look again later.
4. If it mentions backups, check `/dashboard/factory-status` before assuming data
   is at risk.
5. Anything about permissions, payments or tenant access: stop and get a
   specialist. The program deliberately cannot fix those itself.

## Rollback

Every change in this program is additive and reversible. `docs/ROLLBACK.md`
covers reverting a release; `docs/DISASTER-RECOVERY.md` covers restoring data.
Nothing in the Reliability Program writes to the database.
