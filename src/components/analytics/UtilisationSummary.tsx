import { prisma } from '@/lib/prisma'
import { buildUtilisation } from '@/lib/analytics/utilisation'

const DAYS = 30

/**
 * Two owner numbers that had no home: how much of the diary is sold, and what the
 * membership base is worth. A server component so the reads stay on the server and no
 * client bundle grows. Every read is wrapped: a failure shows "could not be checked",
 * never a zero.
 */
async function load(businessId: string) {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000)

  const safe = async <T,>(run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run()
    } catch {
      return null
    }
  }

  const schedules = await safe(() =>
    prisma.schedule.findMany({
      where: { barber: { businessId } },
      select: { dayOfWeek: true, startTime: true, endTime: true, isOff: true },
    }),
  )

  const appointments = await safe(() =>
    prisma.appointment.findMany({
      where: { businessId, startTime: { gte: since } },
      select: { startTime: true, status: true, service: { select: { duration: true } } },
    }),
  )

  const memberships = await safe(() =>
    prisma.membership.findMany({
      where: { businessId },
      select: { status: true, plan: { select: { price: true } } },
    }),
  )

  return buildUtilisation({
    schedules,
    appointments: appointments?.map((a) => ({
      startTime: a.startTime,
      durationMinutes: a.service?.duration ?? null,
      status: a.status,
    })) ?? null,
    memberships: memberships?.map((m) => ({ status: m.status, planPrice: m.plan?.price ?? null })) ?? null,
    rangeDays: DAYS,
  })
}

export async function UtilisationSummary({ businessId }: { businessId: string }) {
  const view = await load(businessId)

  const hours = (mins: number | null) =>
    mins === null ? 'Not available' : `${Math.round((mins / 60) * 10) / 10} hours`

  return (
    <section aria-labelledby="utilisation-heading" className="rounded-xl border border-border bg-card p-4">
      <h2 id="utilisation-heading" className="text-base font-semibold text-foreground">
        How full the diary is, and what memberships are worth
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Booked share of your open hours</p>
          <p className="text-2xl font-semibold text-foreground">
            {view.utilisation.percent === null ? 'Not available' : `${view.utilisation.percent}%`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {hours(view.utilisation.bookedMinutes)} booked of {hours(view.utilisation.availableMinutes)} open. {view.utilisation.note}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Active memberships</p>
          <p className="text-2xl font-semibold text-foreground">
            {view.membership.activeCount === null ? 'Not available' : view.membership.activeCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {view.membership.monthlyRevenue === null
              ? view.membership.note
              : `Worth ${view.membership.monthlyRevenue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} a month. ${view.membership.note}`}
          </p>
        </div>
      </div>
    </section>
  )
}
