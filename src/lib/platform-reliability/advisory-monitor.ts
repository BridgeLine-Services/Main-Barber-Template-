/**
 * Security advisory monitoring (Priority 1, part C).
 *
 * A vulnerability report is only useful to a shop owner if it answers five questions in
 * their language: what is affected, what is installed, what is vulnerable, is a fix
 * available, and does this need doing today. This module turns a raw audit record into
 * exactly that, and refuses to invent a patched version when none is known.
 *
 * Pure: no network, no database, no clock. The caller supplies the raw record and the
 * date it was checked, so every sentence can be pinned by a test.
 */

export type AdvisorySeverity = 'critical' | 'high' | 'moderate' | 'low' | 'unknown'

/** The subset of an npm audit / OSV record this module understands. */
export interface RawAdvisory {
  id?: string | number
  module_name?: string
  packageName?: string
  severity?: string
  title?: string
  url?: string
  range?: string
  vulnerableRange?: string
  installedVersion?: string
  fixAvailable?: boolean | { name?: string; version?: string; isSemVerMajor?: boolean }
  via?: Array<string | { title?: string; url?: string; severity?: string; range?: string }>
}

export interface SecurityAdvisory {
  dependency: string
  installedVersion: string | null
  vulnerableRange: string | null
  /** Only ever set when a fix is actually known. Null means "no fix is known yet". */
  patchedVersion: string | null
  severity: AdvisorySeverity
  title: string
  businessImpact: string
  remediation: string
  /** True when a person should act today, not at the next maintenance window. */
  immediateAction: boolean
  /** Where the finding came from, so the owner can check it. */
  source: string
  checkedAt: string
  /** False when the record was too incomplete to state the risk honestly. */
  verified: boolean
}

const SEVERITY_MAP: Record<string, AdvisorySeverity> = {
  critical: 'critical',
  high: 'high',
  moderate: 'moderate',
  medium: 'moderate',
  low: 'low',
  info: 'low',
}

export function normaliseSeverity(raw: string | undefined | null): AdvisorySeverity {
  if (!raw) return 'unknown'
  return SEVERITY_MAP[raw.trim().toLowerCase()] ?? 'unknown'
}

/** What part of the business a dependency touches, for a sentence the owner understands. */
export type DependencyRole = 'payments' | 'signin' | 'database' | 'framework' | 'messaging' | 'cache' | 'other'

const ROLE_PATTERNS: Array<{ role: DependencyRole; test: RegExp }> = [
  { role: 'payments', test: /^(stripe|@stripe\/)/i },
  { role: 'signin', test: /^(next-auth|@auth\/|bcrypt|bcryptjs|otplib|speakeasy)/i },
  { role: 'database', test: /^(prisma|@prisma\/|pg|postgres|@neondatabase\/|ioredis|redis)/i },
  { role: 'framework', test: /^(next|react|react-dom|@next\/)/i },
  { role: 'messaging', test: /^(twilio|nodemailer|resend|@sendgrid\/)/i },
  { role: 'cache', test: /^(@upstash\/|@vercel\/kv)/i },
]

export function dependencyRole(name: string): DependencyRole {
  const base = name.trim()
  for (const { role, test } of ROLE_PATTERNS) if (test.test(base)) return role
  return 'other'
}

const IMPACT: Record<DependencyRole, string> = {
  payments: 'This package handles card payments. A flaw here could expose payment details or let a charge be manipulated.',
  signin: 'This package handles signing in. A flaw here could let someone reach an account they do not own.',
  database: 'This package talks to your shop data. A flaw here could expose or corrupt customer and appointment records.',
  framework: 'This package runs your website. A flaw here could let an attacker take over a page or a session.',
  messaging: 'This package sends texts and email. A flaw here could leak contact details or let messages be forged.',
  cache: 'This package stores temporary data such as rate limits. A flaw here could weaken abuse protection.',
  other: 'This package is part of your website. A flaw here should be fixed at the next maintenance window unless the risk below says otherwise.',
}

export function businessImpactFor(severity: AdvisorySeverity, dependency: string): string {
  const role = dependencyRole(dependency)
  const base = IMPACT[role]
  if (severity === 'critical') return `${base} Treat this as urgent: the flaw is severe and known to be exploitable.`
  if (severity === 'high') return `${base} This should be fixed before the next busy period.`
  if (severity === 'moderate') return `${base} Fix it in your normal maintenance window.`
  if (severity === 'low') return `${base} Low risk: fix it when it is convenient, alongside other updates.`
  return `${base} The severity could not be read, so treat it cautiously until it is confirmed.`
}

function patchedFrom(fix: RawAdvisory['fixAvailable']): string | null {
  if (fix && typeof fix === 'object' && typeof fix.version === 'string' && fix.version.trim()) return fix.version.trim()
  return null
}

/**
 * Build one advisory. A record without a dependency name or a vulnerable range is
 * reported as unverified rather than guessed at.
 */
export function buildAdvisory(raw: RawAdvisory, checkedAt: string): SecurityAdvisory {
  const dependency = (raw.module_name ?? raw.packageName ?? '').trim()
  const severity = normaliseSeverity(raw.severity)
  const vulnerableRange = (raw.vulnerableRange ?? raw.range ?? '').trim() || null
  const patchedVersion = patchedFrom(raw.fixAvailable)
  const verified = dependency.length > 0 && vulnerableRange !== null && severity !== 'unknown'

  const remediation = patchedVersion
    ? `Update ${dependency || 'the package'} to ${patchedVersion} or later, then run the full test suite before deploying.`
    : dependency
      ? `No fixed version is published yet for ${dependency}. Monitor the advisory source, and apply a workaround only with the person responsible for security.`
      : 'The affected package could not be identified. Check the advisory source directly before acting.'

  return {
    dependency: dependency || 'Unknown package',
    installedVersion: raw.installedVersion?.trim() || null,
    vulnerableRange,
    patchedVersion,
    severity,
    title: raw.title?.trim() || 'Security advisory',
    businessImpact: businessImpactFor(severity, dependency),
    remediation,
    immediateAction: severity === 'critical' || (severity === 'high' && dependencyRole(dependency) !== 'other'),
    source: raw.url?.trim() || 'Security advisory source not recorded',
    checkedAt,
    verified,
  }
}

export interface AdvisorySummary {
  total: number
  bySeverity: Record<AdvisorySeverity, number>
  immediate: number
  unverified: number
  /** Worst state across the list; never "clear" when nothing was actually checked. */
  state: 'action-required' | 'needs-attention' | 'clear' | 'unable-to-verify'
  headline: string
  detail: string
}

export function summariseAdvisories(advisories: SecurityAdvisory[] | null): AdvisorySummary {
  const bySeverity: Record<AdvisorySeverity, number> = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 }
  if (advisories === null) {
    return {
      total: 0,
      bySeverity,
      immediate: 0,
      unverified: 0,
      state: 'unable-to-verify',
      headline: 'We could not check for security advisories.',
      detail: 'That is not the same as being clear. Run the check again before treating this as safe.',
    }
  }
  for (const a of advisories) bySeverity[a.severity]++
  const immediate = advisories.filter((a) => a.immediateAction).length
  const unverified = advisories.filter((a) => !a.verified).length

  if (immediate > 0) {
    return {
      total: advisories.length,
      bySeverity,
      immediate,
      unverified,
      state: 'action-required',
      headline: `${immediate} security update${immediate === 1 ? '' : 's'} should be applied soon.`,
      detail: 'These affect parts of your site that handle money, sign-in or customer data.',
    }
  }
  if (advisories.length > 0) {
    return {
      total: advisories.length,
      bySeverity,
      immediate,
      unverified,
      state: 'needs-attention',
      headline: `${advisories.length} security advisory${advisories.length === 1 ? '' : 'ies'} can wait for your maintenance window.`,
      detail: 'Nothing here needs doing today, but they should be cleared at the next update.',
    }
  }
  return {
    total: 0,
    bySeverity,
    immediate: 0,
    unverified: 0,
    state: 'clear',
    headline: 'No known security advisories affect your software.',
    detail: 'The check ran and found nothing outstanding.',
  }
}
