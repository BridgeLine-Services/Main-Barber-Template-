export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { verifyFactoryReadiness } from '@/lib/production-readiness'

export default async function FactoryStatusPage() {
  const auth = await requireOwner()
  if (!auth.success) redirect('/login')

  const user = await prisma.user.findUnique({
    where: auth.user.id ? { id: auth.user.id } : { email: auth.user.email },
    select: { businessId: true },
  })
  if (!user?.businessId) redirect('/dashboard/onboarding')

  const report = await verifyFactoryReadiness(user.businessId)
  const grouped = report.checks.reduce<Record<string, typeof report.checks>>((result, check) => {
    ;(result[check.category] ||= []).push(check)
    return result
  }, {})

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-amber-400">Barber Website Factory</p>
        <h1 className="mt-2 text-3xl font-bold text-zinc-100">Factory status</h1>
        <p className="mt-2 text-zinc-400">A launch checklist for this shop. Secrets are checked on the server and are never displayed.</p>
      </div>
      <div className={`rounded-xl border p-5 ${report.overall === 'READY' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
        <p className="text-sm text-zinc-300">Overall status</p>
        <p className={`mt-1 text-2xl font-bold ${report.overall === 'READY' ? 'text-emerald-300' : 'text-red-300'}`}>{report.overall}</p>
        <p className="mt-2 text-sm text-zinc-400">{report.passed} passed, {report.failed} failed, {report.warnings} optional features disabled.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(grouped).map(([category, checks]) => (
          <section key={category} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
            <h2 className="text-lg font-semibold text-zinc-100">{category}</h2>
            <div className="mt-4 space-y-3">
              {checks.map((check) => (
                <div key={check.check} className="flex gap-3">
                  <span className={check.status === 'PASS' ? 'text-emerald-400' : check.status === 'WARN' ? 'text-zinc-500' : 'text-red-400'} aria-hidden="true">
                    {check.status === 'PASS' ? '✓' : check.status === 'WARN' ? '○' : '✗'}
                  </span>
                  <div>
                    <p className="font-medium text-zinc-200">{check.check}</p>
                    <p className="text-sm text-zinc-400">{check.detail}</p>
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
