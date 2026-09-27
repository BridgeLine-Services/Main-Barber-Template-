import { prisma } from '@/lib/prisma'
import nodemailer from 'nodemailer'
import { isTwilioConfigured, sendSms } from '@/lib/twilio'
import { getSmtpFromAddress } from '@/lib/app-config'
import { isEmailConfigured, sanitizeErrorMessage } from '@/lib/notifications'

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
export async function processDueNotifications(limit = 50) {
  const now = new Date()

  // Crash recovery: if a worker died mid-send, its claimed rows are stuck
  // in PROCESSING forever. Re-queue claims that have gone stale so the
  // notification is retried on the next cron run instead of being lost.
  const staleCutoff = new Date(now.getTime() - 15 * 60 * 1000)
  const requeued = await prisma.notificationLog.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: staleCutoff }, sentAt: null },
    data: { status: 'PENDING' },
  })
  if (requeued.count > 0) {
    console.warn(`[notification-worker] re-queued ${requeued.count} stale PROCESSING notification(s)`)
  }

  const pending = await prisma.notificationLog.findMany({
    where: { status: 'PENDING', scheduledAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
    select: { id: true },
  })

  let sent = 0
  let failed = 0
  for (const row of pending) {
    const claimed = await prisma.notificationLog.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    })
    if (claimed.count !== 1) continue

    const notification = await prisma.notificationLog.findUnique({ where: { id: row.id } })
    if (!notification) continue
    try {
      if (notification.channel === 'SMS') {
        if (!isTwilioConfigured()) {
          await prisma.notificationLog.update({ where: { id: row.id }, data: { status: 'FAILED', errorMessage: 'SMS notifications are not configured', failureReason: 'SMS notifications are not configured' } })
          continue
        }
        const result = await sendSms(notification.recipient, notification.content || '')
        if (!result.success) throw new Error(result.error || 'SMS delivery failed')
        await prisma.notificationLog.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), providerMessageId: result.messageId || null } })
      } else {
        await getTransporter().sendMail({ from: getSmtpFromAddress(), to: notification.recipient, subject: 'Message from your barber', text: notification.content || '' })
        await prisma.notificationLog.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date() } })
      }
      sent++
    } catch (error) {
      const message = sanitizeErrorMessage(error) || 'Notification delivery failed'
      await prisma.notificationLog.update({ where: { id: row.id }, data: { status: 'FAILED', errorMessage: message, failureReason: message } })
      failed++
    }
  }
  return { checked: pending.length, sent, failed, requeued: requeued.count }
}
