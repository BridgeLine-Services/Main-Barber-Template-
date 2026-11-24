/**
 * Staff assignment management, database side.
 *
 * Writes go through a serializable transaction so two managers saving at the same moment
 * cannot both see "no overlap" and both write one. Nothing here deletes a row: ending an
 * assignment sets an end date, and a transfer is an end plus a start.
 */

import { prisma } from '@/lib/prisma'
import { buildConfigAuditEntry } from './config-audit'
import type { OrgContext } from './resolve'
import type { Assignment } from './assignments'
import {
  planAssignment,
  planEndAssignment,
  planTransfer,
  type AssignmentActor,
  type LocationState,
  type PlanResult,
  type TransferPlan,
} from './assignment-management'

export interface AssignmentView extends Assignment {
  personName: string
  personEmail: string
  businessName: string
}

function actorFrom(context: OrgContext): AssignmentActor {
  return { userId: '', role: context.role, allowedBusinessIds: context.locationBusinessIds }
}

export async function loadLocationStates(context: OrgContext): Promise<LocationState[]> {
  if (context.locationBusinessIds.length === 0) return []
  const rows = await prisma.organizationLocation.findMany({
    where: { organizationId: context.organizationId, businessId: { in: context.locationBusinessIds } },
    select: { businessId: true, status: true, business: { select: { name: true } } },
  })
  return rows.map((row) => ({ businessId: row.businessId, status: row.status, name: row.business.name }))
}

/**
 * Assignments this person may see: their own organization, and only the locations the
 * session resolved for them. A regional manager does not learn about other regions here.
 */
export async function loadAssignments(context: OrgContext): Promise<AssignmentView[]> {
  if (context.locationBusinessIds.length === 0) return []
  const rows = await prisma.staffLocationAssignment.findMany({
    where: { organizationId: context.organizationId, businessId: { in: context.locationBusinessIds } },
    orderBy: { effectiveFrom: 'desc' },
    take: 500,
    select: {
      id: true,
      userId: true,
      businessId: true,
      role: true,
      effectiveFrom: true,
      effectiveTo: true,
      createdById: true,
      createdAt: true,
    },
  })
  if (rows.length === 0) return []

  type Person = { id: string; name: string | null; email: string }
  const [people, locations] = await Promise.all([
    prisma.user
      .findMany({
        where: { id: { in: Array.from(new Set(rows.map((row) => row.userId))) } },
        select: { id: true, name: true, email: true },
      })
      .catch(() => [] as Person[]) as Promise<Person[]>,
    loadLocationStates(context),
  ])
  const personById = new Map<string, Person>(people.map((person) => [person.id, person] as [string, Person]))
  const nameById = new Map<string, string>(
    locations.map((row) => [row.businessId, row.name ?? 'A location'] as [string, string]),
  )

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    businessId: row.businessId,
    role: row.role,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
    createdById: row.createdById,
    personName: personById.get(row.userId)?.name ?? 'Someone',
    personEmail: personById.get(row.userId)?.email ?? '',
    businessName: nameById.get(row.businessId) ?? 'A location',
  }))
}

export interface WriteResult extends PlanResult {
  status: number
  value: { id: string } | null
}

export async function createAssignment(
  context: OrgContext,
  actorId: string,
  input: { userId: string; businessId: string; role: string; effectiveFrom: string; effectiveTo?: string | null },
): Promise<WriteResult> {
  const actor: AssignmentActor = { ...actorFrom(context), userId: actorId }
  const [existing, locations] = await Promise.all([loadAssignments(context), loadLocationStates(context)])

  const plan = planAssignment({ candidate: input, existing, actor, locations, at: new Date() })
  if (!plan.ok || !plan.assignment) {
    return { ok: false, status: plan.errors[0]?.startsWith('Your role') ? 403 : 409, errors: plan.errors, value: null }
  }

  try {
    const created = await prisma.$transaction(
      async (tx) => {
        // Re-read inside the transaction: the check outside it is a courtesy, this is the guard.
        const conflicting = await tx.staffLocationAssignment.findFirst({
          where: {
            organizationId: context.organizationId,
            userId: input.userId,
            businessId: input.businessId,
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date(input.effectiveFrom) } }],
          },
          select: { id: true },
        })
        if (conflicting) throw new Error('OVERLAP')

        const row = await tx.staffLocationAssignment.create({
          data: {
            organizationId: context.organizationId,
            userId: input.userId,
            businessId: input.businessId,
            role: input.role,
            effectiveFrom: new Date(input.effectiveFrom),
            effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
            createdById: actorId,
          },
          select: { id: true },
        })
        await tx.organizationConfigAudit.create({
          data: buildConfigAuditEntry({
            organizationId: context.organizationId,
            actorId,
            action: 'assignment.create',
            entity: 'StaffLocationAssignment',
            entityId: row.id,
            summary: `Assigned a ${input.role.replace('_', ' ').toLowerCase()} role at ${locations.find((l) => l.businessId === input.businessId)?.name ?? 'a location'} from ${input.effectiveFrom.slice(0, 10)}.`,
            newValue: { userId: input.userId, businessId: input.businessId, role: input.role, effectiveFrom: input.effectiveFrom },
            at: new Date().toISOString(),
          }),
        })
        return row
      },
      { isolationLevel: 'Serializable' },
    )
    return { ok: true, status: 200, errors: [], value: created }
  } catch (error) {
    if (error instanceof Error && error.message === 'OVERLAP') {
      return { ok: false, status: 409, errors: ['That person already has an assignment at this location covering those dates.'], value: null }
    }
    console.error('createAssignment failed:', error)
    return { ok: false, status: 500, errors: ['The assignment could not be saved. Nothing was changed.'], value: null }
  }
}

export async function endAssignment(
  context: OrgContext,
  actorId: string,
  assignmentId: string,
): Promise<WriteResult> {
  const actor: AssignmentActor = { ...actorFrom(context), userId: actorId }
  const existing = await loadAssignments(context)
  const row = existing.find((item) => item.id === assignmentId)
  if (!row) return { ok: false, status: 404, errors: ['That assignment could not be found.'], value: null }

  const at = new Date()
  const plan = planEndAssignment(row, actor, at)
  if (!plan.ok || !plan.effectiveTo) {
    return { ok: false, status: plan.errors[0]?.startsWith('Your role') ? 403 : 409, errors: plan.errors, value: null }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.staffLocationAssignment.update({
        where: { id: assignmentId },
        data: { effectiveTo: new Date(plan.effectiveTo as string) },
      })
      await tx.organizationConfigAudit.create({
        data: buildConfigAuditEntry({
          organizationId: context.organizationId,
          actorId,
          action: 'assignment.end',
          entity: 'StaffLocationAssignment',
          entityId: assignmentId,
          summary: `Ended an assignment at ${row.businessName}. The person keeps their history and loses access from now on.`,
          previousValue: { effectiveTo: row.effectiveTo },
          newValue: { effectiveTo: plan.effectiveTo },
          at: new Date().toISOString(),
        }),
      })
    })
    return { ok: true, status: 200, errors: [], value: { id: assignmentId } }
  } catch (error) {
    console.error('endAssignment failed:', error)
    return { ok: false, status: 500, errors: ['The assignment could not be ended. Nothing was changed.'], value: null }
  }
}

export interface TransferResult extends PlanResult {
  status: number
  value: { endedId: string | null; startedId: string | null } | null
  explanation: string
}

export async function transferAssignment(
  context: OrgContext,
  actorId: string,
  assignmentId: string,
  destinationBusinessId: string,
  effectiveFrom: string,
): Promise<TransferResult> {
  const actor: AssignmentActor = { ...actorFrom(context), userId: actorId }
  const [existing, locations] = await Promise.all([loadAssignments(context), loadLocationStates(context)])
  const row = existing.find((item) => item.id === assignmentId)
  if (!row) {
    return { ok: false, status: 404, errors: ['That assignment could not be found.'], value: null, explanation: '' }
  }

  const plan: TransferPlan = planTransfer({ assignment: row, destinationBusinessId, effectiveFrom, existing, actor, locations })
  if (!plan.ok) {
    return { ok: false, status: plan.errors[0]?.startsWith('Your role') ? 403 : 409, errors: plan.errors, value: null, explanation: '' }
  }

  try {
    const ids = await prisma.$transaction(
      async (tx) => {
        await tx.staffLocationAssignment.update({
          where: { id: assignmentId },
          data: { effectiveTo: new Date(effectiveFrom) },
        })
        const started = await tx.staffLocationAssignment.create({
          data: {
            organizationId: context.organizationId,
            userId: row.userId,
            businessId: destinationBusinessId,
            role: row.role,
            effectiveFrom: new Date(effectiveFrom),
            createdById: actorId,
          },
          select: { id: true },
        })
        await tx.organizationConfigAudit.create({
          data: buildConfigAuditEntry({
            organizationId: context.organizationId,
            actorId,
            action: 'assignment.transfer',
            entity: 'StaffLocationAssignment',
            entityId: started.id,
            summary: plan.explanation,
            previousValue: { businessId: row.businessId, effectiveTo: row.effectiveTo },
            newValue: { businessId: destinationBusinessId, effectiveFrom, endedAssignmentId: assignmentId },
            at: new Date().toISOString(),
          }),
        })
        return started.id
      },
      { isolationLevel: 'Serializable' },
    )
    return { ok: true, status: 200, errors: [], value: { endedId: assignmentId, startedId: ids }, explanation: plan.explanation }
  } catch (error) {
    console.error('transferAssignment failed:', error)
    return { ok: false, status: 500, errors: ['The transfer could not be saved. Nothing was changed.'], value: null, explanation: '' }
  }
}
