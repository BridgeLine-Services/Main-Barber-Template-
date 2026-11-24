/**
 * Location management, database side.
 *
 * Every read and write here starts from an OrgContext that resolve.ts built from the
 * session, so a businessId in the request can only ever narrow what happens, never widen it.
 * Nothing in this file deletes an appointment, a payment, an employee or a customer.
 */

import { prisma } from '@/lib/prisma'
import { can } from './capabilities'
import { buildConfigAuditEntry } from './config-audit'
import type { OrgContext } from './resolve'
import {
  activationVerdict,
  buildClosureReview,
  findDuplicateLocation,
  isValidTimezone,
  planRegionRename,
  regionChangeVerdict,
  slugFromName,
  validateLocationDraft,
  type ClosureFacts,
  type ClosureReview,
  type LocationDraft,
  type LocationFacts,
  type LocationReadiness,
  type RegionRenamePlan,
  type Verdict,
} from './location-management'

export interface ManagedLocation extends LocationFacts {
  city: string | null
  state: string | null
  zipCode: string | null
  address: string | null
  email: string | null
  phone: string | null
  timezone: string
  slug: string
  openedAt: string | null
  closedAt: string | null
  readiness: LocationReadiness
}

export interface OperationResult<T> {
  ok: boolean
  status: number
  error: string | null
  reasons: string[]
  value: T | null
}

function fail<T>(status: number, error: string, reasons: string[] = []): OperationResult<T> {
  return { ok: false, status, error, reasons: reasons.length > 0 ? reasons : [error], value: null }
}

function done<T>(value: T): OperationResult<T> {
  return { ok: true, status: 200, error: null, reasons: [], value }
}

/** The locations this person may act on, with the facts a management screen needs. */
export async function loadManagedLocations(context: OrgContext): Promise<ManagedLocation[]> {
  if (context.locationBusinessIds.length === 0) return []

  const rows = await prisma.organizationLocation.findMany({
    where: { organizationId: context.organizationId, businessId: { in: context.locationBusinessIds } },
    orderBy: [{ region: 'asc' }, { createdAt: 'asc' }],
    select: {
      businessId: true,
      region: true,
      status: true,
      openedAt: true,
      closedAt: true,
      business: {
        select: {
          name: true,
          slug: true,
          city: true,
          state: true,
          zipCode: true,
          address: true,
          email: true,
          phone: true,
          timezone: true,
        },
      },
    },
  })

  const businessIds = rows.map((row) => row.businessId)
  const [serviceCounts, managers, brand] = await Promise.all([
    prisma.service.groupBy({ by: ['businessId'], where: { businessId: { in: businessIds }, isActive: true }, _count: { _all: true } }).catch(() => []),
    prisma.staffLocationAssignment
      .findMany({
        where: { businessId: { in: businessIds }, role: 'LOCATION_MANAGER', effectiveTo: null },
        select: { businessId: true },
      })
      .catch(() => []),
    prisma.organizationBrandSettings
      .findUnique({ where: { organizationId: context.organizationId }, select: { id: true } })
      .catch(() => null),
  ])

  const withServices = new Set(serviceCounts.map((row) => row.businessId))
  const withManager = new Set(managers.map((row) => row.businessId))

  return rows.map((row) => ({
    businessId: row.businessId,
    name: row.business.name,
    region: row.region,
    status: row.status,
    city: row.business.city,
    state: row.business.state,
    zipCode: row.business.zipCode,
    address: row.business.address,
    email: row.business.email,
    phone: row.business.phone,
    timezone: row.business.timezone,
    slug: row.business.slug,
    openedAt: row.openedAt ? row.openedAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    readiness: {
      brandSet: brand !== null,
      servicesSet: withServices.has(row.businessId),
      managerAssigned: withManager.has(row.businessId),
    },
  }))
}

/** Whether one location may be opened, and if not, why. Server-side, before any write. */
export async function locationReadiness(context: OrgContext, businessId: string): Promise<LocationReadiness> {
  const [brand, services, manager] = await Promise.all([
    prisma.organizationBrandSettings.findUnique({ where: { organizationId: context.organizationId }, select: { id: true } }).catch(() => null),
    prisma.service.count({ where: { businessId, isActive: true } }).catch(() => 0),
    prisma.staffLocationAssignment
      .count({ where: { businessId, role: 'LOCATION_MANAGER', effectiveTo: null } })
      .catch(() => 0),
  ])
  return { brandSet: brand !== null, servicesSet: services > 0, managerAssigned: manager > 0 }
}

export interface CreateLocationInput extends LocationDraft {
  region?: string | null
}

/**
 * Creates a shop and its location record in one transaction, in onboarding status.
 *
 * Onboarding is not a formality: a location in onboarding is excluded from the booking
 * path until an owner activates it, so a half-finished shop cannot take appointments.
 */
export async function createLocation(
  context: OrgContext,
  actorId: string,
  input: CreateLocationInput,
): Promise<OperationResult<{ businessId: string; slug: string }>> {
  if (!can(context.role, 'locations.manage')) {
    return fail(403, 'Your role cannot add a location.')
  }

  const validation = validateLocationDraft(input)
  if (!validation.allowed) return fail(400, validation.reasons[0], validation.reasons)

  const regionVerdict = regionChangeVerdict(context.regions, input.region ?? null)
  if (!regionVerdict.allowed) return fail(403, regionVerdict.reasons[0], regionVerdict.reasons)

  const existing = await loadManagedLocations(context)
  const duplicate = findDuplicateLocation(String(input.name), existing)
  if (duplicate) {
    return fail(409, `There is already a location called ${duplicate.name}. Give this one a different name.`)
  }

  const takenSlugs = (await prisma.business.findMany({ select: { slug: true } })).map((row) => row.slug)
  const slug = slugFromName(String(input.name), takenSlugs)

  try {
    const created = await prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: String(input.name).trim(),
          slug,
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
          address: input.address?.trim() || null,
          city: input.city?.trim() || null,
          state: input.state?.trim() || null,
          zipCode: input.zipCode?.trim() || null,
          timezone: String(input.timezone).trim(),
          onboardingCompleted: false,
          onboardingStep: 'business',
        },
        select: { id: true, slug: true, name: true },
      })

      await tx.organizationLocation.create({
        data: {
          organizationId: context.organizationId,
          businessId: business.id,
          region: input.region?.trim() || null,
          status: 'onboarding',
        },
        select: { id: true },
      })

      // The organization's service list, at the standard prices, so the new shop is never
      // empty and an owner can adjust from a valid starting point.
      const templates = await tx.organizationServiceTemplate.findMany({
        where: { organizationId: context.organizationId, active: true },
        orderBy: { createdAt: 'asc' },
      })
      if (templates.length > 0) {
        await tx.service.createMany({
          data: templates.map((template, index) => ({
            businessId: business.id,
            name: template.name,
            description: template.description,
            duration: template.durationMinutes,
            price: template.defaultPriceCents / 100,
            order: index,
          })),
        })
      }

      await tx.organizationConfigAudit.create({
        data: buildConfigAuditEntry({
          organizationId: context.organizationId,
          actorId,
          action: 'location.create',
          entity: 'OrganizationLocation',
          entityId: business.id,
          summary: `Added ${business.name}${input.region ? ` in ${String(input.region).trim()}` : ''}. It is in onboarding and takes no bookings until it is activated.`,
          newValue: {
            name: business.name,
            slug: business.slug,
            region: input.region ?? null,
            timezone: input.timezone,
            status: 'onboarding',
            servicesCopied: templates.length,
          },
          at: new Date().toISOString(),
        }),
      })

      return business
    })

    return done({ businessId: created.id, slug: created.slug })
  } catch (error) {
    console.error('createLocation failed:', error)
    return fail(500, 'The location could not be saved. Nothing was created.')
  }
}

export type UpdateLocationInput = LocationDraft

export async function updateLocation(
  context: OrgContext,
  actorId: string,
  businessId: string,
  input: UpdateLocationInput,
): Promise<OperationResult<{ businessId: string }>> {
  if (!can(context.role, 'locations.manage')) return fail(403, 'Your role cannot change a location.')
  if (!context.locationBusinessIds.includes(businessId)) {
    return fail(404, 'That location could not be found.')
  }

  const validation = validateLocationDraft(input)
  if (!validation.allowed) return fail(400, validation.reasons[0], validation.reasons)

  const regionVerdict = regionChangeVerdict(context.regions, input.region ?? null)
  if (!regionVerdict.allowed) return fail(403, regionVerdict.reasons[0], regionVerdict.reasons)

  const existing = await loadManagedLocations(context)
  const duplicate = findDuplicateLocation(String(input.name), existing.filter((row) => row.businessId !== businessId))
  if (duplicate) return fail(409, `There is already a location called ${duplicate.name}.`)

  const current = existing.find((row) => row.businessId === businessId)
  if (!current) return fail(404, 'That location could not be found.')

  try {
    await prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: businessId },
        data: {
          name: String(input.name).trim(),
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
          address: input.address?.trim() || null,
          city: input.city?.trim() || null,
          state: input.state?.trim() || null,
          zipCode: input.zipCode?.trim() || null,
          timezone: String(input.timezone).trim(),
        },
      })
      await tx.organizationLocation.update({
        where: { businessId },
        data: { region: input.region?.trim() || null },
      })
      await tx.organizationConfigAudit.create({
        data: buildConfigAuditEntry({
          organizationId: context.organizationId,
          actorId,
          action: 'location.update',
          entity: 'OrganizationLocation',
          entityId: businessId,
          summary: current.name === String(input.name).trim()
            ? `Updated the details for ${current.name}.`
            : `Renamed ${current.name} to ${String(input.name).trim()}.`,
          previousValue: { name: current.name, region: current.region, timezone: current.timezone },
          newValue: { name: String(input.name).trim(), region: input.region ?? null, timezone: input.timezone },
          at: new Date().toISOString(),
        }),
      })
    })
    return done({ businessId })
  } catch (error) {
    console.error('updateLocation failed:', error)
    return fail(500, 'The change could not be saved. Nothing was changed.')
  }
}

export type LocationAction = 'activate' | 'start-closing' | 'close'

export interface TransitionInput {
  action: LocationAction
  /** The owner confirms a copy of the records was produced. It cannot be verified, so it is recorded. */
  recordsExported?: boolean
}

export async function transitionLocation(
  context: OrgContext,
  actorId: string,
  businessId: string,
  input: TransitionInput,
): Promise<OperationResult<{ status: string }>> {
  if (!can(context.role, 'locations.manage')) return fail(403, 'Your role cannot change a location’s status.')
  if (!context.locationBusinessIds.includes(businessId)) return fail(404, 'That location could not be found.')

  const locations = await loadManagedLocations(context)
  const location = locations.find((row) => row.businessId === businessId)
  if (!location) return fail(404, 'That location could not be found.')

  if (input.action === 'activate') {
    const verdict: Verdict = activationVerdict(location, location.readiness)
    if (!verdict.allowed) return fail(409, verdict.reasons[0], verdict.reasons)
    return writeTransition(context, actorId, location, 'active', 'location.activate',
      `Opened ${location.name}. It can now take bookings.`)
  }

  if (input.action === 'start-closing') {
    if (location.status !== 'active') {
      return fail(409, location.status === 'closing'
        ? 'This location is already closing.'
        : 'Only an open location can start closing.')
    }
    return writeTransition(context, actorId, location, 'closing', 'location.start-closing',
      `Started closing ${location.name}. New bookings stop; existing appointments and records are untouched.`)
  }

  if (input.action === 'close') {
    const review = await loadClosureReview(context, businessId, Boolean(input.recordsExported))
    if (!review) return fail(404, 'That location could not be found.')
    if (!review.allowed) return fail(409, review.reasons[0], review.reasons)
    return writeTransition(context, actorId, location, 'closed', 'location.close',
      `Closed ${location.name}. Its appointments, payments, commissions and customer records are kept.`,
      { recordsExported: Boolean(input.recordsExported) })
  }

  return fail(400, 'That action is not recognised.')
}

async function writeTransition(
  context: OrgContext,
  actorId: string,
  location: ManagedLocation,
  status: string,
  action: string,
  summary: string,
  extra: Record<string, unknown> = {},
): Promise<OperationResult<{ status: string }>> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.organizationLocation.update({
        where: { businessId: location.businessId },
        data: {
          status,
          openedAt: status === 'active' && !location.openedAt ? new Date() : undefined,
          closedAt: status === 'closed' ? new Date() : undefined,
        },
      })
      await tx.organizationConfigAudit.create({
        data: buildConfigAuditEntry({
          organizationId: context.organizationId,
          actorId,
          action,
          entity: 'OrganizationLocation',
          entityId: location.businessId,
          summary,
          previousValue: { status: location.status },
          newValue: { status, ...extra },
          at: new Date().toISOString(),
        }),
      })
    })
    return done({ status })
  } catch (error) {
    console.error('location transition failed:', error)
    return fail(500, 'The change could not be saved. The location is unchanged.')
  }
}

/** The closing conversation, with real counts. A count that cannot be read stays null. */
export async function loadClosureReview(
  context: OrgContext,
  businessId: string,
  recordsExported: boolean,
): Promise<ClosureReview | null> {
  const locations = await loadManagedLocations(context)
  const location = locations.find((row) => row.businessId === businessId)
  if (!location) return null

  const safe = async <T,>(run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run()
    } catch {
      return null
    }
  }

  const now = new Date()
  const [upcoming, past, employees, assignments, commissions, payments, customers] = await Promise.all([
    safe(() =>
      prisma.appointment.count({
        where: { businessId, startTime: { gte: now }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
      }),
    ),
    safe(() => prisma.appointment.count({ where: { businessId, startTime: { lt: now } } })),
    safe(() => prisma.barber.count({ where: { businessId, isActive: true } })),
    safe(() => prisma.staffLocationAssignment.count({ where: { businessId, effectiveTo: null } })),
    safe(() => prisma.commissionEntry.count({ where: { businessId, status: { in: ['PENDING', 'APPROVED'] } } })),
    safe(() => prisma.payment.count({ where: { businessId, status: { in: ['PENDING', 'PROCESSING'] } } })),
    safe(() => prisma.customer.count({ where: { businessId, archivedAt: null } })),
  ])

  const settled = commissions === 0 && payments === 0

  const facts: ClosureFacts = {
    location,
    upcomingAppointments: upcoming,
    pastAppointments: past,
    activeEmployees: employees,
    staffAssignments: assignments,
    outstandingCommissions: commissions,
    unsettledPayments: payments,
    customers,
    settled,
    exported: recordsExported,
  }
  return buildClosureReview(facts)
}

export async function renameRegion(
  context: OrgContext,
  actorId: string,
  from: string,
  to: string,
): Promise<OperationResult<RegionRenamePlan>> {
  if (!can(context.role, 'locations.manage')) return fail(403, 'Your role cannot rename a region.')
  const locations = await loadManagedLocations(context)
  const plan = planRegionRename(locations, from, to, context.regions)
  if (!plan.allowed) return fail(400, plan.reasons[0], plan.reasons)

  try {
    await prisma.$transaction(async (tx) => {
      await tx.organizationLocation.updateMany({
        where: { organizationId: context.organizationId, businessId: { in: plan.affectedBusinessIds } },
        data: { region: to.trim() },
      })
      await tx.organizationConfigAudit.create({
        data: buildConfigAuditEntry({
          organizationId: context.organizationId,
          actorId,
          action: 'region.rename',
          entity: 'OrganizationLocation',
          summary: `Renamed the region ${from.trim()} to ${to.trim()} across ${plan.affectedBusinessIds.length} location${plan.affectedBusinessIds.length === 1 ? '' : 's'}.`,
          previousValue: { region: from.trim() },
          newValue: { region: to.trim(), locations: plan.affectedBusinessIds.length },
          at: new Date().toISOString(),
        }),
      })
    })
    return done(plan)
  } catch (error) {
    console.error('renameRegion failed:', error)
    return fail(500, 'The region could not be renamed. Nothing was changed.')
  }
}

export { isValidTimezone }
