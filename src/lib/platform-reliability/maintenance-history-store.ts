/**
 * The storage half of the maintenance history, switched on after the owner approved the
 * additive `MaintenanceAction` table (docs/PROPOSED-MAINTENANCE-HISTORY-MIGRATION.md).
 *
 * Everything written here passes through the redaction in maintenance-history.ts first, so a
 * secret cannot reach the table even if a caller forgets. Reads are always scoped to one
 * business: a shop can see its own repairs and nothing else.
 */

import { prisma } from '@/lib/prisma'
import {
  redactForHistory,
  redactNamedValue,
  type ApprovalState,
  type ExecutionState,
  type MaintenanceRecord,
} from './maintenance-history'

export interface StoredRecord extends MaintenanceRecord {
  id: string
  createdAt: string
}

function toRecord(row: {
  id: string
  actionKey: string
  repairClass: string
  component: string
  previousValue: string | null
  proposedValue: string | null
  requestedById: string | null
  approvedById: string | null
  approvalState: string
  executionState: string
  result: string | null
  rollbackRef: string | null
  testsPassed: boolean | null
  deploymentSucceeded: boolean | null
  createdAt: Date
  approvedAt: Date | null
  startedAt: Date | null
  completedAt: Date | null
}): StoredRecord {
  return {
    id: row.id,
    actionKey: row.actionKey,
    component: row.component,
    repairClass: row.repairClass as MaintenanceRecord['repairClass'],
    approvalState: row.approvalState as ApprovalState,
    executionState: row.executionState as ExecutionState,
    previousValue: row.previousValue,
    proposedValue: row.proposedValue,
    requestedBy: row.requestedById,
    approvedBy: row.approvedById,
    result: row.result,
    rollbackRef: row.rollbackRef,
    testsPassed: row.testsPassed,
    deploymentSucceeded: row.deploymentSucceeded,
    createdAt: row.createdAt.toISOString(),
    proposedAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}

/** Newest first, scoped to one business. */
export async function listMaintenanceHistory(businessId: string, limit = 20): Promise<StoredRecord[]> {
  const rows = await prisma.maintenanceAction.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  })
  return rows.map(toRecord)
}

/** Writes a record. Redaction runs again here, on purpose. */
export async function saveMaintenanceRecord(
  businessId: string | null,
  record: MaintenanceRecord
): Promise<StoredRecord> {
  const row = await prisma.maintenanceAction.create({
    data: {
      actionKey: record.actionKey.slice(0, 120),
      repairClass: record.repairClass,
      component: record.component.slice(0, 160),
      businessId,
      previousValue: redactNamedValue('previousValue', record.previousValue),
      proposedValue: redactNamedValue('proposedValue', record.proposedValue),
      requestedById: record.requestedBy ?? null,
      approvedById: record.approvedBy ?? null,
      approvalState: record.approvalState,
      executionState: record.executionState,
      result: redactForHistory(record.result),
      rollbackRef: redactForHistory(record.rollbackRef),
      testsPassed: record.testsPassed ?? null,
      deploymentSucceeded: record.deploymentSucceeded ?? null,
      approvedAt: record.approvedAt ? new Date(record.approvedAt) : null,
      startedAt: record.startedAt ? new Date(record.startedAt) : null,
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
    },
  })
  return toRecord(row)
}

/** Updates an existing record after a decision or an outcome. Business-scoped. */
export async function updateMaintenanceRecord(
  businessId: string,
  id: string,
  record: MaintenanceRecord
): Promise<number> {
  const result = await prisma.maintenanceAction.updateMany({
    where: { id, businessId },
    data: {
      approvalState: record.approvalState,
      executionState: record.executionState,
      approvedById: record.approvedBy ?? null,
      result: redactForHistory(record.result),
      rollbackRef: redactForHistory(record.rollbackRef),
      testsPassed: record.testsPassed ?? null,
      deploymentSucceeded: record.deploymentSucceeded ?? null,
      approvedAt: record.approvedAt ? new Date(record.approvedAt) : null,
      startedAt: record.startedAt ? new Date(record.startedAt) : null,
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
    },
  })
  return result.count
}
