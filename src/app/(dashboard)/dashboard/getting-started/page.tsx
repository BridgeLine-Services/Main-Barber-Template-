export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { STAGE_COPY, buildGuidanceProgress, copyForStage, inferStage, type ShopFacts } from '@/lib/setup-guidance'
import { readIntendedStage } from '@/lib/growth/stage-store'
import { resolveStage, stageDefinition, BUSINESS_STAGES } from '@/lib/growth/stages'
import { StageSelector } from '@/components/dashboard/StageSelector'

const STATE_COPY = {
  done: { label: 'Done', tone: 'text-emerald-500' },
  'to-do': { label: 'Still to do', tone: 'text-[var(--dash-brand)]' },
  'could-not-check': { label: 'Could not check', tone: 'text-muted-foreground' },
} as const

const AVAILABILITY_COPY = {
  available: { label: 'Ready to use', tone: 'text-emerald-500 border-emerald-500/40' },
  partial: { label: 'Partly built', tone: 'text-amber-500 border-amber-500/40' },
  planned: { label: 'Not built yet', tone: 'text-muted-foreground border-border' },
} as const

export default async function GettingStartedPage() {
  const auth = await requireOwner()
  if (!auth.success) redirect('/login')

  const user = await prisma.user.findUnique({
    where: auth.user.id ? { id: auth.user.id } : { email: auth.user.email },
    select: { businessId: true },
  })
  if (!user?.businessId) redirect('/dashboard/onboarding')
  const businessId = user.businessId

  let facts: ShopFacts = {}
  let inferred: ReturnType<typeof inferStage> = null
  let intended: Awaited<ReturnType<typeof readIntendedStage>> = null

  try {
    const [business, serviceCount, barberCount, content, intendedStage] = await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId },
        select: { name: true, phone: true, address: true, hours: true },
      }),
      prisma.service.count({ where: { businessId, isActive: true } }),
      prisma.barber.count({ where: { businessId, isActive: true } }),
      prisma.websiteContent.findUnique({
        where: { businessId },
        select: { publishedAt: true, publishedContent: true },
      }),
      readIntendedStage(businessId),
    ])
    intended = intendedStage
    facts = {
      hasName: Boolean(business?.name?.trim()),
      hasPhone: Boolean(business?.phone?.trim()),
      hasAddress: Boolean(business?.address?.trim()),
      hasHours: Boolean(business?.hours && Object.keys(business.hours as object).length > 0),
      serviceCount,
      barberCount,
      websiteLive: Boolean(content?.publishedAt && content?.publishedContent),
      bookingEnabled: serviceCount > 0 && barberCount > 0,
      // This version keeps one business per deployment, so there is nothing to report.
      locationCount: null,
    }
    inferred = inferStage(facts)
  } catch {
    // A failed read must not become a false "all done": facts stay unknown.
    facts = {}
    inferred = null
  }

  const resolution = resolveStage(inferred, intended)
  const activeStage = resolution.effective
  const copy = copyForStage(activeStage)
  const definition = stageDefinition(activeStage)
  const progress = buildGuidanceProgress(activeStage, facts)
  const stateFor = (id: string) => progress.steps.find((s) => s.id === id)?.state

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Getting started</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">What to do next</h1>
        <p className="mt-2 text-muted-foreground">
          These are suggestions, in the order most shops do them. Nothing here changes a setting by itself, and you can
          skip anything marked optional.
        </p>
      </div>

      <section aria-labelledby="stage-heading" className="rounded-lg border border-input bg-[var(--dash-surface)]/50 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="stage-heading" className="text-sm font-semibold text-foreground">
            {definition.label}
          </h2>
          <span className="text-xs text-muted-foreground">Stage {definition.number} of {BUSINESS_STAGES.length}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{copy.suits}</p>
        <p className="mt-2 text-sm text-foreground">{resolution.note}</p>

        <div className="mt-4">
          <p className="text-sm font-semibold text-foreground">Where are you heading?</p>
          <StageSelector intended={intended} current={inferred} />
        </div>
      </section>

      <section aria-labelledby="progress-heading" className="rounded-lg border border-input p-4">
        <h2 id="progress-heading" className="text-sm font-semibold text-foreground">
          How far along you are
        </h2>
        {progress.percent === null ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {progress.headline} We would rather say nothing than show you a number we cannot back up.
          </p>
        ) : (
          <>
            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--dash-surface)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              aria-label={`${progress.percent} per cent of the required steps are done`}
            >
              <div className="h-full rounded-full bg-[var(--dash-brand)]" style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="mt-2 text-sm text-foreground">
              {progress.percent}% of the steps that matter for this stage are done ({progress.doneCount} of{' '}
              {progress.steps.length} in total).
            </p>
          </>
        )}
        <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">{progress.headline}</p>
        {progress.optionalRemaining.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {progress.optionalRemaining.length} optional step{progress.optionalRemaining.length === 1 ? '' : 's'} still open. These never count against you.
          </p>
        )}
        {progress.nextStepId && (
          <p className="mt-2 text-sm text-foreground">
            Start with: <span className="font-semibold">{copy.steps.find((s) => s.id === progress.nextStepId)?.title}</span>
          </p>
        )}
      </section>

      <section aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="text-sm font-semibold text-foreground">
          Your steps
        </h2>
        <ol className="mt-2 space-y-2">
          {copy.steps.map((step, index) => {
            const state = stateFor(step.id)
            const label = state ? STATE_COPY[state] : null
            return (
              <li key={step.id} className="rounded-lg border border-input bg-[var(--dash-surface)]/50 p-4">
                <div className="flex items-start gap-3">
                  <span className="w-5 text-sm tabular-nums text-muted-foreground" aria-hidden="true">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      {step.title}
                      {step.optional && <span className="ml-2 text-xs font-normal text-muted-foreground">optional</span>}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{step.why}</p>
                    {step.action ? (
                      <Link
                        href={step.action}
                        className="mt-2 inline-block rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:border-[var(--dash-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dash-brand)]"
                      >
                        {state === 'done' ? 'Open it again' : 'Do this now'}
                      </Link>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">Nothing to open for this one yet.</p>
                    )}
                    {step.detail && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-muted-foreground">A bit more detail</summary>
                        <p className="mt-1 text-xs text-muted-foreground">{step.detail}</p>
                      </details>
                    )}
                  </div>
                  {label && <span className={`shrink-0 text-xs font-medium ${label.tone}`}>{label.label}</span>}
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <section aria-labelledby="capabilities-heading" className="rounded-lg border border-input p-4">
        <h2 id="capabilities-heading" className="text-sm font-semibold text-foreground">
          What {definition.label.toLowerCase()} includes
        </h2>
        {definition.caveat && <p className="mt-1 text-sm text-muted-foreground">{definition.caveat}</p>}
        <ul className="mt-3 space-y-2">
          {definition.capabilities.map((capability) => {
            const badge = AVAILABILITY_COPY[capability.availability]
            return (
              <li key={capability.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-input pt-2 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{capability.label}</p>
                  <p className="text-xs text-muted-foreground">{capability.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${badge.tone}`}>{badge.label}</span>
                  {capability.href && (
                    <Link href={capability.href} className="text-xs font-medium text-[var(--dash-brand)] underline-offset-2 hover:underline">
                      Open
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-input p-4">
        <h2 className="text-sm font-semibold text-foreground">Other stages</h2>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {STAGE_COPY.filter((s) => s.id !== activeStage).map((s) => (
            <li key={s.id}><span className="font-medium text-foreground">{s.label}</span> — {s.suits}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          We suggest a stage from what your shop already has and what you told us you are heading for. You can read the
          others without changing anything.
        </p>
      </section>
    </div>
  )
}
