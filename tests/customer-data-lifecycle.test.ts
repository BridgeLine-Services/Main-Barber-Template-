// Customer data lifecycle (§21) tests. Requires a live server on :3000
// and DATABASE_URL.
//
// Proves:
//  * archive hides the customer but preserves all data and reporting
//  * anonymize is irreversible, requires an explicit confirm token, and
//    scrubs PII while appointment history stays intact and reportable
//  * portal sessions are revoked on anonymization
//  * the customer self-service export is portal-session-scoped and never
//    contains another customer's data
//  * deletion is owner-only and business-scoped
//  * destructive actions are audited

import { prisma } from '../src/lib/prisma'
import { hashValue, PORTAL_SESSION_COOKIE } from '../src/lib/portal-security'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const BASE = 'http://localhost:3000'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
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

async function api(path: string, init: RequestInit = {}, cookie: string = '', extraHeaders: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie: cookiePairs(cookie) } : {}), ...extraHeaders, ...(init.headers || {}) },
  })
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* CSV etc. */ }
  return { status: res.status, body, text }
}

async function main() {
  const stamp = Date.now()
  const passwordHash = await bcrypt.hash('TestPass123!', 10)

  const biz = await prisma.business.create({ data: { name: 'Lifecycle Shop', slug: `life-a-${stamp}`, timezone: 'America/Los_Angeles' } })
  const bizB = await prisma.business.create({ data: { name: 'Lifecycle Shop B', slug: `life-b-${stamp}`, timezone: 'America/Los_Angeles' } })
  const owner = await prisma.user.create({ data: { email: `owner.life-${stamp}@t.test`, passwordHash, name: 'Life Owner', role: 'OWNER', businessId: biz.id } })
  const ownerB = await prisma.user.create({ data: { email: `ownerb.life-${stamp}@t.test`, passwordHash, name: 'Life Owner B', role: 'OWNER', businessId: bizB.id } })
  const barberRow = await prisma.barber.create({ data: { name: 'Life Barber', businessId: biz.id } })
  const barberUser = await prisma.user.create({ data: { email: `barber.life-${stamp}@t.test`, passwordHash, name: 'Life Barber User', role: 'BARBER', businessId: biz.id, barberId: barberRow.id } })
  const svc = await prisma.service.create({ data: { name: `Life Cut ${stamp}`, businessId: biz.id, duration: 30, price: 25, isActive: true } })

  const secretNote = `PRIVATE-NOTE-${stamp}`
  const custA = await prisma.customer.create({ data: { firstName: 'Alpha', lastName: 'Archived', phone: '555-010-0001', email: `alpha-${stamp}@t.test`, businessId: biz.id, notes: secretNote, tags: ['vip'], smsConsent: true } })
  const custB = await prisma.customer.create({ data: { firstName: 'Beta', lastName: 'Anonymized', phone: '555-010-0002', email: `beta-${stamp}@t.test`, businessId: biz.id, notes: `BETA-NOTE-${stamp}` } })
  const custC = await prisma.customer.create({ data: { firstName: 'Gamma', lastName: 'Portal', phone: '555-010-0003', email: `gamma-${stamp}@t.test`, businessId: biz.id } })

  const mkAppt = (n: string, custId: string, status: 'COMPLETED' | 'CONFIRMED', notes: string | null) =>
    prisma.appointment.create({ data: { confirmationNumber: `LIFE-${n}-${stamp}`, customerAccessToken: `tok-${n}-${stamp}`, businessId: biz.id, customerId: custId, barberId: barberRow.id, serviceId: svc.id, startTime: new Date(Date.now() - 86400e3), endTime: new Date(Date.now() - 86400e3 + 30 * 60e3), status, customerNotes: notes } })
  await mkAppt('A1', custA.id, 'COMPLETED', `A-NOTE-${stamp}`)
  await mkAppt('B1', custB.id, 'COMPLETED', `B-NOTE-${stamp}`)
  const apptC = await mkAppt('C1', custC.id, 'CONFIRMED', null)

  // Active portal session for custC (self-export) and for custB (revocation check).
  const portalTokenC = crypto.randomBytes(32).toString('hex')
  const portalTokenB = crypto.randomBytes(32).toString('hex')
  const hostHeader = { 'x-forwarded-host': `life-a-${stamp}` }
  await prisma.portalSession.create({ data: { businessId: biz.id, customerId: custC.id, tokenHash: hashValue(portalTokenC), expiresAt: new Date(Date.now() + 30 * 60e3) } })
  const sessionB = await prisma.portalSession.create({ data: { businessId: biz.id, customerId: custB.id, tokenHash: hashValue(portalTokenB), expiresAt: new Date(Date.now() + 30 * 60e3) } })

  const ownerLogin = await login(owner.email, 'TestPass123!')
  assert(ownerLogin.ok, 'owner signed in')
  const O = ownerLogin.sessionCookie
  const barberLogin = await login(barberUser.email, 'TestPass123!')
  assert(barberLogin.ok, 'barber signed in')
  const ownerBLogin = await login(ownerB.email, 'TestPass123!')
  const OB = ownerBLogin.sessionCookie

  try {
    console.log('\n  --- Owner-only + business-scoped deletion ---')

    const barberDel = await api(`/api/dashboard/customers/${custA.id}`, { method: 'DELETE' }, barberLogin.sessionCookie)
    assert(barberDel.status === 403, `barber cannot delete/anonymize customers (got ${barberDel.status})`)

    const anonDel = await api(`/api/dashboard/customers/${custA.id}`, { method: 'DELETE' })
    assert(anonDel.status === 401, `anonymous cannot delete customers (got ${anonDel.status})`)

    const crossDel = await api(`/api/dashboard/customers/${custA.id}`, { method: 'DELETE' }, OB)
    assert(crossDel.status === 404, `Business B owner cannot archive Business A customer (got ${crossDel.status})`)

    console.log('\n  --- Anonymize requires explicit confirmation ---')

    const noConfirm = await api(`/api/dashboard/customers/${custB.id}`, { method: 'DELETE', body: JSON.stringify({ mode: 'anonymize' }) }, O)
    assert(noConfirm.status === 400, `anonymize without confirm token rejected (got ${noConfirm.status})`)
    const unchanged = await prisma.customer.findUnique({ where: { id: custB.id } })
    assert(unchanged?.email === `beta-${stamp}@t.test`, 'customer unchanged after rejected anonymization')

    console.log('\n  --- Archive: reversible, preserves data, hides from lists ---')

    const archive = await api(`/api/dashboard/customers/${custA.id}`, { method: 'DELETE' }, O)
    assert(archive.status === 200 && archive.body?.mode === 'archive' && archive.body?.reversible === true, 'archive mode works and is marked reversible')
    const listRes = await api('/api/dashboard/customers', {}, O)
    const listText = JSON.stringify(listRes.body)
    assert(!listText.includes(`alpha-${stamp}@t.test`), 'archived customer hidden from dashboard customers list')
    const kept = await prisma.customer.findUnique({ where: { id: custA.id } })
    assert(kept?.notes === secretNote && kept?.firstName === 'Alpha', 'archived customer data fully preserved')

    console.log('\n  --- Anonymize: PII scrubbed, history preserved ---')

    const anon = await api(`/api/dashboard/customers/${custB.id}`, { method: 'DELETE', body: JSON.stringify({ mode: 'anonymize', confirm: 'ANONYMIZE' }) }, O)
    assert(anon.status === 200 && anon.body?.mode === 'anonymize' && anon.body?.reversible === false, 'anonymize mode works and is marked irreversible')
    const scrubbed = await prisma.customer.findUnique({ where: { id: custB.id } })
    assert(scrubbed?.firstName === 'Removed' && scrubbed?.lastName === 'Customer', 'name scrubbed')
    assert(scrubbed?.phone === 'deleted' && scrubbed?.email.startsWith('anonymized-'), 'contact info scrubbed')
    assert(scrubbed?.notes === null && (scrubbed?.tags ?? []).length === 0 && scrubbed?.smsConsent === false, 'notes, tags, and consent scrubbed')
    assert(!!scrubbed?.archivedAt, 'anonymized customer is archived')

    const apptsB = await prisma.appointment.findMany({ where: { customerId: custB.id } })
    assert(apptsB.length === 1 && apptsB[0].status === 'COMPLETED', 'appointment row preserved with original status after anonymization')
    assert(apptsB[0].customerNotes === null, 'appointment free-text notes scrubbed')

    const revoked = await prisma.portalSession.findUnique({ where: { id: sessionB.id } })
    assert(!!revoked?.revokedAt, 'portal sessions revoked on anonymization')

    const apptCount = await prisma.appointment.count({ where: { businessId: biz.id } })
    assert(apptCount === 3, 'business appointment history intact for reporting after all lifecycle actions')

    console.log('\n  --- Audit trail ---')
    const audits = await prisma.auditLog.count({ where: { businessId: biz.id, entityType: 'Customer', action: 'CUSTOMER_ARCHIVED' } })
    assert(audits >= 2, 'both destructive actions audited')

    console.log('\n  --- Customer self-service export (portal session only) ---')

    const portalCookie = `${PORTAL_SESSION_COOKIE}=${portalTokenC}`
    const noSession = await api('/api/public/portal/data-export', {}, '', hostHeader)
    assert(noSession.status === 401, `portal export without session rejected (got ${noSession.status})`)

    const exportRes = await api('/api/public/portal/data-export', {}, portalCookie, hostHeader)
    assert(exportRes.status === 200, `portal export with session works (got ${exportRes.status})`)
    assert(exportRes.text.includes(`gamma-${stamp}@t.test`), 'export contains own profile')
    assert(exportRes.text.includes(apptC.confirmationNumber), 'export contains own appointment')
    assert(!exportRes.text.includes(`alpha-${stamp}@t.test`) && !exportRes.text.includes(`beta-${stamp}@t.test`), 'export never contains other customers')
    assert(!exportRes.text.includes('TestPass'), 'export contains no credentials')
    assert((exportRes.body?.appointments ?? []).every((a: any) => a.confirmationNumber.startsWith('LIFE-')), 'export appointments scoped to own business')

    // A portal session for Business A cannot read data under Business B's host.
    const wrongHost = await api('/api/public/portal/data-export', {}, portalCookie, { 'x-forwarded-host': `life-b-${stamp}` })
    assert(wrongHost.status === 401, 'portal token does not work against another business host')

    // Export response must be no-store (private data).
    const rawExport = await fetch(`${BASE}/api/public/portal/data-export`, { headers: { cookie: portalCookie, 'x-forwarded-host': `life-a-${stamp}` } })
    assert((rawExport.headers.get('cache-control') || '').includes('no-store'), 'export served with Cache-Control: no-store')

    console.log('\n  --- Business CSV export flags archived customers ---')
    const csvRes = await api('/api/dashboard/customers/export', {}, O)
    assert(csvRes.status === 200, 'CSV export works')
    assert(csvRes.text.includes('Archived'), 'CSV export has an Archived column')
    assert(csvRes.text.includes('Yes'), 'archived customer flagged in CSV')
    assert(!csvRes.text.includes(`beta-${stamp}@t.test`), 'anonymized customer PII absent from CSV')
  } finally {
    // ── cleanup ────────────────────────────────────────────────────────
    await prisma.portalSession.deleteMany({ where: { businessId: { in: [biz.id, bizB.id] } } })
    await prisma.auditLog.deleteMany({ where: { businessId: { in: [biz.id, bizB.id] } } })
    await prisma.appointment.deleteMany({ where: { businessId: { in: [biz.id, bizB.id] } } })
    await prisma.customer.deleteMany({ where: { businessId: { in: [biz.id, bizB.id] } } })
    await prisma.service.deleteMany({ where: { businessId: { in: [biz.id, bizB.id] } } })
    await prisma.user.deleteMany({ where: { businessId: { in: [biz.id, bizB.id] } } })
    await prisma.barber.deleteMany({ where: { businessId: { in: [biz.id, bizB.id] } } })
    await prisma.business.deleteMany({ where: { id: { in: [biz.id, bizB.id] } } })
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Customer data lifecycle tests: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Test runner crashed:', e)
  process.exit(1)
})
