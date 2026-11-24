import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-helpers'
import { can } from '@/lib/organization/capabilities'
import { buildConfigAuditEntry } from '@/lib/organization/config-audit'
import { loadManagedLocations } from '@/lib/organization/location-service'
import {
  money,
  requestVerdict,
  summariseRequests,
  validatePriceRequest,
  type PriceRequestRow,
} from '@/lib/organization/pricing-approvals'
import { resolveOrganizationContext } from '@/lib/organization/resolve'

export const dynamic = 'force-dynamic'

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Price requests for this organization.
 *
 * A location asks; a corporate user decides. Nothing here writes an exception directly:
 * approval is what creates the exception the price resolver reads, so a pending request
 * cannot change what a shop charges by existing.
 */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }
  const context = resolved.context
  if (!can(context.role, 'services.read')) {
    return NextResponse.json({ error: 'Your role cannot see service prices.' }, { status: 403 })
  }

  const [requests, templates, locations] = await Promise.all([
    prisma.organizationServicePriceRequest
      .findMany({
        where: { organizationId: context.organizationId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      .catch(() => []),
    prisma.organizationServiceTemplate
      .findMany({ where: { organizationId: context.organizationId }, select: { id: true, name: true, defaultPriceCents: true, active: true } })
      .catch(() => []),
    loadManagedLocations(context),
  ])

  const templateById = new Map(templates.map((row) => [row.id, row] as [string, typeof row]))
  const nameById = new Map(locations.map((row) => [row.businessId, row.name] as [string, string]))
  const scoped = requests.filter((row) => context.locationBusinessIds.includes(row.businessId))

  const personIds = Array.from(
    new Set(scoped.flatMap((row) => [row.requestedById, row.decidedById]).filter((id): id is string => Boolean(id))),
  )
  const people = await prisma.user
    .findMany({ where: { id: { in: personIds } }, select: { id: true, name: true, email: true } })
    .catch(() => [])
  const personName = new Map(people.map((row) => [row.id, row.name ?? row.email] as [string, string]))

  const rows: PriceRequestRow[] = scoped.map((row) => {
    const template = templateById.get(row.templateId)
    return {
      id: row.id,
      status: row.status,
      requestedAt: row.createdAt.toISOString(),
      templateName: template?.name ?? 'A service that no longer exists',
      locationName: nameById.get(row.businessId) ?? 'A location you cannot see',
      standardPriceCents: template?.defaultPriceCents ?? 0,
      requestedPriceCents: row.priceCents,
      reason: row.reason,
      requestedByName: personName.get(row.requestedById) ?? null,
      approvedByName: row.decidedById ? personName.get(row.decidedById) ?? null : null,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    }
  })

  return NextResponse.json({
    requests: rows,
    summary: summariseRequests(rows, new Date()),
    canDecide: can(context.role, 'services.manage'),
    templates: templates.map((row) => ({ id: row.id, name: row.name, priceCents: row.defaultPriceCents, priceLabel: money(row.defaultPriceCents), active: row.active })),
    locations: locations.map((row) => ({ businessId: row.businessId, name: row.name, status: row.status })),
  })
}

/** Ask for a different price at one location. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }
  const context = resolved.context

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'The request could not be read.' }, { status: 400 })
  }

  const templateId = str(body.templateId)
  const businessId = str(body.businessId)
  const priceCents = typeof body.priceCents === 'number' ? body.priceCents : Number(body.priceCents)
  const reason = str(body.reason)

  const template = templateId
    ? await prisma.organizationServiceTemplate
        .findFirst({ where: { id: templateId, organizationId: context.organizationId } })
        .catch(() => null)
    : null
  if (!template) return NextResponse.json({ error: 'That service could not be found in your organization.' }, { status: 404 })

  const input = {
    templateName: template.name,
    templateActive: template.active,
    standardPriceCents: template.defaultPriceCents,
    requestedPriceCents: priceCents,
    reason,
    businessId,
    allowedBusinessIds: context.locationBusinessIds,
  }

  const permission = requestVerdict(context.role, input)
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  const validation = validatePriceRequest(input)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.errors[0], reasons: validation.errors }, { status: 400 })
  }

  const existing = await prisma.organizationServicePriceRequest
    .findFirst({
      where: { templateId: template.id, businessId: businessId as string, status: { in: ['PENDING', 'APPROVED'] } },
      orderBy: { createdAt: 'desc' },
    })
    .catch(() => null)
  if (existing?.status === 'PENDING') {
    return NextResponse.json({ error: 'This location already has a request waiting for a decision.' }, { status: 409 })
  }
  if (existing?.status === 'APPROVED') {
    return NextResponse.json(
      { error: 'This location already has an approved price for that service. Revoke it before asking for a different one.' },
      { status: 409 },
    )
  }

  const created = await prisma.organizationServicePriceRequest.create({
    data: {
      organizationId: context.organizationId,
      templateId: template.id,
      businessId: businessId as string,
      priceCents: Math.round(priceCents),
      reason: (reason ?? '').trim(),
      status: 'PENDING',
      requestedById: auth.user.id,
    },
  })

  await prisma.organizationConfigAudit
    .create({
      data: buildConfigAuditEntry({
        organizationId: context.organizationId,
        actorId: auth.user.id,
        action: 'pricing.request',
        entity: 'OrganizationServicePriceRequest',
        entityId: created.id,
        summary: `Asked to charge ${money(created.priceCents)} for ${template.name} instead of the standard ${money(template.defaultPriceCents)}.`,
        previousValue: { priceCents: template.defaultPriceCents },
        newValue: { priceCents: created.priceCents, status: 'PENDING' },
        at: new Date().toISOString(),
      }),
    })
    .catch(() => null)

  return NextResponse.json({ success: true, id: created.id })
}
