/**
 * Scheduled maintenance reports (Priority 1, part A).
 *
 * A report is generated on a schedule and written in a shop owner's language. Its most
 * important property is honesty about what it could not see: every section records whether
 * it was verified, and a section that did not run can never be reported as healthy. The
 * overall state is the worst section, so one unverified area is enough to stop the report
 * claiming everything is fine.
 *
 * Pure: the caller gathers the facts and passes them in with the date. Rendering to
 * Markdown is a separate, total function so the same report can be stored or emailed.
 */

import type { AdvisorySummary } from './advisory-monitor'
import type { CompatibilityReport } from './compatibility'
import type { RecoveryReport } from './recovery-verification'
import type { UpdatePlan } from './update-plan'

export type ReportState = 'healthy' | 'needs-attention' | 'action-required' | 'unable-to-verify'

export interface ReportSection {
  id: 'health' | 'security' | 'software' | 'updates' | 'backups' | 'repairs'
  title: string
  state: ReportState
  /** False when this section's source did not answer. */
  verified: boolean
  headline: string
  detail: string
  action: string | null
  /** Facts the section is based on, so the report can be checked rather than trusted. */
  facts: Array<{ label: string; value: string }>
}

export interface ScheduledReportInput {
  generatedAt: string
  templateVersion: string
  /** Null when the health check did not run. */
  health: { state: ReportState; headline: string; detail: string; failedChecks: string[] } | null
  advisories: AdvisorySummary | null
  compatibility: CompatibilityReport | null
  updates: UpdatePlan | null
  recovery: RecoveryReport | null
  /** Repairs waiting for a person to say yes. Null when unknown. */
  pendingApprovals: number | null
  /** Repairs that failed or were rolled back. Null when unknown. */
  failedRepairs: number | null
}

export interface ScheduledMaintenanceReport {
  generatedAt: string
  templateVersion: string
  overall: ReportState
  headline: string
  detail: string
  sections: ReportSection[]
  /** Plain list of everything this report could not confirm. */
  unverified: string[]
  /** Plain list of everything needing a person now. */
  actionsRequired: string[]
}

const RANK: Record<ReportState, number> = {
  healthy: 0,
  'needs-attention': 1,
  'unable-to-verify': 2,
  'action-required': 3,
}

function worst(states: ReportState[]): ReportState {
  return states.reduce<ReportState>((acc, s) => (RANK[s] > RANK[acc] ? s : acc), 'healthy')
}

function healthSection(health: ScheduledReportInput['health']): ReportSection {
  if (!health) {
    return {
      id: 'health',
      title: 'Your shop right now',
      state: 'unable-to-verify',
      verified: false,
      headline: 'The health check did not run.',
      detail: 'Nothing here says your shop is fine; it says we could not look.',
      action: 'Run the health check again, or ask your support provider to.',
      facts: [],
    }
  }
  return {
    id: 'health',
    title: 'Your shop right now',
    state: health.state,
    verified: true,
    headline: health.headline,
    detail: health.detail,
    action: health.state === 'healthy' ? null : 'Open the reliability page to see which check failed.',
    facts: [{ label: 'Failed checks', value: health.failedChecks.length ? health.failedChecks.join(', ') : 'none' }],
  }
}

function securitySection(advisories: AdvisorySummary | null): ReportSection {
  if (!advisories) {
    return {
      id: 'security',
      title: 'Security',
      state: 'unable-to-verify',
      verified: false,
      headline: 'We could not check for security advisories.',
      detail: 'This is not the same as being clear.',
      action: 'Run the advisory check when the network allows it.',
      facts: [],
    }
  }
  return {
    id: 'security',
    title: 'Security',
    state: advisories.state === 'clear' ? 'healthy' : advisories.state === 'unable-to-verify' ? 'unable-to-verify' : advisories.state,
    verified: advisories.state !== 'unable-to-verify',
    headline: advisories.headline,
    detail: advisories.detail,
    action: advisories.immediate > 0 ? 'Apply the urgent security updates at the next safe moment.' : null,
    facts: [
      { label: 'Critical', value: String(advisories.bySeverity.critical) },
      { label: 'High', value: String(advisories.bySeverity.high) },
      { label: 'Moderate', value: String(advisories.bySeverity.moderate) },
      { label: 'Low', value: String(advisories.bySeverity.low) },
    ],
  }
}

function softwareSection(compatibility: CompatibilityReport | null): ReportSection {
  if (!compatibility) {
    return {
      id: 'software',
      title: 'Software versions',
      state: 'unable-to-verify',
      verified: false,
      headline: 'We could not read the software versions.',
      detail: 'Support cannot be confirmed without them.',
      action: 'Check the versions in your deployment settings.',
      facts: [],
    }
  }
  return {
    id: 'software',
    title: 'Software versions',
    state: compatibility.state === 'supported' ? 'healthy' : compatibility.state === 'unsupported' ? 'action-required' : 'unable-to-verify',
    verified: compatibility.unknownCount === 0,
    headline: compatibility.headline,
    detail: compatibility.detail,
    action: compatibility.unsupportedCount > 0 ? 'Plan the upgrade to the tested version.' : null,
    facts: compatibility.findings.map((f) => ({ label: f.label, value: `${f.installed ?? 'unknown'} (${f.status})` })),
  }
}

function updatesSection(updates: UpdatePlan | null): ReportSection {
  if (!updates) {
    return {
      id: 'updates',
      title: 'Available updates',
      state: 'unable-to-verify',
      verified: false,
      headline: 'We could not check for software updates.',
      detail: 'Nothing is known about newer versions right now.',
      action: 'Run the update check when the network allows it.',
      facts: [],
    }
  }
  const count = updates.batch.length + updates.deferred.length
  return {
    id: 'updates',
    title: 'Available updates',
    state: count === 0 ? 'healthy' : updates.risk === 'high' ? 'action-required' : 'needs-attention',
    verified: true,
    headline: updates.summary,
    detail: count === 0 ? 'Every dependency is at the version that was checked.' : 'Updates are prepared for approval. Nothing is merged or deployed automatically.',
    action: count > 0 ? 'Review the prepared update plan and approve it if it looks right.' : null,
    facts: [
      { label: 'Routine updates', value: String(updates.batch.length) },
      { label: 'Needing their own approval', value: String(updates.deferred.length) },
      { label: 'Unclassified', value: String(updates.unclassified.length) },
    ],
  }
}

function backupsSection(recovery: RecoveryReport | null): ReportSection {
  if (!recovery) {
    return {
      id: 'backups',
      title: 'Backups',
      state: 'unable-to-verify',
      verified: false,
      headline: 'We could not check your backups.',
      detail: 'A backup that was not checked is not a backup you can rely on.',
      action: 'Run the backup verification.',
      facts: [],
    }
  }
  return {
    id: 'backups',
    title: 'Backups',
    state: recovery.state === 'verified' ? 'healthy' : recovery.state === 'failed' ? 'action-required' : 'needs-attention',
    verified: recovery.state !== 'unverified',
    headline: recovery.headline,
    detail: recovery.detail,
    action: recovery.action,
    facts: [
      { label: 'Last successful restore test', value: recovery.lastRestoreAt ?? 'never' },
      { label: 'Restore result', value: recovery.state },
    ],
  }
}

function repairsSection(pending: number | null, failed: number | null): ReportSection {
  if (pending === null || failed === null) {
    return {
      id: 'repairs',
      title: 'Repairs',
      state: 'unable-to-verify',
      verified: false,
      headline: 'We could not read the repair record.',
      detail: 'Outstanding approvals and failed repairs are unknown.',
      action: 'Open the maintenance history.',
      facts: [],
    }
  }
  const state: ReportState = failed > 0 ? 'action-required' : pending > 0 ? 'needs-attention' : 'healthy'
  return {
    id: 'repairs',
    title: 'Repairs',
    state,
    verified: true,
    headline: failed > 0
      ? `${failed} repair${failed === 1 ? '' : 's'} did not finish cleanly.`
      : pending > 0
        ? `${pending} repair${pending === 1 ? '' : 's'} waiting for approval.`
        : 'No repairs are waiting and none failed.',
    detail: failed > 0 ? 'A failed repair keeps its evidence and waits for a person.' : 'Every repair that was proposed has been decided.',
    action: failed > 0 ? 'Review the failed repair before trying anything else.' : pending > 0 ? 'Approve or reject the waiting repairs.' : null,
    facts: [
      { label: 'Waiting for approval', value: String(pending) },
      { label: 'Failed', value: String(failed) },
    ],
  }
}

export function buildScheduledReport(input: ScheduledReportInput): ScheduledMaintenanceReport {
  const sections: ReportSection[] = [
    healthSection(input.health),
    securitySection(input.advisories),
    softwareSection(input.compatibility),
    updatesSection(input.updates),
    backupsSection(input.recovery),
    repairsSection(input.pendingApprovals, input.failedRepairs),
  ]

  const overall = worst(sections.map((s) => s.state))
  const unverified = sections.filter((s) => !s.verified).map((s) => s.title)
  const actionsRequired = sections.filter((s) => s.action && s.state !== 'healthy').map((s) => `${s.title}: ${s.action}`)

  const headline =
    overall === 'healthy'
      ? 'Everything that was checked is in good order.'
      : overall === 'needs-attention'
        ? 'A few things are worth doing at your next maintenance window.'
        : overall === 'action-required'
          ? 'Something needs a person now.'
          : 'Part of this report could not be checked, so it does not say your shop is fine.'

  const detail = unverified.length
    ? `${unverified.join(', ')} could not be confirmed. The rest of the report is based on checks that ran.`
    : 'Every section is based on a check that ran.'

  return {
    generatedAt: input.generatedAt,
    templateVersion: input.templateVersion,
    overall,
    headline,
    detail,
    sections,
    unverified,
    actionsRequired,
  }
}

/** Render the report as Markdown. Total: never throws, never hides an unverified section. */
export function renderReportMarkdown(report: ScheduledMaintenanceReport): string {
  const lines: string[] = []
  lines.push(`# Maintenance report`)
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Template version: ${report.templateVersion}`)
  lines.push(`Overall: **${report.overall}**`)
  lines.push('')
  lines.push(report.headline)
  lines.push('')
  lines.push(report.detail)
  lines.push('')
  for (const section of report.sections) {
    lines.push(`## ${section.title}`)
    lines.push('')
    lines.push(`State: ${section.state}${section.verified ? '' : ' (not verified)'}`)
    lines.push('')
    lines.push(section.headline)
    lines.push('')
    lines.push(section.detail)
    if (section.facts.length) {
      lines.push('')
      for (const fact of section.facts) lines.push(`- ${fact.label}: ${fact.value}`)
    }
    if (section.action) {
      lines.push('')
      lines.push(`Action: ${section.action}`)
    }
    lines.push('')
  }
  if (report.unverified.length) {
    lines.push('## Could not be confirmed')
    lines.push('')
    for (const item of report.unverified) lines.push(`- ${item}`)
    lines.push('')
  }
  if (report.actionsRequired.length) {
    lines.push('## Needs a person')
    lines.push('')
    for (const item of report.actionsRequired) lines.push(`- ${item}`)
    lines.push('')
  }
  return lines.join('\n')
}
