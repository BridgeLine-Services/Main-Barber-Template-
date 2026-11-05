// Which address the rate limiter keys on.
//
// Rate limiting is only as good as the key. If a caller can choose their own
// key, they get a fresh allowance on every attempt and the limit is decoration.
// Forwarding headers are ordinary request headers unless a proxy in front of the
// app sets them, so trusting them anywhere is a bypass waiting to be found.

import { getClientIP } from '../src/lib/rate-limit'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

function request(headers: Record<string, string>) {
  return new Request('http://localhost:3000/api/auth/register', { headers })
}

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key]
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
  try { fn() } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

console.log('--- nowhere trusted: forwarding headers are ignored ---')
withEnv({ VERCEL: undefined, RATE_LIMIT_TRUST_PROXY: undefined }, () => {
  assert(getClientIP(request({ 'x-real-ip': '203.0.113.7' })) === 'unknown', 'a client-supplied x-real-ip is not believed')
  assert(getClientIP(request({ 'x-forwarded-for': '203.0.113.7' })) === 'unknown', 'a client-supplied x-forwarded-for is not believed')
  assert(getClientIP(request({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' })) === 'unknown', 'both together are still not believed')
  assert(getClientIP(request({})) === 'unknown', 'no headers at all resolves to unknown')
})

console.log('--- on Vercel the platform header is used ---')
withEnv({ VERCEL: '1', RATE_LIMIT_TRUST_PROXY: undefined }, () => {
  assert(getClientIP(request({ 'x-real-ip': '203.0.113.7' })) === '203.0.113.7', 'x-real-ip is honoured')
  assert(getClientIP(request({ 'x-forwarded-for': '198.51.100.9' })) === '198.51.100.9', 'x-forwarded-for is the fallback')
  assert(getClientIP(request({ 'x-forwarded-for': '198.51.100.9, 203.0.113.7' })) === '203.0.113.7', 'the closest hop is the one used')
  assert(getClientIP(request({ 'x-real-ip': '2001:db8::1' })) === '2001:db8::1', 'an IPv6 client is reported as-is')
})

console.log('--- malformed headers do not crash or collapse the wrong way ---')
withEnv({ VERCEL: '1', RATE_LIMIT_TRUST_PROXY: undefined }, () => {
  assert(getClientIP(request({ 'x-real-ip': 'not an ip' })) === 'unknown', 'garbage in x-real-ip falls through to unknown')
  assert(getClientIP(request({ 'x-real-ip': '999.999.999.999' })) === 'unknown', 'an out-of-range address is not accepted')
  assert(getClientIP(request({ 'x-real-ip': '' })) === 'unknown', 'an empty header is ignored')
  assert(getClientIP(request({ 'x-real-ip': ' '.repeat(4) })) === 'unknown', 'a whitespace header is ignored')
  assert(getClientIP(request({ 'x-real-ip': `<script>${'a'.repeat(200)}` })) === 'unknown', 'an oversized header is rejected')
  assert(getClientIP(request({ 'x-real-ip': 'bad ip', 'x-forwarded-for': '198.51.100.9' })) === '198.51.100.9', 'a bad primary header still allows a good fallback')
  assert(getClientIP(request({ 'x-real-ip': 'bad ip', 'x-forwarded-for': 'also bad' })) === 'unknown', 'bad primary and bad fallback resolve to unknown')
})

console.log('--- a self-hosted proxy opts in explicitly ---')
withEnv({ VERCEL: undefined, RATE_LIMIT_TRUST_PROXY: 'true' }, () => {
  assert(getClientIP(request({ 'x-real-ip': '203.0.113.7' })) === '203.0.113.7', 'RATE_LIMIT_TRUST_PROXY makes the header usable')
})
withEnv({ VERCEL: undefined, RATE_LIMIT_TRUST_PROXY: 'false' }, () => {
  assert(getClientIP(request({ 'x-real-ip': '203.0.113.7' })) === 'unknown', 'the flag must be exactly true')
})
withEnv({ VERCEL: undefined, RATE_LIMIT_TRUST_PROXY: '1' }, () => {
  assert(getClientIP(request({ 'x-real-ip': '203.0.113.7' })) === 'unknown', 'a loose value does not switch trust on')
})

console.log('--- unknown is a shared bucket, which is deliberate ---')
withEnv({ VERCEL: undefined, RATE_LIMIT_TRUST_PROXY: undefined }, () => {
  const a = getClientIP(request({ 'x-real-ip': '203.0.113.7' }))
  const b = getClientIP(request({ 'x-real-ip': '198.51.100.9' }))
  assert(a === b && a === 'unknown', 'two callers who cannot be identified share one bucket rather than getting one each')
})

console.log(`\nRate limit IP tests: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
