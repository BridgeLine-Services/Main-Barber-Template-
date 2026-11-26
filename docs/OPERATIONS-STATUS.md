# Operations status, as measured

This file records what the repository can and cannot say about a running deployment. It exists
because the failure mode that matters for a paid shop is not a missing feature: it is a screen
that says "working" when nobody has connected the provider.

**How to read the columns.** *In code* means the implementation exists and is tested. *Configured*
means a real deployment has the credentials. *Verified* means somebody ran it against the provider
and saw it work. This workspace can only establish the first column. Nothing below claims more.

## Environment variables

`src/lib/env-registry.ts` is the single inventory: every variable, whether it is secret, whether
it is platform-managed, when it is required, and how to obtain it. `blockingEvaluations()` returns
the ones that stop a launch. Nothing here adds a second list; if a variable is missing from the
registry it is a bug in the registry.

Required for any deployment: `DATABASE_URL` (or a provider alias the build resolves),
`NEXTAUTH_SECRET`, `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL`.

Required for a shop that takes bookings under load: `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`. Without them the rate limiter fails **closed** in production: it does
not silently allow everything, it refuses with `store_not_configured`. That is deliberate and is
covered by `tests/rate-limit-store-failure.test.ts`. The owner-facing consequence: first-owner
registration is blocked until Redis is connected, and the message must say that rather than
accusing the person of abuse.

## Health and readiness

- `/api/health` — liveness, no tenant data.
- `/api/health/ready` — 200 when bookable, 503 when a critical dependency (the database) is down.
  The response contains names and statuses only, never customer or business data.

## Backups: what is real

| Layer | State |
| --- | --- |
| Backup and restore **verification in CI** | Verified. `npm run db:backup-verify` runs against a throwaway database. |
| Off-site copy workflow | In code (`.github/workflows/backup-offsite.yml`). It exits 0 with a notice while `DATABASE_URL` is unconfigured, which is honest: an unconfigured backup is not a passing backup. |
| Long-term archive workflow | In code (`.github/workflows/backup-archive.yml`, monthly), alerts on failure with a plain-language message. |
| Media backups | In code (`scripts/media-backup.ts`). |
| Freshness and failure-mode checks | In code (`scripts/backup-freshness.ts`, `tests/backup-failure-modes.test.ts`). |
| **Provider-level automated daily backups with retention** | **Not configured.** This is a hosting/provider action, not a code change. |
| **A real restore rehearsal on production or staging data** | **Not done.** A CI scratch-database restore is not that. |

## Third-party integrations

| Integration | In code | Configured here | Verified against the provider |
| --- | --- | --- | --- |
| Stripe (payments) | Yes, including webhook state machine and 5-minute processing lease | Unknown from this workspace | **No.** No live or test-mode acceptance has been run here. |
| Twilio (SMS) | Yes, including STOP/START consent handling and signature verification | Unknown | **No.** |
| SMTP (email) | Yes, with a configuration-issue message that names what is missing | Unknown | **No.** |
| Vercel Blob (uploads) | Yes, with trusted-URL validation | Unknown | **No.** |
| Google Business | Yes, OAuth state signed with HMAC-SHA256 | Unknown | **No.** |

"Unknown" is the honest answer: this workspace has no provider credentials and no access to the
deployment's environment. A shop must not be told a payment provider is working because the code
exists.

## Alerts

Alert delivery and minimum severity are configured through the environment registry
(`ALERT_WEBHOOK_URL`, `ALERT_MIN_SEVERITY`). Failure messages are written for a shop owner: what
happened, whether the shop is affected, and what to do. Whether an alert channel is connected in a
given deployment is a configuration fact this workspace cannot see.

## Scheduling

`vercel.json` runs four jobs daily and the organization-report sweep every 15 minutes. The
15-minute sweep needs a plan that permits sub-daily crons (not Hobby); see
`docs/LAUNCH-READINESS.md`. The cron-policy assertion in `tests/optional-integrations.test.ts` currently fails on `main`
(19 passed, 1 failed) because it predates the report sweep; the correction lives on the
Phase 1 branch (`phase1/release-confidence`), which allows only the report sweep to be
sub-daily. Until that merges, this document describes the intended policy, not an enforced one.

## What this file does not establish

No deployment, no staging environment and no provider account was touched while writing it. The
launch blockers in `docs/LAUNCH-READINESS.md` stand unchanged: a paid hosting plan, provider
credentials, a real restore rehearsal, legal review of the LICENSE, an independent accessibility
pass, and owner sign-off.
