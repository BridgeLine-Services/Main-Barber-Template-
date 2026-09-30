// Observability (active error reporting) tests — Section 38.
// Verifies the forwarder is a safe no-op by default, reports when
// configured, sanitizes secrets, and can never throw or hang.

import assert from 'node:assert/strict'
import { logError } from '../src/lib/logger'

let passed = 0
let failed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    passed++
    console.log(`  PASS ${name}`)
  } catch (e) {
    failed++
    console.error(`  FAIL ${name}: ${e instanceof Error ? e.message : e}`)
  }
}

// Test collector: records forwarded payloads.
interface ForwardedEvent {
  event?: string
  errorCode?: string
  message?: string
  timestamp?: string
  context?: Record<string, string | undefined>
}
let forwarded: ForwardedEvent[] = []
const originalFetch = globalThis.fetch

async function run() {
  console.log('Observability tests:')

  await test('no-op when OBSERVABILITY_WEBHOOK_URL unset', async () => {
    delete process.env.OBSERVABILITY_WEBHOOK_URL
    let calls = 0
    globalThis.fetch = (async () => { calls++; return new Response('{}', { status: 200 }) }) as typeof fetch
    await logError('obs_test', new Error('boom'))
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(calls, 0, 'must not fetch when unconfigured')
  })

  await test('forwards structured error event when configured', async () => {
    process.env.OBSERVABILITY_WEBHOOK_URL = 'https://collector.example.com/ingest'
    forwarded = []
    let capturedBody: ForwardedEvent | null = null
    let capturedUrl = ''
    globalThis.fetch = (async (url: string | URL | Request, init: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init.body))
      forwarded.push(capturedBody)
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const err = Object.assign(new Error('database exploded'), { code: 'P1001' })
    await logError('obs_forward', err, { route: '/api/dashboard', businessId: 'biz_1' })
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(forwarded.length, 1)
    assert.equal(capturedUrl, 'https://collector.example.com/ingest')
    assert.equal(capturedBody.event, 'obs_forward')
    assert.equal(capturedBody.errorCode, 'P1001')
    assert.equal(capturedBody.message, 'database exploded')
    assert.equal(capturedBody.context.businessId, 'biz_1')
    assert.ok(capturedBody.timestamp)
  })

  await test('sanitizes secrets from forwarded context', async () => {
    process.env.OBSERVABILITY_WEBHOOK_URL = 'https://collector.example.com/ingest'
    forwarded = []
    globalThis.fetch = (async (_url: string | URL | Request, init: RequestInit) => {
      forwarded.push(JSON.parse(String(init.body)))
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    await logError('obs_secret', new Error('x'), {
      password: 'hunter2', SMTP_TOKEN: 'abc', userEmail: 'a@b.com', safe: 'keep',
    })
    await new Promise((r) => setTimeout(r, 30))
    const body = forwarded[0] as ForwardedEvent
    assert.equal(body.context.password, undefined)
    assert.equal(body.context.SMTP_TOKEN, undefined)
    assert.equal(body.context.userEmail, undefined)
    assert.equal(body.context.safe, 'keep')
  })

  await test('collector failure never throws into the app', async () => {
    process.env.OBSERVABILITY_WEBHOOK_URL = 'https://collector.example.com/ingest'
    globalThis.fetch = (async () => { throw new Error('network down') }) as typeof fetch
    let threw = false
    try {
      await logError('obs_failnet', new Error('app error'))
      await new Promise((r) => setTimeout(r, 30))
    } catch {
      threw = true
    }
    assert.equal(threw, false, 'logError must never throw when forwarding fails')
  })

  await test('collector 500 never throws into the app', async () => {
    process.env.OBSERVABILITY_WEBHOOK_URL = 'https://collector.example.com/ingest'
    globalThis.fetch = (async () => new Response('err', { status: 500 })) as typeof fetch
    let threw = false
    try {
      await logError('obs_fail500', new Error('app error'))
      await new Promise((r) => setTimeout(r, 30))
    } catch {
      threw = true
    }
    assert.equal(threw, false)
  })

  await test('hung collector does not block longer than the timeout', async () => {
    process.env.OBSERVABILITY_WEBHOOK_URL = 'https://collector.example.com/ingest'
    globalThis.fetch = (async (_url: string | URL | Request, init: RequestInit) => {
      // Simulate a collector that never responds: respect the abort signal.
      return new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('timeout')))
      })
    }) as typeof fetch
    const start = Date.now()
    await logError('obs_hang', new Error('x'))
    await new Promise((r) => setTimeout(r, 2700))
    const elapsed = Date.now() - start
    assert.ok(elapsed < 4000, `forwarder must abort quickly (took ${elapsed}ms)`)
  })

  globalThis.fetch = originalFetch
  delete process.env.OBSERVABILITY_WEBHOOK_URL
  console.log(`\nObservability tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

run().catch((e) => { console.error(e); process.exit(1) })
