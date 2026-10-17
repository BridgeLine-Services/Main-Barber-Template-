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
