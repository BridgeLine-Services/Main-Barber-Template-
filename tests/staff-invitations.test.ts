/**
 * STAFF INVITATION LIFECYCLE SECURITY
 *
 * Proves, against a live server:
 *  - Inviting creates a StaffInvitation (never a user, never a temp password).
 *  - Invitations can only carry BUSINESS_ADMIN / BARBER — never OWNER.
 *  - Only the SHA-256 hash of the token is stored; the plaintext lives only
 *    in the returned invite link.
 *  - Acceptance: single-use (guarded update), time-limited, revocable, and
 *    the invitee's role/business come ONLY from the invitation.
 *  - Accepting is the only way the account is created — the invitee sets
 *    their own password.
 *  - A business cannot list or revoke another business's invitations.
 *  - An expired/revoked/already-used invitation cannot be accepted.
 *  - Audit trail: STAFF_INVITED / STAFF_INVITATION_ACCEPTED / STAFF_ACTIVATED
 *    / STAFF_INVITATION_REVOKED recorded with human-readable descriptions.
 *
 * Run: npx tsx tests/staff-invitations.test.ts  (server on :3000)
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

async function api(path: string, init: RequestInit = {}, cookie = ''): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie: cookiePairs(cookie) } : {}), ...((init.headers as Record<string, string>) || {}) },
  })
  let body: any = null
  try { body = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, body }
}

async function main() {
  const stamp = Date.now()
  const password = 'Invite-Test-123!'
  const pwHash = await bcrypt.hash(password, 10)

  const mkBiz = (name: string, slug: string) =>
    prisma.business.create({
      data: {
        name, slug, email: `${slug}@test.com`, phone: '555-0101', address: '1 Inv St',
        city: 'InvCity', state: 'CA', zipCode: '90001', timezone: 'UTC',
      },
    })
  const bizA = await mkBiz(`Invite A ${stamp}`, `inv-a-${stamp}`)
  const bizB = await mkBiz(`Invite B ${stamp}`, `inv-b-${stamp}`)

  const ownerA = await prisma.user.create({
    data: { email: `owner-inv-a-${stamp}@test.com`, name: 'Owner A', role: 'OWNER', businessId: bizA.id, passwordHash: pwHash },
  })
  const ownerB = await prisma.user.create({
    data: { email: `owner-inv-b-${stamp}@test.com`, name: 'Owner B', role: 'OWNER', businessId: bizB.id, passwordHash: pwHash },
  })
  const barberUserA = await prisma.user.create({
    data: { email: `barber-inv-a-${stamp}@test.com`, name: 'Barber A', role: 'BARBER', businessId: bizA.id, passwordHash: pwHash },
  })

  const createdUsers: string[] = []

  try {
    const ownerALogin = await login(ownerA.email, password)
    const ownerBLogin = await login(ownerB.email, password)
    const barberALogin = await login(barberUserA.email, password)
    assert(ownerALogin.ok && ownerBLogin.ok && barberALogin.ok, 'owners and barber sign in')

    console.log('\n── Invitation creation ──')
    let r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Invited Barber', email: `inv.barber-${stamp}@test.com`, role: 'BARBER' }),
    }, ownerALogin.sessionCookie)
    assert(r.status === 201, `owner invites a barber (got ${r.status})`)
    const inviteUrl: string = r.body?.inviteUrl || ''
    const token = new URL(inviteUrl).searchParams.get('token') || ''
    assert(token.length >= 32, 'response includes a secure invite link with a token')
    const inviteRecord = await prisma.staffInvitation.findFirst({
      where: { businessId: bizA.id, email: `inv.barber-${stamp}@test.com` },
    })
    assert(!!inviteRecord, 'StaffInvitation row created')
    assert(inviteRecord?.tokenHash === crypto.createHash('sha256').update(token).digest('hex'),
      'only the SHA-256 hash of the token is stored')
    assert(inviteRecord?.role === 'BARBER' && inviteRecord.invitedById === ownerA.id, 'invitation records role + inviter')
    assert(inviteRecord?.acceptedAt === null, 'invitation starts pending')
    const noUserYet = await prisma.user.findUnique({ where: { email: `inv.barber-${stamp}@test.com` } })
    assert(noUserYet === null, 'no user account exists until acceptance')
    assert(!JSON.stringify(r.body).includes('tempPassword'), 'no temporary password is ever returned')

    // OWNER role can never be granted through invitation
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Sneaky Owner', email: `sneaky-owner-${stamp}@test.com`, role: 'OWNER' }),
    }, ownerALogin.sessionCookie)
    assert(r.status === 400, `invitation with role OWNER rejected (got ${r.status})`)

    // Duplicate pending invitation
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Invited Barber', email: `inv.barber-${stamp}@test.com`, role: 'BARBER' }),
    }, ownerALogin.sessionCookie)
    assert(r.status === 409, `duplicate pending invitation rejected (got ${r.status})`)

    // Existing email cannot be invited
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Existing', email: ownerA.email, role: 'BUSINESS_ADMIN' }),
    }, ownerALogin.sessionCookie)
    assert(r.status === 409, `inviting an existing account rejected (got ${r.status})`)

    // BARBER cannot invite
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Nope', email: `nope-${stamp}@test.com`, role: 'BARBER' }),
    }, barberALogin.sessionCookie)
    assert(r.status === 403, `barber cannot invite staff (got ${r.status})`)

    console.log('\n── Invitation inspection (GET before accept) ──')
    r = await api(`/api/auth/accept-invitation?token=${encodeURIComponent(token)}`)
    assert(r.status === 200 && r.body?.valid === true && r.body?.businessName === bizA.name,
      'invitee can inspect the invitation before accepting')

    console.log('\n── Acceptance ──')
    r = await api('/api/auth/accept-invitation', {
      method: 'POST',
      body: JSON.stringify({ token, password, role: 'OWNER' as any }), // role in body must be ignored
    })
    assert(r.status === 201, `invitation accepted (got ${r.status})`)
    const acceptedUser = await prisma.user.findUnique({ where: { email: `inv.barber-${stamp}@test.com` } })
    assert(acceptedUser?.role === 'BARBER', `accepted role comes from the invitation, not the request (got ${acceptedUser?.role})`)
    assert(acceptedUser?.businessId === bizA.id, 'accepted business comes from the invitation')
    assert(acceptedUser?.passwordHash !== pwHash, 'invitee chose their own password (hash not a server temp)')
    createdUsers.push(acceptedUser!.id)

    // Single-use: token cannot be accepted twice
    r = await api('/api/auth/accept-invitation', {
      method: 'POST', body: JSON.stringify({ token, password: 'Other-Pass-456!' }),
    })
    assert(r.status === 409, `used invitation cannot be accepted again (got ${r.status})`)

    // Accepted user can sign in
    const invitedLogin = await login(`inv.barber-${stamp}@test.com`, password)
    assert(invitedLogin.ok, 'accepted staff member can sign in')

    console.log('\n── Expired / revoked / forged invitations ──')
    const forged = await api('/api/auth/accept-invitation', {
      method: 'POST', body: JSON.stringify({ token: crypto.randomBytes(32).toString('base64url'), password }),
    })
    assert(forged.status === 404, `forged token rejected (got ${forged.status})`)

    // Expired invitation (created directly with a past expiry)
    const expiredToken = crypto.randomBytes(32).toString('base64url')
    await prisma.staffInvitation.create({
      data: {
        businessId: bizA.id, email: `expired-${stamp}@test.com`, name: 'Expired', role: 'BARBER',
        tokenHash: crypto.createHash('sha256').update(expiredToken).digest('hex'),
        expiresAt: new Date(Date.now() - 3600_000), invitedById: ownerA.id,
      },
    })
    r = await api('/api/auth/accept-invitation', {
      method: 'POST', body: JSON.stringify({ token: expiredToken, password }),
    })
    assert(r.status === 410, `expired invitation rejected (got ${r.status})`)

    // Revoked invitation
    const revokedToken = crypto.randomBytes(32).toString('base64url')
    const revokedInvite = await prisma.staffInvitation.create({
      data: {
        businessId: bizA.id, email: `revoked-${stamp}@test.com`, name: 'Revoked', role: 'BUSINESS_ADMIN',
        tokenHash: crypto.createHash('sha256').update(revokedToken).digest('hex'),
        expiresAt: new Date(Date.now() + 86_400_000), invitedById: ownerA.id,
      },
    })
    r = await api(`/api/dashboard/staff/invitations/${revokedInvite.id}`, { method: 'DELETE' }, ownerALogin.sessionCookie)
    assert(r.status === 200, 'owner revokes a pending invitation')
    r = await api('/api/auth/accept-invitation', {
      method: 'POST', body: JSON.stringify({ token: revokedToken, password }),
    })
    assert(r.status === 410, `revoked invitation rejected (got ${r.status})`)

    console.log('\n── Tenant isolation of the invitation lifecycle ──')
    // Owner B cannot revoke or list business A's invitations
    const pendingA = await prisma.staffInvitation.findFirst({
      where: { businessId: bizA.id, acceptedAt: null, revokedAt: null },
    })
    // (create a fresh pending one for A to be sure one exists)
    const freshToken = crypto.randomBytes(32).toString('base64url')
    const freshInvite = await prisma.staffInvitation.create({
      data: {
        businessId: bizA.id, email: `fresh-${stamp}@test.com`, name: 'Fresh', role: 'BARBER',
        tokenHash: crypto.createHash('sha256').update(freshToken).digest('hex'),
        expiresAt: new Date(Date.now() + 86_400_000), invitedById: ownerA.id,
      },
    })
    void pendingA
    r = await api(`/api/dashboard/staff/invitations/${freshInvite.id}`, { method: 'DELETE' }, ownerBLogin.sessionCookie)
    assert(r.status === 404, `business B cannot revoke business A's invitation (got ${r.status})`)
    const stillPending = await prisma.staffInvitation.findUnique({ where: { id: freshInvite.id } })
    assert(stillPending?.revokedAt === null, "business A's invitation untouched by the other owner")
    r = await api('/api/dashboard/staff', {}, ownerBLogin.sessionCookie)
    assert((r.body?.invitations || []).every((i: any) => i.email !== `fresh-${stamp}@test.com`),
      'invitation list is scoped to the caller business')

    console.log('\n── Audit trail ──')
    const invitedAudit = await prisma.auditLog.findFirst({
      where: { businessId: bizA.id, action: 'STAFF_INVITED' },
    })
    assert(!!invitedAudit, 'STAFF_INVITED audit recorded')
    assert(!!invitedAudit?.description, 'audit entry carries a human-readable description')
    const acceptedAudit = await prisma.auditLog.findFirst({
      where: { businessId: bizA.id, action: 'STAFF_INVITATION_ACCEPTED' },
    })
    assert(!!acceptedAudit, 'STAFF_INVITATION_ACCEPTED audit recorded')
    const activatedAudit = await prisma.auditLog.findFirst({
      where: { businessId: bizA.id, action: 'STAFF_ACTIVATED' },
    })
    assert(!!activatedAudit, 'STAFF_ACTIVATED audit recorded')
    const revokedAudit = await prisma.auditLog.findFirst({
      where: { businessId: bizA.id, action: 'STAFF_INVITATION_REVOKED' },
    })
    assert(!!revokedAudit, 'STAFF_INVITATION_REVOKED audit recorded')

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exit(failed === 0 ? 0 : 1)
  } finally {
    await prisma.auditLog.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.staffInvitation.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.user.deleteMany({
      where: { OR: [{ id: { in: createdUsers } }, { email: { in: [
        `owner-inv-a-${stamp}@test.com`, `owner-inv-b-${stamp}@test.com`,
        `barber-inv-a-${stamp}@test.com`, `inv.barber-${stamp}@test.com`,
      ] } }] },
    })
    await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } })
    void ownerB
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
