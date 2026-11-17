# Disaster recovery and backup operations

Owner-facing summary: **your shop's data is protected by more than one copy, and
every copy is tested by restoring it.** This document is the operator's side of
that promise: what exists, how to prove it works, and what to do on the worst day.

Read `docs/OPERATIONS.md` for day-to-day running, `docs/MIGRATION-RECOVERY.md`
before touching migrations, and `docs/RELEASE-ROBUSTNESS-2026-11-17.md` for the
audit and evidence behind this document.

---

## 0. The three layers, in one table

| Layer | What it protects | Where it lives | Who sets it up | Verified by |
| --- | --- | --- | --- | --- |
| 1. Primary | The live database | The managed PostgreSQL provider | Provider dashboard (owner) | `npm run db:backup-verify` |
| 2. Independent off-site | The same database, encrypted, on a **different** provider account | Object storage (S3-compatible) or a mounted volume | Operator, once per deployment | `npm run db:backup:offsite` (reads the object back) |
| 3. Archive / retention | Older recovery points: 7 daily, 4 weekly, 6 monthly minimum, plus **one copy per month for 13 months** in a key routine retention never touches | The archive destination (`BACKUP_ARCHIVE_*`, or the layer-2 store with an `archive/` prefix) | Monthly (`backup-archive.yml`) | `npm run db:backup:archive`: copies only a copy that already carries a matching checksum, reads the archived bytes back, compares them and decrypts them, refuses to overwrite a differing archive, and never deletes the current month |
| Media | Shop logos, barber photos, gallery, before/after images | Independent bucket copy, encrypted | Operator, once per deployment | `npm run media:backup` |

A database backup does **not** contain uploaded photos. They are separate layers
on purpose: restoring the database without the media bucket gives a shop with
every appointment intact and every image broken.

**Nothing in this document has been applied to a live provider from this
repository.** Application code, scripts, tests and checklists are in place; the
provider steps below are yours to run, and `docs/RELEASE-ROBUSTNESS-2026-11-17.md`
records which of them are still outstanding.

---

## 1. Layer 1 — the primary database

Two things must be true, and only the provider dashboard can make them true.

### 1.1 Turn on provider backups (5 minutes, once)

1. Open your database provider's dashboard and select the project that holds the
   shop's database.
2. Find **Backups** (on most providers it is a left-hand menu item or a tab on the
   database page).
3. Confirm the plan includes **automated daily backups**. If the page offers
   **Point-in-time recovery (PITR)**, switch it on: it is what turns a 24-hour
   worst case into a 15-minute one.
4. Set retention to at least **7 days**. If a longer option is free, take 30.
5. Find **Notifications** or **Alerts** for the database and add the operator's
   email, so a failed backup is not discovered during an incident.
6. Copy the provider's restore instructions into your own runbook, or note the
   page URL here: `______________________________`.

What "done" looks like: the backups page shows a completed backup with a
timestamp from today, and a restore/PITR control exists.

### 1.2 Prove the dump is restorable, not just present

```bash
# writes backups/barber-<utc>.sql.gz
npm run db:backup

# dump + restore into a scratch database + integrity checks, then drop it
npm run db:backup-verify

# keep the dump for inspection
npm run db:backup-verify -- --keep

# verify an existing artifact (this is how the off-site copy is proven)
npm run db:backup-verify -- --file backups/barber-20261117-030000.sql.gz
```

Exit codes: `0` verified, `1` the backup failed or did not restore, `2`
configuration or client-tool problem. `--json` prints one machine-readable line.

The verify run proves, in order: the dump contains a schema and data; it restores
into a scratch database; the number of base tables matches the application;
row counts match the source for `Business`, `User`, `Appointment`, `Customer`,
`Barber`, `Service`, `Payment`; **every** single-column foreign key holds in the
restored copy; no appointment is orphaned from its business; the applied migration
count matches. Only then does it print `PASS`.

`db:backup-verify` needs `CREATE DATABASE` on the target server. If production's
application role does not have it, point `--url` at an admin connection for the
verification run, or verify a staging copy. The dump itself never needs it.

---

## 2. Layer 2 — independent off-site backups

### 2.1 Create the destination (numbered, once)

Pick a provider **different from the database provider** — that is the entire
point of this layer. Cloudflare R2, Backblaze B2, Amazon S3 and MinIO all work.

1. Create an account with the second provider.
2. Create a **private** bucket, for example `barbershop-backups-<shop>`.
3. Turn on **object versioning** and, if offered, **object lock / immutability**
   with a 30-day retention. This is what stops a stolen credential from erasing
   the recovery set.
4. Create an access key scoped to **that bucket only** (read, write, list,
   delete). Do not reuse an account-wide key.
5. Note the endpoint URL, the bucket name and the region (Cloudflare R2 uses
   `auto`).

### 2.2 Store the settings and the encryption key

Set these in the deployment environment (Vercel → Project → Settings →
Environment Variables → Production, then Redeploy). Every one is optional: an
unset destination never breaks the shop, it only means there is no independent
copy — and readiness says so.

| Variable | Example | Notes |
| --- | --- | --- |
| `BACKUP_STORAGE_DRIVER` | `s3` or `localfs` | `localfs` = a mounted volume on a second provider |
| `BACKUP_LOCAL_DIR` | `/mnt/backups` | only for `localfs` |
| `BACKUP_S3_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` | |
| `BACKUP_S3_REGION` | `auto` | |
| `BACKUP_S3_BUCKET` | `barbershop-backups` | private, versioned |
| `BACKUP_S3_ACCESS_KEY_ID` | *(secret)* | bucket-scoped |
| `BACKUP_S3_SECRET_ACCESS_KEY` | *(secret)* | bucket-scoped |
| `BACKUP_S3_FORCE_PATH_STYLE` | `true` | required by MinIO and some providers |
| `BACKUP_ENCRYPTION_KEY` | *(secret)* | `openssl rand -base64 32` |
| `BACKUP_VERIFY_RESTORE` | `true` | include a real restore in each run |
| `BACKUP_RETENTION_DAYS` / `_WEEKS` / `_MONTHS` / `_MIN_COPIES` | `7` / `4` / `6` / `3` | floors are enforced |
| `BACKUP_COMMAND_TIMEOUT_MS` | `900000` | per-command timeout |

**Store `BACKUP_ENCRYPTION_KEY` in a password manager as well as the deployment.**
Without it the off-site copies cannot be decrypted, and it must not live only in
the bucket being backed up. Losing it is the one failure this layer cannot
recover from.

Do not put any of these in `NEXT_PUBLIC_*`. `npm run env:check` fails if a secret
is exposed to the browser.

### 2.3 Run it, and watch what it proves

```bash
npm run db:backup:offsite
```

Each run: dumps → gzips → AES-256-GCM encrypts → uploads → confirms the object
exists and its size → **reads it back**, authenticates, decompresses and compares
hashes → optionally restores it into a scratch database → writes a manifest →
applies retention → records the run in `BackupRun` → sends a recovery notice if a
previous run had failed.

Exit codes: `0` stored and verified, `1` failed (alerted), `2` another run is in
progress, `3` not configured (reported as a gap, **not** as a failed backup — the
primary backup still exists and the shop is unaffected).

A run is never called successful on the strength of a successful upload. If the
stored bytes do not match the dump, the run fails.

### 2.4 Schedule it where a long job can finish

Do **not** add this to Vercel cron. A dump + encrypt + upload + read-back + restore
of a real database outlives a serverless invocation, and a cron entry that times
out is worse than none. Use a scheduler that permits long jobs:

- **GitHub Actions** (simplest): a scheduled workflow calling
  `npm run db:backup:offsite` with the variables above as repository secrets. It
  must run on a runner that can reach the database, so either allow-list the
  runner or run it from the database host.
- **The database provider's job runner**, if it has one.
- **A small always-on worker** (a $5 VPS or a container job).

Whichever you choose, add a **second, later** job that runs
`npm run db:backup:freshness`. It alerts when the newest *verified* backup is
older than `BACKUP_MAX_AGE_HOURS` (default 30), which is how a scheduler that was
silently disabled gets noticed.

`scripts/backup-offsite.ts` also exposes `checkBackupFreshnessAlert()` for a cron
route if you prefer in-app scheduling.

### 2.5 Retention

| Bucket | Minimum kept | Behaviour |
| --- | --- | --- |
| Daily | 7 | the newest verified run of each day |
| Weekly | 4 | the newest verified run of each ISO week |
| Monthly | 6 | the newest verified run of each month |
| Floor | 3 | absolute minimum number of verified copies that may survive |

Rules that make deletion safe: the newest verified copy is never expired; failed
runs are not counted as recovery copies; unverified objects cannot displace a
verified one; an unreadable manifest is reported and left alone rather than
guessed at; and the whole previous pass aborts if no verified copy would survive
(`assertRetentionSafe`).

---

## 3. Layer 4 — media (uploaded files)

```bash
npm run media:backup
```

Copies every blob listed by the shop's media provider into
`media/<original-path>.enc` in the same off-site destination, encrypted with the
same key, and records a checksum per photo in `media/index.json`.

Rules: originals are only ever read, never deleted; a photo that disappears from
the shop's storage stays in the recovery index **and** in the copy (that is
exactly when the copy matters); an unreadable photo aborts the run instead of
storing junk; and the database's stored URLs are never rewritten, so a restored
database still points at paths that exist.

Recovering a single lost photo:

1. Find it in `media/index.json` (it lists `pathname`, `size`, `storedAt`).
2. Download `media/<pathname>.enc` from the backup bucket.
3. Decrypt with `BACKUP_ENCRYPTION_KEY` (AES-256-GCM, format documented in
   `src/lib/backup/crypto.ts`).
4. Upload the plain file back to the media provider **at the same pathname**, so
   the URL already stored in the database resolves again.

Recovering all media into a new provider account: restore the files at their
original pathnames and update the provider credentials. Because pathnames are
preserved, no database change is required.

---

## 4. Production restoration rehearsal (quarterly)

Owner-facing promise: **we practise this before we need it.** Do it on a
throwaway copy, never over production.

1. **Choose the recovery point.** In the backup destination list the
   `database/*.manifest.json` files, newest first, and pick the newest whose
   `verifiedAt` is set and whose `verifyMethod` is `readback` or `restore`.
   Record its `id`, `checksumSha256` and `startedAt`.
2. **Provision replacement infrastructure.** A new database instance on the same
   provider (or another), same PostgreSQL major version as `prisma/schema.prisma`
   expects. Do **not** point production at it yet.
3. **Restore the database.**
   ```bash
   npm run db:backup-verify -- --url "$NEW_DATABASE_URL" \
     --file <downloaded>.sql.gz
   ```
   This restores into a scratch database and checks it. To load the target
   directly instead, `gunzip -c <file> | psql "$NEW_DATABASE_URL"` after removing
   any incompatible `SET transaction_timeout` line (the verify command does this
   automatically).
4. **Restore media.** Copy the encrypted objects back at their original
   pathnames, or point the application's media credentials at the restored bucket.
5. **Apply migrations — forward only.**
   ```bash
   npx prisma migrate deploy
   ```
   Never `migrate reset`, never `db push` against production. See
   `docs/MIGRATION-RECOVERY.md`.
6. **Restore environment configuration.** Same variable names, same values, new
   secrets where the incident requires rotation. `npm run env:doctor` then
   `npm run env:drift`.
7. **Verify tenant isolation.** `npm run test:tenant && npm run test:matrix`.
8. **Test a real booking** on the restored copy: book, cancel, reschedule, and
   confirm exactly one appointment exists.
9. **Verify access** for an owner, a barber and a customer.
10. **Reconnect the domain** only after 7–9 pass (Vercel → Domains → point at the
    healthy deployment).
11. **Watch** `/api/health/ready` and the alert channel for 30 minutes; then run
    `npm run db:backup:offsite` immediately so the new environment has a verified
    backup of its own.

**No step above may run against the live production database.** A destructive
restore or cutover requires explicit written approval from the owner for that
specific step.

### Recording the rehearsal

Write the date, the backup `id`, what was restored, what was checked, and how long
it took, into the operations log. The targets below are only claims once a
rehearsal has met them.

| Metric | Target | Status |
| --- | --- | --- |
| Database RPO | 15 minutes (with PITR) | Not yet demonstrated — needs provider PITR |
| Database RTO | 1 hour | Not yet demonstrated — needs a timed rehearsal |
| Daily / weekly / monthly retention | 7 / 4 / 6 | Implemented, enforced in code |
| Backup verification | Weekly automated | Implemented; scheduling is the operator's step |
| Full rehearsal | Quarterly | Runbook ready; no rehearsal performed yet |
| Critical alert delivery | Tested end to end | `npm run alert:test` — needs a real webhook |
| Duplicate confirmed bookings | None | Enforced by unique `idempotencyKey` + DB overlap exclusion |

---

## 5. What happens during a failure (and what the owner sees)

| Failure | Customer / owner sees | Operator does |
| --- | --- | --- |
| Database unreachable | "We couldn't confirm your appointment. Please check your booking status before submitting another request." Owner: website row says temporarily unavailable, data is safe | Restore from layer 1; if the provider is down, wait, then re-verify |
| Shared rate-limit store down | Booking/login pause with 503, not 429; existing pages keep working | Check the alert; the limiter fails closed until the store answers |
| Backup run failed | Owner: "Your latest backup needs attention. Your shop is operating normally, but an administrator has been notified." | Read `BackupRun.detail`, re-run with `--json`, check storage credentials |
| Latest backup stale | Same as above, with the age in days | Run `db:backup:freshness`; check the scheduler is enabled |
| Stored backup corrupt | Nothing shown to customers; the run fails and alerts | Do not delete it; keep the previous verified copy and re-run |
| Media object missing | Existing photos still render from the provider; uploads may fail | Restore the file from `media/` at the same pathname |
| Redis credentials removed | Configuration error, not an outage: readiness says "not configured" | Restore the variables; the deploy never silently downgrades to per-instance limits |

---

## 6. Do not do these

- Do not restore over production without an approved, written decision for that step.
- Do not delete a backup to "clean up" before the replacement is verified.
- Do not store `BACKUP_ENCRYPTION_KEY` only in the bucket it encrypts.
- Do not put anyone's production database URL or keys in this repository, in an
  issue, or in a chat message.
- Do not add a second backup/queue/auth engine: extend the ones in `scripts/` and
  `src/lib/`.
