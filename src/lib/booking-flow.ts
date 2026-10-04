/**
 * Booking-flow selection state — pure helpers for the customer wizard.
 *
 * The customer owns their appointment. The system may prefill or suggest,
 * but it never silently replaces a customer's choice. When a change the
 * customer makes invalidates a later selection, we clear ONLY the invalid
 * part and explain why — these helpers compute exactly that.
 *
 * Kept pure (no React, no fetch) so the invalidation rules are unit-tested
 * in tests/booking-flow-state.test.ts.
 */

export interface BarberLike {
  id: string
  name?: string
  services?: Array<{ serviceId?: string; service?: { id?: string } }>
}

export interface FlowSelections {
  serviceId: string
  barberId: string // '', 'any', or a real barber id
  dateISO: string | null // 'yyyy-MM-dd'
  time: string // 'h:mm a' label or ''
}

export interface FlowChangeResult {
  selections: FlowSelections
  /** Human explanation shown to the customer when something was cleared. */
  notice: string | null
}

/** Does this barber offer the given service? A barber with no linked
 *  services is treated as offering everything (open template default). */
export function barberOffersService(barber: BarberLike, serviceId: string): boolean {
  if (!serviceId) return true
  if (!barber.services || barber.services.length === 0) return true
  return barber.services.some((s) =>
    s.serviceId === serviceId || s.service?.id === serviceId
  )
}

/** Can this barber id (which may be a real barber) be kept when the
 *  customer switches to the given service? 'any'/'' are always compatible. */
export function barberCompatibleWithService(
  barberId: string,
  serviceId: string,
  barbers: BarberLike[]
): boolean {
  if (!barberId || barberId === 'any' || barberId === 'first-available') return true
  const barber = barbers.find((b) => b.id === barberId)
  if (!barber) return false
  return barberOffersService(barber, serviceId)
}

function base(s: FlowSelections): FlowChangeResult {
  return { selections: { ...s }, notice: null }
}

/**
 * Customer changed the SERVICE. Keep barber when still compatible (barber
 * offers the new service); otherwise clear barber AND everything that
 * depended on it. The time always resets — a different service can change
 * duration and therefore which slots are open.
 */
export function applyServiceChange(
  prev: FlowSelections,
  nextServiceId: string,
  barbers: BarberLike[]
): FlowChangeResult {
  const result = base(prev)
  result.selections.serviceId = nextServiceId
  result.selections.time = ''

  const barberName = barbers.find((b) => b.id === prev.barberId)?.name
  const compatible = barberCompatibleWithService(prev.barberId, nextServiceId, barbers)
  if (!compatible) {
    result.selections.barberId = ''
    result.selections.dateISO = prev.dateISO // date itself stays valid
    result.notice = barberName
      ? `${barberName} doesn't offer that service. Please choose another barber.`
      : 'That barber isn\u2019t available for this service. Please choose another barber.'
  } else {
    result.notice = null
  }
  return result
}

/**
 * Customer changed the BARBER. The date survives (any bookable date is
 * still bookable); the time resets because availability is per-barber.
 */
export function applyBarberChange(prev: FlowSelections, nextBarberId: string): FlowChangeResult {
  const result = base(prev)
  result.selections.barberId = nextBarberId
  result.selections.time = ''
  return result
}

/**
 * Customer changed the DATE. Service and barber survive; the time resets
 * because it was picked for the previous date.
 */
export function applyDateChange(prev: FlowSelections, nextDateISO: string | null): FlowChangeResult {
  const result = base(prev)
  result.selections.dateISO = nextDateISO
  result.selections.time = ''
  return result
}

/**
 * A preselected time (e.g. from quick booking) must exist in the freshly
 * loaded slot list to stay selected. If it vanished we clear it and say
 * why — never silently swap in another time.
 */
export function reconcilePreselectedTime(
  prev: FlowSelections,
  availableTimes: string[]
): FlowChangeResult {
  const result = base(prev)
  if (prev.time && !availableTimes.includes(prev.time)) {
    const wasTaken = prev.time // we can't distinguish "taken" from "never valid" client-side
    result.selections.time = ''
    result.notice =
      `${wasTaken} is no longer available for this service, barber, and date. ` +
      'Please choose another time below.'
  }
  return result
}
