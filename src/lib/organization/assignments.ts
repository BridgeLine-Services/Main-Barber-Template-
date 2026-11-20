/**
 * Staff location assignments (Priority 3, part F).
 *
 * A person may work at more than one location, but only while an assignment is in force,
 * and every change is auditable. Overlapping assignments for the same person at the same
 * location are rejected because two overlapping rows make "who was here on Tuesday" a
 * question with two answers.
 */

export interface Assignment {
  id?: string
  userId: string
  businessId: string
  role: string
  effectiveFrom: string
  effectiveTo: string | null
  createdById: string | null
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

const ALLOWED_ROLES = ['LOCATION_MANAGER', 'BARBER', 'ADMIN']

export function validateAssignment(input: Partial<Assignment>): ValidationResult {
  const errors: string[] = []
  if (!input.userId?.trim()) errors.push('Choose the person this assignment is for.')
  if (!input.businessId?.trim()) errors.push('Choose the location this assignment is for.')
  if (!input.role || !ALLOWED_ROLES.includes(input.role)) errors.push(`The role must be one of: ${ALLOWED_ROLES.join(', ')}.`)
  const from = input.effectiveFrom ? Date.parse(input.effectiveFrom) : NaN
  if (Number.isNaN(from)) errors.push('The start date is not a valid date.')
  if (input.effectiveTo) {
    const to = Date.parse(input.effectiveTo)
    if (Number.isNaN(to)) errors.push('The end date is not a valid date.')
    else if (!Number.isNaN(from) && to <= from) errors.push('The end date must be after the start date.')
  }
  return { valid: errors.length === 0, errors }
}

export function isAssignmentActive(assignment: Pick<Assignment, 'effectiveFrom' | 'effectiveTo'>, at: Date): boolean {
  const from = Date.parse(assignment.effectiveFrom)
  if (Number.isNaN(from) || from > at.getTime()) return false
  if (!assignment.effectiveTo) return true
  const to = Date.parse(assignment.effectiveTo)
  if (Number.isNaN(to)) return false
  return to > at.getTime()
}

function overlaps(a: Pick<Assignment, 'effectiveFrom' | 'effectiveTo'>, b: Pick<Assignment, 'effectiveFrom' | 'effectiveTo'>): boolean {
  const aFrom = Date.parse(a.effectiveFrom)
  const aTo = a.effectiveTo ? Date.parse(a.effectiveTo) : Number.POSITIVE_INFINITY
  const bFrom = Date.parse(b.effectiveFrom)
  const bTo = b.effectiveTo ? Date.parse(b.effectiveTo) : Number.POSITIVE_INFINITY
  if ([aFrom, aTo, bFrom, bTo].some((n) => Number.isNaN(n))) return true
  return aFrom < bTo && bFrom < aTo
}

/** Returns the conflicting assignment, or null when the new one is clean. */
export function findOverlap(
  existing: Assignment[],
  candidate: Pick<Assignment, 'userId' | 'businessId' | 'effectiveFrom' | 'effectiveTo'>,
): Assignment | null {
  for (const row of existing) {
    if (row.userId !== candidate.userId || row.businessId !== candidate.businessId) continue
    if (overlaps(row, candidate)) return row
  }
  return null
}

export function activeAssignmentsFor(assignments: Assignment[], userId: string, at: Date): Assignment[] {
  return assignments.filter((a) => a.userId === userId && isAssignmentActive(a, at))
}

export interface AssignmentAuditEntry {
  action: 'assignment.created' | 'assignment.ended'
  userId: string
  businessId: string
  role: string
  actorId: string | null
  at: string
  summary: string
}

export function auditEntry(
  action: AssignmentAuditEntry['action'],
  assignment: Pick<Assignment, 'userId' | 'businessId' | 'role' | 'createdById'>,
  at: string,
): AssignmentAuditEntry {
  return {
    action,
    userId: assignment.userId,
    businessId: assignment.businessId,
    role: assignment.role,
    actorId: assignment.createdById,
    at,
    summary: action === 'assignment.created'
      ? `Added a ${assignment.role.replace('_', ' ').toLowerCase()} assignment at this location, starting now.`
      : 'Ended this assignment. The person keeps their history but loses access from now on.',
  }
}
