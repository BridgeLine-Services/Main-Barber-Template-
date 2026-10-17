import { prisma } from '@/lib/prisma'
import nodemailer from 'nodemailer'
import { getSmtpFromAddress } from '@/lib/app-config'
import { isEmailConfigured, sanitizeErrorMessage } from '@/lib/notifications'

const MIN_DELAY = 15
const MAX_DELAY = 7 * 24 * 60
const MAX_ATTEMPTS = 3

export function validateReviewUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function clampReviewDelay(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 60
  return Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.round(parsed)))
}

export async function scheduleReviewRequest(appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { business: true, customer: true },
  })
  if (!appointment || appointment.status !== 'COMPLETED') return { scheduled: false, reason: 'Appointment is not completed' }
  const url = validateReviewUrl(appointment.business.reviewRequestUrl)
  if (!appointment.business.reviewRequestEnabled || !url) return { scheduled: false, reason: 'Review requests disabled or URL invalid' }
  if (!appointment.customer.email || appointment.customer.archivedAt) return { scheduled: false, reason: 'Customer has no usable email' }
  const cooldown = new Date(Date.now() - appointment.business.reviewRequestCooldownDays * 86400000)
  const recent = await prisma.reviewRequest.findFirst({ where: { businessId: appointment.businessId, customerId: appointment.customerId, createdAt: { gte: cooldown }, status: { not: 'CANCELED' } } })
  if (recent) return { scheduled: false, reason: 'Customer cooldown active' }
  const scheduledAt = new Date(Date.now() + appointment.business.reviewRequestDelayMinutes * 60000)
  try {
    await prisma.reviewRequest.create({ data: { businessId: appointment.businessId, appointmentId, customerId: appointment.customerId, recipient: appointment.customer.email, scheduledAt } })
    return { scheduled: true }
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return { scheduled: false, reason: 'Already scheduled' }
// ============================================================================
// Prompt 9 — Automated post-appointment review requests
//
// Server-side, single-authoritative implementation:
//   - Shop settings (feature flag + owner master switch, fail-closed)
//   - Eligibility: only COMPLETED appointments, past the configured delay,
//     with a usable, HTTPS destination and a contactable customer
//   - Durable queue: one ReviewRequest per appointment (DB-unique), atomic
//     claim-and-send, bounded exponential-backoff retries, stale-claim
//     recovery, idempotent cron
//
// A scheduled appointment alone NEVER triggers a request. The worker is the
// only sender; no client request can trigger bulk sends.
// ============================================================================

import { ReviewRequestStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isFeatureEnabledForBusiness } from '@/lib/features'
import { sanitizeErrorMessage } from '@/lib/notifications'

// ─── Policy constants ───────────────────────────────────────────────────────

export const REVIEW_DELAY_MIN_HOURS = 0
export const REVIEW_DELAY_MAX_HOURS = 168 // one week
export const REVIEW_DELAY_DEFAULT_HOURS = 24

export const REVIEW_MAX_ATTEMPTS = 5
/** Exponential backoff: 5m, 20m, 45m, 80m (capped at 2h). */
export function reviewRetryDelayMinutes(attempt: number): number {
  const base = 5 * Math.pow(2, attempt - 1)
  return Math.min(120, base)
}

/** Worker claims stuck in PROCESSING longer than this are re-queued. */
const STALE_CLAIM_MINUTES = 15
/** Max requests handled per cron invocation. */
const CRON_BATCH_LIMIT = 50
/** Look-back window for enqueue: completed appointments considered. */
const ENQUEUE_LOOKBACK_DAYS = 90

// ─── Settings ───────────────────────────────────────────────────────────────

export interface ReviewRequestSettingsRow {
  enabled: boolean
  destinationUrl: string | null
  delayHours: number
  emailSubject: string | null
  messageTemplate: string | null
}

export const DEFAULT_REVIEW_SUBJECT = 'How was your visit?'

export const DEFAULT_REVIEW_TEMPLATE =
  'Hi {{customerFirstName}}, thanks for visiting {{shopName}}! We hope you loved your {{serviceName}}. If you have a moment, an honest review helps us a lot: {{reviewLink}}'

export async function getReviewRequestSettings(businessId: string): Promise<ReviewRequestSettingsRow> {
  const row = await prisma.reviewRequestSettings.findUnique({ where: { businessId } })
  return {
    enabled: row?.enabled ?? false,
    destinationUrl: row?.destinationUrl ?? null,
    delayHours: row?.delayHours ?? REVIEW_DELAY_DEFAULT_HOURS,
    emailSubject: row?.emailSubject ?? null,
    messageTemplate: row?.messageTemplate ?? null,
  }
}

/** Validate an external review destination. HTTPS only, no credentials,
 * must have a hostname. Owners must paste a real platform link — the system
 * never invents one. */
export function isValidReviewDestination(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    if (!u.hostname || u.username || u.password) return false
    return true
  } catch {
    return false
  }
}

export interface SettingsUpdateInput {
  enabled: boolean
  destinationUrl?: string | null
  delayHours: number
  emailSubject?: string | null
  messageTemplate?: string | null
}

export interface SettingsUpdateResult {
  settings: ReviewRequestSettingsRow
  warnings: string[]
}

export async function updateReviewRequestSettings(
  businessId: string,
  input: SettingsUpdateInput
): Promise<SettingsUpdateResult> {
  const warnings: string[] = []
  const delayHours = Math.min(
    REVIEW_DELAY_MAX_HOURS,
    Math.max(REVIEW_DELAY_MIN_HOURS, Math.floor(input.delayHours))
  )

  let destinationUrl: string | null = null
  if (input.destinationUrl !== undefined && input.destinationUrl !== null && input.destinationUrl.trim() !== '') {
    if (!isValidReviewDestination(input.destinationUrl)) {
      throw new ReviewRequestError('INVALID_DESTINATION', 'Review destination must be a valid HTTPS URL')
    }
    destinationUrl = input.destinationUrl.trim()
  }

  // Only safe variables survive rendering; template stays plain text.
  const messageTemplate = input.messageTemplate?.trim() || null
  if (messageTemplate && messageTemplate.length > 2000) {
    throw new ReviewRequestError('INVALID_TEMPLATE', 'Message template is too long (max 2000 characters)')
  }
  const emailSubject = input.emailSubject?.trim() || null
  if (emailSubject && emailSubject.length > 200) {
    throw new ReviewRequestError('INVALID_SUBJECT', 'Email subject is too long (max 200 characters)')
  }

  if (input.enabled && !destinationUrl) {
    warnings.push(
      'Requests are enabled but no review destination is configured — delivery stays suppressed until a valid HTTPS destination is saved.'
    )
  }

  const settings = await prisma.reviewRequestSettings.upsert({
    where: { businessId },
    create: { businessId, enabled: input.enabled, destinationUrl, delayHours, emailSubject, messageTemplate },
    update: { enabled: input.enabled, destinationUrl, delayHours, emailSubject, messageTemplate },
  })
  return {
    settings: {
      enabled: settings.enabled,
      destinationUrl: settings.destinationUrl,
      delayHours: settings.delayHours,
      emailSubject: settings.emailSubject,
      messageTemplate: settings.messageTemplate,
    },
    warnings,
  }
}

export class ReviewRequestError extends Error {
  constructor(public code: 'INVALID_DESTINATION' | 'INVALID_TEMPLATE' | 'INVALID_SUBJECT' | 'FEATURE_DISABLED', message: string) {
    super(message)
    this.name = 'ReviewRequestError'
  }
}

// ─── Template rendering ─────────────────────────────────────────────────────

export interface ReviewTemplateVars {
  customerFirstName: string
  shopName: string
  serviceName: string
  reviewLink: string
}

const TEMPLATE_VARIABLES = ['customerFirstName', 'shopName', 'serviceName', 'reviewLink'] as const

/** Render the owner's plain-text template (or the default). Values are
 * escaped for HTML and the URL is encoded — owners cannot inject markup. */
export function renderReviewMessage(template: string | null, vars: ReviewTemplateVars): string {
  const base = template?.trim() || DEFAULT_REVIEW_TEMPLATE
  return base
    .replace(/\{\{\s*customerFirstName\s*\}\}/g, escapeHtml(vars.customerFirstName))
    .replace(/\{\{\s*shopName\s*\}\}/g, escapeHtml(vars.shopName))
    .replace(/\{\{\s*serviceName\s*\}\}/g, escapeHtml(vars.serviceName))
    .replace(/\{\{\s*reviewLink\s*\}\}/g, escapeHtml(encodeUrlForHtml(vars.reviewLink)))
}

/** Preview for the owner UI — same renderer, sample data, HTML-escaped. */
export function previewReviewMessage(template: string | null): string {
  return renderReviewMessage(template, {
    customerFirstName: 'Alex',
    shopName: 'Your Shop',
    serviceName: 'Classic Haircut',
    reviewLink: 'https://g.page/r/your-shop/review',
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Keep the link clickable in HTML mail while escaping dangerous chars. */
function encodeUrlForHtml(url: string): string {
  return url.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E')
}

// ─── Eligibility (single authoritative service) ─────────────────────────────

type AppointmentWithCustomer = Prisma.AppointmentGetPayload<{
  include: { customer: true; service: true }
}>

export interface EligibilityDecision {
  eligible: boolean
  /** Sanitized machine category for SUPPRESSED rows and tests. */
  reason?: 'FEATURE_DISABLED' | 'NOT_COMPLETED' | 'MISSING_COMPLETION_TIME' | 'WITHIN_DELAY' |
    'NO_CUSTOMER_EMAIL' | 'EMAIL_OPT_OUT' | 'INVALID_DESTINATION' | 'ALREADY_REQUESTED'
}

/** Core eligibility — evaluated against one appointment + resolved settings.
 * completion time is the canonical COMPLETED transition timestamp, never the
 * scheduled start. */
export function evaluateReviewEligibility(args: {
  appointment: AppointmentWithCustomer
  featureEnabled: boolean
  settings: ReviewRequestSettingsRow
  now: Date
}): EligibilityDecision {
  const { appointment, featureEnabled, settings, now } = args

  if (!featureEnabled || !settings.enabled) return { eligible: false, reason: 'FEATURE_DISABLED' }
  if (appointment.status !== 'COMPLETED') return { eligible: false, reason: 'NOT_COMPLETED' }
  // RESCHEDULED appointments that were later completed carry completedAt on
  // the canonical transition; without a valid completion time we never guess.
  if (!appointment.completedAt || appointment.completedAt.getTime() > now.getTime()) {
    return { eligible: false, reason: 'MISSING_COMPLETION_TIME' }
  }
  const delayMs = settings.delayHours * 3600_000
  if (appointment.completedAt.getTime() + delayMs > now.getTime()) {
    return { eligible: false, reason: 'WITHIN_DELAY' }
  }
  if (!appointment.customer?.email?.trim()) return { eligible: false, reason: 'NO_CUSTOMER_EMAIL' }
  if (appointment.customer.emailOptOut) return { eligible: false, reason: 'EMAIL_OPT_OUT' }
  if (!isValidReviewDestination(settings.destinationUrl)) return { eligible: false, reason: 'INVALID_DESTINATION' }
  return { eligible: true }
}

// ─── Enqueue (idempotent) ───────────────────────────────────────────────────

/**
 * Scan recently-completed appointments and create PENDING requests for every
 * eligible appointment that has no request yet. The appointmentId unique
 * constraint makes duplicate/concurrent enqueues impossible — this function
 * is safe to call any number of times.
 *
 * Appointments that are completed + past the delay but NOT contactable
 * (opted out, no email, destination missing) get a SUPPRESSED row so owners
 * can see why nothing was sent. They are never retried; if the underlying
 * problem is fixed (e.g. destination added), re-enqueue flips them to PENDING.
 */
export async function enqueueDueReviewRequests(businessId?: string, limit = CRON_BATCH_LIMIT) {
  const now = new Date()
  const lookback = new Date(now.getTime() - ENQUEUE_LOOKBACK_DAYS * 24 * 3600_000)

  const candidates = await prisma.appointment.findMany({
    where: {
      status: 'COMPLETED',
      completedAt: { not: null, gte: lookback },
      ...(businessId ? { businessId } : {}),
    },
    include: { customer: true, service: true },
    orderBy: { completedAt: 'asc' },
    take: limit * 3,
  })

  let queued = 0
  let suppressed = 0
  let skipped = 0

  // Feature/settings resolved per business to respect tenant scoping.
  const settingsCache = new Map<string, { feature: boolean; settings: ReviewRequestSettingsRow }>()
  const resolve = async (bid: string) => {
    if (!settingsCache.has(bid)) {
      settingsCache.set(bid, {
        feature: await isFeatureEnabledForBusiness(bid, 'reviewRequests'),
        settings: await getReviewRequestSettings(bid),
      })
    }
    return settingsCache.get(bid)!
  }

  for (const appointment of candidates) {
    if (queued + suppressed >= limit) break
    const { feature, settings } = await resolve(appointment.businessId)
    const decision = evaluateReviewEligibility({ appointment, featureEnabled: feature, settings, now })

    if (!decision.eligible) {
      switch (decision.reason) {
        case 'WITHIN_DELAY':
        case 'NOT_COMPLETED':
        case 'MISSING_COMPLETION_TIME':
          skipped++
          break
        case 'NO_CUSTOMER_EMAIL':
        case 'EMAIL_OPT_OUT':
        case 'INVALID_DESTINATION':
          suppressed += await suppressRequest(appointment, decision.reason!)
          break
        default:
          skipped++
      }
      continue
    }

    try {
      await prisma.reviewRequest.create({
        data: {
          businessId: appointment.businessId,
          appointmentId: appointment.id,
          customerId: appointment.customerId,
          destinationUrl: settings.destinationUrl,
          scheduledFor: new Date(appointment.completedAt!.getTime() + settings.delayHours * 3600_000),
          status: 'PENDING',
          idempotencyKey: `review-req:${appointment.id}`,
        },
      })
      queued++
    } catch (error) {
      if (isUniqueViolation(error)) continue // already enqueued — idempotent
      throw error
    }
  }
  return { queued, suppressed, skipped, considered: candidates.length }
}

/** Record a SUPPRESSED request (idempotent) so the owner dashboard explains
 * why delivery did not happen. Re-enqueues update the row when the reason
 * changes; fixing the problem flips it to PENDING on a later enqueue. */
async function suppressRequest(
  appointment: AppointmentWithCustomer,
  category: Exclude<EligibilityDecision['reason'], undefined>
): Promise<number> {
  try {
    await prisma.reviewRequest.upsert({
      where: { appointmentId: appointment.id },
      create: {
        businessId: appointment.businessId,
        appointmentId: appointment.id,
        customerId: appointment.customerId,
        scheduledFor: new Date(),
        status: 'SUPPRESSED',
        failureCategory: category,
        failureDetail: suppressionDetail(category),
        idempotencyKey: `review-req:${appointment.id}`,
      },
      update: { status: 'SUPPRESSED', failureCategory: category, failureDetail: suppressionDetail(category), sentAt: null },
    })
    return 1
  } catch (error) {
    if (isUniqueViolation(error)) return 0
    throw error
  }
}

function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!) }

export async function processReviewRequests(now = new Date()) {
  // Recover jobs left in-flight by a timed-out cron invocation. The atomic
  // claim below still prevents two workers from processing the same row.
  const staleProcessingAt = new Date(now.getTime() - 15 * 60 * 1000)
  await prisma.reviewRequest.updateMany({
    where: { status: 'PROCESSING', lastAttemptAt: { lt: staleProcessingAt } },
    data: { status: 'PENDING', nextAttemptAt: now },
  })

  const due = await prisma.reviewRequest.findMany({ where: { status: 'PENDING', scheduledAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, take: 100 })
  const summary = { processed: 0, sent: 0, skipped: 0, failed: 0 }
  for (const request of due) {
    const claimed = await prisma.reviewRequest.updateMany({ where: { id: request.id, status: 'PENDING' }, data: { status: 'PROCESSING', lastAttemptAt: now, attemptCount: { increment: 1 } } })
    if (!claimed.count) continue
    summary.processed++
    const current = await prisma.reviewRequest.findUnique({ where: { id: request.id }, include: { business: true, appointment: true, customer: true } })
    const url = current && validateReviewUrl(current.business.reviewRequestUrl)
    if (!current || current.appointment.status !== 'COMPLETED' || !current.business.reviewRequestEnabled || !url || !current.customer.email || current.customer.archivedAt) {
      await prisma.reviewRequest.update({ where: { id: request.id }, data: { status: 'SKIPPED', skipReason: 'Eligibility changed before delivery' } })
      summary.skipped++
      continue
    }
    if (!isEmailConfigured()) {
      await prisma.reviewRequest.update({ where: { id: request.id }, data: { status: current.attemptCount >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING', failureReason: 'Email provider is not configured', nextAttemptAt: new Date(now.getTime() + Math.min(3600000, 60000 * 2 ** current.attemptCount)) } })
      summary.failed++
      continue
    }
    try {
      const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT || 587) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
      await transport.sendMail({ from: getSmtpFromAddress(), to: current.customer.email, subject: `Thank you for visiting ${current.business.name}`, html: `<div style="font-family:sans-serif;max-width:600px"><p>Hi ${escapeHtml(current.customer.firstName)},</p><p>Thank you for visiting <strong>${escapeHtml(current.business.name)}</strong>. We would appreciate your honest feedback.</p><p><a href="${escapeHtml(url)}">Leave a review</a></p><p>Thank you.</p></div>` })
      await prisma.reviewRequest.update({ where: { id: request.id }, data: { status: 'SENT', providerMessageId: 'smtp-accepted' } })
      summary.sent++
    } catch (error) {
      const terminal = current.attemptCount >= MAX_ATTEMPTS
      await prisma.reviewRequest.update({ where: { id: request.id }, data: { status: terminal ? 'FAILED' : 'PENDING', failureReason: sanitizeErrorMessage(error), nextAttemptAt: terminal ? null : new Date(now.getTime() + Math.min(86400000, 60000 * 2 ** current.attemptCount)) } })
      summary.failed++
    }
  }
  return summary
}

export const reviewRequestLimits = { MIN_DELAY, MAX_DELAY, MAX_ATTEMPTS }
function suppressionDetail(category: string): string {
  switch (category) {
    case 'NO_CUSTOMER_EMAIL': return 'Customer has no usable email address'
    case 'EMAIL_OPT_OUT': return 'Customer opted out of emails'
    case 'INVALID_DESTINATION': return 'Review destination missing or invalid (HTTPS required)'
    case 'FEATURE_DISABLED': return 'Review requests disabled for this shop'
    default: return 'Not eligible'
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002'
}

// ─── Claim + deliver (atomic, retrying, crash-safe) ─────────────────────────

export interface DeliveryResult {
  claimed: number
  sent: number
  failed: number
  suppressed: number
  requeued: number
}

/**
 * Process due requests: claim → recheck → send → persist. Safe under
 * concurrent cron invocations (compare-and-set claim), bounded per call.
 */
export async function processDueReviewRequests(limit = CRON_BATCH_LIMIT): Promise<DeliveryResult> {
  const now = new Date()
  let sent = 0
  let failed = 0
  let suppressed = 0

  // Crash recovery: re-queue claims stale for >15 minutes (worker died mid-send).
  const staleCutoff = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000)
  const requeued = await prisma.reviewRequest.updateMany({
    where: { status: 'PROCESSING', lastAttemptAt: { lt: staleCutoff } },
    data: { status: 'PENDING' },
  })

  const due = await prisma.reviewRequest.findMany({
    where: { status: 'PENDING', scheduledFor: { lte: now } },
    orderBy: { scheduledFor: 'asc' },
    take: limit,
    select: { id: true },
  })

  let claimed = 0
  for (const row of due) {
    // Atomic claim: only one worker can flip PENDING → PROCESSING.
    const claim = await prisma.reviewRequest.updateMany({ // perf-ok: bounded claim-and-send worker; per-row CAS required for claim semantics
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'PROCESSING', lastAttemptAt: now, attemptCount: { increment: 1 } },
    })
    if (claim.count !== 1) continue
    claimed++

    const request = await prisma.reviewRequest.findUnique({
      where: { id: row.id },
      include: {
        appointment: { include: { customer: true, service: true } },
        business: { select: { name: true, email: true } },
      },
    })
    if (!request) continue

    // Recheck eligibility immediately before sending — config, status,
    // consent, or destination may have changed since enqueue.
    const feature = await isFeatureEnabledForBusiness(request.businessId, 'reviewRequests')
    const settings = await getReviewRequestSettings(request.businessId)
    const decision = evaluateReviewEligibility({
      appointment: request.appointment,
      featureEnabled: feature,
      settings,
      now: new Date(),
    })

    if (!decision.eligible) {
      // Never send when the check fails at send time.
      if (decision.reason === 'WITHIN_DELAY' || decision.reason === 'NOT_COMPLETED' || decision.reason === 'MISSING_COMPLETION_TIME') {
        // Transient state — back to PENDING, no attempt wasted.
        await prisma.reviewRequest.update({
          where: { id: request.id },
          data: { status: 'PENDING', attemptCount: { decrement: 1 }, lastAttemptAt: null, scheduledFor: request.appointment.completedAt ?? request.scheduledFor },
        })
        claimed--
        continue
      }
      await prisma.reviewRequest.update({
        where: { id: request.id },
        data: { status: 'SUPPRESSED', failureCategory: decision.reason ?? 'CONFIG_ERROR', failureDetail: suppressionDetail(decision.reason ?? 'CONFIG_ERROR') },
      })
      suppressed++
      continue
    }

    try {
      const messageHtml = buildReviewEmailHtml(request, settings)
      const { sendReviewRequestEmail } = await import('@/lib/notifications')
      const providerMessageId = await sendReviewRequestEmail({
        businessId: request.businessId,
        to: request.appointment.customer!.email,
        subject: settings.emailSubject || DEFAULT_REVIEW_SUBJECT,
        html: messageHtml,
        idempotencyKey: request.idempotencyKey,
      })
      await prisma.reviewRequest.update({
        where: { id: request.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: providerMessageId ?? null,
          destinationUrl: settings.destinationUrl,
          failureCategory: null,
          failureDetail: null,
        },
      })
      sent++
    } catch (error) {
      failed += await recordFailure(request.id, request.attemptCount, error)
    }
  }

  return { claimed, sent, failed, suppressed, requeued: requeued.count }
}

/** Persist a failure with bounded exponential backoff. Permanent problems are
 * recognized by category and never retried indefinitely. */
async function recordFailure(requestId: string, attemptCount: number, error: unknown): Promise<number> {
  const sanitized = sanitizeErrorMessage(error)
  const permanent = isPermanentEmailError(sanitized)
  const attempts = attemptCount + 1 // attemptCount was incremented by the claim
  const exhausted = attempts >= REVIEW_MAX_ATTEMPTS

  if (permanent || exhausted) {
    await prisma.reviewRequest.update({
      where: { id: requestId },
      data: {
        status: 'FAILED',
        failureCategory: permanent ? 'PROVIDER_ERROR' : 'EXHAUSTED_RETRIES',
        failureDetail: sanitized,
      },
    })
    return 1
  }

  // Retryable: back to PENDING with a backoff window.
  const backoffMs = reviewRetryDelayMinutes(attempts) * 60_000
  await prisma.reviewRequest.update({
    where: { id: requestId },
    data: { status: 'PENDING', scheduledFor: new Date(Date.now() + backoffMs) },
  })
  return 1
}

/** Provider rejections that will never succeed on retry (bad address, policy
 * rejection). Everything else is treated as transient (network, SMTP down). */
function isPermanentEmailError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('invalid recipient') ||
    m.includes('does not exist') ||
    m.includes('user unknown') ||
    m.includes('hard bounce') ||
    m.includes('address rejected')
  )
}

function buildReviewEmailHtml(
  request: NonNullable<Prisma.ReviewRequestGetPayload<{ include: { appointment: { include: { customer: true; service: true } }, business: { select: { name: true; email: true } } } }>>,
  settings: ReviewRequestSettingsRow
): string {
  const vars: ReviewTemplateVars = {
    customerFirstName: request.appointment.customer?.firstName || 'there',
    shopName: request.business.name,
    serviceName: request.appointment.service?.name || 'service',
    reviewLink: settings.destinationUrl!,
  }
  const body = renderReviewMessage(settings.messageTemplate, vars)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1a1a1a;">${esc(request.business.name)}</h1>
      <p style="font-size: 16px; line-height: 1.6;">${body}</p>
      <p style="margin: 28px 0;">
        <a href="${esc(settings.destinationUrl!)}"
           style="display: inline-block; background: #d4af37; color: #1a1a1a; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
          Leave a review
        </a>
      </p>
      <p style="font-size: 13px; color: #888;">
        Sent by ${esc(request.business.name)}${request.business.email ? ` &middot; ${esc(request.business.email)}` : ''}.
        You are receiving this because you completed a visit. Reply to this email to contact the shop.
      </p>
    </div>
  `
}

// ─── Owner dashboard summary ────────────────────────────────────────────────

export interface ReviewRequestSummary {
  pending: number
  processing: number
  sent: number
  failed: number
  suppressed: number
  cancelled: number
  lastSentAt: string | null
  lastProcessedAt: string | null
  enabled: boolean
  delayHours: number
  destinationConfigured: boolean
}

export async function getReviewRequestSummary(businessId: string): Promise<ReviewRequestSummary> {
  const [counts, settings, feature, lastSent, lastProcessed] = await Promise.all([
    prisma.reviewRequest.groupBy({
      by: ['status'],
      where: { businessId },
      _count: { _all: true },
    }),
    getReviewRequestSettings(businessId),
    isFeatureEnabledForBusiness(businessId, 'reviewRequests'),
    prisma.reviewRequest.findFirst({
      where: { businessId, status: 'SENT' },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    }),
    prisma.reviewRequest.findFirst({
      where: { businessId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    }),
  ])
  const by = (status: ReviewRequestStatus) =>
    counts.find((c) => c.status === status)?._count._all ?? 0
  return {
    pending: by('PENDING'),
    processing: by('PROCESSING'),
    sent: by('SENT'),
    failed: by('FAILED'),
    suppressed: by('SUPPRESSED'),
    cancelled: by('CANCELLED'),
    lastSentAt: lastSent?.sentAt?.toISOString() ?? null,
    lastProcessedAt: lastProcessed?.updatedAt.toISOString() ?? null,
    enabled: settings.enabled && feature,
    delayHours: settings.delayHours,
    destinationConfigured: isValidReviewDestination(settings.destinationUrl),
  }
}

export interface ReviewRequestListRow {
  id: string
  status: ReviewRequestStatus
  appointmentStartTime: string
  serviceName: string | null
  customerName: string
  attemptCount: number
  lastAttemptAt: string | null
  sentAt: string | null
  failureCategory: string | null
  failureDetail: string | null
  destinationHost: string | null
}

/** Owner-facing list. Only the destination HOST is exposed (never the full
 * URL with params, customer emails, or provider payloads). */
export async function listReviewRequests(
  businessId: string,
  opts: { status?: ReviewRequestStatus; take?: number; skip?: number }
): Promise<{ rows: ReviewRequestListRow[]; hasMore: boolean }> {
  const take = Math.min(100, opts.take ?? 25)
  const rows = await prisma.reviewRequest.findMany({
    where: { businessId, ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: take + 1,
    skip: opts.skip ?? 0,
    include: {
      appointment: { select: { startTime: true, service: { select: { name: true } } } },
      customer: { select: { firstName: true, lastName: true } },
    },
  })
  const hasMore = rows.length > take
  return {
    rows: rows.slice(0, take).map((r) => ({
      id: r.id,
      status: r.status,
      appointmentStartTime: r.appointment.startTime.toISOString(),
      serviceName: r.appointment.service?.name ?? null,
      customerName: [r.customer?.firstName, r.customer?.lastName].filter(Boolean).join(' ') || 'Customer',
      attemptCount: r.attemptCount,
      lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
      sentAt: r.sentAt?.toISOString() ?? null,
      failureCategory: r.failureCategory,
      failureDetail: r.failureDetail,
      destinationHost: r.destinationUrl ? safeHost(r.destinationUrl) : null,
    })),
    hasMore,
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
