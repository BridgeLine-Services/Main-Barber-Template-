// Critical alerting: two channels, retries, duplicate suppression, recovery
// notices, and the rule that no customer detail ever leaves the process.

import { resetAlertStateForTest, getAlertDeliveryStatus, sanitizeAlertContext, sendAlert, sendRecoveryAlert, sendTestAlert, isAlertingConfigured } from '../src/lib/alerts'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

interface Captured { url: string; body: Record<string, unknown> }

const originalFetch = globalThis.fetch
let captured: Captured[] = []
let responder: (url: string, attempt: number) => Response = () => new Response('ok', { status: 200 })
let attemptCount = 0

function installFetch() {
  captured = []
  attemptCount = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    captured.push({ url, body })
    attemptCount++
    return responder(url, attemptCount)
  }) as unknown as typeof fetch
}

const env = { ALERT_WEBHOOK_URL: 'https://alerts.test/critical', OBSERVABILITY_WEBHOOK_URL: 'https://collector.test/ingest' }

async function main() {
  const envRecord = process.env as Record<string, string | undefined>
  const savedNodeEnv = envRecord.NODE_ENV
  envRecord.NODE_ENV = 'test'
  installFetch()

  console.log('--- configuration ---')
  assert(!isAlertingConfigured({}), 'an unconfigured deployment is reported as such')
  assert(isAlertingConfigured({ ALERT_WEBHOOK_URL: 'https://x.test' }), 'one channel is enough')
  resetAlertStateForTest()
  assert((await sendAlert({ event: 'x', severity: 'critical', summary: 's' }, {})).length === 0, 'no channel means no attempt and no throw')

  console.log('--- two independent channels ---')
  resetAlertStateForTest()
  const both = await sendAlert({ event: 'database_unavailable', severity: 'critical', summary: 'The database is not answering.' }, env)
  assert(both.length === 2, 'a critical alert goes to both the independent channel and the primary collector')
  assert(captured[0].url === env.ALERT_WEBHOOK_URL, 'the independent channel is attempted first')
  assert(both.every((delivery) => delivery.ok), 'both deliveries are recorded as successful')
  assert(captured[0].body.severity === 'critical' && captured[0].body.event === 'database_unavailable', 'the payload carries the structured event')

  console.log('--- duplicate suppression ---')
  resetAlertStateForTest()
  captured = []
  await sendAlert({ event: 'rate_limit_store_unavailable', severity: 'critical', summary: 'x' }, env)
  const firstCount = captured.length
  const second = await sendAlert({ event: 'rate_limit_store_unavailable', severity: 'critical', summary: 'x' }, env)
  assert(second.length === 0, 'an identical alert inside the window is suppressed')
  assert(captured.length === firstCount, 'a suppressed alert makes no HTTP requests')
  const different = await sendAlert({ event: 'backup_stale', severity: 'critical', summary: 'y' }, env)
  assert(different.length === 2, 'a different event is not suppressed by another event\'s window')

  console.log('--- severity floor ---')
  resetAlertStateForTest()
  captured = []
  const quiet = await sendAlert({ event: 'noise', severity: 'info', summary: 'z' }, { ...env, ALERT_MIN_SEVERITY: 'critical' })
  assert(quiet.length === 0, 'below-floor events are dropped for the independent channel')
  assert(captured.length === 0, 'a dropped event makes no request at all')

  console.log('--- recovery notices are never suppressed ---')
  resetAlertStateForTest()
  captured = []
  await sendAlert({ event: 'backup_failed', severity: 'critical', summary: 'failed' }, env)
  await sendAlert({ event: 'backup_failed', severity: 'critical', summary: 'failed' }, env)
  const recovery = await sendRecoveryAlert('backup_failed', 'Backups are completing again.', {}, env)
  assert(recovery.length === 2, 'a recovery notice is delivered even during the suppression window')
  assert(captured.some((entry) => entry.body.recoveryOf === 'backup_failed'), 'the notice names the incident it closes')

  console.log('--- retry and delivery tracking ---')
  resetAlertStateForTest()
  captured = []
  responder = (_url, attempt) => (attempt === 1 ? new Response('boom', { status: 500 }) : new Response('ok', { status: 200 }))
  attemptCount = 0
  const retried = await sendAlert({ event: 'flaky', severity: 'critical', summary: 'retry me' }, { ALERT_WEBHOOK_URL: env.ALERT_WEBHOOK_URL })
  assert(retried.length === 1 && retried[0].attempts === 2, 'a critical alert retries once before giving up')
  assert(retried[0].ok, 'the retry can succeed')
  responder = () => new Response('down', { status: 503 })
  resetAlertStateForTest()
  const failedDelivery = await sendAlert({ event: 'down', severity: 'warning', summary: 'w' }, { ALERT_WEBHOOK_URL: env.ALERT_WEBHOOK_URL })
  assert(failedDelivery.length === 1 && !failedDelivery[0].ok, 'a failed delivery is recorded as failed, not thrown')
  assert(getAlertDeliveryStatus().length >= 1, 'delivery status is tracked for the operator')
  responder = () => new Response('ok', { status: 200 })

  console.log('--- nothing customer-identifying leaves the process ---')
  const sanitized = sanitizeAlertContext({
    customerEmail: 'alex@example.com',
    customerPhone: '+1 555 010 9999',
    apiToken: 'sk-live-123',
    note: 'Call alex@example.com or +1 (555) 010-9999',
    tenantId: 'biz_123',
    count: 4,
    ok: true,
  } as Record<string, string | number | boolean>)
  assert(!('customerEmail' in sanitized) && !('customerPhone' in sanitized) && !('apiToken' in sanitized), 'identifying and secret keys are dropped')
  assert(String(sanitized.note).includes('[redacted-email]') && String(sanitized.note).includes('[redacted-number]'), 'free text is scrubbed of addresses and numbers')
  assert(sanitized.tenantId === 'biz_123' && sanitized.count === 4 && sanitized.ok === true, 'useful operational context survives')

  console.log('--- acceptance test alert ---')
  resetAlertStateForTest()
  captured = []
  const test = await sendTestAlert(env)
  assert(test.length === 2 && captured.every((entry) => entry.body.event === 'deployment_test_alert'), 'the acceptance alert is a real delivery, not a dry run')
  let threw = ''
  try { await sendTestAlert({}) } catch (error) { threw = error instanceof Error ? error.message : String(error) }
  assert(/No alert channel is configured/.test(threw), 'a missing channel is an explicit error for the acceptance check')

  globalThis.fetch = originalFetch
  envRecord.NODE_ENV = savedNodeEnv
  console.log(`\nAlerting tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => { globalThis.fetch = originalFetch; console.error(error); process.exit(1) })
