# Separate deployments per client shop

The template can host many shops in one deployment (tenant isolation), or one
deployment per client. This is the second option, and it exists because a
commercial client eventually asks for their own copy: their domain, their
database, their data-processing position, their incident path.

## What must be separate, and why

| Thing | Separate per client? | Reason |
| --- | --- | --- |
| Vercel project | Yes | one bad deploy cannot take every shop down |
| PostgreSQL database | Yes | a restore or corruption event stays inside one client |
| Backup bucket and encryption key | Yes | a stolen key exposes one client, not the portfolio |
| Environment variables | Yes | credentials are per client, never shared |
| Domain | Yes | their brand, their certificate, their DNS |
| Rate-limit namespace | Yes | per-client limits, no key collisions |
| GitHub repository | No | one master repository, private, protected (see below) |

## Provisioning a client (numbered)

1. Create a Vercel project from the **same** repository, named `barber-<client>`.
2. Create a new PostgreSQL database for that client.
3. Generate `BACKUP_ENCRYPTION_KEY` for this client only and store it in their
   password-manager entry.
4. Create their own backup bucket: private, versioned, bucket-scoped key, on a
   provider different from their database.
5. Fill their environment from `.env.example`: `DATABASE_URL`, `NEXTAUTH_SECRET`,
   `NEXTAUTH_URL`, `CRON_SECRET`, the Upstash pair, `BACKUP_*`, `ALERT_WEBHOOK_URL`.
6. Run `npm run env:check` against those values. Fix every blocking problem before
   the first deploy.
7. Deploy, then open `/api/health` and `/api/health/ready`.
8. Create the owner account through the normal onboarding flow, never by inserting
   rows.
9. Add their domain in Vercel, then **Domains**, and wait for the certificate.
10. Configure their scheduled backup: their own repository secrets for
    `.github/workflows/backup-offsite.yml`, or their own scheduler. Never reuse
    another client's secrets.
11. Run `npm run db:backup:offsite`, then `npm run db:backup:rehearse`, and keep
    the evidence file with the handover pack.
12. Record in the handover pack: database provider and region, bucket, where the
    key lives, alert channel, who to call, and the date of the first rehearsal.

## Master repository protection

Settings, not code. Changing them needs the owner's decision. Verified on
2026-11-17: the repository is **public**, and GitHub reports 1 moderate Dependabot
alert on the default branch.

1. Settings → General → **Change visibility** → Private.
2. Settings → Branches → rule for `main`: require a pull request, require the CI
   checks, disallow force pushes, disallow deletion.
3. Settings → Tags → protect `v*` release tags so a shipped tag cannot move.
4. Settings → Secrets → confirm no client credential sits at repository level.
5. Enable Dependabot security updates so the open alert arrives as a PR.

None of these were changed in this round.

## Handover pack per client

Their domain and sign-in details; who to contact and when; the plain-language
outage explanation from `docs/DISASTER-RECOVERY.md` §5; backup schedule, retention
and the date of the last verified rehearsal; a one-page "if something looks wrong"
card (try again, check status, call support, do not book twice); and the written
scope of who is responsible for backups, domain, database billing and local
compliance.
