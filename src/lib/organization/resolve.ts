/**
 * Resolving an organization from the session, never from the request (Priority 2).
 *
 * The directive is explicit: an organization id supplied by the browser is not proof of
 * access. So this module's only input is a user id that came from the server-side session,
 * and it answers with the organization that user actually belongs to plus the locations
 * they may act on. A caller that needs a location checks the returned list; it never trusts
 * a location id it was handed.
 */

import { prisma } from '@/lib/prisma'
import { normaliseRole, type Capability, type OrgRole, can } from './capabilities'

export interface OrgContext {
  organizationId: string
  organizationName: string
  membershipId: string
  role: OrgRole
  /** Regions this member may act on. Empty means every region. */
  regions: string[]
  allRegions: boolean
  /** The locations this person may act on, resolved from membership and assignment. */
  locationBusinessIds: string[]
  /** The location a location-level member primarily works at, when known. */
  homeBusinessId: string | null
}

export type OrgContextFailure = 'no-membership' | 'suspended' | 'unrecognised-role' | 'read-failed'

/**
 * A single shape rather than a discriminated union: this repository compiles with
 * strictNullChecks off, where literal-type narrowing does not survive, and a shape that
 * cannot be narrowed is a bug waiting to happen. `context` is null exactly when `ok` is
 * false, and every caller must check both.
 */
export interface OrgContextResult {
  ok: boolean
  context: OrgContext | null
  reason: OrgContextFailure | null
  message: string | null
}

const FAILURE_MESSAGE: Record<OrgContextFailure, string> = {
  'no-membership': 'You are not a member of an organization. A single shop works without one.',
  suspended: 'Your organization membership is not active. Ask the organization owner to restore it.',
  'unrecognised-role': 'Your organization role is not recognised, so no organization access is granted.',
  'read-failed': 'Your organization details could not be read just now. Nothing was changed.',
}

export async function resolveOrganizationContext(userId: string | null | undefined): Promise<OrgContextResult> {
  if (!userId) return { ok: false, context: null, reason: 'no-membership', message: FAILURE_MESSAGE['no-membership'] }

  let memberships
  try {
    memberships = await prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    })
  } catch {
    return { ok: false, context: null, reason: 'read-failed', message: FAILURE_MESSAGE['read-failed'] }
  }

  if (memberships.length === 0) return { ok: false, context: null, reason: 'no-membership', message: FAILURE_MESSAGE['no-membership'] }

  const active = memberships.find((m) => m.status === 'ACTIVE' && m.organization.deactivatedAt === null)
  if (!active) return { ok: false, context: null, reason: 'suspended', message: FAILURE_MESSAGE.suspended }

  const role = normaliseRole(active.role)
  if (!role) return { ok: false, context: null, reason: 'unrecognised-role', message: FAILURE_MESSAGE['unrecognised-role'] }

  // The membership lookup above was guarded; these three lookups were not, so a
  // database error here could hand a caller a partially resolved context. Every
  // failure now returns the same controlled, fail-closed result.
  let visible: Array<{ businessId: string; region: string | null; status: string }>
  let homeBusinessId: string | null
  try {
    const locations = await prisma.organizationLocation.findMany({
      where: { organizationId: active.organizationId },
      select: { businessId: true, region: true, status: true },
    })

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { businessId: true } })
    homeBusinessId = user?.businessId ?? null

    visible = locations.filter((l) => l.status !== 'closed')
    if (role === 'REGIONAL_MANAGER') {
      // Fail closed. An empty region list used to skip this filter entirely, so a
      // regional manager whose regions were never set could see every location in
      // the organization. All-region access is now an explicit, auditable grant;
      // without it, a manager sees the regions they were given and nothing else.
      // Explicit per-location assignments are added below, as before.
      visible = active.allRegions
        ? visible
        : visible.filter((l) => l.region !== null && active.regions.includes(l.region))
    }
    if (role === 'FRANCHISE_OWNER' || role === 'LOCATION_MANAGER' || role === 'BARBER') {
      // A location-level role sees only the location it belongs to.
      visible = visible.filter((l) => l.businessId === homeBusinessId)
    }

    // Explicit staff assignments can widen a regional manager or barber's reach.
    if (role === 'REGIONAL_MANAGER' || role === 'BARBER' || role === 'LOCATION_MANAGER') {
      const assignments = await prisma.staffLocationAssignment.findMany({
        where: { organizationId: active.organizationId, userId, effectiveTo: null },
        select: { businessId: true },
      })
      const assigned = new Set(assignments.map((a) => a.businessId))
      visible = locations.filter((l) => l.status !== 'closed' && (visible.some((v) => v.businessId === l.businessId) || assigned.has(l.businessId)))
    }
  } catch {
    return { ok: false, context: null, reason: 'read-failed', message: FAILURE_MESSAGE['read-failed'] }
  }

  return {
    ok: true,
    reason: null,
    message: null,
    context: {
      organizationId: active.organizationId,
      organizationName: active.organization.name,
      membershipId: active.id,
      role,
      regions: active.regions,
      allRegions: active.allRegions,
      locationBusinessIds: visible.map((l) => l.businessId),
      homeBusinessId,
    },
  }
}

/** Does this context include the location? Never called with an id from the browser alone. */
export function hasLocationAccess(context: OrgContext, businessId: string): boolean {
  return context.locationBusinessIds.includes(businessId)
}

/** Capability check that also proves the location, when one is involved. */
export function authoriseLocationAction(
  context: OrgContext,
  businessId: string,
  capability: Capability,
): { allowed: boolean; reason: string } {
  if (!can(context.role, capability)) {
    return { allowed: false, reason: 'Your role does not include this action.' }
  }
  if (!hasLocationAccess(context, businessId)) {
    return { allowed: false, reason: 'That location is not one you are assigned to.' }
  }
  return { allowed: true, reason: 'Allowed for this location.' }
}
