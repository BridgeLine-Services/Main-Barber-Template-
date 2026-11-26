/**
 * Corporate brand settings: the shared look, and which fields a location may change.
 *
 * The rules already exist in `branding.ts` (`isValidBrandValue`, `requestLocationOverride`,
 * `describeBrandBoundary`). This module adds the storage and the audit trail around them, and
 * reuses the repository's managed-storage URL validator rather than inventing a second one for
 * logo links.
 *
 * Two deliberate limits:
 *   - Only the four known fields can be written. There is no arbitrary CSS, no HTML, no theme
 *     engine: the shop-level theme system keeps that job.
 *   - A location may only be allowed to override a field that corporate itself has set. Allowing
 *     an override on an unset field would let a location define the brand by accident.
 */

import { prisma } from '@/lib/prisma'
import { isManagedStorageUrl } from '@/lib/trusted-storage-url'
import { buildConfigAuditEntry } from './config-audit'
import { describeBrandBoundary, isValidBrandValue, resolveBrand } from './branding'
import type { BrandField, BrandValues, ResolvedBrandField } from './branding'

export const BRAND_FIELDS: BrandField[] = ['logoUrl', 'primaryColor', 'accentColor', 'brandGuidelinesUrl']

export interface BrandSettingsView {
  logoUrl: string | null
  primaryColor: string | null
  accentColor: string | null
  brandGuidelinesUrl: string | null
  allowedOverrides: string[]
  boundary: string
}

export interface LocationBrandView {
  businessId: string
  name: string
  /** Where each field's value comes from for this location. */
  resolved: ResolvedBrandField[]
  /** True when the location currently uses at least one value of its own. */
  usesOwnValue: boolean
}

export async function loadBrandSettings(organizationId: string): Promise<BrandSettingsView | null> {
  const row = await prisma.organizationBrandSettings.findUnique({
    where: { organizationId },
    select: {
      logoUrl: true, primaryColor: true, accentColor: true, brandGuidelinesUrl: true, allowedOverrides: true,
    },
  })
  if (!row) {
    return {
      logoUrl: null, primaryColor: null, accentColor: null, brandGuidelinesUrl: null,
      allowedOverrides: [],
      boundary: describeBrandBoundary(null),
    }
  }
  const settings = { ...row, allowedOverrides: row.allowedOverrides }
  return { ...row, boundary: describeBrandBoundary(settings) }
}

/** How the brand resolves at each location, so "why does that shop look like that?" has an answer. */
export async function loadLocationBrands(organizationId: string): Promise<LocationBrandView[]> {
  const locations = await prisma.organizationLocation.findMany({
    where: { organizationId, status: { not: 'closed' } },
    select: {
      businessId: true,
      business: {
        select: {
          name: true,
          logo: true,
          primaryColor: true,
          accentColor: true,
        },
      },
    },
    orderBy: { businessId: 'asc' },
  })

  const settings = await prisma.organizationBrandSettings.findUnique({
    where: { organizationId },
    select: {
      logoUrl: true, primaryColor: true, accentColor: true, brandGuidelinesUrl: true, allowedOverrides: true,
    },
  })

  return locations.map((location) => {
    // A location's own shop-level values are its overrides, but only where they actually differ
    // from the shared brand. Business.primaryColor and accentColor have schema defaults
    // (#1a1a1a, #d4af37), so a shop that never chose a colour still has one: treating that as a
    // deliberate override would report every location as customised the moment corporate
    // allowed the field.
    const local: Partial<BrandValues> = {
      logoUrl: location.business.logo ?? null,
      primaryColor: location.business.primaryColor ?? null,
      accentColor: location.business.accentColor ?? null,
    }
    const overrides: Partial<BrandValues> = {}
    for (const field of ['logoUrl', 'primaryColor', 'accentColor'] as BrandField[]) {
      const localValue = local[field] ?? null
      const sharedValue = settings?.[field] ?? null
      if (localValue !== null && localValue !== sharedValue) overrides[field] = localValue
    }
    const resolved = resolveBrand(settings ?? null, overrides)
    return {
      businessId: location.businessId,
      name: location.business.name,
      resolved,
      usesOwnValue: resolved.some((f) => f.source === 'location'),
    }
  })
}

export interface BrandInput {
  logoUrl?: unknown
  primaryColor?: unknown
  accentColor?: unknown
  brandGuidelinesUrl?: unknown
  allowedOverrides?: unknown
}

export interface SaveResult {
  ok: boolean
  errors: string[]
  settings?: BrandSettingsView
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export async function saveBrandSettings(
  organizationId: string,
  actorId: string,
  input: BrandInput
): Promise<SaveResult> {
  const errors: string[] = []

  // A field that is not sent is left as it is; an explicit null clears it. Treating a missing
  // field as "clear it" would wipe a logo every time a form posted only the colours.
  const before = await prisma.organizationBrandSettings.findUnique({
    where: { organizationId },
    select: { logoUrl: true, primaryColor: true, accentColor: true, brandGuidelinesUrl: true, allowedOverrides: true },
  })

  const sent = {
    logoUrl: asNullableString(input.logoUrl),
    primaryColor: asNullableString(input.primaryColor),
    accentColor: asNullableString(input.accentColor),
    brandGuidelinesUrl: asNullableString(input.brandGuidelinesUrl),
  }

  const next: Record<BrandField, string | null> = {
    logoUrl: sent.logoUrl === undefined ? before?.logoUrl ?? null : sent.logoUrl,
    primaryColor: sent.primaryColor === undefined ? before?.primaryColor ?? null : sent.primaryColor,
    accentColor: sent.accentColor === undefined ? before?.accentColor ?? null : sent.accentColor,
    brandGuidelinesUrl: sent.brandGuidelinesUrl === undefined ? before?.brandGuidelinesUrl ?? null : sent.brandGuidelinesUrl,
  }

  for (const field of BRAND_FIELDS) {
    const value = next[field]
    if (value === null) continue
    if (!isValidBrandValue(field, value)) {
      errors.push(
        field === 'primaryColor' || field === 'accentColor'
          ? 'Colours must be a hex value such as #1a1a1a.'
          : 'That web address is not valid. Use a full https:// address.'
      )
    }
    if (field === 'logoUrl' && !isManagedStorageUrl(value)) {
      errors.push('The logo must be an image uploaded through this application, not a link to somewhere else.')
    }
  }

  const requested = Array.isArray(input.allowedOverrides)
    ? input.allowedOverrides.filter((v): v is string => typeof v === 'string')
    : before?.allowedOverrides ?? []
  const unknown = requested.filter((f) => !BRAND_FIELDS.includes(f as BrandField))
  if (unknown.length > 0) errors.push(`Unknown brand fields: ${unknown.join(', ')}.`)
  if (errors.length > 0) return { ok: false, errors }

  // An override is only meaningful for a field corporate has actually set.
  const allowed = requested.filter((f) => next[f as BrandField] !== null)
  const dropped = requested.filter((f) => !allowed.includes(f))
  if (dropped.length > 0) {
    errors.push(
      `A location cannot be allowed to change ${dropped.join(', ')} because the shared brand does not set it yet. Set the shared value first.`
    )
    return { ok: false, errors }
  }

  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.organizationBrandSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        logoUrl: next.logoUrl,
        primaryColor: next.primaryColor,
        accentColor: next.accentColor,
        brandGuidelinesUrl: next.brandGuidelinesUrl,
        allowedOverrides: allowed,
        updatedById: actorId,
      },
      update: {
        logoUrl: next.logoUrl,
        primaryColor: next.primaryColor,
        accentColor: next.accentColor,
        brandGuidelinesUrl: next.brandGuidelinesUrl,
        allowedOverrides: allowed,
        updatedById: actorId,
      },
      select: {
        logoUrl: true, primaryColor: true, accentColor: true, brandGuidelinesUrl: true, allowedOverrides: true,
      },
    })

    const changedFields = BRAND_FIELDS.filter((f) => (before?.[f] ?? null) !== (row[f] ?? null))
    const overridesChanged = JSON.stringify(before?.allowedOverrides ?? []) !== JSON.stringify(row.allowedOverrides)
    if (changedFields.length > 0 || overridesChanged || !before) {
      await tx.organizationConfigAudit.create({
        data: buildConfigAuditEntry({
          organizationId,
          actorId,
          action: before ? 'branding.update' : 'branding.create',
          entity: 'OrganizationBrandSettings',
          entityId: organizationId,
          summary: before
            ? `Changed the shared brand${changedFields.length ? `: ${changedFields.join(', ')}` : ''}${overridesChanged ? `; locations may now change: ${row.allowedOverrides.join(', ') || 'nothing'}` : ''}.`
            : 'Set the shared brand for the first time.',
          previousValue: before
            ? {
                logoUrl: before.logoUrl, primaryColor: before.primaryColor, accentColor: before.accentColor,
                brandGuidelinesUrl: before.brandGuidelinesUrl, allowedOverrides: before.allowedOverrides,
              }
            : null,
          newValue: {
            logoUrl: row.logoUrl, primaryColor: row.primaryColor, accentColor: row.accentColor,
            brandGuidelinesUrl: row.brandGuidelinesUrl, allowedOverrides: row.allowedOverrides,
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
    settings: { ...saved, boundary: describeBrandBoundary({ ...saved }) },
  }
}
