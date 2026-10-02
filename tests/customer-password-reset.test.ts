/**
 * CUSTOMER PASSWORD RESET / RECOVERY TESTS
 *
 * Proves, against a live server, the token-based password recovery flow for
 * customer accounts (Part 1 of the hardening plan: "Password reset/recovery
 * if password authentication is used"):
 *
 *   - forgot-password is enumeration-safe: known and unknown emails get the
 *     IDENTICAL generic response
 *   - the raw reset token is never stored — only its SHA-256 hash
 *   - reset-password rejects malformed tokens, expired tokens, reused
 *     (single-use) tokens, and weak passwords (shared policy)
 *   - a successful reset clears the token, stamps passwordChangedAt, and
 *     satisfies mustChangePassword
 *   - the old password stops working; the new one logs in
 *   - the forgot-password endpoint enforces its stricter rate limit
 *
 * Run: npx tsx tests/customer-password-reset.test.ts  (server on :3000,
 * NODE_ENV=development so the dev-safe resetUrl is returned)
 */

import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../src/lib/prisma'

const BASE = 'http://localhost:3000'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

async function api(
  path: string,
  body: unknown,
  ip = '203.0.113.77'
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
  let parsed: Record<string, unknown> | null = null
  try { parsed = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, body: parsed }
}

async function login(email: string, password: string): Promise<boolean> {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfRes.json()
  const cookie = csrfRes.headers.get('set-cookie') || ''
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    redirect: 'manual',
  })
  const setCookie = res.headers.get('set-cookie') || ''
  return /next-auth\.session-token=/.test(setCookie)
}

async function main() {
  const stamp = Date.now()
  const email = `pwreset-cust-${stamp}@test.local`
  const oldPassword = 'OriginalPass123'
  const newPassword = 'FreshStart456!'
  const businessSlug = `password-reset-test-shop-${stamp}`

  // ── fixture: a business + a CUSTOMER account ──────────────────────────────
  const business = await prisma.business.create({
    data: {
      name: 'Password Reset Test Shop',
      slug: businessSlug,
      email: `owner-${stamp}@pwreset.test.local`,
    },
  })
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Password Reset Customer',
      role: 'CUSTOMER',
      passwordHash: await bcrypt.hash(oldPassword, 12),
      businessId: business.id,
    },
  })
  const cleanupUserIds = [user.id]

  try {
    console.log('\n── Enumeration safety ──')
    const unknown = await api('/api/auth/forgot-password', { email: `nobody-${stamp}@test.local` })
    const known = await api('/api/auth/forgot-password', { email }, '203.0.113.78')
    assert(unknown.status === 200, 'unknown email still returns 200')
    assert(
      unknown.body?.message === known.body?.message,
      'known and unknown emails get the IDENTICAL message (no enumeration)'
    )
    assert(!('resetUrl' in (unknown.body ?? {})), 'unknown email gets NO reset token')
    const invalid = await api('/api/auth/forgot-password', { email: 'not-an-email' }, '203.0.113.79')
    assert(invalid.status === 200 && typeof invalid.body?.message === 'string', 'malformed input gets the generic shape (no signal)')

    console.log('\n── Token creation (customer account) ──')
    const devUrl = known.body?.resetUrl
    assert(typeof devUrl === 'string' && devUrl.includes('token='), 'dev mode returns the reset link for the customer account')
    const rawToken = new URLSearchParams(String(devUrl).split('?')[1]).get('token')!

    const stored = await prisma.user.findUnique({ where: { id: user.id } })
    const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    assert(stored?.passwordResetToken === expectedHash, 'DB stores only the SHA-256 hash of the token')
    assert(stored?.passwordResetToken !== rawToken, 'raw token is NEVER stored')
    const expiresInMin = (stored!.passwordResetExpires!.getTime() - Date.now()) / 60_000
    assert(expiresInMin > 55 && expiresInMin <= 60, 'token expires in ~1 hour')

    console.log('\n── Reset endpoint validation ──')
    const garbage = await api('/api/auth/reset-password', { token: 'x'.repeat(64), password: newPassword }, '198.51.100.101')
    assert(garbage.status === 400, 'unknown token rejected')
    const shortToken = await api('/api/auth/reset-password', { token: 'short', password: newPassword }, '198.51.100.102')
    assert(shortToken.status === 400, 'malformed (short) token rejected')
    const weak = await api('/api/auth/reset-password', { token: rawToken, password: 'weak' }, '198.51.100.103')
    assert(weak.status === 400, 'weak password rejected by the shared policy')
    assert(
      (await bcrypt.compare(oldPassword, (await prisma.user.findUnique({ where: { id: user.id } }))!.passwordHash!)),
      'failed attempts do NOT change the password'
    )

    console.log('\n── Successful reset ──')
    const ok = await api('/api/auth/reset-password', { token: rawToken, password: newPassword }, '198.51.100.104')
    assert(ok.status === 200 && ok.body?.success === true, 'valid token + strong password resets the password')
    const after = await prisma.user.findUnique({ where: { id: user.id } })
    assert(await bcrypt.compare(newPassword, after!.passwordHash!), 'passwordHash updated to the new password')
    assert(after?.passwordResetToken === null && after?.passwordResetExpires === null, 'token cleared — single use enforced')
    assert(after?.passwordChangedAt !== null, 'passwordChangedAt stamped')
    assert(after?.mustChangePassword === false, 'a reset satisfies mustChangePassword')

    console.log('\n── Single use + re-login ──')
    const reuse = await api('/api/auth/reset-password', { token: rawToken, password: 'AnotherNew789!' }, '198.51.100.105')
    assert(reuse.status === 400, 'used token cannot reset again')
    assert(!(await login(email, oldPassword)), 'OLD password no longer authenticates')
    assert(await login(email, newPassword), 'new password logs the customer in')

    console.log('\n── Expiry enforcement ──')
    // Mint a fresh token, then age it past its expiry directly in the DB.
    const second = await api('/api/auth/forgot-password', { email }, '203.0.113.80')
    const raw2 = new URLSearchParams((second.body?.resetUrl as string).split('?')[1]).get('token')!
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetExpires: new Date(Date.now() - 60_000) },
    })
    const expired = await api('/api/auth/reset-password', { token: raw2, password: 'ThirdPassword321!' }, '198.51.100.106')
    assert(expired.status === 400, 'expired token rejected')
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetExpires: new Date(Date.now() + 3_600_000) },
    })
    const lateUse = await api('/api/auth/reset-password', { token: raw2, password: 'ThirdPassword321!' }, '198.51.100.107')
    assert(lateUse.status === 200, 'same token succeeds once re-issued within expiry (expiry re-checked each attempt)')

    console.log('\n── Rate limiting (stricter bucket: 3/min) ──')
    const floodIp = `198.51.100.${(stamp % 200) + 1}`
    let lastStatus = 0
    for (let i = 0; i < 4; i++) {
      const r = await api('/api/auth/forgot-password', { email: `flood-${i}-${stamp}@test.local` }, floodIp)
      lastStatus = r.status
    }
    assert(lastStatus === 429, '4th rapid request from one IP is rate-limited (429)')

    console.log('\n── Audit trail ──')
    const audits = await prisma.auditLog.findMany({
      where: { userId: user.id, entityType: 'User', action: 'USER_PASSWORD_CHANGED' },
    })
    assert(
      audits.some((a) => (a.newValues as Record<string, string>)?.event === 'PASSWORD_RESET_REQUESTED'),
      'reset REQUEST is audited'
    )
    assert(
      audits.some((a) => (a.newValues as Record<string, string>)?.event === 'PASSWORD_RESET_COMPLETED'),
      'reset COMPLETION is audited'
    )
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: { in: cleanupUserIds } } })
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } })
    await prisma.business.deleteMany({ where: { id: business.id } })
  }

  console.log(`\n${'─'.repeat(50)}`)
  if (failed === 0) {
    console.log(`✅ All ${passed} customer password-reset tests passed\n`)
    process.exit(0)
  } else {
    console.log(`❌ ${failed} of ${passed + failed} customer password-reset tests failed\n`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Test error:', err)
  process.exit(1)
})
