/**
 * Dependency and runtime monitoring — the judgement half of Part 7.1 and 7.4.
 *
 * Pure on purpose. Every fact (installed versions, support dates, audit counts)
 * is passed in by the caller, so this module never touches the network, a
 * lockfile or the database, and its decisions can be tested exactly.
 *
 * The rule that matters: nothing here may ever classify a major upgrade, a
 * database migration, an authentication, payment or permission change as a safe
 * automatic repair. Those need a person. Only additive, reversible, low-risk
 * work is allowed to be automatic.
 */

import { advisorySupportRecord, buildSupportRecord, type SupportRecord } from './support-sources'

export type MaintenanceState = 'action-required' | 'needs-attention' | 'healthy' | 'not-configured'

/** How the repair may proceed, mirroring Part 7.4's three categories. */
export type RepairClass = 'automatic' | 'approval' | 'manual'

export interface MonitoredComponent {
  /** Package or runtime name, e.g. "next" or "node". */
  name: string
  /** Version actually installed, e.g. "16.4.6" or "24.22.2". */
  installed: string
  /** Newest version the vendor currently supports, when known. */
  latest?: string | null
  /** ISO date this line leaves support, when known. */
  eolOn?: string | null
  /** True when the installed line is still inside vendor support. */
  supported?: boolean | null
}

export interface AuditSummary {
  critical: number
  high: number
  moderate: number
  low: number
}

export interface MonitorInput {
  components: MonitoredComponent[]
  /** null means the vulnerability check could not be run at all. */
  audit: AuditSummary | null
  /** ISO date the check ran. */
  checkedAt: string
}

export interface MaintenanceFinding {
  id: string
  component: string
  state: MaintenanceState
  repair: RepairClass
  /** What happened, in an owner's words. */
  headline: string
  /** What it means for the business. */
  impact: string
  /** What should happen next. */
  action: string
  /**
   * The evidence behind the finding: source, date checked, support status, security and
   * compatibility implications. Present for component and advisory findings so the page
   * never has to guess where an answer came from.
   */
  support?: SupportRecord
}

export interface MaintenanceReport {
  findings: MaintenanceFinding[]
  overall: MaintenanceState
  counts: Record<MaintenanceState, number>
  /** True when every check ran and nothing needs a person. */
  allClear: boolean
}

const RUNTIME_NAMES = new Set(['node', 'nodejs'])

function majorOf(version: string): number | null {
  const match = /^v?(\d+)/.exec(String(version ?? '').trim())
  return match ? Number(match[1]) : null
}

function daysUntil(iso: string, from: string): number | null {
  const then = Date.parse(iso)
  const now = Date.parse(from)
  if (Number.isNaN(then) || Number.isNaN(now)) return null
  return Math.round((then - now) / 86_400_000)
}

/**
 * A version bump is only ever automatic when it is a patch on the same major
 * line. Anything that crosses a major boundary changes behaviour and needs
 * approval; that is the difference between maintenance and an upgrade project.
 */
export function repairClassFor(installed: string, latest: string | null | undefined): RepairClass {
  if (!latest) return 'manual'
  const a = String(installed).split('.')
  const b = String(latest).split('.')
  if (a[0] !== b[0]) return 'approval'
  if (a[1] !== b[1]) return 'approval'
  return 'automatic'
}

function componentFinding(component: MonitoredComponent, checkedAt: string): MaintenanceFinding {
  const isRuntime = RUNTIME_NAMES.has(component.name.toLowerCase())
  const label = isRuntime ? 'This app runs on Node.js' : component.name
  const installedMajor = majorOf(component.installed)
  const latestMajor = majorOf(component.latest ?? '')
  const base = { component: component.name, support: buildSupportRecord(component, checkedAt) }

  // Unknown support status is reported as unknown, never as healthy.
  if (component.supported === null || component.supported === undefined) {
    return {
      ...base,
      id: `component:${component.name}:unknown`,
      state: 'not-configured',
      repair: 'manual',
      headline: `${label}: we could not check its support status`,
      impact:
        'Not knowing is not the same as being fine. Nothing is broken today, but this check could not confirm it.',
      action: 'Re-run the maintenance check. If it keeps failing, the vendor status source is unavailable.',
    }
  }

  if (!component.supported) {
    const days = component.eolOn ? daysUntil(component.eolOn, checkedAt) : null
    const when =
      days === null
        ? 'It is out of support.'
        : days < 0
          ? `Support ended ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago.`
          : `Support ends in ${days} day${days === 1 ? '' : 's'}.`
    return {
      ...base,
      id: `component:${component.name}:unsupported`,
      state: 'action-required',
      repair: 'approval',
      headline: `${label} ${component.installed}, which is no longer supported. ${when}`,
      impact:
        'Security fixes stop arriving for this version. Your shop keeps working, but problems will not be patched.',
      action: `Move to a supported version${component.latest ? ` (${component.latest})` : ''}. This is a planned upgrade, not a quick fix, so it needs approval and a test run first.`,
    }
  }

  if (latestMajor !== null && installedMajor !== null && latestMajor > installedMajor) {
    return {
      ...base,
      id: `component:${component.name}:major-behind`,
      state: 'needs-attention',
      repair: 'approval',
      headline: `${label} ${component.installed}; ${component.latest} is available`,
      impact:
        'You are supported today. The newer major line brings fixes and eventual support for longer, but upgrading changes behaviour.',
      action: 'Schedule the upgrade deliberately: read the release notes, run the full test suite, then approve it.',
    }
  }

  return {
    ...base,
    id: `component:${component.name}:healthy`,
    state: 'healthy',
    repair: 'automatic',
    headline: `${label} ${component.installed} is supported`,
    impact: 'Nothing to do. Security fixes are still being published for this version.',
    action: 'No action needed.',
  }
}

function auditFinding(audit: AuditSummary | null, checkedAt: string): MaintenanceFinding {
  const support = advisorySupportRecord(checkedAt, audit !== null)
  if (!audit) {
    return {
      support,
      id: 'audit:unavailable',
      component: 'dependencies',
      state: 'not-configured',
      repair: 'manual',
      headline: 'The vulnerability check did not run',
      impact:
        'We cannot say whether installed packages have known security problems. That is a gap in knowledge, not a confirmed fault.',
      action: 'Run the vulnerability check again. If it keeps failing, review dependencies by hand.',
    }
  }

  const serious = audit.critical + audit.high
  if (serious > 0) {
    return {
      support,
      id: 'audit:vulnerable',
      component: 'dependencies',
      state: 'action-required',
      repair: 'approval',
      headline: `${serious} known security ${serious === 1 ? 'problem' : 'problems'} in installed packages`,
      impact:
        'These are published vulnerabilities. None is proof your shop was attacked, but they are the ones to close first.',
      action:
        'Update the affected packages. A patch-level update can be prepared and tested automatically; anything larger needs approval.',
    }
  }

  if (audit.moderate > 0) {
    return {
      support,
      id: 'audit:moderate',
      component: 'dependencies',
      state: 'needs-attention',
      repair: 'approval',
      headline: `${audit.moderate} lower-severity ${audit.moderate === 1 ? 'issue' : 'issues'} in installed packages`,
      impact: 'No high or critical problems. These are worth clearing at the next maintenance window.',
      action: 'Fold the updates into the next planned release rather than changing things today.',
    }
  }

  return {
    support,
    id: 'audit:clean',
    component: 'dependencies',
    state: 'healthy',
    repair: 'automatic',
    headline: 'No known vulnerabilities in installed packages',
    impact: 'Nothing to do. This is what a healthy dependency tree looks like.',
    action: 'No action needed.',
  }
}

const ORDER: MaintenanceState[] = ['action-required', 'needs-attention', 'not-configured', 'healthy']

export function buildMaintenanceReport(input: MonitorInput): MaintenanceReport {
  const findings: MaintenanceFinding[] = [
    ...input.components.map((component) => componentFinding(component, input.checkedAt)),
    auditFinding(input.audit, input.checkedAt),
  ]

  const counts: Record<MaintenanceState, number> = {
    'action-required': 0,
    'needs-attention': 0,
    healthy: 0,
    'not-configured': 0,
  }
  for (const finding of findings) counts[finding.state] += 1

  const overall = ORDER.find((state) => counts[state] > 0) ?? 'healthy'

  return {
    findings,
    overall,
    counts,
    allClear: counts['action-required'] === 0 && counts['needs-attention'] === 0 && counts['not-configured'] === 0,
  }
}

/** One sentence for an owner who will read nothing else. */
export function summariseMaintenance(report: MaintenanceReport): string {
  const { counts } = report
  if (report.allClear) return 'Everything is supported and up to date. Nothing needs you.'
  if (counts['action-required'] > 0) {
    return `${counts['action-required']} thing${counts['action-required'] === 1 ? '' : 's'} needs a decision before it becomes a problem. Your shop keeps working.`
  }
  if (counts['needs-attention'] > 0) {
    return `${counts['needs-attention']} planned improvement${counts['needs-attention'] === 1 ? '' : 's'} waiting for a maintenance window. Nothing is broken.`
  }
  return 'Some checks could not run, so this is not a clean bill of health. Nothing is broken today.'
}
