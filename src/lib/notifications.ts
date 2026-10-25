import { prisma } from '@/lib/prisma'
import { formatFullDate, formatTime } from '@/lib/utils'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { sendSms, isTwilioConfigured, buildReminderMessage, buildConfirmationMessage } from '@/lib/twilio'
import { getSmtpFromAddress } from '@/lib/app-config'
import { getFeatureConfig, isEmailEnabled, isSmsEnabled } from '@/lib/env-check'

// ============================================================================
// Notification System
// Email + SMS notifications for booking confirmation, reminders, and alerts.
// Email uses Nodemailer (SMTP). SMS uses Twilio REST API (no npm package).
// All notification attempts are logged to the NotificationLog table for
// delivery tracking. The owner dashboard can show which messages failed.
// ============================================================================

let transporter: Transporter | null = null

export function isEmailConfigured(): boolean {
  return emailConfigurationIssue() === null
}

export function emailConfigurationIssue(): string | null {
  const config = getFeatureConfig('email')
  if (!config.enabled) return 'Email notifications are disabled (set EMAIL_ENABLED=true to enable)'
  if (!config.configured) {
    return `Email notifications are enabled but missing required configuration: ${config.missing.join(', ')}`
  }
  return null
}

export function notificationStatus() {
  return {
    email: isEmailConfigured(),
    sms: isSmsEnabled() && isTwilioConfigured(),
  }
}

function getTransporter(): Transporter {
  if (transporter) return transporter

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: parseInt(process.env.SMTP_PORT || '587') === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  return transporter
}

interface AppointmentWithRelations {
  id?: string
  confirmationNumber: string
  startTime: Date
  endTime: Date
  customer: { firstName: string; lastName: string; email: string; phone: string; smsConsent?: boolean }
  barber: { name: string }
  service: { name: string; duration: number; price: number }
  business: { name: string; phone: string | null; email: string | null; address: string | null; id?: string }
}

/**
 * Log a notification attempt to the database for delivery tracking.
 */
/**
 * Providers (SMTP/Twilio) can return verbose, multi-line errors that may
 * embed recipient PII or the message payload. Notification logs must stay
 * bounded and free of sensitive dumps: collapse whitespace and cap length.
 */
export function sanitizeErrorMessage(error: unknown, maxChars = 500): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error')
  return raw.replace(/\s+/g, ' ').trim().slice(0, maxChars) || 'Unknown error'
}

async function logNotification(params: {
  businessId?: string
  customerId?: string
  appointmentId?: string
  recipient: string
  channel: 'EMAIL' | 'SMS'
  type: 'BOOKING_CONFIRMATION' | 'BOOKING_REMINDER' | 'CANCELLATION_NOTICE' | 'RESCHEDULE_NOTICE' | 'CONTACT_FORM' | 'WAITLIST_NOTIFICATION' | 'REBOOKING_REMINDER' | 'MARKETING_CAMPAIGN' | 'STAFF_INVITE' | 'SHOP_ORDER_CONFIRMATION' | 'REVIEW_REQUEST'
  status: 'PENDING' | 'SENT' | 'FAILED'
  content?: string
  subject?: string
  errorMessage?: string
  providerMessageId?: string
  scheduledAt?: Date
  idempotencyKey?: string
  }) {
  try {
    const idempotencyKey = params.idempotencyKey || [params.appointmentId, params.type, params.channel, params.recipient].filter(Boolean).join(':')
    if (!idempotencyKey) return
    await prisma.notificationLog.upsert({
      where: { idempotencyKey },
  create: {
  businessId: params.businessId || null,
  customerId: params.customerId || null,
  appointmentId: params.appointmentId || null,
  recipient: params.recipient,
        channel: params.channel,
        type: params.type,
        status: params.status,
        content: params.content || null,
        subject: params.subject || null,
        errorMessage: params.errorMessage ? sanitizeErrorMessage(params.errorMessage) : null,
        failureReason: params.errorMessage ? sanitizeErrorMessage(params.errorMessage) : null,
        providerMessageId: params.providerMessageId || null,
        idempotencyKey,
        scheduledAt: params.scheduledAt || null,
        sentAt: params.status === 'SENT' ? new Date() : null,
      },
      update: params.status === 'SENT' ? {
        status: 'SENT', sentAt: new Date(), providerMessageId: params.providerMessageId || undefined,
      } : {},
    })
  } catch (error) {
    console.error('Failed to log notification:', error)
  }
}

/** Queue a customer notification through the shared, idempotent notification log. */
export async function queueCustomerNotification(params: {
  businessId: string
  customerId: string
  recipient: string
  channel: 'EMAIL' | 'SMS'
  type: 'REBOOKING_REMINDER' | 'WAITLIST_NOTIFICATION' | 'MARKETING_CAMPAIGN'
  content: string
  scheduledAt?: Date
  idempotencyKey: string
  smsConsent?: boolean
}) {
  if (params.channel === 'SMS' && (!params.recipient || !params.smsConsent)) {
    return { queued: false, reason: 'SMS consent or phone number is missing' }
  }

  await logNotification({
    businessId: params.businessId,
    customerId: params.customerId,
    recipient: params.recipient,
    channel: params.channel,
    type: params.type,
    status: 'PENDING',
    content: params.content,
    scheduledAt: params.scheduledAt,
    idempotencyKey: params.idempotencyKey,
  })

  return { queued: true }
}

export async function scheduleAppointmentReminders(appointment: AppointmentWithRelations, settings: {
  reminder24HoursEnabled?: boolean
  reminder2HoursEnabled?: boolean
  sameDayReminderEnabled?: boolean
} = {}) {
  const emailIssue = emailConfigurationIssue()
  if (emailIssue) return { scheduled: 0, skipped: true, reason: emailIssue }

  const reminders = [
    settings.reminder24HoursEnabled !== false ? { type: 'BOOKING_REMINDER' as const, hours: 24 } : null,
    settings.reminder2HoursEnabled !== false ? { type: 'BOOKING_REMINDER' as const, hours: 2 } : null,
    settings.sameDayReminderEnabled ? { type: 'BOOKING_REMINDER' as const, hours: 0 } : null,
  ].filter(Boolean) as Array<{ type: 'BOOKING_REMINDER'; hours: number }>

  await Promise.all(reminders.map((reminder) => logNotification({
  businessId: appointment.business.id,
  customerId: (appointment.customer as { id?: string }).id,
  appointmentId: appointment.id,
  recipient: appointment.customer.email,
    channel: 'EMAIL',
    type: reminder.type,
    status: 'PENDING',
    content: `Reminder: ${appointment.business.name} — ${appointment.service.name} on ${formatFullDate(appointment.startTime)} at ${formatTime(appointment.startTime)}. Confirmation #${appointment.confirmationNumber}`,
    scheduledAt: new Date(appointment.startTime.getTime() - reminder.hours * 60 * 60 * 1000),
    idempotencyKey: `${appointment.id}:REMINDER_${reminder.hours || 'SAME_DAY'}:EMAIL`,
  })))
} 

function hasSmsConsent(appointment: AppointmentWithRelations & { customer: { smsConsent?: boolean } }) {
  return Boolean(appointment.customer.phone && appointment.customer.smsConsent)
}

export async function sendBookingConfirmation(appointment: AppointmentWithRelations) {
  const dateStr = formatFullDate(appointment.startTime)
  const timeStr = formatTime(appointment.startTime)

  // Customer email
  const customerHtml = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1a1a1a;">Appointment Confirmed</h1>
      <p>Hi ${appointment.customer.firstName},</p>
      <p>Your appointment with <strong>${appointment.barber.name}</strong> is scheduled for:</p>
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>${appointment.service.name}</strong></p>
        <p style="margin: 5px 0;">${dateStr} at ${timeStr}</p>
        <p style="margin: 5px 0;">Barber: ${appointment.barber.name}</p>
        <p style="margin: 5px 0;">Duration: ${appointment.service.duration} minutes</p>
        <p style="margin: 5px 0; color: #666;">Payment: Pay in person at the barbershop.</p>
      </div>
      <p style="font-size: 14px; color: #666;">
        Confirmation #: <strong>${appointment.confirmationNumber}</strong><br/>
        Prices are subject to change. Payment is collected in person.
      </p>
      <p style="font-size: 14px; color: #666;">
        Need to reschedule or cancel? Use your confirmation number on our website.
      </p>
    </div>
  `

  // Barber email
  const barberHtml = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1a1a1a;">New Appointment</h1>
      <p>You have a new booking:</p>
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>${appointment.customer.firstName} ${appointment.customer.lastName}</strong></p>
        <p style="margin: 5px 0;">${appointment.service.name} — ${appointment.service.duration} min</p>
        <p style="margin: 5px 0;">${dateStr} at ${timeStr}</p>
        <p style="margin: 5px 0;">Phone: ${appointment.customer.phone}</p>
        <p style="margin: 5px 0;">Email: ${appointment.customer.email}</p>
        <p style="margin: 5px 0;">Confirmation #: ${appointment.confirmationNumber}</p>
      </div>
    </div>
  `

  // Email is optional and must never affect booking success.
  if (isEmailConfigured()) {
    try {
      const transport = getTransporter()
      await transport.sendMail({
        from: getSmtpFromAddress(),
        to: appointment.customer.email,
        subject: `Appointment Confirmed — ${appointment.business.name}`,
        html: customerHtml,
      })
      await logNotification({
        businessId: appointment.business.id,
        appointmentId: appointment.id,
        recipient: appointment.customer.email,
        channel: 'EMAIL',
        type: 'BOOKING_CONFIRMATION',
        status: 'SENT',
      })
    } catch (error) {
      console.error('Email notification error:', error)
      await logNotification({
        businessId: appointment.business.id,
        appointmentId: appointment.id,
        recipient: appointment.customer.email,
        channel: 'EMAIL',
        type: 'BOOKING_CONFIRMATION',
        status: 'FAILED',
        errorMessage: sanitizeErrorMessage(error),
      })
    }
  }

  // Send barber/shop notification email
  if (isEmailConfigured() && appointment.business.email) {
    try {
      const transport = getTransporter()
      await transport.sendMail({
        from: getSmtpFromAddress(),
        to: appointment.business.email,
        subject: `New Appointment: ${appointment.customer.firstName} ${appointment.customer.lastName}`,
        html: barberHtml,
      })
      await logNotification({
        businessId: appointment.business.id,
        appointmentId: appointment.id,
        recipient: appointment.business.email,
        channel: 'EMAIL',
        type: 'BOOKING_CONFIRMATION',
        status: 'SENT',
      })
    } catch (error) {
      console.error('Barber email notification error:', error)
      await logNotification({
        businessId: appointment.business.id,
        appointmentId: appointment.id,
        recipient: appointment.business.email,
        channel: 'EMAIL',
        type: 'BOOKING_CONFIRMATION',
        status: 'FAILED',
        errorMessage: sanitizeErrorMessage(error),
      })
    }
  }

  // Send SMS confirmation if Twilio is configured
  if (isTwilioConfigured() && hasSmsConsent(appointment)) {
    const smsBody = buildConfirmationMessage({
      businessName: appointment.business.name,
      customerName: appointment.customer.firstName,
      service: appointment.service.name,
      date: dateStr,
      time: timeStr,
      confirmationNumber: appointment.confirmationNumber,
    })
    const smsResult = await sendSms(appointment.customer.phone, smsBody)
    await logNotification({
      businessId: appointment.business.id,
      appointmentId: appointment.id,
      recipient: appointment.customer.phone,
      channel: 'SMS',
      type: 'BOOKING_CONFIRMATION',
      status: smsResult.success ? 'SENT' : 'FAILED',
      errorMessage: smsResult.success ? undefined : smsResult.error,
    })
  }
}

export async function sendAppointmentReminder(appointment: AppointmentWithRelations, hoursBefore: number) {
  const dateStr = formatFullDate(appointment.startTime)
  const timeStr = formatTime(appointment.startTime)
  const reminderText =
    hoursBefore === 24
      ? `Reminder: You have an appointment tomorrow at ${timeStr}.`
      : `Reminder: Your barber appointment is coming up at ${timeStr}.`

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Appointment Reminder</h2>
      <p>${reminderText}</p>
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>${appointment.service.name}</strong></p>
        <p style="margin: 5px 0;">${dateStr}</p>
        <p style="margin: 5px 0;">Barber: ${appointment.barber.name}</p>
        <p style="margin: 5px 0;">Confirmation #: ${appointment.confirmationNumber}</p>
      </div>
    </div>
  `

  const emailIssue = emailConfigurationIssue()
  if (emailIssue && isEmailEnabled()) {
    await logNotification({
      businessId: appointment.business.id,
      appointmentId: appointment.id,
      recipient: appointment.customer.email,
      channel: 'EMAIL',
      type: 'BOOKING_REMINDER',
      status: 'FAILED',
      errorMessage: emailIssue,
    })
  } else if (!emailIssue) {
    try {
      const transport = getTransporter()
      await transport.sendMail({
        from: getSmtpFromAddress(),
        to: appointment.customer.email,
        subject: `Appointment Reminder — ${appointment.business.name}`,
        html,
      })
      await logNotification({
        businessId: appointment.business.id,
        appointmentId: appointment.id,
        recipient: appointment.customer.email,
        channel: 'EMAIL',
        type: 'BOOKING_REMINDER',
        status: 'SENT',
      })
    } catch (error) {
      console.error('Reminder email error:', error)
      await logNotification({
        businessId: appointment.business.id,
        appointmentId: appointment.id,
        recipient: appointment.customer.email,
        channel: 'EMAIL',
        type: 'BOOKING_REMINDER',
        status: 'FAILED',
        errorMessage: sanitizeErrorMessage(error),
      })
    }
  }

  // SMS reminder if Twilio is configured
  if (isTwilioConfigured() && hasSmsConsent(appointment)) {
    const smsBody = buildReminderMessage({
      businessName: appointment.business.name,
      customerName: appointment.customer.firstName,
      service: appointment.service.name,
      date: dateStr,
      time: timeStr,
      confirmationNumber: appointment.confirmationNumber,
    })
    const smsResult = await sendSms(appointment.customer.phone, smsBody)
    await logNotification({
      businessId: appointment.business.id,
      appointmentId: appointment.id,
      recipient: appointment.customer.phone,
      channel: 'SMS',
      type: 'BOOKING_REMINDER',
      status: smsResult.success ? 'SENT' : 'FAILED',
      errorMessage: smsResult.success ? undefined : smsResult.error,
    })
  }
}

/**
 * Send an SMS reminder to a customer.
 * Now uses real Twilio instead of a stub.
 */
export async function sendSmsReminder(phone: string, message: string) {
  if (!isTwilioConfigured()) {
    console.warn(`[SMS not configured] — notification skipped`)
    await logNotification({
      recipient: phone,
      channel: 'SMS',
      type: 'BOOKING_REMINDER',
      status: 'FAILED',
      errorMessage: 'Twilio not configured',
    })
    return
  }

  const result = await sendSms(phone, message)
  await logNotification({
    recipient: phone,
    channel: 'SMS',
    type: 'BOOKING_REMINDER',
    status: result.success ? 'SENT' : 'FAILED',
    errorMessage: result.success ? undefined : result.error,
  })
}

// ============================================================================

// ============================================================================
// Staff invitation HTML — responsive, dark-and-gold branded email that
// matches the shop's dashboard aesthetic. All values interpolated here are
// validated server-side (name/email from the invite form schema,
// businessName from the authenticated session, inviteUrl built from the
// canonical app URL). Only the single-use invitation token travels in the
// link — no credentials beyond the optional temp password.
// ============================================================================

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderStaffInviteHtml(params: {
  businessName: string
  name: string
  roleLabel: string
  inviteUrl: string
  tempPassword: string
}): string {
  const shop = escapeHtml(params.businessName)
  const name = escapeHtml(params.name)
  const role = escapeHtml(params.roleLabel)
  const safeUrl = escapeHtml(params.inviteUrl)
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>You're invited to join ${shop}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#0c0a09;-webkit-text-size-adjust:100%;">
    <div role="presentation" style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background-color:#1c1917;border:1px solid #3f3f46;border-radius:12px;overflow:hidden;">
        <div style="background-color:#0c0a09;padding:28px 32px;border-bottom:1px solid #3f3f46;text-align:center;">
          <p style="margin:0;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#d4a853;font-family:Georgia,serif;">
            ${shop}
          </p>
        </div>
        <div style="padding:32px;color:#e7e5e4;font-family:Georgia,serif;">
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#fafaf9;font-weight:600;">
            You're invited to join ${shop}
          </h1>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#d6d3d1;">
            Hi ${name},
          </p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#d6d3d1;">
            You've been invited to join <strong style="color:#fafaf9;">${shop}</strong> as a
            <strong style="color:#d4a853;">${role}</strong>.
          </p>
          <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#a8a29e;">
            Your account will give you access to the tools and features assigned to your role within the barbershop.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;width:100%;">
            <tr>
              <td style="text-align:center;">
                <a href="${safeUrl}"
                   style="display:inline-block;background-color:#d4a853;color:#1c1917;font-family:Georgia,serif;font-size:16px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;">
                  Accept Your Invitation
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#78716c;">
            This invitation expires after 7 days and can only be used once.
            If you weren't expecting this invitation, you can safely ignore this email.
          </p>
        </div>
        <div style="background-color:#0c0a09;padding:20px 32px;border-top:1px solid #3f3f46;">
          <p style="margin:0;font-size:13px;color:#78716c;font-family:Georgia,serif;">
            Best regards,<br />The ${shop} Team
          </p>
        </div>
      </div>
    </div>
  </body>
</html>`
}

// Staff invite notification
// Best-effort delivery of temporary credentials when SMTP is configured.
// The API response still returns the temp password to the inviting owner,
// so a failed/absent email never blocks the invite.
// ============================================================================

export async function sendStaffInviteEmail(params: {
  businessId: string
  businessName: string
  to: string
  name: string
  tempPassword: string
  loginUrl: string
  /** Invited role identifier ('BARBER' | 'BUSINESS_ADMIN'); rendered as a friendly label. */
  role?: string
}): Promise<boolean> {
  const emailIssue = emailConfigurationIssue()
  if (emailIssue) {
    if (isEmailEnabled()) {
      await logNotification({
        businessId: params.businessId,
        recipient: params.to,
        channel: 'EMAIL',
        type: 'STAFF_INVITE',
        status: 'FAILED',
        errorMessage: emailIssue,
      })
    }
    return false
  }
  try {
    const transport = getTransporter()
    const roleLabel = params.role === 'BUSINESS_ADMIN' ? 'Co-owner' : params.role === 'BARBER' ? 'Barber' : 'team member'
    const html = renderStaffInviteHtml({
      businessName: params.businessName,
      name: params.name,
      roleLabel,
      inviteUrl: params.loginUrl,
      tempPassword: params.tempPassword,
    })
    await transport.sendMail({
      from: getSmtpFromAddress(),
      to: params.to,
      subject: `You're invited to join ${params.businessName}`,
      text: [
        `Hi ${params.name},`,
        ``,
        `You've been invited to join ${params.businessName} as a ${roleLabel}.`,
        ``,
        params.tempPassword
          ? `Sign in here: ${params.loginUrl}`
          : `Accept your invitation and set your password here: ${params.loginUrl}`,
        `Email: ${params.to}`,
        ...(params.tempPassword ? [`Temporary password: ${params.tempPassword}`] : []),
        ``,
        `You'll be asked to set your own password the first time you sign in.`,
        ``,
        `If you weren't expecting this invite, you can ignore this email.`,
      ].join('\n'),
      html,
    })
    await logNotification({
      businessId: params.businessId,
      recipient: params.to,
      channel: 'EMAIL',
      type: 'STAFF_INVITE',
      status: 'SENT',
    })
    return true
  } catch (error) {
    console.error('staff invite email failed:', sanitizeErrorMessage(error))
    await logNotification({
      businessId: params.businessId,
      recipient: params.to,
      channel: 'EMAIL',
      type: 'STAFF_INVITE',
      status: 'FAILED',
      errorMessage: sanitizeErrorMessage(error),
    })
    return false
  }
}

// ============================================================================
// Waitlist notifications
// Sent when a cancelled slot is offered to the top waitlist candidate.
// Includes a secure claim link so the customer can book the released slot.
// ============================================================================

/**
 * Gift card delivery email — sent when an online purchase is activated by
 * the payment webhook (digital cards). Best-effort: returns false when
 * email is not configured, and the caller swallows errors so a mail
 * outage never blocks card activation.
 */
export async function sendGiftCardDeliveryEmail(params: {
  to: string
  businessName: string
  purchaserName: string
  recipientName?: string | null
  code: string
  amount: number
  expiresAt?: Date | null
  message?: string | null
}): Promise<boolean> {
  if (!isEmailConfigured()) return false
  if (!params.to) return false

  const expiry = params.expiresAt
    ? formatFullDate(params.expiresAt)
    : null
  const greetingName = params.recipientName?.trim() || params.purchaserName

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1a1a1a;">Your Gift Card is Ready</h1>
      <p>Hi ${greetingName},</p>
      <p>Here is your gift card for <strong>${params.businessName}</strong>:</p>
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
        <p style="font-size: 24px; letter-spacing: 2px; margin: 5px 0;"><strong>${params.code}</strong></p>
        <p style="margin: 5px 0;">Value: <strong>$${params.amount.toFixed(2)}</strong></p>
        ${expiry ? `<p style="margin: 5px 0; color: #666;">Expires: ${expiry}</p>` : ''}
      </div>
      ${params.message?.trim() ? `<div style="border-left: 3px solid #ccc; padding-left: 12px; margin: 16px 0; font-style: italic;">"${params.message.replace(/</g, '&lt;')}"</div>` : ''}
      <p style="font-size: 14px; color: #666;">
        To use it, simply give the code at checkout. See you soon!
      </p>
    </div>
  `

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: params.to,
    subject: `Your ${params.businessName} gift card`,
    html,
  })
  return true
}

export async function sendWaitlistSlotNotification(params: {
  businessId?: string
  entryId: string
  customer: { firstName: string; lastName: string; email: string; phone: string }
  service: { name: string; duration: number }
  barber: { name: string }
  slotStart: Date
  slotEnd: Date
  claimToken: string
  claimUrl: string
  business: { name: string; phone: string | null; email: string | null }
}): Promise<void> {
  const dateStr = formatFullDate(params.slotStart)
  const timeStr = formatTime(params.slotStart)
  const holdMinutes = 15

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1a1a1a;">A Slot Just Opened Up!</h1>
      <p>Hi ${params.customer.firstName},</p>
      <p>Good news — an appointment slot just became available that matches your waitlist request:</p>
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>${params.service.name}</strong></p>
        <p style="margin: 5px 0;">${dateStr} at ${timeStr}</p>
        <p style="margin: 5px 0;">Barber: ${params.barber.name}</p>
      </div>
      <p>This slot is held for you for <strong>${holdMinutes} minutes</strong>. Click below to claim it:</p>
      <a href="${params.claimUrl}" style="display: inline-block; background: #1a1a1a; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 10px 0;">Claim This Slot</a>
      <p style="font-size: 14px; color: #666;">If you no longer need an appointment, you can ignore this email.</p>
    </div>
  `

  const emailIssue = emailConfigurationIssue()
  if (emailIssue && isEmailEnabled()) {
    await logNotification({
      businessId: params.businessId,
      recipient: params.customer.email,
      channel: 'EMAIL',
      type: 'WAITLIST_NOTIFICATION',
      status: 'FAILED',
      errorMessage: emailIssue,
    })
  } else if (!emailIssue) {
    try {
      const transport = getTransporter()
      await transport.sendMail({
        from: getSmtpFromAddress(),
        to: params.customer.email,
        subject: `Slot Available — ${params.business.name}`,
        html,
      })
      await logNotification({
        businessId: params.businessId,
        recipient: params.customer.email,
        channel: 'EMAIL',
        type: 'WAITLIST_NOTIFICATION',
        status: 'SENT',
      })
    } catch (error) {
      console.error('Waitlist email error:', error)
      await logNotification({
        businessId: params.businessId,
        recipient: params.customer.email,
        channel: 'EMAIL',
        type: 'WAITLIST_NOTIFICATION',
        status: 'FAILED',
        errorMessage: sanitizeErrorMessage(error),
      })
    }
  }

  // SMS for waitlist notification
  if (isTwilioConfigured() && params.customer.phone) {
    const smsBody = `${params.business.name}: A slot opened for ${params.service.name} on ${dateStr} at ${timeStr}. You have ${holdMinutes} min to claim: ${params.claimUrl}`
    const smsResult = await sendSms(params.customer.phone, smsBody)
    await logNotification({
      businessId: params.businessId,
      recipient: params.customer.phone,
      channel: 'SMS',
      type: 'WAITLIST_NOTIFICATION',
      status: smsResult.success ? 'SENT' : 'FAILED',
      errorMessage: smsResult.success ? undefined : smsResult.error,
    })
  }
}

// ============================================================================
// Shop order confirmation (transactional email)
// ============================================================================

interface OrderEmailItem {
  name: string
  quantity: number
  price: number
}

/**
 * Order confirmation email, sent when a shop order's payment settles
 * (webhook → markOrderPaidForPayment). The webhook handler fires this
 * AFTER the PAID transition commits and never lets an email failure break
 * the payment flow. Idempotency: callers pass a NotificationLog idempotency
 * key (the order id) so webhook retries cannot double-send.
 */
export async function sendOrderConfirmationEmail(params: {
  businessId: string
  to: string
  businessName: string
  orderNumber: string
  items: OrderEmailItem[]
  subtotal: number
  shippingAmount: number
  taxAmount: number
  total: number
  currency?: string
}): Promise<boolean> {
  if (!isEmailConfigured()) return false
  if (!params.to?.trim()) return false

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const sym = params.currency === 'USD' || !params.currency ? '$' : `${params.currency} `
  const money = (n: number) => `${sym}${n.toFixed(2)}`

  const rows = params.items
    .map(
      (i) =>
        `<tr><td style="padding: 6px 0; border-bottom: 1px solid #eee;">${esc(i.name)} × ${i.quantity}</td><td style="padding: 6px 0; border-bottom: 1px solid #eee; text-align: right;">${money(i.price * i.quantity)}</td></tr>`
    )
    .join('')

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1a1a1a;">Order ${esc(params.orderNumber)} confirmed</h1>
      <p>Thanks for your order at <strong>${esc(params.businessName)}</strong>. Here's your receipt:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        ${rows}
        <tr><td style="padding: 6px 0; text-align: right; color: #666;">Subtotal</td><td style="padding: 6px 0; text-align: right;">${money(params.subtotal)}</td></tr>
        ${params.shippingAmount > 0 ? `<tr><td style="padding: 6px 0; text-align: right; color: #666;">Shipping</td><td style="padding: 6px 0; text-align: right;">${money(params.shippingAmount)}</td></tr>` : ''}
        ${params.taxAmount > 0 ? `<tr><td style="padding: 6px 0; text-align: right; color: #666;">Tax</td><td style="padding: 6px 0; text-align: right;">${money(params.taxAmount)}</td></tr>` : ''}
        <tr><td style="padding: 12px 0 0; text-align: right; font-weight: bold;">Total</td><td style="padding: 12px 0 0; text-align: right; font-weight: bold;">${money(params.total)}</td></tr>
      </table>
      <p style="font-size: 14px; color: #666;">If you have questions about this order, reply to this email or contact the shop.</p>
    </div>
  `

  await logNotification({
    businessId: params.businessId,
    recipient: params.to,
    channel: 'EMAIL',
    type: 'SHOP_ORDER_CONFIRMATION',
    status: 'SENT',
    idempotencyKey: `${params.orderNumber}:ORDER_CONFIRMED`,
  })

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: params.to,
    subject: `Your ${params.businessName} order ${params.orderNumber}`,
    html,
  })
  return true
}

// ─── Prompt 9: review request email ──────────────────────────────────────────

/** Send a post-visit review request through the shared SMTP transport.
 * Returns the provider message id (for the durable queue) or null.
 * Idempotency-keyed in the shared notification log for observability. */
export async function sendReviewRequestEmail(params: {
  businessId: string
  to: string
  subject: string
  html: string
  idempotencyKey: string
}): Promise<string | null> {
  if (!isEmailConfigured()) throw new Error('Email notifications are not configured')
  if (!params.to?.trim()) throw new Error('Missing recipient email address')

  const info = await getTransporter().sendMail({
    from: getSmtpFromAddress(),
    to: params.to,
    subject: params.subject,
    html: params.html,
    // nodemailer's message-id doubles as the provider message id.
    headers: { 'X-Entity-Ref': params.idempotencyKey },
  })

  await logNotification({
    businessId: params.businessId,
    recipient: params.to,
    channel: 'EMAIL',
    type: 'REVIEW_REQUEST',
    status: 'SENT',
    idempotencyKey: `${params.idempotencyKey}:SENT`,
    providerMessageId: info.messageId || undefined,
  })
  return info.messageId || null
}
