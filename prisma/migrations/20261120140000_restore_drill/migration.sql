-- Priority 1, part G: proof that a backup can be restored, not merely created.
-- Additive only: one new table, two indexes, no change to any existing table or row.
-- Rollback: DROP TABLE "RestoreDrill";

-- CreateTable
CREATE TABLE "RestoreDrill" (
    "id" TEXT NOT NULL,
    "backupId" TEXT,
    "objectKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "tablesRestored" TEXT[],
    "rowsCompared" INTEGER,
    "rowCountsMatched" BOOLEAN,
    "durationMs" INTEGER,
    "detail" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "RestoreDrill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RestoreDrill_startedAt_idx" ON "RestoreDrill"("startedAt");

-- CreateIndex
CREATE INDEX "RestoreDrill_verifiedAt_idx" ON "RestoreDrill"("verifiedAt");
