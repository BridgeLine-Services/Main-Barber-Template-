/**
 * Two numbers the owner has never been able to see: how much of the diary is actually
 * sold, and what the membership base is worth.
 *
 * Pure by design. Every input can be null, because a failed read is not an empty shop,
 * and this module refuses to turn "could not check" into "0%".
 */

export interface ScheduleRow {
  dayOfWeek: number
  startTime: string
  endTime: string
  isOff: boolean
}

export interface BookedRow {
  startTime: Date
  durationMinutes: number | null
  status: string
}

export interface MembershipRow {
  status: string
  planPrice: number | null
}

export interface UtilisationInput {
  schedules: ScheduleRow[] | null
  appointments: BookedRow[] | null
  memberships: MembershipRow[] | null
  rangeDays: number
  timezoneOffsetMinutes?: number
}

export interface UtilisationResult {
  utilisation: { percent: number | null; bookedMinutes: number | null; availableMinutes: number | null; note: string }
  membership: { activeCount: number | null; monthlyRevenue: number | null; note: string }
  allRead: boolean
}

const UNREAD = 'Could not be checked.'

function minutesOf(clock: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 24 || min < 0 || min > 59) return null
  return h * 60 + min
}

/** Open minutes per week from a recurring schedule, ignoring days marked off. */
export function weeklyOpenMinutes(schedules: ScheduleRow[]): number | null {
  let total = 0
  for (const row of schedules) {
    if (row.isOff) continue
    const start = minutesOf(row.startTime)
    const end = minutesOf(row.endTime)
    if (start === null || end === null) return null
    if (end <= start) return null
    total += end - start
  }
  return total
}

const COUNTS_AS_SOLD = new Set(['COMPLETED', 'CONFIRMED', 'SCHEDULED', 'IN_PROGRESS'])

export function buildUtilisation(input: UtilisationInput): UtilisationResult {
  const { schedules, appointments, memberships, rangeDays } = input
  const days = Math.max(1, Math.round(rangeDays))

  let bookedMinutes: number | null = null
  if (appointments) {
    bookedMinutes = appointments
      .filter((a) => COUNTS_AS_SOLD.has(a.status))
      .reduce((sum, a) => sum + Math.max(0, a.durationMinutes ?? 0), 0)
  }

  let availableMinutes: number | null = null
  if (schedules) {
    const weekly = weeklyOpenMinutes(schedules)
    availableMinutes = weekly === null ? null : Math.round((weekly * days) / 7)
  }

  const percent =
    bookedMinutes === null || availableMinutes === null || availableMinutes <= 0
      ? null
      : Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100))

  const utilisation = {
    percent,
    bookedMinutes,
    availableMinutes,
    note:
      percent !== null
        ? 'Share of your open hours that are booked in this period.'
        : availableMinutes === 0
          ? 'No open hours are set, so there is nothing to measure against yet.'
          : UNREAD,
  }

  let activeCount: number | null = null
  let monthlyRevenue: number | null = null
  if (memberships) {
    const active = memberships.filter((m) => m.status === 'ACTIVE')
    activeCount = active.length
    // A plan with no readable price makes the total unknown, not smaller.
    monthlyRevenue = active.every((m) => typeof m.planPrice === 'number')
      ? Math.round(active.reduce((sum, m) => sum + (m.planPrice ?? 0), 0) * 100) / 100
      : null
  }

  const membership = {
    activeCount,
    monthlyRevenue,
    note:
      activeCount === null
        ? UNREAD
        : monthlyRevenue === null
          ? 'Members are counted, but a plan price could not be read, so the total is not shown.'
          : 'What active memberships are worth each month.',
  }

  return {
    utilisation,
    membership,
    allRead: utilisation.percent !== null && membership.monthlyRevenue !== null,
  }
}
