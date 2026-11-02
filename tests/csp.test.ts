// CSP builder tests.
//
// The policy is security-critical and the nonce mode is switched per
// environment, so both modes are pinned here: the default must stay identical
// to the policy the app already shipped, and nonce mode must remove
// 'unsafe-inline' from script-src only.

import { buildContentSecurityPolicy, isNonceEnabled, PREVIEW_PATH, CSP_NONCE_ENV_VAR } from '../src/lib/csp'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

function directive(policy: string, name: string): string {
  return policy.split('; ').find((part) => part.startsWith(`${name} `)) || ''
}

console.log('--- default mode (flag off) ---')
{
  const policy = buildContentSecurityPolicy({ isProduction: true })
  const script = directive(policy, 'script-src')
  assert(script.includes("'unsafe-inline'"), "default script-src keeps 'unsafe-inline'")
  assert(!script.includes('nonce-'), 'default script-src has no nonce')
  assert(!script.includes("'unsafe-eval'"), 'production never allows unsafe-eval')
  assert(directive(policy, 'frame-ancestors') === "frame-ancestors 'none'", 'framing denied by default')
  assert(directive(policy, 'style-src').includes("'unsafe-inline'"), 'style-src keeps unsafe-inline (generated theme CSS)')
  assert(directive(policy, 'object-src') === "object-src 'none'", 'plugins blocked')
  assert(directive(policy, 'base-uri') === "base-uri 'self'", 'base-uri locked to self')
  assert(policy.endsWith(';'), 'policy is terminated with a semicolon')
}

console.log('--- preview route framing exception ---')
{
  const preview = buildContentSecurityPolicy({ pathname: PREVIEW_PATH, isProduction: true })
  assert(directive(preview, 'frame-ancestors') === "frame-ancestors 'self'", 'preview allows same-origin framing only')
  const other = buildContentSecurityPolicy({ pathname: '/dashboard/settings', isProduction: true })
  assert(directive(other, 'frame-ancestors') === "frame-ancestors 'none'", 'every other route still denies framing')
}

console.log('--- nonce mode ---')
{
  const policy = buildContentSecurityPolicy({ nonce: 'abc123', isProduction: true })
  const script = directive(policy, 'script-src')
  assert(script.includes("'nonce-abc123'"), 'nonce is present in script-src')
  assert(script.includes("'strict-dynamic'"), "strict-dynamic lets the nonced bootstrap load chunks")
  assert(!script.includes("'unsafe-inline'"), "nonce mode removes 'unsafe-inline' from script-src")
  assert(directive(policy, 'style-src').includes("'unsafe-inline'"), 'style-src is untouched by nonce mode')
  assert(!policy.includes('nonce-', policy.indexOf('style-src')), 'no nonce leaks into style-src')
  assert(policy.includes('nonce-abc123') && directive(policy, 'script-src').includes('nonce-abc123'), 'exactly the supplied nonce is used')
}

console.log('--- development allowances ---')
{
  const dev = buildContentSecurityPolicy({ isProduction: false })
  assert(directive(dev, 'script-src').includes("'unsafe-eval'"), "development allows 'unsafe-eval' for React JIT")
  const devNonce = buildContentSecurityPolicy({ nonce: 'n1', isProduction: false })
  assert(directive(devNonce, 'script-src').includes("'unsafe-eval'"), "'unsafe-eval' survives nonce mode in development")
  assert(!buildContentSecurityPolicy({ isProduction: true }).includes("'unsafe-eval'"), 'production policy has no eval allowance anywhere')
}

console.log('--- per-request nonce selection ---')
{
  assert(isNonceEnabled({ [CSP_NONCE_ENV_VAR]: 'true' }), 'flag on enables nonce mode')
  assert(!isNonceEnabled({ [CSP_NONCE_ENV_VAR]: 'false' }), 'flag off keeps the default mode')
  assert(!isNonceEnabled({}), 'unset flag keeps the default mode')
  assert(!isNonceEnabled({ [CSP_NONCE_ENV_VAR]: 'TRUE' }), 'only the literal "true" enables it (no accidental on)')
  // Two calls with different nonces must not share state.
  const a = buildContentSecurityPolicy({ nonce: 'aaa', isProduction: true })
  const b = buildContentSecurityPolicy({ nonce: 'bbb', isProduction: true })
  assert(a.includes('nonce-aaa') && !a.includes('nonce-bbb'), 'policies are built per request, not cached')
  assert(b.includes('nonce-bbb') && !b.includes('nonce-aaa'), 'no cross-request nonce leakage')
}

console.log(`\nCSP tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
