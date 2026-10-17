import crypto from 'node:crypto'
import nodemailer from 'nodemailer'
import { sendSms, isTwilioConfigured } from '@/lib/twilio'
import { getFeatureConfig } from '@/lib/env-check'

export const PORTAL_SESSION_COOKIE = 'barber_portal_session'
export const PORTAL_CODE_TTL_MS = 10 * 60 * 1000
export const PORTAL_SESSION_TTL_MS = 30 * 60 * 1000
export const PORTAL_MAX_ATTEMPTS = 5

export function normalizeContact(email?: string, phone?: string) {
  if (email?.trim()) return { value: email.trim().toLowerCase(), channel: 'EMAIL' as const }
  if (phone?.trim()) return { value: phone.replace(/\D/g, ''), channel: 'SMS' as const }
  return null
}

export function hashValue(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function createCode() { return String(crypto.randomInt(100000, 1000000)) }
export function createToken() { return crypto.randomBytes(32).toString('hex') }

export async function sendPortalCode(channel: 'EMAIL' | 'SMS', recipient: string, code: string, businessName: string) {
  const message = `Your ${businessName} appointment portal verification code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this message.`
  if (channel === 'SMS') return isTwilioConfigured() ? sendSms(recipient, message) : { success: false, error: 'SMS unavailable' }
  const email = getFeatureConfig('email')
  if (!email.enabled) return { success: false, error: 'Email notifications are disabled' }
  if (!email.configured) return { success: false, error: `Email notifications are enabled but missing required configuration: ${email.missing.join(', ')}` }
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT || 587) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
  await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: recipient, subject: `${businessName} verification code`, text: message })
  return { success: true }
}
