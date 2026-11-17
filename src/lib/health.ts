// ============================================================================
// Health and readiness (Section 39 — Monitoring, extended)
//
// Two questions, deliberately kept apart:
//
//   LIVENESS  "is this process running and serving?"  -> /api/health
//   READINESS "can it safely handle real work now?"   -> /api/health/ready
//
// A single endpoint answering both was the original design and it was wrong in a
// dangerous way: restarting a healthy process because an optional integration is
// down, or reporting "healthy" while booking cannot be confirmed. It is also a
// security surface — a verbose diagnostic endpoint is a gift to anyone probing a
// deployment — so the public response names a status and nothing else. Hostnames,
// connection strings, stack traces, tenant names and counts never appear.
//
// Dependency rules (documented, tested):
//   • Database       critical  — without it no shop can operate.
//   • Rate-limit store  degrades write paths (fail-closed), pages still render.
//   • SMTP / Twilio / Stripe  optional — a disabled integration is not an outage.
//   • Storage        required for media uploads only, never for browsing.
// ============================================================================

import { prisma } from '@/lib/prisma'
import { checkRateLimitStoreHealth, getRateLimitStoreRuntimeState } from '@/lib/rate-limit'
import { isEncryptionKeyConfigured } from '@/lib/backup/crypto'
import { buildOwnerStatus, type OwnerStatusSummary } from '@/lib/system-status'

export type CheckStatus = 'ok' | 'degraded' | 'unavailable' | 'not_configured' | 'unknown'
export type DependencyRole = 'critical' | 'required_for_writes' | 'optional'

export interface HealthCheckResult {
  name: string
  role: DependencyRole
  status: CheckStatus
  /** Plain sentence. Never contains a URL, credential, tenant name or count. */
  detail: string
}

export interface ReadinessReport {
  status: 'ready' | 'degraded' | 'unavailable'
  checkedAt: string
  checks: HealthCheckResult[]
  /** Ages the newest verified backup. Carried here so a render pass never calls
   *  Date.now() itself (an impure call during render). */
  backupAgeHours?: number | null
}

// ── Backup freshness ────────────────────────────────────────────────────────
// "Verified" is the only status that counts: an object that exists but was never
// read back cannot be promised as a recovery copy.

export const BACKUP_FRESHNESS = {
  /** Daily backups: older than this is worth a warning. */
  warnHours: 36,
  /** Older than this means recovery would lose a business day. */
  criticalHours: 72,
} as const

export interface BackupFreshness {
  status: CheckStatus
  /** Whole hours since the newest verified backup, or null when none is known. */
  ageHours: number | null
  detail: string
}

export function evaluateBackupFreshness(
  latestVerifiedAt: Date | string | null | undefined,
  now: Date = new Date(),
): BackupFreshness {
  if (!latestVerifiedAt) {
    return {
      status: 'unknown',
      ageHours: null,
      detail: 'No verified backup has been recorded yet. Ask your operator to confirm backups are running.',
    }
  }
  const stamp = latestVerifiedAt instanceof Date ? latestVerifiedAt : new Date(latestVerifiedAt)
  const millis = stamp.getTime()
  if (!Number.isFinite(millis)) {
    return { status: 'unknown', ageHours: null, detail: 'The last backup timestamp could not be read.' }
  }
  const ageHours = Math.max(0, (now.getTime() - millis) / 3_600_000)
  if (ageHours > BACKUP_FRESHNESS.criticalHours) {
    return { status: 'degraded', ageHours, detail: 'The last verified backup is more than three days old.' }
  }
  if (ageHours > BACKUP_FRESHNESS.warnHours) {
    return { status: 'degraded', ageHours, detail: 'The last verified backup is more than a day and a half old.' }
  }
  return { status: 'ok', ageHours, detail: 'A recent verified backup exists.' }
}

// ── Checks ──────────────────────────────────────────────────────────────────

export async function checkDatabase(): Promise<HealthCheckResult> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return { name: 'database', role: 'critical', status: 'ok', detail: 'The database is answering.' }
  } catch (error) {
    // The operator gets the shape in the server log; the caller gets a sentence.
    console.error('[health] database check failed', error instanceof Error ? error.name : 'unknown')
    return {
      name: 'database',
      role: 'critical',
      status: 'unavailable',
      detail: 'The database is not answering.',
    }
  }
}

export async function checkRateLimitStore(): Promise<HealthCheckResult> {
  const health = await checkRateLimitStoreHealth()
  if (health.state === 'ok') {
    return { name: 'rate_limit_store', role: 'required_for_writes', status: 'ok', detail: 'The shared request limiter is answering.' }
  }
  if (health.state === 'not_configured') {
    // Development/demo deployments legitimately run without it; production does
    // not, and readiness says so without naming a provider.
    const role: DependencyRole = process.env.NODE_ENV === 'production' ? 'required_for_writes' : 'optional'
    return {
      name: 'rate_limit_store',
      role,
      status: process.env.NODE_ENV === 'production' ? 'degraded' : 'not_configured',
      detail: 'The shared request limiter is not configured, so sign-in, registration and booking are refusing requests.',
    }
  }
  return {
    name: 'rate_limit_store',
    role: 'required_for_writes',
    status: 'degraded',
    detail: 'The shared request limiter is not answering, so sign-in, registration and booking are temporarily refusing requests.',
  }
}

export async function checkBackupFreshness(): Promise<HealthCheckResult & { ageHours: number | null }> {
  try {
    const latest = await prisma.backupRun.findFirst({
      where: { kind: 'database', verifiedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: { verifiedAt: true },
    })
    const freshness = evaluateBackupFreshness(latest?.verifiedAt ?? null)
    return {
      name: 'backup',
      role: 'required_for_writes',
      status: freshness.status === 'ok' ? 'ok' : freshness.status,
      detail: freshness.detail,
      ageHours: freshness.ageHours,
    }
  } catch {
    // A missing table (pre-migration) or an unreadable row is "unknown", never
    // "fine". Claiming a backup exists when it cannot be read is the exact
    // failure this check exists to prevent.
    return { name: 'backup', role: 'required_for_writes', status: 'unknown', detail: 'Backup history could not be read.', ageHours: null }
  }
}

export function checkMediaStorage(): HealthCheckResult {
  const configured = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim())
  if (!configured) {
    return {
      name: 'media_storage',
      role: 'optional',
      status: 'not_configured',
      detail: 'Photo storage is not configured. Existing pages still work; new uploads are unavailable.',
    }
  }
  return {
    name: 'media_storage',
    role: 'optional',
    status: 'ok',
    detail: 'Photo storage is configured.',
  }
}

export function checkBackupEncryption(): HealthCheckResult {
  const configured = isEncryptionKeyConfigured(process.env.BACKUP_ENCRYPTION_KEY)
  if (!configured) {
    return {
      name: 'backup_encryption',
      role: 'optional',
      status: 'not_configured',
      detail: 'Off-site backups are not encrypted on this deployment.',
    }
  }
  return { name: 'backup_encryption', role: 'optional', status: 'ok', detail: 'Off-site backups are encrypted.' }
}

/** Optional integrations: reported, never allowed to fail readiness. */
/**
 * Alert delivery (Part 7). Optional on purpose: a shop with no monitoring webhook
 * still runs. Reported as `not_configured` so an operator can see the gap without
 * the owner being told their shop is broken.
 */
export function checkAlerting(env: Record<string, string | undefined> = process.env): HealthCheckResult {
  const primary = Boolean(env.OBSERVABILITY_WEBHOOK_URL?.trim())
  const independent = Boolean(env.ALERT_WEBHOOK_URL?.trim())
  if (primary && independent) {
    return { name: 'alerting', role: 'optional', status: 'ok', detail: 'Critical alerts go to two independent channels.' }
  }
  if (primary || independent) {
    return { name: 'alerting', role: 'optional', status: 'not_configured', detail: 'Only one alert channel is configured, so an outage of that provider would silence alerts.' }
  }
  return { name: 'alerting', role: 'optional', status: 'not_configured', detail: 'No alert channel is configured, so nobody would be told if a backup failed.' }
}

export function checkOptionalIntegrations(): HealthCheckResult[] {
  const results: HealthCheckResult[] = []
  const smtp = Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim())
  results.push({
    name: 'email',
    role: 'optional',
    status: smtp ? 'ok' : 'not_configured',
    detail: smtp ? 'Email is configured.' : 'Email is not configured; the site and bookings work without it.',
  })
  const sms = Boolean(process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim())
  results.push({
    name: 'sms',
    role: 'optional',
    status: sms ? 'ok' : 'not_configured',
    detail: sms ? 'Text messages are configured.' : 'Text messages are not configured; bookings are unaffected.',
  })
  const payments = Boolean(process.env.STRIPE_SECRET_KEY?.trim())
  results.push({
    name: 'payments',
    role: 'optional',
    status: payments ? 'ok' : 'not_configured',
    detail: payments ? 'Online payments are configured.' : 'Online payments are not configured; in-person payment is unaffected.',
  })
  return results
}

/**
 * Compose the readiness report.
 *
 * `unavailable` is reserved for a failed CRITICAL dependency. Everything else is
 * `degraded`: the shop is still reachable, some work is temporarily refused, and
 * the owner is told what to do (nothing) rather than being locked out.
 */
export async function buildReadinessReport(now: Date = new Date()): Promise<ReadinessReport> {
  const [database, rateLimit, backup] = await Promise.all([
    checkDatabase(),
    checkRateLimitStore(),
    checkBackupFreshness(),
  ])
  const checks: HealthCheckResult[] = [
    database,
    rateLimit,
    backup,
    checkMediaStorage(),
    checkBackupEncryption(),
    checkAlerting(),
    ...checkOptionalIntegrations(),
  ]

  const criticalFailed = checks.some((check) => check.role === 'critical' && check.status !== 'ok')
  const writePathDegraded = checks.some(
    (check) => check.role === 'required_for_writes' && check.status !== 'ok',
  )
  const status: ReadinessReport['status'] = criticalFailed ? 'unavailable' : writePathDegraded ? 'degraded' : 'ready'
  return { status, checkedAt: now.toISOString(), checks, backupAgeHours: backup.ageHours }
}

/** HTTP status for a readiness report: only a critical failure is a 503. */
export function readinessHttpStatus(report: ReadinessReport): number {
  return report.status === 'unavailable' ? 503 : 200
}

/**
 * The public shape. Roles and internal detail are kept for the owner-facing
 * status screen (server component) but the HTTP response carries only names and
 * statuses, so an anonymous probe learns nothing about the stack.
 */
export function publicReadinessView(report: ReadinessReport) {
  return {
    status: report.status,
    checkedAt: report.checkedAt,
    checks: report.checks.map((check) => ({ name: check.name, status: check.status })),
  }
}

/** Redacted runtime numbers for the owner/operator screen. */
export function rateLimitRuntimeSummary() {
  const state = getRateLimitStoreRuntimeState()
  return {
    degraded: state.degraded,
    consecutiveFailures: state.consecutiveFailures,
    lastFailureAt: state.lastFailureAt,
    lastSuccessAt: state.lastSuccessAt,
  }
}

/**
 * Translate the technical readiness report into the owner-facing summary used by
 * the dashboard. One place does the mapping, so the screen and the status library
 * cannot disagree about what "degraded" means for a barbershop owner.
 */
export function ownerStatusFromReadiness(report: ReadinessReport, backupAgeHours: number | null | undefined = undefined): OwnerStatusSummary {
  const find = (name: string) => report.checks.find((check) => check.name === name)
  const state = (name: string): 'ok' | 'degraded' | 'unavailable' | 'not_configured' | 'unknown' => {
    const check = find(name)
    if (!check) return 'unknown'
    if (check.status === 'ok') return 'ok'
    if (check.status === 'unavailable') return 'unavailable'
    if (check.status === 'not_configured') return 'not_configured'
    return 'degraded'
  }
  const database = state('database')
  const limiter = state('rate_limit_store')
  const email = state('email')
  const sms = state('sms')
  const notifications: 'ok' | 'not_configured' | 'degraded' =
    email === 'ok' || sms === 'ok' ? 'ok' : email === 'degraded' || sms === 'degraded' ? 'degraded' : 'not_configured'
  return buildOwnerStatus({
    database,
    bookings: database !== 'ok' ? 'unavailable' : limiter === 'ok' || limiter === 'not_configured' ? 'ok' : 'degraded',
    notifications,
    backup: state('backup'),
    backupAgeHours: backupAgeHours ?? report.backupAgeHours ?? null,
    photos: state('media_storage'),
  })
}
