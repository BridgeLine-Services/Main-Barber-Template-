export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireOwner } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getRebookingTasks } from '@/lib/rebooking-engine'
import { buildGrowthCards, summariseGrowth } from '@/lib/growth/overview'
import { BUSINESS_STAGES, resolveStage, stageDefinition, availableCapabilities, plannedCapabilities } from '@/lib/growth/stages'
import { inferStage, type ShopFacts } from '@/lib/setup-guidance'
import { readIntendedStage } from '@/lib/growth/stage-store'

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
        {cards.map((card) => (
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
    </div>
  )
}
