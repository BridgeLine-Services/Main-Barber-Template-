export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { verifyFactoryLaunch } from '@/lib/factory-launch'

const statusStyles = {
  PASS: 'text-emerald-400',
  DISABLED: 'text-zinc-500',
  WARNING: 'text-amber-400',
  MANUAL: 'text-blue-400',
  BLOCKED: 'text-red-400',
  NOT_STARTED: 'text-zinc-500',
} as const

export default async function FactoryLaunchPage() {
  const auth = await requireOwner()
  if (!auth.success) redirect('/login')
  const user = await prisma.user.findUnique({
    where: auth.user.id ? { id: auth.user.id } : { email: auth.user.email },
    select: { businessId: true },
  })
  if (!user?.businessId) redirect('/dashboard/onboarding')

  const report = await verifyFactoryLaunch(user.businessId)
  const grouped = report.checks.reduce<Record<string, typeof report.checks>>((result, check) => {
    ;(result[check.category] ||= []).push(check)
    return result
  }, {})
  const overallClass = report.overall === 'READY' ? 'border-emerald-500/40 bg-emerald-500/10' : report.overall === 'BLOCKED' ? 'border-red-500/40 bg-red-500/10' : 'border-blue-500/40 bg-blue-500/10'

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-amber-400">Barber Website Factory</p>
        <h1 className="mt-2 text-3xl font-bold text-zinc-100">Factory Launch Console</h1>
        <p className="mt-2 text-zinc-400">One prioritized workflow for deployment, configuration, testing, domain verification, and launch review.</p>
      </div>
      <section className={`rounded-xl border p-5 ${overallClass}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-300">Overall status</p>
            <p className="mt-1 text-2xl font-bold text-zinc-100">{report.overall.replace('_', ' ')}</p>
            <p className="mt-1 text-sm text-zinc-400">Current stage: {report.stage.replaceAll('_', ' ')}</p>
          </div>
          <div className="text-right text-sm text-zinc-400">
            <p>{report.counts.passed} passed</p>
            <p>{report.counts.blocked} blocked</p>
            <p>{report.counts.manual} manual</p>
            <p>{report.counts.warnings} warnings</p>
          </div>
        </div>
        <div className="mt-5 rounded-lg border border-white/10 bg-black/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Next action</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{report.nextAction.title}</p>
          <p className="mt-1 text-sm text-zinc-300">{report.nextAction.detail}</p>
        </div>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(grouped).map(([category, checks]) => (
          <section key={category} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
            <h2 className="text-lg font-semibold text-zinc-100">{category}</h2>
            <div className="mt-4 space-y-4">
              {checks.map((check) => (
                <div key={check.key} className="flex gap-3">
                  <span className={statusStyles[check.status]} aria-label={check.status}>●</span>
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-200">{check.label}</p>
                    <p className="text-sm text-zinc-400">{check.detail}</p>
                    {check.status !== 'PASS' && check.status !== 'DISABLED' && <p className="mt-1 text-sm text-zinc-300">Next: {check.remediation}</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
