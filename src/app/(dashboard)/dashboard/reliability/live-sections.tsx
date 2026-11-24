import type { CompatibilityReport } from '@/lib/platform-reliability/compatibility'
import type { LiveAdvisoryCheck } from '@/lib/platform-reliability/live-advisories'
import type { LiveUpdateCheck } from '@/lib/platform-reliability/live-updates'
import type { UpdatePlan } from '@/lib/platform-reliability/update-plan'

export function LiveDependencyUpdates({ updateCheck, updatePlan }: { updateCheck: LiveUpdateCheck; updatePlan: UpdatePlan | null }) {
  return (
    <section aria-labelledby="dependency-updates" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
      <h2 id="dependency-updates" className="text-lg font-semibold text-foreground">Available software updates</h2>
      <p className="mt-1 text-sm text-muted-foreground">Installed package versions are compared with the npm registry. Updates are plans only: this check never changes, merges, or deploys software.</p>
      {!updateCheck.verified || !updatePlan ? (
        <div className="mt-3 rounded-lg border border-border p-4">
          <p className="text-sm font-semibold text-foreground">COULD NOT VERIFY</p>
          <p className="mt-1 text-sm text-muted-foreground">{updateCheck.error ?? 'The registry did not confirm every package.'} We will not treat missing results as no updates.</p>
          <p className="mt-1 text-xs text-muted-foreground">Source: {updateCheck.source} · Last checked: {updateCheck.checkedAt.slice(0, 10)}</p>
        </div>
      ) : updatePlan.batch.length + updatePlan.deferred.length === 0 && updatePlan.unclassified.length === 0 ? (
        <div className="mt-3 rounded-lg border border-border p-4">
          <p className="text-sm font-semibold text-foreground">HEALTHY</p>
          <p className="mt-1 text-sm text-muted-foreground">No newer stable releases were found for {updateCheck.packageCount} direct dependencies.</p>
          <p className="mt-1 text-xs text-muted-foreground">Last checked: {updateCheck.checkedAt.slice(0, 10)} · Next check: within 6 hours of the next visit.</p>
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm text-foreground">{updatePlan.summary}</p>
          {updatePlan.unclassified.length > 0 && (
            <div className="mt-3 rounded-lg border border-border p-4">
              <p className="text-sm font-semibold text-foreground">COULD NOT VERIFY</p>
              <p className="mt-1 text-sm text-muted-foreground">The registry returned a release candidate or unreadable version for: {updatePlan.unclassified.join(', ')}. It is not counted as a stable update.</p>
              <p className="mt-1 text-xs text-muted-foreground">Source: {updateCheck.source} · Last checked: {updateCheck.checkedAt.slice(0, 10)} · Next review: within 7 days.</p>
            </div>
          )}
          <ul className="mt-3 flex flex-col gap-4">
            {[...updatePlan.batch, ...updatePlan.deferred].map((item) => {
              const specialistNeeded = item.breaking && ['next', 'react', 'react-dom', '@prisma/client', 'prisma'].includes(item.name)
              const updateStatus = item.kind === 'security' || item.breaking ? 'APPROVAL REQUIRED' : 'UPDATE AVAILABLE'
              const nextDate = new Date(Date.parse(updateCheck.checkedAt) + (item.kind === 'security' ? 7 : 30) * 24 * 60 * 60 * 1000)
              return (
                <li key={`${item.name}-${item.latest}`} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{item.name}: {item.installed} to {item.latest}</h3>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{updateStatus}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.reason}{item.breaking ? ' This may change how the website behaves.' : ' This is a routine release in the same supported version line.'}</p>
                  <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <div><dt className="inline font-medium text-foreground">Affected: </dt><dd className="inline">The {item.name} package in your {item.runtime ? 'live website' : 'build and test tools'}.</dd></div>
                    <div><dt className="inline font-medium text-foreground">Automatic repair: </dt><dd className="inline">No · Approval required: Yes · Specialist: {specialistNeeded ? 'Yes, recommended for this breaking core upgrade.' : 'No'}</dd></div>
                    <div><dt className="inline font-medium text-foreground">Last checked: </dt><dd className="inline">{updateCheck.checkedAt.slice(0, 10)}</dd></div>
                    <div><dt className="inline font-medium text-foreground">Next maintenance: </dt><dd className="inline">Review by {nextDate.toISOString().slice(0, 10)}</dd></div>
                    <div className="sm:col-span-2"><dt className="inline font-medium text-foreground">Required checks: </dt><dd className="inline">{item.tests.join(', ')}</dd></div>
                    <div className="sm:col-span-2"><dt className="inline font-medium text-foreground">Source and rollback: </dt><dd className="inline">{updateCheck.source}. {updatePlan.rollback} No automatic merge or deployment.</dd></div>
                  </dl>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

export function RuntimeCompatibilitySection({ report, checkedAt }: { report: CompatibilityReport; checkedAt: string }) {
  return (
    <section aria-labelledby="compatibility-check" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
      <h2 id="compatibility-check" className="text-lg font-semibold text-foreground">Runtime and database compatibility</h2>
      <p className="mt-1 text-sm text-muted-foreground">This compares detected versions with the versions this website is tested against. It is not a vendor support guarantee.</p>
      <p className="mt-1 text-xs text-muted-foreground">Last checked: {checkedAt.slice(0, 10)}</p>
      <ul className="mt-3 flex flex-col gap-4">
        {report.findings.map((finding) => {
          const status = finding.status === 'supported' ? 'HEALTHY' : finding.status === 'unsupported' ? 'SPECIALIST REQUIRED' : 'COULD NOT VERIFY'
          return (
            <li key={finding.component} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">{finding.label}: {finding.installed ?? 'version unavailable'}</h3>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{status}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{finding.detail}</p>
              <p className="mt-1 text-sm text-foreground/90">{finding.action ?? 'No action needed.'}</p>
              <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                <div><dt className="inline font-medium text-foreground">Automatic repair: </dt><dd className="inline">No</dd></div>
                <div><dt className="inline font-medium text-foreground">Owner approval: </dt><dd className="inline">{finding.status === 'unsupported' ? 'Required' : 'Not needed'}</dd></div>
                <div><dt className="inline font-medium text-foreground">Specialist: </dt><dd className="inline">{finding.status === 'unsupported' ? 'Required before an out-of-line upgrade' : 'Not currently required'}</dd></div>
                <div><dt className="inline font-medium text-foreground">Source: </dt><dd className="inline">{finding.source}</dd></div>
                <div><dt className="inline font-medium text-foreground">Next maintenance: </dt><dd className="inline">{finding.status === 'unsupported' ? 'Review within 7 days' : 'Review at the next monthly check'}</dd></div>
              </dl>
            </li>
          )
        })}
      </ul>
      {report.combinations.filter((finding) => finding.broken).map((finding) => (
        <p key={finding.id} className="mt-3 text-sm text-muted-foreground">SPECIALIST REQUIRED · {finding.message}</p>
      ))}
    </section>
  )
}

export function SecurityAdvisorySection({ check }: { check: LiveAdvisoryCheck }) {
  return (
    <section aria-labelledby="security-advisories" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
      <h2 id="security-advisories" className="text-lg font-semibold text-foreground">Dependency security check</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Installed application packages were checked against {check.source}. PostgreSQL server packages and the operating-system image are outside this npm feed and are not claimed as checked.
      </p>
      {!check.verified ? (
        <div className="mt-3 rounded-lg border border-border p-4">
          <p className="text-sm font-semibold text-foreground">COULD NOT VERIFY</p>
          <p className="mt-1 text-sm text-muted-foreground">{check.error ?? 'The advisory source did not confirm every installed package.'} This is not a clean security result.</p>
          <p className="mt-1 text-xs text-muted-foreground">Last checked: {check.checkedAt.slice(0, 10)} · Packages included: {check.packageCount}</p>
        </div>
      ) : check.advisories.length === 0 ? (
        <div className="mt-3 rounded-lg border border-border p-4">
          <p className="text-sm font-semibold text-foreground">HEALTHY</p>
          <p className="mt-1 text-sm text-muted-foreground">No known advisories were returned for {check.packageCount} installed npm packages.</p>
          <p className="mt-1 text-xs text-muted-foreground">Source: {check.source} · Last checked: {check.checkedAt.slice(0, 10)} · Next check: within 15 minutes of the next visit.</p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-4">
          {check.advisories.map((advisory, index) => {
            const nextCheckAt = new Date(Date.parse(advisory.checkedAt) + (advisory.severity === 'critical' ? 24 : advisory.severity === 'high' ? 72 : 24 * 30) * 60 * 60 * 1000)
            const issueStatus = !advisory.verified ? 'COULD NOT VERIFY' : advisory.patchedVersion ? 'APPROVAL REQUIRED' : 'SPECIALIST REQUIRED'
            const specialistNeeded = !advisory.patchedVersion || advisory.severity === 'unknown'
            return (
              <li key={`${advisory.dependency}-${index}`} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{advisory.title}</h3>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{issueStatus}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{advisory.businessImpact}</p>
                <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <div><dt className="inline font-medium text-foreground">Affected: </dt><dd className="inline">{advisory.dependency} {advisory.installedVersion ?? 'version unavailable'} · {advisory.vulnerableRange ?? 'affected range not supplied by source'}</dd></div>
                  <div><dt className="inline font-medium text-foreground">Verified fix: </dt><dd className="inline">{advisory.patchedVersion ?? 'No fixed version verified'}</dd></div>
                  <div><dt className="inline font-medium text-foreground">Who is affected: </dt><dd className="inline">Your website and the business functions this package supports.</dd></div>
                  <div><dt className="inline font-medium text-foreground">Automatic repair: </dt><dd className="inline">No · Owner approval: Yes · Specialist: {specialistNeeded ? 'Yes, a fix or severity needs technical review.' : 'Not required unless there is evidence of an incident.'}</dd></div>
                  <div><dt className="inline font-medium text-foreground">Last checked: </dt><dd className="inline">{advisory.checkedAt.slice(0, 10)}</dd></div>
                  <div><dt className="inline font-medium text-foreground">Next maintenance: </dt><dd className="inline">{nextCheckAt.toISOString().slice(0, 10)}</dd></div>
                  <div className="sm:col-span-2"><dt className="inline font-medium text-foreground">Recommended action: </dt><dd className="inline">{advisory.remediation} Nothing is changed or deployed by this check.</dd></div>
                  <div className="sm:col-span-2"><dt className="inline font-medium text-foreground">Source: </dt><dd className="inline"><a href={advisory.source} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{advisory.source}</a></dd></div>
                </dl>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
