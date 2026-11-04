// Rate-limit outcome mapping.
//
// The defect this replaces: a deployment with no Redis answered "Too many
// attempts. Please wait a minute" — the same message as a real limit — so
// owners retried forever, and operators had no signal that the store was the
// problem. Now a genuine limit is 429 and an unusable store is 503, both with
// Retry-After.

import { buildRateLimitDenial, getClientIP, type RateLimitResult } from '../src/lib/rate-limit'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const now = 1_700_000_000_000
const base: RateLimitResult = { allowed: false, remaining: 0, resetAt: now + 30_000, reason: 'exceeded' }

console.log('--- genuine limit ---')
{
  const d = buildRateLimitDenial(base, now)!
  assert(d.status === 429, 'exhausting the window returns 429')
  assert(d.reason === 'exceeded', 'the reason is recorded')
  assert(d.headers['Retry-After'] === '30', 'Retry-After reflects the window')
  assert(/wait a minute/i.test(d.body.error), 'the message tells the person what to do')
  assert(!/redis|upstash|env|token/i.test(d.body.error), 'the message leaks no infrastructure detail')
}

console.log('--- the store is missing ---')
{
  const d = buildRateLimitDenial({ ...base, reason: 'store_not_configured' }, now)!
  assert(d.status === 503, 'missing configuration returns 503, not 429')
  assert(d.reason === 'store_not_configured', 'the cause is distinguishable')
  assert(/temporarily unable/i.test(d.body.error), 'the person is told it is temporary, not that they misbehaved')
  assert(!/too many|attempt/i.test(d.body.error), 'it must NOT blame the visitor for an outage')
  assert(!/redis|upstash|token|url/i.test(d.body.error), 'no infrastructure detail leaks')
  assert(Number(d.headers['Retry-After']) >= 60, 'Retry-After is at least a minute for an outage')
}

console.log('--- the store is down ---')
{
  const d = buildRateLimitDenial({ ...base, reason: 'store_unavailable' }, now)!
  assert(d.status === 503, 'an unreachable store also returns 503')
  assert(d.reason === 'store_unavailable', 'an outage is distinguishable from a missing variable')
  assert(d.headers['Retry-After'] !== undefined, 'Retry-After is present')
}

console.log('--- allowed requests ---')
{
  assert(buildRateLimitDenial({ ...base, allowed: true, reason: 'ok' }, now) === null, 'an allowed request produces no denial')
}

console.log('--- client IP ---')
{
  const mk = (headers: Record<string, string>) => new Request('http://localhost/api/x', { headers })
  assert(getClientIP(mk({ 'x-real-ip': '203.0.113.9' })) === '203.0.113.9', 'a valid x-real-ip is used')
  assert(getClientIP(mk({ 'x-real-ip': 'not-an-ip' })) === 'unknown', 'a malformed address is rejected rather than echoed')
  assert(getClientIP(mk({ 'x-real-ip': '' })) === 'unknown', 'an empty header is rejected')
  assert(getClientIP(mk({ 'x-real-ip': 'x'.repeat(200) })) === 'unknown', 'an over-long header is rejected')
  assert(getClientIP(mk({})) === 'unknown', 'a missing header yields the shared bucket rather than throwing')
  // Behind Vercel the last forwarded hop is the one Vercel appended (the client
  // cannot forge it by prepending values).
  const saved = process.env.VERCEL
  process.env.VERCEL = '1'
  assert(
    getClientIP(mk({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })) === '203.0.113.7',
    'the right-most forwarded hop is trusted on Vercel, not the spoofable left-most',
  )
  assert(getClientIP(mk({ 'x-forwarded-for': 'garbage' })) === 'unknown', 'a malformed forwarded chain falls back safely')
  if (saved === undefined) delete process.env.VERCEL
  else process.env.VERCEL = saved
}

console.log(`\nRate limit outcome tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
