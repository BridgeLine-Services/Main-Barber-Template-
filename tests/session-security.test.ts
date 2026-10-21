// ============================================================================
// SESSION SECURITY — password-change session invalidation unit tests.
//
// Verifies the pure staleness decision used by the NextAuth jwt callback:
// a session is dead only when the account's passwordChangedAt is strictly
// newer than the stamp captured at sign-in. Grandfathered sessions (no
// stamp) must never be invalidated, and equal timestamps must survive
// (signed in right after a password change).
// ============================================================================
import { isSessionInvalidated } from '../src/lib/session-security'

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    console.error(`  ✗ ${message}`)
  }
}

async function main() {
  console.log('\n══════════ Session Security Test Suite ══════════')

  const sign_in = new Date('2026-10-19T10:00:00.000Z').getTime()
  const later = new Date('2026-10-19T12:00:00.000Z')
  const same = new Date('2026-10-19T10:00:00.000Z')

  console.log('\n[1] Password changed AFTER sign-in → session dead')
  assert(isSessionInvalidated(later, sign_in) === true, 'later passwordChangedAt invalidates the session')

  console.log('\n[2] Password changed BEFORE (or equal to) sign-in → session alive')
  assert(isSessionInvalidated(same, sign_in) === false, 'equal timestamp survives (signed in after the change)')
  assert(
    isSessionInvalidated(new Date('2026-10-18T10:00:00.000Z'), sign_in) === false,
    'older passwordChangedAt survives'
  )

  console.log('\n[3] Grandfathered sessions (no stamp) are never invalidated')
  assert(isSessionInvalidated(later, null) === false, 'null stamp is grandfathered')
  assert(isSessionInvalidated(later, undefined) === false, 'undefined stamp is grandfathered')

  console.log('\n[4] No passwordChangedAt on the account → session survives')
  assert(isSessionInvalidated(null, sign_in) === false, 'null DB value survives')
  assert(isSessionInvalidated(undefined, sign_in) === false, 'undefined DB value survives')

  console.log('\n[5] ISO string DB values are accepted')
  assert(isSessionInvalidated('2026-10-19T12:00:00.000Z', sign_in) === true, 'ISO string later → dead')
  assert(isSessionInvalidated('2026-10-19T10:00:00.000Z', sign_in) === false, 'ISO string equal → alive')
  assert(isSessionInvalidated('not-a-date', sign_in) === false, 'garbage value is treated as alive (fail-open for parse, safe: no change)')

  console.log('\n[6] Zero stamp (signed in before first password change was recorded)')
  assert(isSessionInvalidated(later, 0) === true, 'epoch-0 stamp with later change → dead')
  assert(isSessionInvalidated(null, 0) === false, 'epoch-0 stamp with no DB change → alive')

  console.log(`\nSession security tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  process.exit(0)
}

main().catch((e) => {
  console.error('Test crashed:', e)
  process.exit(1)
})
