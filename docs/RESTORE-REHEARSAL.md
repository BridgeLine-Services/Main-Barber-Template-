# Quarterly restore rehearsal

The automated rehearsal runs in GitHub Actions on the first day of each calendar quarter and can also be started manually from the Actions tab. It restores a verified off-site backup only into a generated scratch database, performs row-count and integrity checks, and drops that scratch database. It never restores over the configured staging database.

## Required GitHub Actions secrets

Configure these under repository Settings → Secrets and variables → Actions. Use a dedicated staging environment/database with permission to create and drop scratch databases. Do not use production credentials unless the approved operating procedure explicitly requires them.

- `STAGING_DATABASE_URL`: staging PostgreSQL endpoint used only to create the disposable scratch restore target.
- `RESTORE_DRILL_EVIDENCE_URL`: set to the same non-production staging application database as `STAGING_DATABASE_URL`, so the staging reliability report can read the evidence. The rehearsal restores into a separately generated scratch database and never writes evidence to that scratch database.
- `BACKUP_ENCRYPTION_KEY`: key that decrypts the off-site backup.
- `BACKUP_STORAGE_DRIVER` and the storage driver's credentials (`BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` for S3).

The evidence URL is provided to the rehearsal runner as `RESTORE_DRILL_EVIDENCE_URL`. It is intentionally not a `NEXT_PUBLIC_*` variable and is not required by the live application. The workflow fails closed unless both URLs point to the same staging application database, and when the encryption key or storage driver is missing. A failed evidence write is reported as a failed workflow step; a rehearsal is not considered fully recorded unless the write succeeds.

The run writes a JSON evidence artifact for one year and persists the structured `RestoreDrill` row to the configured evidence database. The reliable state in the owner dashboard is determined by rows that are available to that dashboard; an isolated evidence database not connected to the reporting application does not automatically populate the dashboard.

## Before enabling the schedule

1. Provision a non-production staging PostgreSQL account with the permissions the restore verifier needs to create, inspect, and drop a uniquely named scratch database.
2. Ensure the non-production staging application database has the current `RestoreDrill` schema and restrict its credentials to the workflow; the evidence connection must match `STAGING_DATABASE_URL` so the staging reliability report reads the saved row.
3. Add the secrets above and verify the storage credentials can read verified backup manifests and encrypted payloads.
4. Run the workflow manually, inspect its artifact, verify the `RestoreDrill` record was written, and confirm the scratch database was removed.
5. Keep production destinations out of these secrets unless an approved operating procedure specifically requires them.

A green rehearsal proves only that the selected backup could be restored at the recorded time. It is not a substitute for monitoring the next scheduled run or for specialist response to a failed restore.
