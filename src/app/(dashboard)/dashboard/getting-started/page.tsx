export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { STAGE_COPY, buildGuidanceProgress, copyForStage, inferStage, type ShopFacts, type ShopStage } from '@/lib/setup-guidance'

const STATE_COPY = {
  done: { label: 'Done', tone: 'text-emerald-500' },
  'to-do': { label: 'Still to do', tone: 'text-[var(--dash-brand)]' },
  'could-not-check': { label: 'Could not check', tone: 'text-muted-foreground' },
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
  let stage: ShopStage | null = null

  try {
    const [business, serviceCount, barberCount, content] = await Promise.all([
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
    ])
    facts = {
      hasName: Boolean(business?.name?.trim()),
      hasPhone: Boolean(business?.phone?.trim()),
      hasAddress: Boolean(business?.address?.trim()),
      hasHours: Boolean(business?.hours && Object.keys(business.hours as object).length > 0),
      serviceCount,
      barberCount,
      websiteLive: Boolean(content?.publishedAt && content?.publishedContent),
      bookingEnabled: serviceCount > 0 && barberCount > 0,
    }
    stage = inferStage(facts)
  } catch {
    // A failed read must not become a false "all done": facts stay unknown.
    facts = {}
    stage = null
  }

  const activeStage: ShopStage = stage ?? 'starting'
  const copy = copyForStage(activeStage)
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

      <div className="rounded-lg border border-input bg-[var(--dash-surface)]/50 p-4">
        <p className="text-sm font-semibold text-foreground">{copy.label}</p>
        <p className="mt-1 text-sm text-muted-foreground">{copy.suits}</p>
        <p className="mt-3 text-sm text-foreground" aria-live="polite">{progress.headline}</p>
      </div>

      <ol className="space-y-2">
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
                </div>
                {label && <span className={`shrink-0 text-xs font-medium ${label.tone}`}>{label.label}</span>}
              </div>
            </li>
          )
        })}
      </ol>

      <div className="rounded-lg border border-input p-4">
        <p className="text-sm font-semibold text-foreground">Other stages</p>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {STAGE_COPY.filter((s) => s.id !== activeStage).map((s) => (
            <li key={s.id}><span className="font-medium text-foreground">{s.label}</span> — {s.suits}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          We suggest a stage from what your shop already has. You can read the others without changing anything.
        </p>
      </div>
    </div>
  )
}
