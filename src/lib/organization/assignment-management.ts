/**
 * Staff assignment management (Part B of the organization management phase).
 *
 * assignments.ts already holds the effective-dating rules: validation, overlap detection,
 * and what counts as active at a moment. This module is the layer that decides whether a
 * particular person may make a particular change, and what the change looks like when it is
 * written. It never deletes a row: ending an assignment sets an end date, and a transfer is
 * an end plus a start, so "who was here in March" keeps one answer.
 *
 * Pure on purpose. The caller supplies assignments it has already loaded inside the
 * session's organization, and the locations the actor may act on, resolved server-side.
 */

import { can, type OrgRole } from './capabilities'
import {
  findOverlap,
  isAssignmentActive,
  validateAssignment,
  type Assignment,
} from './assignments'

export interface AssignmentActor {
  userId: string
  role: OrgRole
  /** Locations resolved from the session. Never taken from the request. */
  allowedBusinessIds: string[]
}

export interface LocationState {
  businessId: string
  name?: string
  status: string
}

export interface PlanResult {
  ok: boolean
  errors: string[]
}

function inScope(actor: AssignmentActor, businessId: string): boolean {
  return actor.allowedBusinessIds.includes(businessId)
}

function locationOf(locations: LocationState[], businessId: string): LocationState | null {
  return locations.find((row) => row.businessId === businessId) ?? null
}

/** A closed location takes no new work, so it takes no new assignments either. */
function closedReason(locations: LocationState[], businessId: string): string | null {
  const location = locationOf(locations, businessId)
  if (location && location.status === 'closed') {
    return `${location.name ?? 'That location'} is closed, so it cannot take a new assignment.`
  }
  return null
}

export interface AssignmentPlanInput {
  candidate: Partial<Assignment> & { userId?: string; businessId?: string; role?: string; effectiveFrom?: string; effectiveTo?: string | null }
  existing: Assignment[]
  actor: AssignmentActor
  locations: LocationState[]
  at: Date
}

export interface AssignmentPlan extends PlanResult {
  assignment: Assignment | null
}

/**
 * Whether this assignment may be written.
 *
 * Order matters: the permission check comes before any judgement about the request, so a
 * person without the capability is told they cannot do this rather than being handed a
 * helpful validation error about somebody else's data.
 */
export function planAssignment(input: AssignmentPlanInput): AssignmentPlan {
  const { candidate, actor } = input
  const errors: string[] = []

  if (!can(actor.role, 'staff.assign')) {
    return { ok: false, errors: ['Your role cannot assign people to locations.'], assignment: null }
  }

  const validation = validateAssignment(candidate)
  errors.push(...validation.errors)

  const businessId = (candidate.businessId ?? '').trim()
  if (businessId.length > 0 && !inScope(actor, businessId)) {
    errors.push('That location is outside the locations you look after.')
  }
  const closed = businessId.length > 0 ? closedReason(input.locations, businessId) : null
  if (closed) errors.push(closed)

  if (candidate.userId && candidate.userId === actor.userId) {
    errors.push('You cannot assign yourself. Ask another owner to make this change.')
  }

  if (errors.length > 0) return { ok: false, errors, assignment: null }

  const assignment: Assignment = {
    userId: String(candidate.userId),
    businessId,
    role: String(candidate.role),
    effectiveFrom: String(candidate.effectiveFrom),
    effectiveTo: candidate.effectiveTo ?? null,
    createdById: actor.userId,
  }

  const conflict = findOverlap(input.existing, assignment)
  if (conflict) {
    return {
      ok: false,
      errors: [
        `That person already has a ${conflict.role.replace('_', ' ').toLowerCase()} assignment at this location from ${conflict.effectiveFrom.slice(0, 10)}${
          conflict.effectiveTo ? ` to ${conflict.effectiveTo.slice(0, 10)}` : ', with no end date'
        }. End it first, or choose a start date after it ends.`,
      ],
      assignment: null,
    }
  }

  return { ok: true, errors: [], assignment }
}

export interface TransferInput {
  assignment: Assignment
  destinationBusinessId: string
  effectiveFrom: string
  existing: Assignment[]
  actor: AssignmentActor
  locations: LocationState[]
}

export interface TransferOperation {
  kind: 'end' | 'start'
  assignmentId?: string
  effectiveFrom: string
  effectiveTo: string | null
  userId: string
  businessId: string
  role: string
}

export interface TransferPlan extends PlanResult {
  operations: TransferOperation[]
  explanation: string
}

/**
 * A transfer ends the old assignment on the day the new one starts and creates the new one.
 * The old row is kept, so the history shows a person moving rather than a person vanishing.
 */
export function planTransfer(input: TransferInput): TransferPlan {
  const { assignment, actor, destinationBusinessId } = input
  const errors: string[] = []

  if (!can(actor.role, 'staff.assign')) {
    return { ok: false, errors: ['Your role cannot move people between locations.'], operations: [], explanation: '' }
  }
  if (!inScope(actor, assignment.businessId)) errors.push('That assignment is outside the locations you look after.')
  if (!inScope(actor, destinationBusinessId)) errors.push('The destination is outside the locations you look after.')
  const closed = closedReason(input.locations, destinationBusinessId)
  if (closed) errors.push(closed)
  if (assignment.businessId === destinationBusinessId) errors.push('That person is already assigned to that location.')

  const from = Date.parse(input.effectiveFrom)
  if (Number.isNaN(from)) errors.push('The transfer date is not a valid date.')
  else if (!isAssignmentActive(assignment, new Date(from))) {
    errors.push('That assignment is not in force on the transfer date, so there is nothing to move.')
  }

  const others = input.existing.filter((row) => row !== assignment)
  const candidate: Assignment = {
    userId: assignment.userId,
    businessId: destinationBusinessId,
    role: assignment.role,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    createdById: actor.userId,
  }
  const conflict = findOverlap(others, candidate)
  if (conflict) {
    errors.push(
      `That person already has an assignment at the destination from ${conflict.effectiveFrom.slice(0, 10)}. End it first.`,
    )
  }

  if (errors.length > 0) return { ok: false, errors, operations: [], explanation: '' }

  const destination = locationOf(input.locations, destinationBusinessId)
  return {
    ok: true,
    errors: [],
    operations: [
      {
        kind: 'end',
        assignmentId: assignment.id,
        effectiveFrom: assignment.effectiveFrom,
        effectiveTo: input.effectiveFrom,
        userId: assignment.userId,
        businessId: assignment.businessId,
        role: assignment.role,
      },
      {
        kind: 'start',
        effectiveFrom: input.effectiveFrom,
        effectiveTo: null,
        userId: assignment.userId,
        businessId: destinationBusinessId,
        role: assignment.role,
      },
    ],
    explanation: `From ${input.effectiveFrom.slice(0, 10)} this person works at ${
      destination?.name ?? 'the new location'
    }. They lose access to the old location from that date, keep their history at both, and their other assignments are unchanged.`,
  }
}

export interface EndPlan extends PlanResult {
  effectiveTo: string | null
}

/** Ending is never a delete. It sets an end date and keeps the row. */
export function planEndAssignment(
  assignment: Assignment,
  actor: AssignmentActor,
  at: Date,
): EndPlan {
  if (!can(actor.role, 'staff.assign')) {
    return { ok: false, errors: ['Your role cannot end assignments.'], effectiveTo: null }
  }
  if (!inScope(actor, assignment.businessId)) {
    return { ok: false, errors: ['That assignment is outside the locations you look after.'], effectiveTo: null }
  }
  if (!isAssignmentActive(assignment, at)) {
    return { ok: false, errors: ['That assignment has already ended. Nothing was changed.'], effectiveTo: null }
  }
  return { ok: true, errors: [], effectiveTo: at.toISOString() }
}

export type AssignmentState = 'current' | 'upcoming' | 'ended'

export interface AssignmentRow {
  id: string
  userId: string
  businessId: string
  businessName: string
  role: string
  roleWords: string
  effectiveFrom: string
  effectiveTo: string | null
  state: AssignmentState
  stateWords: string
  createdById: string | null
  createdAt: string | null
}

const ROLE_WORDS: Record<string, string> = {
  LOCATION_MANAGER: 'Location manager',
  BARBER: 'Barber',
  ADMIN: 'Administrator',
}

export function assignmentState(assignment: Pick<Assignment, 'effectiveFrom' | 'effectiveTo'>, at: Date): AssignmentState {
  const from = Date.parse(assignment.effectiveFrom)
  if (!Number.isNaN(from) && from > at.getTime()) return 'upcoming'
  return isAssignmentActive(assignment, at) ? 'current' : 'ended'
}

/**
 * The history, in the order a person would tell it. Nothing is dropped to make the current
 * picture look tidier: ended rows stay with their dates and the person who made the change.
 */
export function assignmentRows(
  assignments: Assignment[],
  locations: LocationState[],
  at: Date,
): AssignmentRow[] {
  return assignments
    .map((row) => {
      const state = assignmentState(row, at)
      const location = locationOf(locations, row.businessId)
      return {
        id: row.id ?? `${row.userId}-${row.businessId}-${row.effectiveFrom}`,
        userId: row.userId,
        businessId: row.businessId,
        businessName: location?.name ?? 'A location',
        role: row.role,
        roleWords: ROLE_WORDS[row.role] ?? row.role.replace('_', ' ').toLowerCase(),
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        state,
        stateWords:
          state === 'current' ? 'In force now' : state === 'upcoming' ? 'Starts later' : 'Ended',
        createdById: row.createdById,
        createdAt: null,
      }
    })
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom))
}

export function groupByState(rows: AssignmentRow[]): Record<AssignmentState, AssignmentRow[]> {
  return {
    current: rows.filter((row) => row.state === 'current'),
    upcoming: rows.filter((row) => row.state === 'upcoming'),
    ended: rows.filter((row) => row.state === 'ended'),
  }
}

export function describeTransfer(plan: TransferPlan): string {
  return plan.ok ? plan.explanation : plan.errors.join(' ')
}
