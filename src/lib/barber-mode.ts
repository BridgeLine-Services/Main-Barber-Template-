// ─── Barber Mode: pure schedule derivation ─────────────────────────────────
//
// Barber Mode is a mobile-first work surface for an individual barber.
// This module contains ONLY pure logic — deriving the barber's working day
// from a list of appointments. It performs no database access and holds no
// tenant data; callers (the barber-mode route) are responsible for fetching
// businessId/barberId-scoped appointments through the existing Prisma
// conventions.
//
// IMPORTANT — no schema change:
// The canonical AppointmentStatus lifecycle (PENDING → CONFIRMED →
// COMPLETED / CANCELLED / NO_SHOW / RESCHEDULED) is unchanged. "Current
// appointment" is derived from time: a PENDING/CONFIRMED appointment whose
// window [startTime, endTime) contains "now". No new status was added and
// no transition rules were touched.

export interface BarberModeAppointment {
  id: string
  confirmationNumber: string
  status: string
  startTime: Date | string
  endTime: Date | string
  customer?: {
    id: string
    firstName: string
    lastName: string
    phone: string
    notes?: string | null
    preferences?: unknown
  } | null
  service?: { id: string; name: string; duration: number; price: number } | null
  customerNotes?: string | null
}

export interface BarberModeDay {
  /** PENDING/CONFIRMED appointment happening right now (time-derived) */
  current: BarberModeAppointment | null
  /** Next PENDING/CONFIRMED appointment starting in the future */
  next: BarberModeAppointment | null
  /** Remaining PENDING/CONFIRMED appointments after `next`, chronological */
  upcoming: BarberModeAppointment[]
  /** Completed today */
  completed: BarberModeAppointment[]
  /** Cancelled today */
  cancelled: BarberModeAppointment[]
  /** Marked no-show today */
  noShows: BarberModeAppointment[]
  /** Every appointment for the day, chronological (for the full schedule) */
  all: BarberModeAppointment[]
}

const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED'] as const

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function isActive(a: BarberModeAppointment): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(a.status)
}

function isHappeningNow(a: BarberModeAppointment, nowMs: number): boolean {
  return toMs(a.startTime) <= nowMs && nowMs < toMs(a.endTime)
}

/**
 * Derive the barber's working day from their (already tenant-scoped)
 * appointments. Deterministic and side-effect free.
 */
export function deriveBarberModeDay(
  appointments: BarberModeAppointment[],
  now: Date | string = new Date()
): BarberModeDay {
  const nowMs = toMs(now)
  const sorted = [...appointments].sort((a, b) => toMs(a.startTime) - toMs(b.startTime))

  const current =
    sorted.find((a) => isActive(a) && isHappeningNow(a, nowMs)) ?? null

  const futureActive = sorted.filter((a) => isActive(a) && toMs(a.startTime) > nowMs)

  return {
    current,
    next: futureActive[0] ?? null,
    upcoming: futureActive.slice(1),
    completed: sorted.filter((a) => a.status === 'COMPLETED'),
    cancelled: sorted.filter((a) => a.status === 'CANCELLED'),
    noShows: sorted.filter((a) => a.status === 'NO_SHOW'),
    all: sorted,
  }
}

/**
 * Human-friendly label for a moment relative to now ("in 2h 05m", "now").
 * Pure — used by the UI for the current/next appointment countdown.
 */
export function formatRelativeWhen(
  target: Date | string,
  now: Date | string = new Date()
): string {
  const diffMs = toMs(target) - toMs(now)
  if (Math.abs(diffMs) < 60_000) return 'now'
  const abs = Math.abs(diffMs)
  const h = Math.floor(abs / 3_600_000)
  const m = Math.floor((abs % 3_600_000) / 60_000)
  const label = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
  return diffMs > 0 ? `in ${label}` : `${label} ago`
}

/**
 * The actions available to a barber on an appointment, derived from the
 * canonical status model (src/lib/validation.ts VALID_TRANSITIONS).
 * Pure — mirrors the server-enforced state machine for UI gating only.
 */
export interface BarberModeAction {
  complete: boolean
  markNoShow: boolean
  cancel: boolean
}

export function availableActions(a: Pick<BarberModeAppointment, 'status'>): BarberModeAction {
  switch (a.status) {
    case 'PENDING':
    case 'CONFIRMED':
      return { complete: true, markNoShow: true, cancel: true }
    default:
      return { complete: false, markNoShow: false, cancel: false }
  }
}
