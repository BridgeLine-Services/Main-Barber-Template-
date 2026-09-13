/**
 * Customer Haircut History & Preferences
 * ---------------------------------------
 * Personalizes returning appointments by reusing the existing Customer model:
 * the `preferences` JSON field, `notes`, tags, and the existing appointment
 * history. No duplicate customer profile model is created.
 *
 * The key privacy rule enforced here: staff-only fields (notes, tags, and
 * internal labels) NEVER appear in customer-visible payloads. The
 * customer-visible builders in this module omit `notes` by construction.
 */

export interface HistoryAppointmentInput {
  id: string
  status: string
  startTime: Date | string
  endTime: Date | string
  customerNotes?: string | null
  service?: { id: string; name: string; price: number | null } | null
  barber?: { id: string; name: string } | null
}

export interface ServiceHistoryItem {
  appointmentId: string
  serviceName: string
  serviceId: string | null
  barberId: string | null
  barberName: string
  date: string // ISO date (start time)
  status: string
}

export interface PreferredBarberResult {
  barberId: string
  barberName: string
  completedVisits: number
}

/**
 * Summarize appointment history into a per-visit service record.
 * Ordered most recent first. Includes every status so staff sees the full
 * picture; customer-visible views filter via summarizeForCustomer.
 */
export function summarizeServiceHistory(appointments: HistoryAppointmentInput[]): ServiceHistoryItem[] {
  return appointments
    .map((a) => ({
      appointmentId: a.id,
      serviceName: a.service?.name || 'Service removed',
      serviceId: a.service?.id ?? null,
      barberId: a.barber?.id ?? null,
      barberName: a.barber?.name || 'Unassigned',
      date: new Date(a.startTime).toISOString(),
      status: a.status,
    }))
    .sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime())
}

/**
 * Derive the preferred barber strictly from existing data: the barber with
 * the most COMPLETED appointments (ties broken by most recent visit).
 * Returns null when there is no completed history.
 */
export function computePreferredBarber(appointments: HistoryAppointmentInput[]): PreferredBarberResult | null {
  const tally = new Map<string, { name: string; visits: number; lastVisit: number }>()
  for (const a of appointments) {
    if (a.status !== 'COMPLETED' || !a.barber) continue
    const existing = tally.get(a.barber.id)
    const visitTime = new Date(a.startTime).getTime()
    tally.set(a.barber.id, {
      name: a.barber.name,
      visits: (existing?.visits || 0) + 1,
      lastVisit: Math.max(existing?.lastVisit || 0, visitTime),
    })
  }
  if (tally.size === 0) return null
  const [barberId, info] = [...tally.entries()].sort((a, b) => {
    if (b[1].visits !== a[1].visits) return b[1].visits - a[1].visits
    return b[1].lastVisit - a[1].lastVisit
  })[0]
  return { barberId, barberName: info.name, completedVisits: info.visits }
}

/**
 * Known preference keys get friendly labels; anything else the shop or the
 * customer saved passes through with a humanized label. The preference
 * system stays flexible — no rigid taxonomy is imposed. Values are kept as
 * strings so arbitrary preferences display naturally.
 */
const PREFERENCE_LABELS: Record<string, string> = {
  haircutStyle: 'Haircut Style',
  style: 'Haircut Style',
  guardLength: 'Guard Length',
  guard: 'Guard Length',
  beard: 'Beard Preference',
  beardPreference: 'Beard Preference',
  side: 'Side Preference',
  sidePreference: 'Side Preference',
  taper: 'Taper',
  fade: 'Fade',
  preferredBarber: 'Preferred Barber',
}

export interface DisplayPreference {
  key: string
  label: string
  value: string
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
}

function preferenceValueToString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
    return value.join(', ')
  }
  return null
}

/**
 * Format the flexible `preferences` JSON field for display. Unknown keys are
 * preserved with a humanized label so each shop's own preference vocabulary
 * keeps working. Non-scalar values are skipped rather than coerced.
 */
export function formatPreferencesForDisplay(preferences: unknown): DisplayPreference[] {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return []
  const out: DisplayPreference[] = []
  for (const [key, value] of Object.entries(preferences as Record<string, unknown>)) {
    const asString = preferenceValueToString(value)
    if (asString === null || asString.trim() === '') continue
    out.push({ key, label: PREFERENCE_LABELS[key] || humanizeKey(key), value: asString })
  }
  return out
}

export interface CustomerVisibleProfile {
  firstName: string
  lastName: string
  email: string
  phone: string
  smsConsent: boolean
  /** Customer-editable/safe preferences only — formatted for display. */
  preferences: DisplayPreference[]
  /** Previous services, most recent first. */
  serviceHistory: ServiceHistoryItem[]
  preferredBarber: PreferredBarberResult | null
  upcomingCount: number
  completedCount: number
}

/**
 * Build the customer-visible slice of a customer's record. Staff-only fields
 * (notes, tags, internal labels) are structurally excluded: this builder does
 * not accept or copy them, so a customer can never be shown staff notes.
 */
export function toCustomerVisibleProfile(params: {
  customer: { firstName: string; lastName: string; email: string; phone: string; smsConsent: boolean; preferences: unknown }
  appointments: HistoryAppointmentInput[]
  now?: Date
}): CustomerVisibleProfile {
  const { customer, appointments } = params
  const now = params.now || new Date()
  const history = summarizeServiceHistory(appointments)
  const upcoming = appointments.filter(
    (a) => new Date(a.startTime) >= now && !['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(a.status)
  )
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    smsConsent: customer.smsConsent,
    preferences: formatPreferencesForDisplay(customer.preferences),
    serviceHistory: history,
    preferredBarber: computePreferredBarber(appointments),
    upcomingCount: upcoming.length,
    completedCount: appointments.filter((a) => a.status === 'COMPLETED').length,
  }
}

/**
 * Validate a preferences payload before saving it to the Customer.preferences
 * JSON field (customer self-service or staff edit). Rules:
 * - must be a plain object, at most 20 keys
 * - keys: 1-40 chars, letters/digits/space/underscore/hyphen only
 * - values: strings up to 200 chars (numbers/booleans coerced to strings)
 * Returns cleaned preferences or null when invalid.
 */
export function sanitizePreferences(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0 || entries.length > 20) return null
  const cleaned: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z0-9 _-]{1,40}$/.test(key)) return null
    const asString = preferenceValueToString(value)
    if (asString === null || asString.length > 200) return null
    cleaned[key] = asString
  }
  return cleaned
}
