import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normalizePhoneForE164, SMS_CONSENT_DISCLOSURES, sendSms } from '@/lib/twilio'

export const runtime = 'nodejs'

function twiml(message: string) {
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return new NextResponse(`<Response><Message>${escaped}</Message></Response>`, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

function isValidTwilioSignature(requestUrl: string, params: URLSearchParams, signature: string | null) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken || !signature) return false
  const payload = requestUrl + [...params.keys()].sort().map((key) => key + params.get(key)).join('')
  const expected = createHmac('sha1', authToken).update(payload).digest('base64')
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export async function POST(request: Request) {
  const body = await request.text()
  const params = new URLSearchParams(body)
  if (!isValidTwilioSignature(new URL(request.url).toString(), params, request.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }

  const from = normalizePhoneForE164(params.get('From') || '')
  const to = normalizePhoneForE164(params.get('To') || '')
  const message = (params.get('Body') || '').trim().toUpperCase()
  if (!from || !to) return twiml('We could not identify this phone number. Please contact the business directly.')

  const business = await prisma.business.findFirst({ where: { phone: to }, select: { id: true, name: true } })
  const customer = business
    ? await prisma.customer.findFirst({ where: { businessId: business.id, phone: from }, select: { id: true, phone: true, smsConsent: true, marketingSmsConsent: true } })
    : null
  if (!business || !customer) return twiml('We could not match this number. Please contact the business directly.')

  const providerEventId = params.get('MessageSid') || params.get('SmsSid') || null
  const action = message === 'STOP' || message === 'UNSUBSCRIBE' || message === 'CANCEL' || message === 'END' || message === 'QUIT'
    ? 'STOP'
    : message === 'START' || message === 'UNSTOP' || message === 'YES'
      ? 'START'
      : null

  if (action) {
    const existing = providerEventId
      ? await prisma.smsConsentLog.findFirst({ where: { businessId: business.id, providerEventId }, select: { id: true } })
      : null
    if (!existing) {
      await prisma.$transaction(async (tx) => {
        await tx.customer.update({
          where: { id: customer.id },
          data: action === 'STOP'
            ? { smsConsent: false, marketingSmsConsent: false, smsOptedOutAt: new Date() }
            : { smsConsent: true, marketingSmsConsent: true, smsOptedOutAt: null },
        })
        await tx.smsConsentLog.createMany({
          data: [
            { businessId: business.id, customerId: customer.id, phone: from, category: 'TRANSACTIONAL', action, disclosure: SMS_CONSENT_DISCLOSURES.transactional, source: 'TWILIO_INBOUND', providerEventId },
            { businessId: business.id, customerId: customer.id, phone: from, category: 'MARKETING', action, disclosure: SMS_CONSENT_DISCLOSURES.marketing, source: 'TWILIO_INBOUND', providerEventId: providerEventId ? `${providerEventId}:MARKETING` : null },
          ],
        })
      })
    }
    return twiml(action === 'STOP' ? 'You have been unsubscribed from all text messages. Reply START to re-subscribe.' : 'You are subscribed to text messages again. Reply STOP to unsubscribe.')
  }

  if (message === 'HELP' || message === 'INFO') {
    return twiml(`Reply STOP to unsubscribe. Contact ${business.name} for help.`)
  }

  return twiml('Reply STOP to unsubscribe, START to re-subscribe, or HELP for assistance.')
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
}
