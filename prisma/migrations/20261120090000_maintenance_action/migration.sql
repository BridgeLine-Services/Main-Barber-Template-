-- Maintenance history: additive only.
-- Creates one table, two indexes and one foreign key. Nothing existing is altered,
-- renamed or dropped, and no data statement runs.

CREATE TABLE "MaintenanceAction" (
    "id" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "repairClass" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "businessId" TEXT,
    "previousValue" TEXT,
    "proposedValue" TEXT,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvalState" TEXT NOT NULL DEFAULT 'proposed',
    "executionState" TEXT NOT NULL DEFAULT 'not-started',
    "result" TEXT,
    "rollbackRef" TEXT,
    "testsPassed" BOOLEAN,
    "deploymentSucceeded" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MaintenanceAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaintenanceAction_businessId_createdAt_idx" ON "MaintenanceAction"("businessId", "createdAt");
CREATE INDEX "MaintenanceAction_approvalState_createdAt_idx" ON "MaintenanceAction"("approvalState", "createdAt");

ALTER TABLE "MaintenanceAction" ADD CONSTRAINT "MaintenanceAction_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
