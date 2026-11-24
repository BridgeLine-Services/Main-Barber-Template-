export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireOwner } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getRebookingTasks } from '@/lib/rebooking-engine'
import { buildGrowthCards, summariseGrowth } from '@/lib/growth/overview'
import { SLOW_DAY_WINDOW_WEEKS, buildSlowDayReport, groupByShopDay, recentWindow, slowDayCard } from '@/lib/growth/slow-days'
import { BUSINESS_STAGES, resolveStage, stageDefinition, availableCapabilities, plannedCapabilities } from '@/lib/growth/stages'
import { inferStage, type ShopFacts } from '@/lib/setup-guidance'
import { readIntendedStage } from '@/lib/growth/stage-store'
import { summariseReferrals, type ReferralRow } from '@/lib/growth/referrals'
import {
  describeProgramState,
  referralEmptyState,
  referralMetricRows,
  whatTheProgramDoes,
} from '@/lib/growth/dashboard-view'

const TONE: Record<string, string> = {
  healthy: 'border-emerald-500/30 bg-emerald-500/5',
  'needs-attention': 'border-amber-500/30 bg-amber-500/5',
  'not-configured': 'border-border bg-[var(--dash-surface)]',
  'could-not-check': 'border-border bg-[var(--dash-surface)]',
}

const LABEL: Record<string, string> = {
  healthy: 'Fine',
  'needs-attention': 'Worth a look',
  'not-configured': 'Not set up',
  'could-not-check': 'Could not check',
}

export default async function GrowthPage() {
  const session = await requireOwner().catch(() => null)
  if (!session?.user) redirect('/login')
  const businessId = session.user.businessId
  if (!businessId) redirect('/dashboard')

  // Each read is isolated: one failing source must not blank the page, and a failure
  // must arrive as null so the card says "could not check" rather than showing a zero.
  const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn()
    } catch {
      return null
    }
  }

  const audience = await safe(() =>
    prisma.customer.count({ where: { businessId, emailOptOut: false } }),
  )
  const campaigns = await safe(() => prisma.marketingCampaign.count({ where: { businessId } }))
  const lastCampaign = await safe(() =>
    prisma.marketingCampaign.findFirst({
      where: { businessId, sentAt: { not: null } },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    }),
  )
  const invites = await safe(() => prisma.reviewRequest.count({ where: { businessId, status: 'SENT' } }))
  const rebooking = await safe(() => getRebookingTasks(businessId))

  // Stage evidence (Part 4.1/4.2). Null counts stay null so the stage is never guessed
  // from a read that failed.
  const serviceCount = await safe(() => prisma.service.count({ where: { businessId, isActive: true } }))
  const barberCount = await safe(() => prisma.barber.count({ where: { businessId, isActive: true } }))
  const intended = await readIntendedStage(businessId)
  const facts: ShopFacts = { serviceCount, barberCount, locationCount: null }
  const resolution = resolveStage(inferStage(facts), intended)
  const definition = stageDefinition(resolution.effective)
  const ready = availableCapabilities(resolution.effective)
  const planned = plannedCapabilities(resolution.effective)

  // Referrals, read the same way the referrals endpoint reads them, so the screen and the
  // API cannot disagree. Every read is wrapped: a failure arrives as null, which the panel
  // reports as "could not verify" rather than as an absence of referrals.
  const program = await safe(() => prisma.referralProgram.findUnique({ where: { businessId } }))
  const referralMetrics = await safe(async () => {
    const attributions = await prisma.referralAttribution.findMany({
      where: { businessId },
      select: { customerId: true, referrerCustomerId: true, source: true },
    })
    if (attributions.length === 0) return summariseReferrals([], 0)
    const bookings = await prisma.appointment.groupBy({
      by: ['customerId'],
      where: { businessId, status: 'COMPLETED', customerId: { in: attributions.map((a) => a.customerId) } },
      _count: { _all: true },
    })
    const bookingCounts = new Map(bookings.map((row) => [row.customerId, row._count._all]))
    const paymentRows = await prisma.payment.findMany({
      where: { businessId, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
      select: { customerId: true, amount: true, refundedAmount: true },
    })
    const revenueByCustomer = new Map<string, number>()
    for (const row of paymentRows) {
      if (!row.customerId) continue
      const cents = Math.round((row.amount - (row.refundedAmount ?? 0)) * 100)
      revenueByCustomer.set(row.customerId, (revenueByCustomer.get(row.customerId) ?? 0) + cents)
    }
    const rows: ReferralRow[] = attributions.map((a) => ({
      customerId: a.customerId,
      referrerCustomerId: a.referrerCustomerId,
      source: a.source,
      revenueCents: revenueByCustomer.get(a.customerId) ?? 0,
      bookings: bookingCounts.get(a.customerId) ?? 0,
    }))
    const total = Array.from(revenueByCustomer.values()).reduce((sum, value) => sum + value, 0)
    return summariseReferrals(rows, total)
  })

  // Quiet days: the shop's own last eight weeks, bucketed in the shop's own timezone rather
  // than the server's. A failed read arrives as null so the card says it could not check,
  // instead of calling an unread week "even".
  const timezone =
    (await safe(() =>
      prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } }),
    ))?.timezone ?? 'America/Los_Angeles'

  const quietWindow = recentWindow(SLOW_DAY_WINDOW_WEEKS)
  const bookedTimes = await safe(() =>
    prisma.appointment.findMany({
      where: {
        businessId,
        startTime: { gte: quietWindow.since, lt: quietWindow.until },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      select: { startTime: true },
    }),
  )

  const quietDays = buildSlowDayReport({
    days: bookedTimes ? groupByShopDay(bookedTimes.map((row) => row.startTime), timezone) : null,
    // The page has no verified count of customers who have drifted, so it says so rather
    // than guessing an audience size it cannot check.
    dormantCustomers: null,
  })

  const cards = buildGrowthCards({
    audienceCount: audience,
    dueCount: null,
    atRiskCount: null,
    rebookingWaiting: rebooking ? rebooking.length : null,
    campaignCount: campaigns,
    lastCampaignSentAt: lastCampaign?.sentAt ? lastCampaign.sentAt.toISOString() : null,
    reviewInvitesSent: invites,
    emailConfigured: null,
  })

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Growing your shop</h1>
        <p className="mt-1 text-sm text-muted-foreground">{summariseGrowth(cards)}</p>
      </header>

      <section aria-labelledby="stage-strip-heading" className="rounded-xl border border-input bg-[var(--dash-surface)]/50 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="stage-strip-heading" className="text-sm font-semibold text-foreground">
            Where you are: {definition.label}
          </h2>
          <Link href="/dashboard/getting-started" className="text-xs font-medium text-[var(--dash-brand)] underline-offset-2 hover:underline">
            Open your next steps
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{resolution.note}</p>

        <ol className="mt-3 grid gap-2 sm:grid-cols-5">
          {BUSINESS_STAGES.map((stage) => {
            const isCurrent = stage.id === resolution.effective
            return (
              <li
                key={stage.id}
                aria-current={isCurrent ? 'step' : undefined}
                className={
                  'rounded-lg border p-2 text-center text-xs ' +
                  (isCurrent
                    ? 'border-[var(--dash-brand)] bg-[var(--dash-brand)]/10 font-semibold text-foreground'
                    : 'border-input text-muted-foreground')
                }
              >
                <span className="block text-[11px] tabular-nums">{stage.number}</span>
                {stage.label}
              </li>
            )
          })}
        </ol>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-foreground">You can do this today ({ready.length})</p>
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {ready.slice(0, 6).map((c) => (
                <li key={c.id}>
                  {c.href ? (
                    <Link href={c.href} className="underline-offset-2 hover:underline">{c.label}</Link>
                  ) : (
                    c.label
                  )}
                  {c.availability === 'partial' && <span className="ml-1 text-amber-500">(partly built)</span>}
                </li>
              ))}
              {ready.length > 6 && <li>and {ready.length - 6} more on the next steps page</li>}
            </ul>
          </div>
          {planned.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreground">Not built yet ({planned.length})</p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {planned.map((c) => (
                  <li key={c.id}>{c.label}</li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Named so you are never promised something that is not there.
              </p>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {[...cards, slowDayCard(quietDays)].map((card) => (
          <section
            key={card.id}
            aria-labelledby={'growth-' + card.id}
            className={'rounded-xl border p-4 ' + (TONE[card.state] ?? TONE['not-configured'])}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id={'growth-' + card.id} className="text-sm font-semibold text-foreground">
                {card.title}
              </h2>
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {LABEL[card.state]}
              </span>
            </div>
            <p className="mt-2 text-sm text-foreground/90">{card.headline}</p>
            <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
            {card.action && <p className="mt-2 text-xs font-medium text-foreground/80">{card.action}</p>}
          </section>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        This page only reads. Nothing here sends a message, changes a customer or publishes
        anything. Sending happens on the campaigns and rebooking screens, where you can see
        exactly who will receive it first.
      </p>

      <section aria-labelledby="referrals" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="referrals" className="text-lg font-semibold text-foreground">Referrals</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Customers bringing other customers in, and what that has been worth.
            </p>
          </div>
          <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground">
            Referral program: {describeProgramState(program ? program.enabled : null).label}
          </span>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">{describeProgramState(program ? program.enabled : null).meaning}</p>
        <p className="mt-2 text-xs text-muted-foreground">{whatTheProgramDoes()}</p>

        {referralMetrics && referralEmptyState(program ? program.enabled : null, referralMetrics) ? (
          <p className="mt-4 rounded-lg border border-border p-3 text-sm text-muted-foreground">
            {referralEmptyState(program ? program.enabled : null, referralMetrics)}
          </p>
        ) : null}

        {referralMetrics ? (
          <>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {referralMetricRows(referralMetrics).map((row) => (
                <div key={row.id} className="rounded-lg border border-border p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.label}</dt>
                  <dd className="mt-1 text-xl font-semibold text-foreground">{row.value}</dd>
                  <p className="mt-1 text-xs text-muted-foreground">{row.meaning}</p>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{referralMetrics.note}</p>
            {referralMetrics.byChannel.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-foreground">Where referrals came from</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {referralMetrics.byChannel.map((channel) => (
                    <li key={channel.channel} className="flex justify-between gap-3 border-b border-border/60 pb-1">
                      <span className="text-muted-foreground">{channel.channel}</span>
                      <span className="font-medium text-foreground">{channel.customers}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="mt-4 rounded-lg border border-border p-3 text-sm text-muted-foreground">
            We could not read your referral results just now. Nothing has been changed. Reload the page in a moment.
          </p>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Turning the program on or off, and creating a customer&apos;s shareable link, is done on the referrals screen so
          you can see what each change will do before you confirm it.
        </p>
      </section>
    </div>
  )
}
