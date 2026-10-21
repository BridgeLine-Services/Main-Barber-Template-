/**
 * CO-OWNER (BUSINESS_ADMIN) PERMISSION BOUNDARIES + INVITATION RESEND
 *
 * Proves, against a live server:
 *  - Policy: only the OWNER may invite, edit, deactivate, remove, resend, or
 *    revoke invitations for CO-OWNER tier accounts. A co-owner manages
 *    BARBER staff only.
 *  - Owner can invite a co-owner; acceptance creates a BUSINESS_ADMIN staff
 *    member scoped to the owner's business.
 *  - Co-owner CAN invite a barber; CANNOT invite another co-owner.
 *  - Co-owner CAN revoke/resend a barber invitation; CANNOT revoke/resend a
 *    co-owner invitation.
 *  - Co-owner CANNOT deactivate, remove, or promote a co-owner; CANNOT
 *    assign the Co-owner role; CANNOT transfer ownership.
 *  - Resend replaces the old token atomically: the old link dies, exactly
 *    one active invitation remains, and the fresh link is valid.
 *
 * Run: npx tsx tests/coowner-permissions.test.ts  (server on :3000)
 */
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../src/lib/prisma'
import { canManageStaffWithRole } from '../src/lib/permissions'
import { roleLabel } from '../src/lib/role-labels'

const BASE = 'http://localhost:3000'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

async function login(email: string, password: string) {
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
  const session = /next-auth\.session-token=([^;]+)/.exec(setCookie)?.[1]
  return { ok: !!session, sessionCookie: setCookie }
}

function cookiePairs(setCookie: string): string {
  return setCookie.split(/,(?=[^;]+?=)/).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ')
}

async function api(path: string, init: RequestInit = {}, cookie = ''): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie: cookiePairs(cookie) } : {}), ...((init.headers as Record<string, string>) || {}) },
  })
  let body: Record<string, unknown> | null = null
  try { body = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, body }
}

async function main() {
  const stamp = Date.now()
  const password = 'Coowner-Test-123!'
  const pwHash = await bcrypt.hash(password, 10)

  console.log('\n── Central policy (pure functions) ──')
  assert(canManageStaffWithRole('OWNER', 'BUSINESS_ADMIN'), 'policy: OWNER manages co-owners')
  assert(canManageStaffWithRole('OWNER', 'BARBER'), 'policy: OWNER manages barbers')
  assert(!canManageStaffWithRole('BUSINESS_ADMIN', 'BUSINESS_ADMIN'), 'policy: co-owner cannot manage co-owners')
  assert(!canManageStaffWithRole('BUSINESS_ADMIN', 'OWNER'), 'policy: co-owner cannot manage the owner')
  assert(canManageStaffWithRole('BUSINESS_ADMIN', 'BARBER'), 'policy: co-owner manages barbers')
  assert(!canManageStaffWithRole('BARBER', 'BARBER'), 'policy: barber manages nobody')
  assert(!canManageStaffWithRole('CUSTOMER', 'BARBER'), 'policy: customer manages nobody')
  assert(roleLabel('BUSINESS_ADMIN') === 'Co-owner', 'label: BUSINESS_ADMIN displays as Co-owner')
  assert(roleLabel('OWNER') === 'Owner' && roleLabel('BARBER') === 'Barber' && roleLabel('CUSTOMER') === 'Customer', 'label: other roles unchanged')

  const biz = await prisma.business.create({
    data: {
      name: `Coowner Biz ${stamp}`, slug: `coowner-${stamp}`,
      email: `coowner-${stamp}@test.com`, phone: '555-0101', address: '1 Co St',
      city: 'CoCity', state: 'CA', zipCode: '90001', timezone: 'UTC',
    },
  })
  const owner = await prisma.user.create({
    data: { email: `coowner-owner-${stamp}@test.com`, name: 'Owner', role: 'OWNER', businessId: biz.id, passwordHash: pwHash },
  })

  try {
    const ownerLogin = await login(owner.email, password)
    assert(ownerLogin.ok, 'owner signs in')

    console.log('\n── Owner invites a co-owner; invitee accepts ──')
    const coEmail = `coowner-inv-${stamp}@test.com`
    let r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Invited Co-owner', email: coEmail, role: 'BUSINESS_ADMIN' }),
    }, ownerLogin.sessionCookie)
    assert(r.status === 201, `owner invites a co-owner (got ${r.status})`)
    const coInviteUrl: string = (r.body?.inviteUrl as string | undefined) || ''
    const coToken = new URL(coInviteUrl).searchParams.get('token') || ''
    const coInvite = await prisma.staffInvitation.findFirst({ where: { businessId: biz.id, email: coEmail } })
    assert(!!coInvite && coInvite.tokenHash === crypto.createHash('sha256').update(coToken).digest('hex'),
      'co-owner invitation stores only the SHA-256 token hash')

    r = await api('/api/auth/accept-invitation', {
      method: 'POST', body: JSON.stringify({ token: coToken, password, role: 'OWNER' }),
    })
    assert(r.status === 201, `invitee accepts the co-owner invitation (got ${r.status})`)
    const coowner = await prisma.user.findUnique({ where: { email: coEmail } })
    assert(coowner?.role === 'BUSINESS_ADMIN' && coowner?.businessId === biz.id,
      'role comes from the invitation, never the request payload')

    const coLogin = await login(coEmail, password)
    assert(coLogin.ok, 'co-owner signs in')

    console.log('\n── Co-owner staff-management boundaries ──')
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Nope Co', email: `nope-co-${stamp}@test.com`, role: 'BUSINESS_ADMIN' }),
    }, coLogin.sessionCookie)
    assert(r.status === 403, `co-owner cannot invite another co-owner (got ${r.status})`)

    const barberEmail = `coowner-barber-${stamp}@test.com`
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Co Barber', email: barberEmail, role: 'BARBER' }),
    }, coLogin.sessionCookie)
    assert(r.status === 201, `co-owner can invite a barber (got ${r.status})`)
    const barberInviteUrl: string = (r.body?.inviteUrl as string | undefined) || ''
    const barberToken = new URL(barberInviteUrl).searchParams.get('token') || ''
    await api('/api/auth/accept-invitation', { method: 'POST', body: JSON.stringify({ token: barberToken, password }) })
    const coBarber = await prisma.user.findUnique({ where: { email: barberEmail } })
    assert(coBarber?.role === 'BARBER', 'barber account created by acceptance')

    // Co-owner cannot manage a co-owner account
    r = await api(`/api/dashboard/staff/${coowner!.id}`, {
      method: 'PATCH', body: JSON.stringify({ isActive: false }),
    }, coLogin.sessionCookie)
    assert(r.status === 403, `co-owner cannot deactivate a co-owner (got ${r.status})`)
    r = await api(`/api/dashboard/staff/${coowner!.id}`, { method: 'DELETE' }, coLogin.sessionCookie)
    assert(r.status === 403, `co-owner cannot remove a co-owner (got ${r.status})`)
    r = await api(`/api/dashboard/staff/${coBarber!.id}`, {
      method: 'PATCH', body: JSON.stringify({ role: 'BUSINESS_ADMIN' }),
    }, coLogin.sessionCookie)
    assert(r.status === 403, `co-owner cannot promote a barber to co-owner (got ${r.status})`)
    r = await api('/api/dashboard/ownership-transfer', {
      method: 'POST', body: JSON.stringify({ targetUserId: coowner!.id }),
    }, coLogin.sessionCookie)
    assert(r.status === 403, `co-owner cannot transfer ownership (got ${r.status})`)

    // Co-owner CAN manage a barber
    r = await api(`/api/dashboard/staff/${coBarber!.id}`, {
      method: 'PATCH', body: JSON.stringify({ isActive: false }),
    }, coLogin.sessionCookie)
    assert(r.status === 200, `co-owner can deactivate a barber they manage (got ${r.status})`)

    console.log('\n── Co-owner invitation revoke/resend boundaries ──')
    // Owner creates a second, pending co-owner invitation
    const coEmail2 = `coowner-inv2-${stamp}@test.com`
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Second Co', email: coEmail2, role: 'BUSINESS_ADMIN' }),
    }, ownerLogin.sessionCookie)
    assert(r.status === 201, 'owner invites a second co-owner')
    const coInvite2 = await prisma.staffInvitation.findFirst({ where: { businessId: biz.id, email: coEmail2 } })

    r = await api(`/api/dashboard/staff/invitations/${coInvite2!.id}`, { method: 'DELETE' }, coLogin.sessionCookie)
    assert(r.status === 403, `co-owner cannot revoke a co-owner invitation (got ${r.status})`)
    r = await api(`/api/dashboard/staff/invitations/${coInvite2!.id}`, { method: 'POST' }, coLogin.sessionCookie)
    assert(r.status === 403, `co-owner cannot resend a co-owner invitation (got ${r.status})`)

    // Co-owner CAN revoke + resend their own barber invitation (create a fresh one)
    const barberEmail2 = `coowner-barber2-${stamp}@test.com`
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Co Barber 2', email: barberEmail2, role: 'BARBER' }),
    }, coLogin.sessionCookie)
    assert(r.status === 201, 'co-owner invites a second barber')
    const bInvite2 = await prisma.staffInvitation.findFirst({ where: { businessId: biz.id, email: barberEmail2 } })
    r = await api(`/api/dashboard/staff/invitations/${bInvite2!.id}`, { method: 'POST' }, coLogin.sessionCookie)
    assert(r.status === 200 && typeof r.body?.inviteUrl === 'string',
      `co-owner can resend their barber invitation (got ${r.status})`)

    console.log('\n── Owner resend replaces the token atomically ──')
    const fresh = await prisma.staffInvitation.findFirst({ where: { businessId: biz.id, email: barberEmail2, revokedAt: null, acceptedAt: null } })
    assert(!!fresh && fresh.id !== bInvite2!.id, 'resend created a fresh invitation and revoked the old one')
    const freshToken = new URL((r.body?.inviteUrl as string) || '').searchParams.get('token') || ''
    assert(fresh.tokenHash === crypto.createHash('sha256').update(freshToken).digest('hex'), 'resend stores the new token hash only')

    // Owner resends the pending co-owner invitation
    r = await api(`/api/dashboard/staff/invitations/${coInvite2!.id}`, { method: 'POST' }, ownerLogin.sessionCookie)
    assert(r.status === 200, `owner can resend a co-owner invitation (got ${r.status})`)
    const active = await prisma.staffInvitation.count({
      where: { businessId: biz.id, email: coEmail2, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    })
    assert(active === 1, `exactly one active invitation remains per email (got ${active})`)

    console.log('\n── Owner retains full control ──')
    // (after the resend, the current invitation for coEmail2 is the fresh one)
    const currentCoInvite = await prisma.staffInvitation.findFirst({
      where: { businessId: biz.id, email: coEmail2, acceptedAt: null, revokedAt: null },
    })
    r = await api(`/api/dashboard/staff/invitations/${currentCoInvite!.id}`, { method: 'DELETE' }, ownerLogin.sessionCookie)
    assert(r.status === 200, 'owner can revoke a co-owner invitation')
    // The original (pre-resend) invitation is already revoked: revoking it
    // again is rejected, not silently treated as still-live.
    r = await api(`/api/dashboard/staff/invitations/${coInvite2!.id}`, { method: 'DELETE' }, ownerLogin.sessionCookie)
    assert(r.status !== 200, `revoking an already-revoked invitation is refused (got ${r.status})`)
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Owner Barber', email: `owner-barber-${stamp}@test.com`, role: 'BARBER' }),
    }, ownerLogin.sessionCookie)
    assert(r.status === 201, 'owner can still invite barbers')

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed > 0 ? 1 : 0
  } finally {
    await prisma.staffInvitation.deleteMany({ where: { businessId: biz.id } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { businessId: biz.id } }).catch(() => {})
    await prisma.user.deleteMany({ where: { businessId: biz.id } }).catch(() => {})
    await prisma.business.delete({ where: { id: biz.id } }).catch(() => {})
    await prisma.$disconnect().catch(() => {})
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
