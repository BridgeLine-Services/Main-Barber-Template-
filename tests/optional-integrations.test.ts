import nodeAssert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolvePaymentProvider, inPersonProvider, stripeProvider } from '../src/lib/payments'
import { missingStripeConfiguration, stripeConfigured } from '../src/lib/payments/providers/stripe-client'
import { emailConfigurationIssue, isEmailConfigured, sendAppointmentReminder, sendBookingConfirmation, sendWaitlistSlotNotification } from '../src/lib/notifications'
import { getFeatureConfig } from '../src/lib/env-check'
import { importGoogleReviewsFromAPI, isGBPConnected, syncBusinessToGoogle, getGBPOAuthUrl } from '../src/lib/google-business'
import { sendPortalCode } from '../src/lib/portal-security'
import { sendSms } from '../src/lib/twilio'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS ${message}`)
    passed++
  } else {
    console.error(`  FAIL ${message}`)
    failed++
  }
}

const environmentKeys = [
  'EMAIL_ENABLED', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
  'SMS_ENABLED', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'GOOGLE_ENABLED', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GBP_ACCESS_TOKEN',
  'GBP_REFRESH_TOKEN', 'GBP_ACCOUNT_ID', 'GBP_LOCATION_ID', 'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET',
]

async function main() {
  const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]))
  const originalFetch = globalThis.fetch
  let outboundRequests = 0
  globalThis.fetch = async () => {
    outboundRequests++
    throw new Error('Optional provider must not be called in this test')
  }

  try {
    process.env.EMAIL_ENABLED = 'false'
    process.env.SMTP_HOST = 'smtp.example.test'
    process.env.SMTP_USER = 'test-user'
    process.env.SMTP_PASS = 'test-password'
    process.env.SMTP_FROM = 'noreply@example.test'
    delete process.env.SMTP_PORT

    process.env.SMS_ENABLED = 'false'
    process.env.TWILIO_ACCOUNT_SID = 'test-account'
    process.env.TWILIO_AUTH_TOKEN = 'test-token'
    process.env.TWILIO_PHONE_NUMBER = '+15555550100'

    process.env.GOOGLE_ENABLED = 'false'
    process.env.GOOGLE_CLIENT_ID = 'test-client'
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
    process.env.GBP_ACCESS_TOKEN = 'test-access-token'
    process.env.GBP_ACCOUNT_ID = 'accounts/test'
    process.env.GBP_LOCATION_ID = 'locations/test'

    console.log('\n── Disabled integrations ──')
    assert(!isEmailConfigured(), 'EMAIL_ENABLED=false disables email despite complete SMTP credentials')
    assert(emailConfigurationIssue()?.includes('disabled') === true, 'disabled email reports an explicit configuration state')
    assert(getFeatureConfig('email').configured, 'SMTP_PORT is optional because the mailer defaults to port 587')

    const appointment = {
      id: 'test-appointment',
      confirmationNumber: 'TEST-123',
      startTime: new Date('2030-01-01T18:00:00.000Z'),
      endTime: new Date('2030-01-01T18:30:00.000Z'),
      customer: { firstName: 'Test', lastName: 'Customer', email: 'customer@example.test', phone: '+15555550101', smsConsent: true },
      barber: { name: 'Test Barber' },
      service: { name: 'Test Cut', duration: 30, price: 20 },
      business: { id: 'test-business', name: 'Test Shop', phone: null, email: 'shop@example.test', address: null },
    }
    await sendBookingConfirmation(appointment)
    await sendAppointmentReminder(appointment, 24)
    await sendWaitlistSlotNotification({
      businessId: 'test-business',
      entryId: 'test-entry',
      customer: appointment.customer,
      service: appointment.service,
      barber: appointment.barber,
      slotStart: appointment.startTime,
      slotEnd: appointment.endTime,
      claimToken: 'test-token',
      claimUrl: 'https://example.test/claim',
      business: { name: 'Test Shop', phone: null, email: null },
    })
    const portalEmail = await sendPortalCode('EMAIL', 'customer@example.test', '123456', 'Test Shop')
    assert(portalEmail.success === false && portalEmail.error?.includes('disabled') === true, 'portal email reports disabled without sending')

    const sms = await sendSms('+15555550101', 'Test message')
    assert(sms.success === false && sms.error?.includes('disabled') === true, 'direct SMS sender respects SMS_ENABLED=false')

    assert(!isGBPConnected(), 'GOOGLE_ENABLED=false hides stored Google credentials')
    const syncResult = await syncBusinessToGoogle('test-business')
    const reviewsResult = await importGoogleReviewsFromAPI('test-business')
    assert(syncResult.errors[0]?.includes('disabled') === true, 'Google sync exits explicitly when disabled')
    assert(reviewsResult.errors[0]?.includes('disabled') === true, 'Google review import exits explicitly when disabled')
    nodeAssert.throws(() => getGBPOAuthUrl('test-user', 'test-business', 'https://example.test/callback'), /disabled/)
    assert(outboundRequests === 0, 'disabled optional providers make no outbound requests')

    console.log('\n── Enabled integrations with incomplete credentials ──')
    process.env.EMAIL_ENABLED = 'true'
    delete process.env.SMTP_FROM
    const emailConfig = getFeatureConfig('email')
    assert(!emailConfig.configured && emailConfig.missing.includes('SMTP_FROM'), 'enabled email lists missing required SMTP configuration')
    assert(emailConfigurationIssue()?.includes('SMTP_FROM') === true, 'enabled email exposes the missing sender configuration')

    process.env.SMS_ENABLED = 'true'
    delete process.env.TWILIO_AUTH_TOKEN
    const smsConfig = await sendSms('+15555550101', 'Test message')
    assert(smsConfig.success === false && smsConfig.error?.includes('not configured') === true, 'enabled SMS reports missing provider credentials')

    process.env.GOOGLE_ENABLED = 'true'
    delete process.env.GOOGLE_CLIENT_SECRET
    assert(getFeatureConfig('google').missing.includes('GOOGLE_CLIENT_SECRET'), 'enabled Google integration lists missing OAuth credentials')
    nodeAssert.throws(() => getGBPOAuthUrl('test-user', 'test-business', 'https://example.test/callback'), /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/)

    console.log('\n── Payments and cron limits ──')
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_PUBLISHABLE_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
    assert(resolvePaymentProvider({ paymentInPerson: true }) === inPersonProvider, 'pay-at-shop remains available without Stripe credentials')
    nodeAssert.throws(() => resolvePaymentProvider({ paymentInPerson: false }), /Stripe is not fully configured/)
    process.env.STRIPE_SECRET_KEY = 'test-secret'
    assert(!stripeConfigured(), 'Stripe secret key alone does not enable incomplete online payments')
    assert(missingStripeConfiguration().includes('STRIPE_PUBLISHABLE_KEY') && missingStripeConfiguration().includes('STRIPE_WEBHOOK_SECRET'),
      'Stripe reports missing client and webhook credentials')
    assert(resolvePaymentProvider({ paymentInPerson: true }) === inPersonProvider, 'in-person payments remain available when Stripe is incomplete')
    nodeAssert.equal(stripeProvider.id, 'stripe')
    process.env.STRIPE_PUBLISHABLE_KEY = 'test-publishable'
    process.env.STRIPE_WEBHOOK_SECRET = 'test-webhook'
    assert(stripeConfigured(), 'all required Stripe credentials enable the online provider')
    assert(resolvePaymentProvider({ paymentInPerson: false }) === stripeProvider, 'online payments resolve to Stripe only when fully configured')

    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons: Array<{ schedule: string }>
    }
    assert(vercel.crons.every(({ schedule }) => /^\d{1,2}\s+\d{1,2}\s+\*\s+\*\s+\*$/.test(schedule)),
      'Vercel cron schedules run at most once daily')
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  console.log(`\nOptional integration tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('Optional integration test runner crashed:', error)
  process.exitCode = 1
})
