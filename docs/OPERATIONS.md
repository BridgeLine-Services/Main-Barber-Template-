# Operations Guide — Backups, Monitoring, Third-Party Services

This document describes the operational configuration the template
expects in production. The template ships none of this infrastructure;
each deployment must configure it per client.

## 1. Backups & Disaster Recovery

**Data to protect**

| Tier | Contents | Examples |
| --- | --- | --- |
| Operational | Postgres database | appointments, customers, staff accounts |
| Media | Uploaded files (barber photos, gallery, logos) | public/media storage |
| Config | Environment variables, domain settings, DNS records | Vercel/DB consoles |
| Code | Client repository, migrations | GitHub |

**Database backups (required per deployment)**

- Automated daily backups with at least a 7-day retention window; weekly
  backups retained at least 4 weeks.
- Recommended: managed provider PITR (point-in-time recovery) if the
  database host offers it; otherwise scheduled `pg_dump` to off-host
  object storage.
- Test a restore at least once per quarter. An untested backup is not a
  backup.

**Media backups**

- Uploaded images live outside the database. Enable provider-level
  storage versioning or scheduled sync to a second location.

**Disaster recovery targets (recommended defaults, tune per client)**

| Metric | Target |
| --- | --- |
| RPO (max data loss) | 24 hours (or PITR window) |
| RTO (max downtime) | 4 hours |
| Backup retention | 7 daily / 4 weekly / 6 monthly |

**Recovery procedure sketch**

1. Provision a replacement Postgres instance and Vercel deployment.
2. Apply the latest schema migrations (`prisma migrate deploy`).
3. Restore the latest verified backup.
4. Re-apply environment variables from the secured secrets store.
5. Smoke-test: sign-in, booking creation, tenant isolation (two shops).
6. Cut DNS to the replacement and monitor errors for 24 hours.

## 2. Monitoring & Alerts

**Application health checks**

- Availability: HTTP check on the deployment's `/` route, at least every
  5 minutes.
- Build/deploy status: monitor the CI pipeline and Vercel deploy hooks.

**Errors**

- Route `console.error` output (the app logs structured errors, e.g.
  `[auth]`, `[audit_log_failed]`) to a log drain. Recommended: Vercel log
  drain into an alerting service (e.g. Better Stack, Datadog, Axiom).
- Alert on: 5xx rate above 1% for 5 minutes, repeated
  `[audit_log_failed]` events, repeated database connection failures.

**Security signals**

- Failed sign-in spikes per IP (see the built-in login throttle).
- Password-reset request volume spikes.
- Audit-log review: `BUSINESS_DEACTIVATED`, `USER_ROLE_CHANGED`,
  `SHOP_CONFIGURATION_RESET` events should match known administrative actions.

**Data quality**

- Daily job checking appointment integrity: end < start, orphaned
  bookings, future-dated completions.

## 3. Third-Party Services

The template's only hard external dependencies at runtime are the
platform (Vercel) and the Postgres database. Optional services:

| Service | Used for | Requirement |
| --- | --- | --- |
| Email provider (e.g. Resend/SES) | Password resets, booking confirmations | Enabled only when `EMAIL_ENABLED=true` — credentials in env vars, never committed |
| Google Business Profile | Review sync | OAuth per client, optional |
| Maps/geo provider | Location display | Optional |

**Service contract rules**

- Every integration must degrade gracefully when disabled.
- No client may be able to read another client's integration credentials.
- Adding a new third-party service requires updating this document, the
  client's privacy policy (see docs/LEGAL-PLACEHOLDERS.md), and the
  deployment guide.

## 4. Soft Deactivation (built-in)

The template supports soft deactivation per shop (owner settings →
danger zone): staff sign-ins and public bookings are blocked, all data
preserved, one-click reactivation. Deactivation events are audited
(`BUSINESS_DEACTIVATED` / `BUSINESS_REACTIVATED`).
