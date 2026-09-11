// ============================================================================
// Twilio SMS Service
// Uses the Twilio REST API directly via fetch — no npm package required.
// Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER
// environment variables to be set.
// ============================================================================

import { isSmsEnabled } from '@/lib/env-check'

export interface SmsResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Check if Twilio is configured (all required env vars present)
 */
export function isTwilioConfigured(): boolean {
  if (!isSmsEnabled()) return false
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  )
}

/**
 * Send an SMS message via the Twilio REST API.
 * Uses Basic auth with Account SID + Auth Token.
 *
 * @param to - Destination phone number in E.164 format (e.g. "+15551234567")
 * @param body - Message text (max 1600 chars per segment; 160 for non-segmented)
 */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_PHONE_NUMBER

  if (!accountSid || !authToken || !fromNumber) {
    return {
      success: false,
      error: 'Twilio not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER',
    }
  }

  // Normalize the "to" number to E.164 if it isn't already
  const normalizedTo = normalizePhoneForE164(to)
  if (!normalizedTo) {
    return { success: false, error: `Invalid phone number: ${to}` }
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: fromNumber,
        To: normalizedTo,
        Body: body,
      }).toString(),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Twilio SMS error:', data)
      return {
        success: false,
        error: data.message || `Twilio error ${response.status}`,
      }
    }

    return {
      success: true,
      messageId: data.sid,
    }
  } catch (error: any) {
    console.error('Twilio fetch error:', error)
    return {
      success: false,
      error: error.message || 'Network error sending SMS',
    }
  }
}

/**
 * Normalize a phone number to E.164 format.
 * Handles US numbers (adds +1 prefix if 10 digits), and passes through
 * numbers that already start with +.
 */
function normalizePhoneForE164(phone: string): string | null {
  // Strip all non-digit characters
  const digits = phone.replace(/\D/g, '')

  // Already has country code (starts with +)
  if (phone.startsWith('+') && digits.length >= 10) {
    return phone
  }

  // US number: 10 digits → +1XXXXXXXXXX
  if (digits.length === 10) {
    return `+1${digits}`
  }

  // US number with 1 prefix: 11 digits starting with 1
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }

  // International: assume it needs a + prefix
  if (digits.length > 10) {
    return `+${digits}`
  }

  return null
}

/**
 * Build an SMS reminder message for an appointment.
 * Keeps it concise — ideally under 160 chars for single-segment delivery.
 */
export function buildReminderMessage(opts: {
  businessName: string
  customerName: string
  service: string
  date: string
  time: string
  confirmationNumber: string
}): string {
  return `Reminder: ${opts.businessName} — ${opts.service} on ${opts.date} at ${opts.time}. Reply C or call to cancel. Conf# ${opts.confirmationNumber}`
}

/**
 * Build an SMS confirmation message for a new booking.
 */
export function buildConfirmationMessage(opts: {
  businessName: string
  customerName: string
  service: string
  date: string
  time: string
  confirmationNumber: string
}): string {
  return `Confirmed: ${opts.businessName} — ${opts.service} on ${opts.date} at ${opts.time}. See you then! Conf# ${opts.confirmationNumber}`
}
