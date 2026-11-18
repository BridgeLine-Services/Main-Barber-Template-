export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { requireOwner } from '@/lib/auth-helpers'
import { buildReadinessReport } from '@/lib/health'
import { buildMaintenanceReport } from '@/lib/platform-reliability/dependency-monitor'
import {
  buildReliabilitySections,
  summariseSections,
  type ReliabilitySection,
  type SectionState,
} from '@/lib/platform-reliability/reliability-sections'
import { readFileSync } from 'node:fs'

/**
 * The Reliability Center: six plain answers for an owner.
 *
 * Everything here comes from the existing health, status, backup and dependency
 * systems. Nothing on this page changes anything, and it says so. A section only
 * reads "healthy" when a check actually ran and passed; anything else says what we
 * could not read rather than assuming the best.
 */

const TONE: Record<SectionState, { label: string; className: string }> = {
  healthy: { label: 'Fine', className: 'text-emerald-400' },
  'needs-attention': { label: 'Worth a look', className: 'text-amber-400' },
  'action-required': { label: 'Needs attention', className: 'text-red-400' },
  'not-configured': { label: 'Not set up', className: 'text-muted-foreground' },
  'unable-to-verify': { label: 'Could not check', className: 'text-muted-foreground' },
}

// Versions are read from the installed manifest, not typed in by hand, so the report
// can never describe a version the shop is not running.
function installedComponents() {
  try {
    const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    const wanted = ['next', 'react', 'typescript', '@prisma/client']
    return wanted
      .filter((name) => typeof all[name] === 'string')
      .map((name) => ({
        name,
        installed: String(all[name]).replace(/^[^\d]*/, ''),
        // Support dates are not invented here: this page does not call the vendors,
        // so the monitor reports that the check could not be completed.
        supported: null,
      }))
  } catch {
    return []
  }
}

export default async function ReliabilityPage() {
  const auth = await requireOwner()
  if (!auth.success) redirect('/login')

  const readiness = await buildReadinessReport().catch(() => null)
  const maintenance =
    installedComponents().length > 0
      ? buildMaintenanceReport({
          components: installedComponents(),
          audit: null,
          checkedAt: new Date().toISOString(),
        })
      : null

  const sections = buildReliabilitySections({
    readiness,
    maintenance,
    backupAgeHours: readiness?.backupAgeHours ?? null,
    securityFindings: null,
    pendingApprovals: null,
    now: new Date(),
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Reliability</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Is my shop okay?</h1>
        <p className="mt-2 text-muted-foreground">{summariseSections(sections)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This page only looks. Nothing here changes your website, your bookings or your records.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((section) => (
          <SectionCard key={section.id} section={section} />
        ))}
      </div>

      {readiness && readiness.checks.length > 0 && (
        <section aria-labelledby="checks" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <h2 id="checks" className="text-lg font-semibold text-foreground">What each check found</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {readiness.checks.map((check) => (
              <li key={check.name} className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">{check.name}</span>
                <span className="text-muted-foreground">{check.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="help" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 id="help" className="text-lg font-semibold text-foreground">If something needs a person</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Updates, database work, sign-in changes, payment changes and permission changes are never made
          automatically. They need a decision first, and your shop keeps taking bookings while that is sorted out.
        </p>
      </section>
    </div>
  )
}

function SectionCard({ section }: { section: ReliabilitySection }) {
  const tone = TONE[section.state]
  return (
    <section aria-labelledby={`section-${section.id}`} className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`section-${section.id}`} className="text-base font-semibold text-foreground">{section.title}</h2>
        <span className={`text-xs font-medium ${tone.className}`}>{tone.label}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-foreground">{section.headline}</p>
      <p className="mt-1 text-sm text-muted-foreground">{section.detail}</p>
      {section.action && <p className="mt-2 text-xs text-muted-foreground">{section.action}</p>}
    </section>
  )
}
