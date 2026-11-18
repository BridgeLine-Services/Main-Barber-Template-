/**
 * The six things an owner wants to know, in their order, in their words.
 *
 * Part 5.1 of the directive. Pure on purpose: the page gathers facts from the existing
 * health, status and backup systems, and this module decides what to say. No network,
 * no database, no clock of its own, so every sentence can be pinned by a test.
 *
 * The rule that matters most: a section is only ever "healthy" when a check actually
 * ran and passed. Missing information is "unable to verify", never green.
 */
import type { CheckStatus, ReadinessReport } from '@/lib/health'
import type { MaintenanceReport } from '@/lib/platform-reliability/dependency-monitor'

export type SectionState = 'healthy' | 'needs-attention' | 'action-required' | 'not-configured' | 'unable-to-verify'

export interface ReliabilitySection {
  id: 'health' | 'security' | 'software' | 'backups' | 'maintenance' | 'cost'
  title: string
  state: SectionState
  headline: string
  detail: string
  action?: string
}

export interface SectionInput {
  readiness: ReadinessReport | null
  maintenance: MaintenanceReport | null
  /** Hours since the newest VERIFIED backup, or null when nothing is known. */
  backupAgeHours: number | null
  /** Open security findings, or null when the scan could not be read. */
  securityFindings: { high: number } | null
  /** Repairs already waiting for a person to say yes, or null when that is not known. */
  pendingApprovals: number | null
  now: Date
}

const WARN_HOURS = 36
const CRITICAL_HOURS = 72

function fromCheck(status: CheckStatus): SectionState {
  switch (status) {
    case 'ok':
      return 'healthy'
    case 'degraded':
      return 'needs-attention'
    case 'unavailable':
      return 'action-required'
    case 'not_configured':
      return 'not-configured'
    default:
      return 'unable-to-verify'
  }
}

function healthSection(readiness: ReadinessReport | null): ReliabilitySection {
  if (!readiness) {
    return {
      id: 'health',
      title: 'Your shop right now',
      state: 'unable-to-verify',
      headline: 'We could not check your shop just now.',
      detail: 'The check did not run, so nothing here is a statement that everything is fine.',
      action: 'Reload this page in a minute. If it still says this, the site needs a technical look.',
    }
  }
  const blocking = readiness.checks.filter((c) => c.status === 'unavailable' || c.status === 'degraded')
  const state = fromCheck(readiness.status === 'ready' ? 'ok' : readiness.status === 'degraded' ? 'degraded' : 'unavailable')
  if (state === 'healthy') {
    return {
      id: 'health',
      title: 'Your shop right now',
      state,
      headline: 'Your website is running and taking bookings.',
      detail: 'Every check that ran came back clear.',
    }
  }
  return {
    id: 'health',
    title: 'Your shop right now',
    state,
    headline: blocking.some((c) => c.role === 'critical') ? 'Bookings may not be reaching you.' : 'Something needs a look.',
    detail: blocking.length > 0 ? blocking.map((c) => c.detail).join(' ') : 'A check came back unclear.',
    action: 'Open the checks below for the plain explanation of each one.',
  }
}

function securitySection(findings: SectionInput['securityFindings']): ReliabilitySection {
  if (!findings) {
    return {
      id: 'security',
      title: 'Safety of your information',
      state: 'unable-to-verify',
      headline: 'We could not read the security scan today.',
      detail: 'Nothing is known to be wrong. The scan simply did not report back, and we will not call that safe.',
      action: 'Ask your operator to run the scan. Your customers are unaffected either way.',
    }
  }
  if (findings.high > 0) {
    return {
      id: 'security',
      title: 'Safety of your information',
      state: 'needs-attention',
      headline: `${findings.high} thing${findings.high === 1 ? '' : 's'} in the software should be updated.`,
      detail: 'These are known weaknesses in the code the website runs on. None is proof that anyone got in.',
      action: 'A technical review is needed before changing them. Your shop keeps working meanwhile.',
    }
  }
  return {
    id: 'security',
    title: 'Safety of your information',
    state: 'healthy',
    headline: 'No known weaknesses in the software today.',
    detail: 'The scan ran and found nothing outstanding.',
  }
}

function softwareSection(maintenance: MaintenanceReport | null): ReliabilitySection {
  if (!maintenance) {
    return {
      id: 'software',
      title: 'Software updates',
      state: 'unable-to-verify',
      headline: 'We could not read which versions are in use.',
      detail: 'Without that, nothing can be said about updates.',
    }
  }
  if (maintenance.overall === 'healthy') {
    return {
      id: 'software',
      title: 'Software updates',
      state: 'healthy',
      headline: 'Nothing needs updating right now.',
      detail: 'Every version in use is one the maker still supports.',
    }
  }
  if (maintenance.overall === 'not-configured') {
    return {
      id: 'software',
      title: 'Software updates',
      state: 'unable-to-verify',
      headline: 'We could not check for updates.',
      detail: 'The version check did not run, so this is not a statement that you are up to date.',
      action: 'Your operator can run the check again.',
    }
  }
  return {
    id: 'software',
    title: 'Software updates',
    state: maintenance.overall === 'action-required' ? 'action-required' : 'needs-attention',
    headline: 'An update is available and needs a decision.',
    detail: 'Updates are never applied on their own. Someone has to agree to it first.',
    action: 'Ask your operator to review it. Nothing changes on your website until they do.',
  }
}

function backupSection(ageHours: number | null): ReliabilitySection {
  if (ageHours === null) {
    return {
      id: 'backups',
      title: 'Your backup copies',
      state: 'unable-to-verify',
      headline: 'No verified backup is on record yet.',
      detail: 'A copy only counts once it has been opened and checked, so we will not claim one exists.',
      action: 'Ask your operator to confirm the backup job is running.',
    }
  }
  if (ageHours > CRITICAL_HOURS) {
    return {
      id: 'backups',
      title: 'Your backup copies',
      state: 'action-required',
      headline: 'The last verified copy is more than three days old.',
      detail: 'If something went wrong today, a day or more of records could be lost.',
      action: 'Ask your operator to check the backup job today.',
    }
  }
  if (ageHours > WARN_HOURS) {
    return {
      id: 'backups',
      title: 'Your backup copies',
      state: 'needs-attention',
      headline: 'The last verified copy is more than a day and a half old.',
      detail: 'That is later than usual, though not yet a danger.',
      action: 'Ask your operator to check the backup job when they can.',
    }
  }
  return {
    id: 'backups',
    title: 'Your backup copies',
    state: 'healthy',
    headline: 'A recent copy of your records has been checked.',
    detail: 'It was opened and read back, not just uploaded.',
  }
}

function maintenanceSection(pendingApprovals: number | null, maintenance: MaintenanceReport | null): ReliabilitySection {
  if (pendingApprovals === null) {
    return {
      id: 'maintenance',
      title: 'Work in progress',
      state: 'unable-to-verify',
      headline: 'We could not read the maintenance list.',
      detail: 'This is not a statement that no work is pending.',
    }
  }
  if (maintenance && maintenance.overall === 'healthy' && pendingApprovals === 0) {
    return {
      id: 'maintenance',
      title: 'Work in progress',
      state: 'healthy',
      headline: 'No maintenance is waiting on you.',
      detail: 'Nothing is queued, and nothing has failed.',
    }
  }
  if (pendingApprovals > 0) {
    return {
      id: 'maintenance',
      title: 'Work in progress',
      state: 'needs-attention',
      headline: `${pendingApprovals} repair${pendingApprovals === 1 ? '' : 's'} waiting for a yes.`,
      detail: 'These are changes that need a person to approve them before they happen.',
      action: 'Nothing happens on your website until you or your operator say yes.',
    }
  }
  return {
    id: 'maintenance',
    title: 'Work in progress',
    state: 'unable-to-verify',
    headline: 'We could not read the maintenance list.',
    detail: 'This is not a statement that no work is pending.',
  }
}

function costSection(pendingApprovals: number | null): ReliabilitySection {
  return {
    id: 'cost',
    title: 'What this could cost you',
    state: 'not-configured',
    headline: 'No specialist work has been charged.',
    detail:
      'Routine checks are included. Anything that needs a specialist is estimated before it starts, and you approve it first. ' +
      'An estimate is not a quote, and no saving is promised.',
    action: pendingApprovals && pendingApprovals > 0 ? 'Review the waiting repairs above before agreeing to any work.' : undefined,
  }
}

export function buildReliabilitySections(input: SectionInput): ReliabilitySection[] {
  return [
    healthSection(input.readiness),
    securitySection(input.securityFindings),
    softwareSection(input.maintenance),
    backupSection(input.backupAgeHours),
    maintenanceSection(input.pendingApprovals, input.maintenance),
    costSection(input.pendingApprovals),
  ]
}

/**
 * One sentence for the top of the page. Never claims more than the sections support.
 * Cost is deliberately excluded: it is a standing statement about charges, not a check,
 * so it must not turn a clean result into a warning or the reverse.
 */
export function summariseSections(sections: ReliabilitySection[]): string {
  const checks = sections.filter((s) => s.id !== 'cost')
  if (checks.some((s) => s.state === 'action-required')) return 'Something needs attention today.'
  if (checks.some((s) => s.state === 'needs-attention')) return 'Nothing is broken, and a few things are worth a look.'
  if (checks.some((s) => s.state === 'unable-to-verify')) return 'Some checks did not run, so this is not a clean bill of health.'
  if (checks.some((s) => s.state === 'not-configured')) return 'Nothing needs attention. Some optional pieces are not set up.'
  return 'Everything we checked came back clear.'
}
