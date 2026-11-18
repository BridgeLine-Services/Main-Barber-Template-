export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { buildReadinessReport, ownerStatusFromReadiness } from '@/lib/health'
import {
  buildMaintenanceReport,
  summariseMaintenance,
  type MonitoredComponent,
} from '@/lib/platform-reliability/dependency-monitor'

/**
 * The Reliability Program, for the person who runs the shop.
 *
 * This page adds no new checks and no new health endpoint. It renders what the
 * existing systems already report (src/lib/health.ts readiness, its owner-facing
 * translation, and the dependency monitor's maintenance report) in one place, in
 * sentences a barber can act on.
 *
 * Two rules it keeps:
 *   - a check that could not run says so; it is never drawn as healthy
 *   - nothing here changes anything. No repair runs from this page.
 */

const COMPONENTS_TO_WATCH = ['node', 'next', 'react', '@prisma/client', 'typescript'] as const

function installedVersions(): MonitoredComponent[] {
  try {
    const raw = readFileSync(`${process.cwd()}/package.json`, 'utf8')
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      engines?: { node?: string }
    }
    const version = (name: string) =>
      pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? null
    return COMPONENTS_TO_WATCH.flatMap((name) => {
      const declared = name === 'node' ? pkg.engines?.node : version(name)
      if (!declared) return []
      // The declared range is what this checkout requires; strip the range marker
      // so the monitor compares versions rather than range syntax.
      return [{ name, installed: declared.replace(/^[\^~>= ]+/, ''), latest: null, supported: null }]
    })
  } catch {
    return []
  }
}

const TONE_STYLES: Record<string, string> = {
  good: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
  watch: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
  action: 'border-red-500/30 bg-red-500/5 text-red-300',
  off: 'border-border bg-[var(--dash-surface)]/40 text-muted-foreground',
}

export default async function ReliabilityPage() {
  const auth = await requireOwner()
  if (!auth.success) redirect('/login')

  const user = await prisma.user.findUnique({
    where: auth.user.id ? { id: auth.user.id } : { email: auth.user.email },
    select: { businessId: true },
  })
  if (!user?.businessId) redirect('/dashboard/onboarding')

  const runtime = await buildReadinessReport()
  const rightNow = ownerStatusFromReadiness(runtime)

  // Support status needs the vendor's current release data. This page does not
  // fetch it, so every component arrives with supported: null and the monitor
  // reports "could not check" rather than guessing at an end-of-life date.
  const maintenance = buildMaintenanceReport({
    components: installedVersions(),
    audit: null,
    checkedAt: new Date().toISOString(),
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Reliability</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Is everything working?</h1>
        <p className="mt-2 text-muted-foreground">
          A plain answer to the questions that matter: is the website up, can customers book, are
          records safe, and is anything waiting on you. Nothing on this page changes your shop.
        </p>
      </div>

      <section aria-labelledby="right-now" className="rounded-xl border border-border bg-[var(--dash-surface)]/40 p-5">
        <h2 id="right-now" className="text-lg font-semibold text-foreground">Right now</h2>
        <p className="mt-1 text-sm text-muted-foreground">{rightNow.headline}</p>
        <ul className="mt-4 space-y-2">
          {rightNow.rows.map((row) => (
            <li
              key={row.label}
              className={`rounded-lg border p-3 text-sm ${TONE_STYLES[row.tone] ?? TONE_STYLES.off}`}
            >
              <p className="font-medium">{row.label}</p>
              <p className="mt-0.5 opacity-90">{row.detail}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">Checked {new Date(runtime.checkedAt).toLocaleString()}.</p>
      </section>

      <section aria-labelledby="software" className="rounded-xl border border-border bg-[var(--dash-surface)]/40 p-5">
        <h2 id="software" className="text-lg font-semibold text-foreground">Software and updates</h2>
        <p className="mt-1 text-sm text-muted-foreground">{summariseMaintenance(maintenance)}</p>
        {maintenance.findings.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            There is nothing to check on this installation right now.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {maintenance.findings.map((finding) => (
              <li key={finding.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{finding.headline}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {finding.state.replace('-', ' ')}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{finding.impact}</p>
                <p className="mt-1 text-muted-foreground">{finding.action}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          This page does not contact the software makers, so support dates read as &ldquo;could not be
          checked&rdquo; rather than being guessed. Nothing is updated from here: an update needs your
          decision, and anything that touches the database needs a technical review first.
        </p>
      </section>

      <section aria-labelledby="next" className="rounded-xl border border-border bg-[var(--dash-surface)]/40 p-5">
        <h2 id="next" className="text-lg font-semibold text-foreground">What to do next</h2>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>If a line above says action required, that is the one to deal with first.</li>
          <li>Anything about backups or photos can be checked on the system page, which explains each item.</li>
          <li>If a check could not be completed, it is safe to look again later; the shop keeps working.</li>
        </ul>
      </section>
    </div>
  )
}
