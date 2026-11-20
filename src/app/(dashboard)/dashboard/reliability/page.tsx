export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { requireOwner } from '@/lib/auth-helpers'
import { buildReadinessReport } from '@/lib/health'
import { buildMaintenanceReport } from '@/lib/platform-reliability/dependency-monitor'
import { TEMPLATE_VERSION, describeTemplateVersion, nodeIsSufficient } from '@/lib/template-version'
import { historyAvailability, summariseHistory } from '@/lib/platform-reliability/maintenance-history'
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

      {maintenance && maintenance.findings.length > 0 && (
        <section aria-labelledby="versions" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <h2 id="versions" className="text-lg font-semibold text-foreground">Software versions and support</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every line below was checked against the source named next to it, on the date shown. Where a source
            could not be read, we say so instead of assuming the version is fine.
          </p>
          <ul className="mt-3 space-y-4">
            {maintenance.findings.map((finding) => (
              <li key={finding.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{finding.headline}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {STATE_LABEL[finding.state]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{finding.impact}</p>
                <p className="mt-1 text-sm text-foreground/90">{finding.action}</p>
                {finding.support && (
                  <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <div>
                      <dt className="inline font-medium text-foreground">Installed: </dt>
                      <dd className="inline">{finding.support.installed}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-foreground">Recommended: </dt>
                      <dd className="inline">{finding.support.recommended ?? 'Could not check this information.'}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-foreground">Support: </dt>
                      <dd className="inline">{SUPPORT_LABEL[finding.support.status]}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-foreground">Checked: </dt>
                      <dd className="inline">{finding.support.checkedAt.slice(0, 10)}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline font-medium text-foreground">Source: </dt>
                      <dd className="inline">
                        <a
                          href={finding.support.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline underline-offset-2"
                        >
                          {finding.support.source}
                        </a>
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline font-medium text-foreground">Security: </dt>
                      <dd className="inline">{finding.support.security}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline font-medium text-foreground">What a change would touch: </dt>
                      <dd className="inline">{finding.support.compatibility}</dd>
                    </div>
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="repair-history" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 id="repair-history" className="text-lg font-semibold text-foreground">Repairs and their history</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {summariseHistory([]).sentence}
        </p>
        <p className="mt-2 text-sm text-foreground">{historyAvailability().reason}</p>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground">
            What a repair record will show
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>What was found, and when.</li>
            <li>What was recommended, and whether it could be done safely on its own.</li>
            <li>Who approved it, when approval was needed.</li>
            <li>What changed, whether the checks passed, and whether it was undone.</li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            It will never record a password, a key or any secret value, and it will never record a customer&apos;s
            personal details.
          </p>
        </details>
      </section>

      <section aria-labelledby="version" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 id="version" className="text-lg font-semibold text-foreground">Which version is this?</h2>
        <p className="mt-1 text-sm text-foreground">{describeTemplateVersion()}</p>
        <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <dt className="inline font-medium text-foreground">Runtime: </dt>
            <dd className="inline">
              Node.js {process.version} —{' '}
              {nodeIsSufficient(process.version) === true
                ? 'newer than this version needs.'
                : nodeIsSufficient(process.version) === false
                  ? `this version needs Node.js ${TEMPLATE_VERSION.requiredNodeMajor} or newer.`
                  : 'we could not read the version, so we cannot say.'}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Database migrations in this version: </dt>
            <dd className="inline">{TEMPLATE_VERSION.schemaMigrationCount}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          To see whether a newer template release exists, run the update check in your own copy. It only reports what
          changed; it never applies anything, and it never touches your bookings, records or settings.
        </p>
      </section>

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

const STATE_LABEL: Record<string, string> = {
  'action-required': 'Needs a decision',
  'needs-attention': 'Worth a look',
  healthy: 'Fine',
  'not-configured': 'Could not check',
}

const SUPPORT_LABEL: Record<string, string> = {
  supported: 'Still supported',
  unsupported: 'No longer supported',
  unknown: 'Could not check this information.',
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
