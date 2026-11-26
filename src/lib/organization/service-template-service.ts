/**
 * Organization service templates: the standard service list corporate publishes.
 *
 * The validation and the price-resolution rules already live in `service-templates.ts`;
 * this module only adds the database work around them. Two invariants matter:
 *
 * 1. An organization only ever touches its own templates. The organization id comes from
 *    the resolved session context, never from the request.
 * 2. Editing a template's standard price never touches an approved location exception.
 *    A location that negotiated a price keeps it; the exception row is a separate record
 *    and this module never writes to it.
 */

import { prisma } from '@/lib/prisma'
import { buildConfigAuditEntry } from './config-audit'
import { describeServiceChanges, formatCents, validateServiceTemplate } from './service-templates'
import type { ServiceTemplate } from './service-templates'

export interface TemplateRow extends ServiceTemplate {
  /** How many locations have an approved price that differs from the standard. */
  locationExceptions: number
}

export async function listServiceTemplates(organizationId: string): Promise<TemplateRow[]> {
  const templates = await prisma.organizationServiceTemplate.findMany({
    where: { organizationId },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      durationMinutes: true,
      defaultPriceCents: true,
      active: true,
      _count: { select: { exceptions: true } },
    },
  })

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    durationMinutes: t.durationMinutes,
    defaultPriceCents: t.defaultPriceCents,
    active: t.active,
    locationExceptions: t._count.exceptions,
  }))
}

export interface TemplateInput {
  name?: unknown
  description?: unknown
  durationMinutes?: unknown
  defaultPriceCents?: unknown
  active?: unknown
}

export interface TemplateResult {
  ok: boolean
  errors: string[]
  template?: TemplateRow
}

/** Coerce a request body into the shape the validator understands, without guessing. */
function normalise(input: TemplateInput): Partial<ServiceTemplate> {
  return {
    name: typeof input.name === 'string' ? input.name.trim() : undefined,
    description: typeof input.description === 'string' ? input.description.trim() : null,
    durationMinutes: typeof input.durationMinutes === 'number' ? input.durationMinutes : undefined,
    defaultPriceCents: typeof input.defaultPriceCents === 'number' ? input.defaultPriceCents : undefined,
    active: typeof input.active === 'boolean' ? input.active : undefined,
  }
}

export async function createServiceTemplate(
  organizationId: string,
  actorId: string,
  input: TemplateInput
): Promise<TemplateResult> {
  const value = normalise(input)
  const validation = validateServiceTemplate({
    name: value.name,
    durationMinutes: value.durationMinutes,
    defaultPriceCents: value.defaultPriceCents,
  })
  if (!validation.valid) return { ok: false, errors: validation.errors }

  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.organizationServiceTemplate.create({
      data: {
        organizationId,
        name: value.name as string,
        description: value.description ?? null,
        durationMinutes: value.durationMinutes as number,
        defaultPriceCents: value.defaultPriceCents as number,
        active: value.active ?? true,
      },
    })
    await tx.organizationConfigAudit.create({
      data: buildConfigAuditEntry({
        organizationId,
        actorId,
        action: 'service-template.create',
        entity: 'OrganizationServiceTemplate',
        entityId: created.id,
        summary: `Added the standard service "${created.name}" at ${formatCents(created.defaultPriceCents)} for ${created.durationMinutes} minutes.`,
        previousValue: null,
        newValue: {
          name: created.name,
          durationMinutes: created.durationMinutes,
          defaultPriceCents: created.defaultPriceCents,
          active: created.active,
        },
        at: new Date().toISOString(),
      }),
    })
    return created
  })

  return {
    ok: true,
    errors: [],
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      durationMinutes: template.durationMinutes,
      defaultPriceCents: template.defaultPriceCents,
      active: template.active,
      locationExceptions: 0,
    },
  }
}

/**
 * Update a template's standard values.
 *
 * Approved location prices are deliberately left alone: they live in
 * OrganizationServicePriceException, and changing a standard price is not a decision about
 * a location's negotiated price. The response says how many locations are unaffected so the
 * screen can tell the reader that plainly.
 */
export async function updateServiceTemplate(
  organizationId: string,
  actorId: string,
  templateId: string,
  input: TemplateInput
): Promise<TemplateResult> {
  const existing = await prisma.organizationServiceTemplate.findFirst({
    where: { id: templateId, organizationId },
    select: {
      id: true, name: true, description: true, durationMinutes: true, defaultPriceCents: true, active: true,
    },
  })
  if (!existing) return { ok: false, errors: ['That service is not part of this organization.'] }

  const value = normalise(input)
  const merged: ServiceTemplate = {
    id: existing.id,
    name: value.name ?? existing.name,
    description: value.description === null ? null : value.description ?? existing.description,
    durationMinutes: value.durationMinutes ?? existing.durationMinutes,
    defaultPriceCents: value.defaultPriceCents ?? existing.defaultPriceCents,
    active: value.active ?? existing.active,
  }

  const validation = validateServiceTemplate(merged)
  if (!validation.valid) return { ok: false, errors: validation.errors }

  const changes = describeServiceChanges(
    { ...existing } as ServiceTemplate,
    merged
  )

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.organizationServiceTemplate.update({
      where: { id: existing.id },
      data: {
        name: merged.name,
        description: merged.description,
        durationMinutes: merged.durationMinutes,
        defaultPriceCents: merged.defaultPriceCents,
        active: merged.active,
      },
      select: {
        id: true, name: true, description: true, durationMinutes: true, defaultPriceCents: true, active: true,
        _count: { select: { exceptions: true } },
      },
    })
    if (changes.length > 0) {
      await tx.organizationConfigAudit.create({
        data: buildConfigAuditEntry({
          organizationId,
          actorId,
          action: 'service-template.update',
          entity: 'OrganizationServiceTemplate',
          entityId: row.id,
          summary: `Changed "${existing.name}": ${changes.map((c) => `${c.field} from ${c.before} to ${c.after}`).join('; ')}.`,
          previousValue: {
            name: existing.name,
            durationMinutes: existing.durationMinutes,
            defaultPriceCents: existing.defaultPriceCents,
            active: existing.active,
          },
          newValue: {
            name: row.name,
            durationMinutes: row.durationMinutes,
            defaultPriceCents: row.defaultPriceCents,
            active: row.active,
          },
          at: new Date().toISOString(),
        }),
      })
    }
    return row
  })

  return {
    ok: true,
    errors: [],
    template: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      durationMinutes: updated.durationMinutes,
      defaultPriceCents: updated.defaultPriceCents,
      active: updated.active,
      locationExceptions: updated._count.exceptions,
    },
  }
}
