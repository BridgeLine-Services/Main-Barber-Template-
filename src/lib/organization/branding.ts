/**
 * Centralized branding with approved location exceptions (Priority 3, part A).
 *
 * Corporate sets the look. A location may override only the fields corporate has
 * explicitly allowed, and every resolved value says where it came from, so an owner can
 * always answer "why does this shop look like that?".
 */

export interface BrandValues {
  logoUrl: string | null
  primaryColor: string | null
  accentColor: string | null
  brandGuidelinesUrl: string | null
}

export type BrandField = keyof BrandValues

export interface BrandSettingsRecord extends BrandValues {
  allowedOverrides: string[]
}

export interface ResolvedBrandField {
  field: BrandField
  value: string | null
  source: 'organization' | 'location' | 'unset'
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export function isValidBrandValue(field: BrandField, value: string): boolean {
  if (field === 'logoUrl' || field === 'brandGuidelinesUrl') {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' || url.protocol === 'http:'
    } catch {
      return false
    }
  }
  return HEX.test(value)
}

export interface BrandOverrideResult {
  accepted: boolean
  reason: string
  field: BrandField
}

/** A location may only override a field corporate has allowed, with a valid value. */
export function requestLocationOverride(
  settings: BrandSettingsRecord,
  field: BrandField,
  value: string,
): BrandOverrideResult {
  if (!settings.allowedOverrides.includes(field)) {
    return { accepted: false, field, reason: 'Corporate has not allowed locations to change this. Ask them to allow it, or use the shared brand.' }
  }
  if (!isValidBrandValue(field, value)) {
    return { accepted: false, field, reason: 'That value is not a valid colour or web address, so it was not saved.' }
  }
  return { accepted: true, field, reason: 'This location may use its own value for this field.' }
}

/** Resolve one field, naming the source so the UI can explain it. */
export function resolveBrandField(
  settings: BrandSettingsRecord | null,
  overrides: Partial<BrandValues> | null,
  field: BrandField,
): ResolvedBrandField {
  const override = overrides?.[field] ?? null
  if (override && settings?.allowedOverrides.includes(field)) {
    return { field, value: override, source: 'location' }
  }
  const corporate = settings?.[field] ?? null
  if (corporate) return { field, value: corporate, source: 'organization' }
  return { field, value: null, source: 'unset' }
}

export function resolveBrand(settings: BrandSettingsRecord | null, overrides: Partial<BrandValues> | null): ResolvedBrandField[] {
  const fields: BrandField[] = ['logoUrl', 'primaryColor', 'accentColor', 'brandGuidelinesUrl']
  return fields.map((field) => resolveBrandField(settings, overrides, field))
}

/** Plain explanation of the boundary, for the settings page. */
export function describeBrandBoundary(settings: BrandSettingsRecord | null): string {
  const allowed = settings?.allowedOverrides ?? []
  if (allowed.length === 0) return 'Every location uses the shared brand. No location may change it.'
  return `Locations may change: ${allowed.join(', ')}. Everything else stays shared.`
}
