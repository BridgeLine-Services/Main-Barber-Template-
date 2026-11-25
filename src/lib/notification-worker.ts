import { prisma } from '@/lib/prisma'
import { isFeatureEnabled } from '@/lib/features'
import nodemailer from 'nodemailer'
import { isTwilioConfigured, sendSms } from '@/lib/twilio'
import { getSmtpFromAddress } from '@/lib/app-config'
import { emailConfigurationIssue, sanitizeErrorMessage } from '@/lib/notifications'
import {
  buildOrganizationInvitationEmail,
  invitationDeliveryRetry,
} from '@/lib/organization/invitation-delivery'
import { buildConfigAuditEntry } from '@/lib/organization/config-audit'
import { organizationReportDeliveryRetry } from '@/lib/organization/report-delivery'

type EmailMessage = { from: string; to: string; subject: string; text: string; html?: string }
type EmailSender = (message: EmailMessage) => Promise<{ messageId?: string } | void>

async function recordOrganizationReportOutcome(
  configurationId: string | null,
  status: 'SENT' | 'RETRYING' | 'FAILED' | 'CANCELLED',
  error?: string,
  previousStatus: 'PENDING' | 'RETRYING' = 'PENDING',
) {
  if (!configurationId) return
  try {
    const deliveredAt = new Date()
    const configuration = await prisma.organizationReportingConfiguration.update({
      where: { id: configurationId },
      data: {
        lastDeliveryStatus: status,
        lastDeliveryAt: deliveredAt,
        lastDeliveryError: status === 'SENT' ? null : error ?? 'Email delivery failed.',
      },
      select: { organizationId: true },
    })
    await prisma.organizationConfigAudit.create({
      data: buildConfigAuditEntry({
        organizationId: configuration.organizationId,
        actorId: null,
        action: `organization-report.delivery.${status.toLowerCase()}`,
        entity: 'OrganizationReportingConfiguration',
        entityId: configurationId,
        summary: status === 'SENT'
          ? 'Scheduled organization report email was delivered.'
          : status === 'RETRYING'
            ? 'Scheduled organization report email delivery will be retried.'
            : status === 'CANCELLED'
              ? 'Scheduled organization report email was cancelled before delivery.'
              : 'Scheduled organization report email delivery failed.',
        previousValue: { status: previousStatus },
        newValue: { status },
        at: deliveredAt.toISOString(),
      }),
    })
  } catch {
    console.error('[notification-worker] could not record organization report delivery outcome')
  }
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
}

/** Claims and delivers due notifications. The PROCESSING transition is atomic,
 * so concurrent cron invocations cannot send the same row. */
export async function processDueNotifications(
  limit = 50,
  dependencies: { sendEmail?: EmailSender; notificationIds?: string[]; notificationType?: 'ORGANIZATION_INVITATION' | 'ORGANIZATION_REPORT' } = {},
) {
  const now = new Date()

  // Crash recovery: if a worker died mid-send, its claimed rows are stuck
  // in PROCESSING forever. Re-queue claims that have gone stale so the
  // notification is retried on the next cron run instead of being lost.
  const staleCutoff = new Date(now.getTime() - 15 * 60 * 1000)
  const requeued = await prisma.notificationLog.updateMany({
    where: {
      status: 'PROCESSING',
      updatedAt: { lt: staleCutoff },
      sentAt: null,
      ...(dependencies.notificationIds ? { id: { in: dependencies.notificationIds } } : {}),
      ...(dependencies.notificationType ? { type: dependencies.notificationType } : {}),
    },
    data: { status: 'PENDING' },
  })
  if (requeued.count > 0) {
    console.warn(`[notification-worker] re-queued ${requeued.count} stale PROCESSING notification(s)`)
  }

  const pending = await prisma.notificationLog.findMany({
    where: {
      status: 'PENDING',
      scheduledAt: { lte: now },
      ...(dependencies.notificationIds ? { id: { in: dependencies.notificationIds } } : {}),
      ...(dependencies.notificationType ? { type: dependencies.notificationType } : {}),
    },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
    select: { id: true, type: true },
  })

  // Channel switches, resolved once per run. A shop that has SMS or email switched off
  // must not have messages sent on its behalf. Queued rows are marked with the reason
  // rather than deleted, so the owner can see what did not go out and why.
  const channelBusinesses = await prisma.business.findMany({
    select: { id: true, featureOverrides: true },
  })
  const channelAllowed = new Map<string, { sms: boolean; email: boolean }>()
  for (const b of channelBusinesses) {
    channelAllowed.set(b.id, {
      sms: isFeatureEnabled(b, 'smsNotifications'),
      email: isFeatureEnabled(b, 'emailNotifications'),
    })
  }

  let sent = 0
  let failed = 0
  let retrying = 0
  for (const row of pending) {
    const claimed = await prisma.notificationLog.updateMany({ // perf-ok: bounded claim-and-send worker (take: limit); per-row CAS is required for claim semantics
      where: { id: row.id, status: 'PENDING' },
      data: {
        status: 'PROCESSING',
        ...(['ORGANIZATION_INVITATION', 'ORGANIZATION_REPORT'].includes(row.type) ? { attemptCount: { increment: 1 } } : {}),
      },
    })
    if (claimed.count !== 1) continue

    const notification = await prisma.notificationLog.findUnique({
      where: { id: row.id },
      include: {
        customer: { select: { smsConsent: true, marketingSmsConsent: true, smsOptedOutAt: true, emailOptOut: true } },
        organizationReportingConfiguration: { select: { enabled: true, recipients: true } },
      },
    }) // perf-ok: bounded claim-and-send worker (take: limit); per-row CAS is required for claim semantics
    if (!notification) continue

    if (notification.type === 'ORGANIZATION_REPORT') {
      const configuration = notification.organizationReportingConfiguration
      if (!configuration?.enabled || !configuration.recipients.includes(notification.recipient)) {
        const message = 'The report schedule changed before delivery; this email was cancelled.'
        await prisma.notificationLog.update({
          where: { id: row.id },
          data: { status: 'FAILED', errorMessage: message, failureReason: message },
        })
        await recordOrganizationReportOutcome(
          notification.organizationReportingConfigurationId,
          'CANCELLED',
          message,
          notification.attemptCount > 1 ? 'RETRYING' : 'PENDING',
        )
        failed++
        continue
      }
    }

    // Honour the shop's channel switches before any provider is called.
    const allowed = notification.businessId ? channelAllowed.get(notification.businessId) : undefined
    if (allowed) {
      const switchedOff = notification.channel === 'SMS' ? !allowed.sms : !allowed.email
      if (switchedOff) {
        await prisma.notificationLog.update({
          where: { id: row.id },
          data: {
            status: 'FAILED',
            failureReason: notification.channel === 'SMS'
              ? 'Text messages are switched off for this shop'
              : 'Emails are switched off for this shop',
          },
        })
        continue
      }
    }
    try {
      if ((notification.channel === 'SMS' &&
          (!notification.customer || notification.customer.smsOptedOutAt ||
            (notification.type === 'MARKETING_CAMPAIGN' ? !notification.customer.marketingSmsConsent : !notification.customer.smsConsent))) ||
        (notification.type === 'MARKETING_CAMPAIGN' && notification.channel === 'EMAIL' && notification.customer?.emailOptOut)) {
        await prisma.notificationLog.update({ where: { id: row.id }, data: { status: 'FAILED', failureReason: 'Consent withdrawn before delivery' } })
        continue
      }
      if (notification.channel === 'SMS') {
        if (!isTwilioConfigured()) {
          await prisma.notificationLog.update({ where: { id: row.id }, data: { status: 'FAILED', errorMessage: 'SMS notifications are not configured', failureReason: 'SMS notifications are not configured' } }) // perf-ok: bounded claim-and-send worker (take: limit); per-row CAS is required for claim semantics
          continue
        }
        const result = await sendSms(notification.recipient, notification.content || '')
        if (!result.success) throw new Error(result.error || 'SMS delivery failed')
        await prisma.notificationLog.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), providerMessageId: result.messageId || null } }) // perf-ok: bounded claim-and-send worker (take: limit); per-row CAS is required for claim semantics
      } else {
        const emailIssue = emailConfigurationIssue()
        if (emailIssue && !dependencies.sendEmail) {
          await prisma.notificationLog.update({
            where: { id: row.id },
            data: {
              status: 'FAILED',
              errorMessage: emailIssue,
              failureReason: emailIssue,
              ...(notification.type === 'ORGANIZATION_INVITATION' ? { content: null } : {}),
            },
          }) // perf-ok: bounded claim-and-send worker (take: limit); per-row CAS is required for claim semantics
          if (notification.type === 'ORGANIZATION_REPORT') {
            await recordOrganizationReportOutcome(
              notification.organizationReportingConfigurationId,
              'FAILED',
              emailIssue,
            )
            failed++
          }
          continue
        }
        const from = getSmtpFromAddress()
        let message: EmailMessage = {
          from,
          to: notification.recipient,
          subject: notification.subject || 'Message from your barber',
          text: notification.content || '',
        }
        if (notification.type === 'ORGANIZATION_INVITATION') {
          const invitationEmail = await buildOrganizationInvitationEmail({
            idempotencyKey: notification.idempotencyKey,
            recipient: notification.recipient,
            encryptedContent: notification.content,
          })
          if (!invitationEmail) {
            await prisma.notificationLog.update({
              where: { id: row.id },
              data: {
                status: 'FAILED',
                content: null,
                errorMessage: 'This invitation is no longer active, so its email was not sent.',
                failureReason: 'This invitation is no longer active, so its email was not sent.',
              },
            })
            failed++
            continue
          }
          message = { from, ...invitationEmail }
        }
        const sendEmail = dependencies.sendEmail ?? ((email: EmailMessage) => getTransporter().sendMail(email))
        const providerResult = await sendEmail(message)
        await prisma.notificationLog.update({
          where: { id: row.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            providerMessageId: providerResult && typeof providerResult === 'object' ? providerResult.messageId || null : null,
            ...(notification.type === 'ORGANIZATION_INVITATION' ? { content: null } : {}),
            errorMessage: null,
            failureReason: null,
          },
        }) // perf-ok: bounded claim-and-send worker (take: limit); per-row CAS is required for claim semantics
        if (notification.type === 'ORGANIZATION_REPORT') {
          await recordOrganizationReportOutcome(
            notification.organizationReportingConfigurationId,
            'SENT',
            undefined,
            notification.attemptCount > 1 ? 'RETRYING' : 'PENDING',
          )
        }
      }
      sent++
    } catch (error) {
      if (notification.type === 'ORGANIZATION_REPORT') {
        const retry = organizationReportDeliveryRetry(notification.attemptCount, error)
        const status = retry.retryAt ? 'PENDING' : 'FAILED'
        await prisma.notificationLog.update({
          where: { id: row.id },
          data: {
            status,
            scheduledAt: retry.retryAt ?? notification.scheduledAt,
            errorMessage: retry.message,
            failureReason: retry.message,
          },
        })
        await recordOrganizationReportOutcome(
          notification.organizationReportingConfigurationId,
          retry.retryAt ? 'RETRYING' : 'FAILED',
          retry.message,
          notification.attemptCount > 1 ? 'RETRYING' : 'PENDING',
        )
        if (retry.retryAt) retrying++
        else failed++
        continue
      }
      if (notification.type === 'ORGANIZATION_INVITATION') {
        const retry = invitationDeliveryRetry(notification.attemptCount, error)
        await prisma.notificationLog.update({
          where: { id: row.id },
          data: {
            status: retry.retryAt ? 'PENDING' : 'FAILED',
            scheduledAt: retry.retryAt ?? notification.scheduledAt,
            errorMessage: retry.message,
            failureReason: retry.message,
            ...(retry.retryAt ? {} : { content: null }),
          },
        })
        if (!retry.retryAt) failed++
        continue
      }
      const message = sanitizeErrorMessage(error) || 'Notification delivery failed'
      await prisma.notificationLog.update({ where: { id: row.id }, data: { status: 'FAILED', errorMessage: message, failureReason: message } }) // perf-ok: bounded claim-and-send worker (take: limit); per-row CAS is required for claim semantics
      failed++
    }
  }
  return { checked: pending.length, sent, failed, retrying, requeued: requeued.count }
}
