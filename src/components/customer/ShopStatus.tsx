// Live shop status module for the customer-facing site.
//
// Renders an honest, data-driven status: open/closed computed from the
// business's real weekly hours in the business's own timezone, today's
// hours, and the live walk-in queue state (real WAITING entries for the
// current business day). Nothing is invented — no hours configured means
// a "by appointment" note, not made-up hours. A soft-deactivated shop
// reports "temporarily closed" and offers no booking actions.

import Link from 'next/link'
import { Calendar, Clock, Users } from 'lucide-react'
import { DateTime } from 'luxon'
import { resolveBusiness } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'
import { estimateWaitMinutes, WALK_IN_TIME_RANGE } from '@/lib/queue'
import { resolveBusinessTimezone, startOfDayUTC } from '@/lib/timezone'
import type { BusinessHours } from '@/lib/business-hours'

export async function ShopStatus() {
  const business = await resolveBusiness().catch(() => null)
  if (!business) return null

  // Soft-deactivated shops keep marketing pages but report closed.
  const deactivated = business.deactivatedAt != null

  // Current local day/time in the BUSINESS's timezone, not the server's.
  const timezone = resolveBusinessTimezone(business)
  const now = DateTime.now().setZone(timezone)
  const dayKey = (now.weekdayLong || '').toLowerCase() // 'monday' … 'sunday'
  const todayHours = business.hours && typeof business.hours === 'object'
    ? (business.hours as BusinessHours)[dayKey]
    : undefined
  const hasHours = Boolean(todayHours)

  const minutesNow = now.hour * 60 + now.minute
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }
  const openNow =
    !deactivated &&
    hasHours &&
    !todayHours!.isOff &&
    minutesNow >= toMinutes(todayHours!.open || '09:00') &&
    minutesNow < toMinutes(todayHours!.close || '18:00')

  // Live queue state for the current business day (real WAITING entries).
  const [waitingEntries, activeBarbers] = await Promise.all([
    prisma.waitlistEntry.findMany({
      where: {
        businessId: business.id,
        status: 'WAITING',
        preferredDate: startOfDayUTC(timezone),
        preferredTimeRange: WALK_IN_TIME_RANGE,
      },
      include: { service: { select: { duration: true } } },
      orderBy: { createdAt: 'asc' },
    }).catch(() => []),
    prisma.barber.count({ where: { businessId: business.id, isActive: true } }).catch(() => 0),
  ])
  const queueLength = waitingEntries.length
  // Honest estimate a NEW walk-in would face: everyone currently ahead.
  const estimatedWait = estimateWaitMinutes(waitingEntries, activeBarbers)
  const walkInsWelcome = business.walkInsWelcome !== false

  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-5 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Open / closed pill — colored dot + label */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              openNow ? 'bg-emerald-500' : 'bg-destructive/70'
            }`}
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-foreground">
            {deactivated
              ? 'Temporarily closed'
              : openNow
                ? 'Open now'
                : 'Closed'}
          </span>
        </div>

        {/* Today's hours — real configured hours only */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" aria-hidden="true" />
          {!hasHours || todayHours!.isOff ? (
            <span>By appointment today</span>
          ) : (
            <span>
              Today: {todayHours!.open || '09:00'} – {todayHours!.close || '18:00'}
            </span>
          )}
        </div>

        {/* Live walk-in queue state */}
        {walkInsWelcome && !deactivated && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-4 w-4" aria-hidden="true" />
            <span>
              {queueLength === 0
                ? 'No walk-in queue'
                : `${queueLength} in queue${estimatedWait != null ? ` · ~${estimatedWait} min wait` : ''}`}
            </span>
          </div>
        )}
      </div>

      {/* Actions — none when deactivated */}
      {!deactivated && (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Link
            href="/book"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors duration-micro hover:bg-primary/90 focus-ring"
          >
            <Calendar className="h-4 w-4" aria-hidden="true" />
            Book an appointment
          </Link>
          {walkInsWelcome && (
            <Link
              href="/queue"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors duration-micro hover:brightness-125 focus-ring rounded-sm px-1 py-1"
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              Join the walk-in queue
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
