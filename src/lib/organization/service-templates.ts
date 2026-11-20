/**
 * Standardized services and pricing with controlled location exceptions
 * (Priority 3, part B).
 *
 * Corporate publishes a template. A location either uses the default price or records an
 * approved exception with a reason. Every change produces a history entry that says what
 * changed, who changed it and what it was before, so a price is never a mystery.
 */

export interface ServiceTemplate {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  defaultPriceCents: number
  active: boolean
}

export interface PriceException {
  templateId: string
  businessId: string
  priceCents: number
  reason: string | null
  approvedById: string | null
}

export interface ResolvedPrice {
  templateId: string
  businessId: string
  priceCents: number
  source: 'default' | 'location-exception'
  explanation: string
}

export function resolveServicePrice(
  template: ServiceTemplate,
  exception: PriceException | null,
  businessId: string,
): ResolvedPrice {
  if (exception && exception.templateId === template.id && exception.businessId === businessId) {
    return {
      templateId: template.id,
      businessId,
      priceCents: exception.priceCents,
      source: 'location-exception',
      explanation: `This location charges ${formatCents(exception.priceCents)} instead of the standard ${formatCents(template.defaultPriceCents)}${exception.reason ? `, because ${exception.reason}` : ''}.`,
    }
  }
  return {
    templateId: template.id,
    businessId,
    priceCents: template.defaultPriceCents,
    source: 'default',
    explanation: `This location uses the standard price of ${formatCents(template.defaultPriceCents)}.`,
  }
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateServiceTemplate(input: Partial<ServiceTemplate>): ValidationResult {
  const errors: string[] = []
  if (!input.name?.trim()) errors.push('A service needs a name.')
  if (!Number.isInteger(input.durationMinutes) || (input.durationMinutes ?? 0) <= 0) errors.push('The length must be a whole number of minutes greater than zero.')
  if (!Number.isInteger(input.defaultPriceCents) || (input.defaultPriceCents ?? -1) < 0) errors.push('The price cannot be negative.')
  return { valid: errors.length === 0, errors }
}

export function validatePriceException(input: Partial<PriceException>): ValidationResult {
  const errors: string[] = []
  if (!Number.isInteger(input.priceCents) || (input.priceCents ?? -1) < 0) errors.push('The location price cannot be negative.')
  if (!input.reason?.trim()) errors.push('A location price needs a reason, so the difference can be explained later.')
  if (!input.approvedById?.trim()) errors.push('A location price needs to record who approved it.')
  return { valid: errors.length === 0, errors }
}

export interface ServiceChange {
  field: 'name' | 'description' | 'durationMinutes' | 'defaultPriceCents' | 'active'
  before: string
  after: string
}

/** Field-by-field history, so "what changed" is a list rather than a diff to read. */
export function describeServiceChanges(before: ServiceTemplate, after: ServiceTemplate): ServiceChange[] {
  const changes: ServiceChange[] = []
  const push = (field: ServiceChange['field'], b: string, a: string) => {
    if (b !== a) changes.push({ field, before: b, after: a })
  }
  push('name', before.name, after.name)
  push('description', before.description ?? '', after.description ?? '')
  push('durationMinutes', String(before.durationMinutes), String(after.durationMinutes))
  push('defaultPriceCents', formatCents(before.defaultPriceCents), formatCents(after.defaultPriceCents))
  push('active', before.active ? 'offered' : 'not offered', after.active ? 'offered' : 'not offered')
  return changes
}
