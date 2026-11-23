export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireAuth, getBusinessIdForUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import {
  buildBarberAnalytics,
  type AppointmentFact,
  type PaymentFact,
  type ReferralFact,
  type ScheduleFact,
} from '@/lib/growth/barber-analytics'
import { PERFORMANCE_RANGES, answerRows, revenueRows, UNKNOWN } from '@/lib/growth/dashboard-view'

const MAX_DAYS = 365

function rangeDays(raw: string | string[] | undefined): number {
  const requested = Number(Array.isArray(raw) ? raw[0] : raw ?? '90')
  if (!Number.isFinite(requested)) return 90
  return Math.min(MAX_DAYS, Math.max(1, Math.round(requested)))
}

/**
 * One barber's numbers, read-only.
 *
 * The authorization is the same rule the analytics endpoint applies, applied again here
 * because a page is a second door to the same data: a barber is pinned to their own
 * profile, an owner or admin may name a barber of their own shop, and a barber id that
 * belongs to another shop is refused rather than shown. Nothing on this page writes.
 */
export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; barberId?: string }>
}) {
  const auth = await requireAuth()
  if (!auth.success) redirect('/login')

  const user = auth.user
  if (user.role === 'CUSTOMER') redirect('/dashboard')

  const businessId = await getBusinessIdForUser(user)
  if (!businessId) redirect('/dashboard')

  const params = await searchParams
  const days = rangeDays(params.days)
  const requested = params.barberId

  const isManager = user.role === 'OWNER' || user.role === 'BUSINESS_ADMIN'
  let barberId: string | null = user.barberId ?? null
  let refused: string | null = null

  if (requested) {
    if (!isManager && requested !== user.barberId) {
      refused = 'You can only see your own numbers.'
    } else {
      const barber = await prisma.barber.findFirst({ where: { id: requested, businessId }, select: { id: true } })
      if (!barber) refused = 'That barber is not one of yours.'
      else barberId = barber.id
    }
  }

  if (refused) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-3xl font-bold text-foreground">Performance</h1>
        <p className="rounded-xl border border-border bg-[var(--dash-surface)] p-5 text-sm text-muted-foreground">{refused}</p>
        <Link href="/dashboard/growth/performance" className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--dash-brand)]">
          Go to my own numbers
        </Link>
      </div>
    )
  }

  if (!barberId) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-3xl font-bold text-foreground">Performance</h1>
        <p className="rounded-xl border border-border bg-[var(--dash-surface)] p-5 text-sm text-muted-foreground">
          This account is not linked to a barber, so there are no personal numbers to show. Choose a barber below to see theirs.
        </p>
        <BarberPicker businessId={businessId} days={days} />
      </div>
    )
  }

  const end = new Date()
  const start = new Date(end.getTime() - days * 86_400_000)

  const [appointmentRows, paymentRows, commissionRows, commissionSettings, referralRows, scheduleRows] = await Promise.all([
    prisma.appointment.findMany({
      where: { businessId, barberId, startTime: { gte: start, lte: end } },
      select: { id: true, startTime: true, status: true, customerId: true, service: { select: { name: true, price: true } } },
    }),
    prisma.payment.findMany({
      where: { businessId, barberId, createdAt: { gte: start, lte: end }, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
      select: { amount: true, refundedAmount: true },
    }),
    prisma.commissionEntry.findMany({
      where: { businessId, barberId, createdAt: { gte: start, lte: end } },
      select: { source: true, grossAmount: true, commissionAmount: true, adjustment: true, refundAdjustment: true },
    }),
    prisma.commissionSettings.findUnique({ where: { businessId }, select: { tipsMode: true } }),
    prisma.referralAttribution.findMany({ where: { businessId }, select: { customerId: true, referrerCustomerId: true, source: true } }),
    prisma.schedule.findMany({ where: { barberId }, select: { dayOfWeek: true, startTime: true, endTime: true, isOff: true } }),
  ])

  const appointments: AppointmentFact[] = appointmentRows.map((row) => ({
    id: row.id,
    startTime: row.startTime,
    status: row.status,
    serviceName: row.service?.name ?? null,
    servicePriceCents: row.service ? Math.round(row.service.price * 100) : null,
    source: null,
    customerId: row.customerId,
  }))

  // Tips are a number only when this shop records them. EXCLUDED means they are the
  // barber's own and never written down, so the figure is unknown rather than zero.
  const tipsRecorded = commissionSettings?.tipsMode !== 'EXCLUDED'
  const tipCents = tipsRecorded
    ? commissionRows.filter((row) => row.source === 'TIP').reduce((sum, row) => sum + Math.round(row.grossAmount * 100), 0)
    : null
  const commissionCents = commissionRows.reduce(
    (sum, row) => sum + Math.round((row.commissionAmount + row.adjustment + row.refundAdjustment) * 100),
    0,
  )

  const payments: PaymentFact[] = paymentRows.length > 0
    ? [{
        grossCents: paymentRows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0),
        refundCents: paymentRows.reduce((sum, row) => sum + Math.round((row.refundedAmount ?? 0) * 100), 0),
        tipCents,
        commissionCents,
      }]
    : []

  const referrals: ReferralFact[] = referralRows
  const schedules: ScheduleFact[] = scheduleRows

  const result = buildBarberAnalytics({ appointments, payments, referrals, schedules, rangeDays: days })
  const rows = answerRows(result)
  const money = revenueRows(result.revenue)
  const hasTrade = appointmentRows.length > 0 || paymentRows.length > 0

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Growth</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Performance</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          What happened in the last {days} days. Every figure says how it was worked out, and anything we could not
          work out says so instead of showing zero.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">This page only looks. Nothing here changes your bookings or your pay.</p>
      </div>

      <nav aria-label="Choose a time period" className="flex flex-wrap gap-2">
        {PERFORMANCE_RANGES.map((range) => {
          const active = range.days === days
          return (
            <Link
              key={range.days}
              href={`/dashboard/growth/performance?days=${range.days}${barberId ? `&barberId=${barberId}` : ''}`}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm ${active ? 'border-[var(--dash-brand)] font-semibold text-foreground' : 'border-border text-muted-foreground'}`}
            >
              {range.label}
            </Link>
          )
        })}
      </nav>

      {isManager && <BarberPicker businessId={businessId} days={days} />}

      {!hasTrade && (
        <p className="rounded-xl border border-border bg-[var(--dash-surface)] p-5 text-sm text-muted-foreground">
          Nothing was booked or paid in this period, so there is nothing to show yet. Try a longer period, or check back
          after your next few appointments.
        </p>
      )}

      <section aria-labelledby="answers" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 id="answers" className="text-lg font-semibold text-foreground">Your numbers</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3">
              <dt className="text-sm font-medium text-foreground">{row.question}</dt>
              <dd className={`mt-1 text-base ${row.unknown ? 'text-muted-foreground' : 'font-semibold text-foreground'}`}>{row.answer}</dd>
              <p className="mt-1 text-xs text-muted-foreground">{row.basis}</p>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="money" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 id="money" className="text-lg font-semibold text-foreground">Money</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {money.map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.label}</dt>
              <dd className={`mt-1 text-xl ${row.unknown ? 'text-muted-foreground' : 'font-semibold text-foreground'}`}>{row.value}</dd>
              <p className="mt-1 text-xs text-muted-foreground">{row.meaning}</p>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          No profit figure is shown. This template does not record shop expenses, so a profit number would be a guess
          dressed up as a fact.
        </p>
        {result.notes.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </section>

      {!result.allRead && (
        <p className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 text-sm text-muted-foreground">
          Some of this could not be read ({UNKNOWN}). The rest is still shown so you can see what is known; reload in a
          moment to try again.
        </p>
      )}
    </div>
  )
}

async function BarberPicker({ businessId, days }: { businessId: string; days: number }) {
  const barbers = await prisma.barber.findMany({
    where: { businessId, isActive: true },
    orderBy: { name: 'asc' },
    take: 50,
    select: { id: true, name: true },
  })
  if (barbers.length === 0) return null
  return (
    <section aria-labelledby="barbers" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
      <h2 id="barbers" className="text-lg font-semibold text-foreground">Whose numbers?</h2>
      <p className="mt-1 text-sm text-muted-foreground">Only barbers at your shop appear here.</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {barbers.map((barber) => (
          <li key={barber.id}>
            <Link
              href={`/dashboard/growth/performance?days=${days}&barberId=${barber.id}`}
              className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm text-foreground"
            >
              {barber.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
