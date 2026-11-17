-- Backup run history (observability for backup freshness).
--
-- Additive and non-destructive: one new table, no existing table touched, no
-- data rewritten. Rolling back the application leaves the table unused, which is
-- why this migration is safe during a rolling deploy. It is NOT a backup: it only
-- records that one happened, so readiness can notice silence.

-- CreateTable
CREATE TABLE IF NOT EXISTS "BackupRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "sizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "objectKey" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "detail" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BackupRun_kind_startedAt_idx" ON "BackupRun"("kind", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BackupRun_verifiedAt_idx" ON "BackupRun"("verifiedAt");
