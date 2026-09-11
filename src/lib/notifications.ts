import { prisma } from '@/lib/prisma'
import { formatFullDate, formatTime } from '@/lib/utils'
import nodemailer from 'nodemailer'
import { sendSms, isTwilioConfigured, buildReminderMessage, buildConfirmationMessage } from '@/lib/twilio'
import { getSmtpFromAddress } from '@/lib/app-config'
import { isEmailEnabled, isSmsEnabled } from '@/lib/env-check'

// ============================================================================
// Notification System
// Email + SMS notifications for booking confirmation, reminders, and alerts.
// Email uses Nodemailer (SMTP). SMS uses Twilio REST API (no npm package).
// All notification attempts are logged to the NotificationLog table for
// delivery tracking. The owner dashboard can show which messages failed.
// ============================================================================

let transporter: nodemailer.Transporter | null = null

export function isEmailConfigured(): boolean {
  if (!isEmailEnabled()) return false
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM)
}

export function notificationStatus() {
  return {
    email: isEmailConfigured(),
    sms: isSmsEnabled() && isTwilioConfigured(),
  }
}

function getTransporter(): nodemailer.Transporter {
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
async function logNotification(params: {
  businessId?: string
  customerId?: string
  appointmentId?: string
  recipient: string
  channel: 'EMAIL' | 'SMS'
  type: 'BOOKING_CONFIRMATION' | 'BOOKING_REMINDER' | 'CANCELLATION_NOTICE' | 'RESCHEDULE_NOTICE' | 'CONTACT_FORM' | 'WAITLIST_NOTIFICATION' | 'REBOOKING_REMINDER' | 'MARKETING_CAMPAIGN'
  status: 'PENDING' | 'SENT' | 'FAILED'
  content?: string
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
        errorMessage: params.errorMessage || null,
        failureReason: params.errorMessage || null,
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
  if (!isEmailConfigured()) return { scheduled: 0, skipped: true, reason: 'Email notifications are not configured' }

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
        errorMessage: String(error),
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
        errorMessage: String(error),
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

  // Email reminder
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
      errorMessage: String(error),
    })
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
// Waitlist notifications
// Sent when a cancelled slot is offered to the top waitlist candidate.
// Includes a secure claim link so the customer can book the released slot.
// ============================================================================

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

  // Email
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
      errorMessage: String(error),
    })
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
