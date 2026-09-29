// Cross-tenant IDOR matrix (§8/§14 tenant isolation, Phase 3).
// Requires a live server on :3000 and DATABASE_URL.
//
// For every business-scoped dashboard API route, an authenticated user of
// Business A attempts to read, mutate, and delete Business B's resources
// by ID. Each attempt must fail without leaking or altering B's data.
// List/export endpoints must never include B's records.
//
// This suite proves HTTP-level tenant isolation end to end (auth ->
// business resolution -> query scope), complementing the DB-query-level
// tests in tenant-isolation.test.ts.

import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcryptjs'

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
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

async function api(path: string, init: RequestInit = {}, cookie: string = ''): Promise<{ status: number; body: any; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie: cookiePairs(cookie) } : {}), ...(init.headers || {}) },
  })
  let body: any = null
  const text = await res.text()
  try { body = JSON.parse(text) } catch { /* non-JSON (e.g. CSV) */ }
  return { status: res.status, body, text }
}

/** An attack attempt "succeeds safely" if it did not return 200 AND the
 * response contains none of B's sensitive marker strings. */
function safeAttempt(res: { status: number; body: any; text: string }, markers: string[], label: string) {
  const leaked = markers.filter((m) => res.text.includes(m))
  assert(res.status !== 200 && leaked.length === 0, `${label} blocked (status ${res.status}${leaked.length ? ', LEAKED: ' + leaked.join(', ') : ''})`)
}

async function main() {
  const stamp = Date.now()
  const passwordHash = await bcrypt.hash('TestPass123!', 10)

  // ── fixtures ──────────────────────────────────────────────────────────
  const bizA = await prisma.business.create({ data: { name: 'Matrix Shop A', slug: `matrix-a-${stamp}`, timezone: 'America/Los_Angeles' } })
  const bizB = await prisma.business.create({ data: { name: 'Matrix Shop B', slug: `matrix-b-${stamp}`, timezone: 'America/Los_Angeles' } })

  const ownerA = await prisma.user.create({ data: { email: `owner.a-${stamp}@matrix.test`, passwordHash, name: 'Owner A', role: 'OWNER', businessId: bizA.id } })
  const barberA = await prisma.barber.create({ data: { name: 'Barber A', businessId: bizA.id } })
  const serviceA = await prisma.service.create({ data: { name: 'Matrix Cut A', businessId: bizA.id, duration: 30, price: 20, isActive: true } })
  const customerA = await prisma.customer.create({ data: { firstName: 'Ann', lastName: 'Alpha', phone: '111-111-1111', email: `ann.a-${stamp}@matrix.test`, businessId: bizA.id } })
  await prisma.appointment.create({ data: { confirmationNumber: `MXA-${stamp}-1`, customerAccessToken: `tok-a-${stamp}`, businessId: bizA.id, customerId: customerA.id, barberId: barberA.id, serviceId: serviceA.id, startTime: new Date(Date.now() + 3600e3), endTime: new Date(Date.now() + 5400e3), status: 'CONFIRMED' } })

  await prisma.user.create({ data: { email: `owner.b-${stamp}@matrix.test`, passwordHash, name: 'Owner B', role: 'OWNER', businessId: bizB.id } })
  const barberB = await prisma.barber.create({ data: { name: 'Barber B', businessId: bizB.id } })
  const serviceB = await prisma.service.create({ data: { name: 'Matrix Cut B', businessId: bizB.id, duration: 45, price: 35, isActive: true } })
  const customerB = await prisma.customer.create({ data: { firstName: 'Bob', lastName: 'Beta', phone: '222-222-2222', email: `bob.b-${stamp}@matrix.test`, businessId: bizB.id, notes: `SECRET-NOTE-B-${stamp}` } })
  const apptB = await prisma.appointment.create({ data: { confirmationNumber: `MXB-${stamp}-1`, customerAccessToken: `tok-b-${stamp}`, businessId: bizB.id, customerId: customerB.id, barberId: barberB.id, serviceId: serviceB.id, startTime: new Date(Date.now() + 3600e3), endTime: new Date(Date.now() + 7200e3), status: 'CONFIRMED' } })
  const faqB = await prisma.faq.create({ data: { category: 'General', question: `B question ${stamp}`, answer: `B answer ${stamp}`, businessId: bizB.id } })
  const campaignB = await prisma.marketingCampaign.create({ data: { name: `B Campaign ${stamp}`, subject: `B subject ${stamp}`, body: `B body ${stamp}`, audience: 'ALL_CUSTOMERS', status: 'DRAFT', businessId: bizB.id } })
  const closureB = await prisma.businessClosure.create({ data: { title: `B Holiday ${stamp}`, startDate: new Date('2026-12-25'), endDate: new Date('2026-12-25'), businessId: bizB.id } })
  const blockedB = await prisma.blockedTime.create({ data: { businessId: bizB.id, barberId: barberB.id, startTime: new Date(Date.now() + 86400e3), endTime: new Date(Date.now() + 90000e3), reason: `B block ${stamp}` } })
  const inventoryB = await prisma.inventoryItem.create({ data: { name: `B Product ${stamp}`, businessId: bizB.id, stock: 5 } })
  const reviewB = await prisma.review.create({ data: { businessId: bizB.id, authorName: `B Reviewer ${stamp}`, rating: 5, comment: `B comment ${stamp}` } })
  const staffUserB = await prisma.user.create({ data: { email: `barber.b-${stamp}@matrix.test`, passwordHash, name: 'Barber B User', role: 'BARBER', businessId: bizB.id, barberId: barberB.id } })
  const overrideB = await prisma.availabilityOverride.create({ data: { businessId: bizB.id, barberId: barberB.id, date: new Date('2026-10-15'), isAvailable: false, reason: `B off ${stamp}` } })

  // Snapshot B's data (mutation-diff after the attack matrix).
  const snapshot = async () => ({
    appt: await prisma.appointment.findUnique({ where: { id: apptB.id } }),
    barber: await prisma.barber.findUnique({ where: { id: barberB.id } }),
    service: await prisma.service.findUnique({ where: { id: serviceB.id } }),
    customer: await prisma.customer.findUnique({ where: { id: customerB.id } }),
    faq: await prisma.faq.findUnique({ where: { id: faqB.id } }),
    campaign: await prisma.marketingCampaign.findUnique({ where: { id: campaignB.id } }),
    closure: await prisma.businessClosure.findUnique({ where: { id: closureB.id } }),
    blocked: await prisma.blockedTime.findUnique({ where: { id: blockedB.id } }),
    inventory: await prisma.inventoryItem.findUnique({ where: { id: inventoryB.id } }),
    review: await prisma.review.findUnique({ where: { id: reviewB.id } }),
    override: await prisma.availabilityOverride.findUnique({ where: { id: overrideB.id } }),
    business: await prisma.business.findUnique({ where: { id: bizB.id } }),
  })
  const strip = (o: any) => JSON.stringify(o, (k, v) => (k === 'updatedAt' ? undefined : v))
  const before = await snapshot()

  // Markers that must never appear in a response to A.
  const M = {
    confirm: `MXB-${stamp}-1`,
    email: `bob.b-${stamp}@matrix.test`,
    secretNote: `SECRET-NOTE-B-${stamp}`,
    campaign: `B Campaign ${stamp}`,
    faq: `B question ${stamp}`,
    service: 'Matrix Cut B',
    barber: 'Barber B',
    inventory: `B Product ${stamp}`,
    review: `B comment ${stamp}`,
    closure: `B Holiday ${stamp}`,
  }

  const loginA = await login(ownerA.email, 'TestPass123!')
  assert(loginA.ok, 'owner A signed in')
  const A = loginA.sessionCookie

  try {
    console.log('\n  --- IDOR matrix: A attacking B by ID ---')

    // Appointments
    safeAttempt(await api(`/api/dashboard/appointments/${apptB.id}`, {}, A), [M.confirm], 'GET B appointment')
    safeAttempt(await api(`/api/dashboard/appointments/${apptB.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }) }, A), [M.confirm], 'PATCH B appointment')
    safeAttempt(await api(`/api/dashboard/appointments/${apptB.id}`, { method: 'DELETE' }, A), [M.confirm], 'DELETE B appointment')

    // Barbers
    safeAttempt(await api(`/api/dashboard/barbers/${barberB.id}`, {}, A), [M.barber], 'GET B barber')
    safeAttempt(await api(`/api/dashboard/barbers/${barberB.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Hacked' }) }, A), [M.barber], 'PATCH B barber')
    safeAttempt(await api(`/api/dashboard/barbers/${barberB.id}`, { method: 'DELETE' }, A), [M.barber], 'DELETE B barber')

    // Onboarding team (same barber via onboarding surface)
    safeAttempt(await api(`/api/dashboard/onboarding/team/${barberB.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Hacked' }) }, A), [M.barber], 'PATCH B barber via onboarding/team')
    safeAttempt(await api(`/api/dashboard/onboarding/team/${barberB.id}`, { method: 'DELETE' }, A), [M.barber], 'DELETE B barber via onboarding/team')

    // Services
    safeAttempt(await api(`/api/dashboard/services/${serviceB.id}`, {}, A), [M.service], 'GET B service')
    safeAttempt(await api(`/api/dashboard/services/${serviceB.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Hacked', price: 0 }) }, A), [M.service], 'PATCH B service')
    safeAttempt(await api(`/api/dashboard/services/${serviceB.id}`, { method: 'DELETE' }, A), [M.service], 'DELETE B service')
    safeAttempt(await api(`/api/dashboard/onboarding/services/${serviceB.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Hacked' }) }, A), [M.service], 'PATCH B service via onboarding')
    safeAttempt(await api(`/api/dashboard/onboarding/services/${serviceB.id}`, { method: 'DELETE' }, A), [M.service], 'DELETE B service via onboarding')

    // Barber-services linking (attach B's service to B's barber through A's context)
    safeAttempt(await api(`/api/dashboard/barber-services`, { method: 'POST', body: JSON.stringify({ barberId: barberB.id, serviceId: serviceB.id }) }, A), [M.service], 'cross-tenant barber-service link')

    // Customers
    safeAttempt(await api(`/api/dashboard/customers/${customerB.id}`, {}, A), [M.email, M.secretNote], 'GET B customer')
    safeAttempt(await api(`/api/dashboard/customers/${customerB.id}`, { method: 'PATCH', body: JSON.stringify({ firstName: 'Hacked' }) }, A), [M.email], 'PATCH B customer')
    safeAttempt(await api(`/api/dashboard/customers/${customerB.id}`, { method: 'DELETE' }, A), [M.email], 'DELETE B customer')
    safeAttempt(await api(`/api/dashboard/customers/${customerB.id}/tags`, { method: 'POST', body: JSON.stringify({ tags: ['hacked'] }) }, A), [M.email], 'tag B customer')
    safeAttempt(await api(`/api/dashboard/customers/${customerB.id}/intelligence`, {}, A), [M.email], 'B customer intelligence')
    safeAttempt(await api(`/api/dashboard/customers/${customerB.id}/rebook`, { method: 'POST', body: JSON.stringify({}) }, A), [M.email], 'rebook B customer')

    // FAQs
    safeAttempt(await api(`/api/dashboard/faqs/${faqB.id}`, {}, A), [M.faq], 'GET B FAQ')
    safeAttempt(await api(`/api/dashboard/faqs/${faqB.id}`, { method: 'PATCH', body: JSON.stringify({ question: 'Hacked?' }) }, A), [M.faq], 'PATCH B FAQ')
    safeAttempt(await api(`/api/dashboard/faqs/${faqB.id}`, { method: 'DELETE' }, A), [M.faq], 'DELETE B FAQ')

    // Marketing campaigns
    safeAttempt(await api(`/api/dashboard/marketing/campaigns/${campaignB.id}`, {}, A), [M.campaign], 'GET B campaign')
    safeAttempt(await api(`/api/dashboard/marketing/campaigns/${campaignB.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Hacked' }) }, A), [M.campaign], 'PATCH B campaign')
    safeAttempt(await api(`/api/dashboard/marketing/campaigns/${campaignB.id}`, { method: 'DELETE' }, A), [M.campaign], 'DELETE B campaign')
    safeAttempt(await api(`/api/dashboard/marketing/campaigns/${campaignB.id}/send`, { method: 'POST', body: JSON.stringify({}) }, A), [M.campaign], 'send B campaign')

    // Closures / blocked time / availability overrides
    safeAttempt(await api(`/api/dashboard/closures/${closureB.id}`, {}, A), [M.closure], 'GET B closure')
    safeAttempt(await api(`/api/dashboard/closures/${closureB.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Hacked' }) }, A), [M.closure], 'PATCH B closure')
    safeAttempt(await api(`/api/dashboard/closures/${closureB.id}`, { method: 'DELETE' }, A), [M.closure], 'DELETE B closure')
    safeAttempt(await api(`/api/dashboard/blocked-times/${blockedB.id}`, { method: 'PATCH', body: JSON.stringify({ reason: 'Hacked' }) }, A), ['B block ' + stamp], 'PATCH B blocked time')
    safeAttempt(await api(`/api/dashboard/blocked-times/${blockedB.id}`, { method: 'DELETE' }, A), ['B block ' + stamp], 'DELETE B blocked time')
    safeAttempt(await api(`/api/dashboard/availability-overrides`, { method: 'POST', body: JSON.stringify({ barberId: barberB.id, date: '2026-10-16', isAvailable: false }) }, A), ['B off ' + stamp], 'create override on B barber')

    // Inventory
    safeAttempt(await api(`/api/dashboard/inventory/${inventoryB.id}`, {}, A), [M.inventory], 'GET B inventory item')
    safeAttempt(await api(`/api/dashboard/inventory/${inventoryB.id}`, { method: 'PATCH', body: JSON.stringify({ stock: 0 }) }, A), [M.inventory], 'PATCH B inventory item')
    safeAttempt(await api(`/api/dashboard/inventory/${inventoryB.id}`, { method: 'DELETE' }, A), [M.inventory], 'DELETE B inventory item')

    // Staff accounts
    safeAttempt(await api(`/api/dashboard/staff/${staffUserB.id}`, {}, A), [`barber.b-${stamp}@matrix.test`], 'GET B staff user')
    safeAttempt(await api(`/api/dashboard/staff/${staffUserB.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'OWNER' }) }, A), [`barber.b-${stamp}@matrix.test`], 'escalate/patch B staff user')
    safeAttempt(await api(`/api/dashboard/staff/${staffUserB.id}`, { method: 'DELETE' }, A), [`barber.b-${stamp}@matrix.test`], 'DELETE B staff user')

    // Reviews (visibility / feature toggling)
    safeAttempt(await api(`/api/dashboard/reviews`, { method: 'PATCH', body: JSON.stringify({ reviewId: reviewB.id, isPublished: false }) }, A), [M.review], 'unpublish B review')

    // Ownership transfer targeting B's staff
    safeAttempt(await api(`/api/dashboard/ownership-transfer`, { method: 'POST', body: JSON.stringify({ targetUserId: staffUserB.id }) }, A), [`barber.b-${stamp}@matrix.test`], 'transfer ownership to B staff')

    // Settings / theme with B's business id injected into the payload.
    // Both routes resolve the business from the AUTHENTICATED SESSION
    // (getBusinessIdForUser / session.user.businessId), never from the
    // payload — so the call may legitimately succeed (it modifies A's own
    // settings). The tenant-safety invariant is that B is untouched, which
    // the post-matrix integrity snapshot proves below.
    const settingsRes = await api(`/api/dashboard/settings`, { method: 'PATCH', body: JSON.stringify({ businessId: bizB.id, businessName: 'Payload Injected Name' }) }, A)
    assert(!settingsRes.text.includes(M.email), 'settings PATCH does not leak B customer data')
    const themeRes = await api(`/api/dashboard/theme`, { method: 'PATCH', body: JSON.stringify({ businessId: bizB.id, primaryColor: '#ff0000' }) }, A)
    assert(!themeRes.text.includes(M.email), 'theme PATCH does not leak B customer data')
    // Verify in-DB right away too (not only the end-of-run snapshot):
    const bizBNow = await prisma.business.findUnique({ where: { id: bizB.id } })
    assert(bizBNow?.name === 'Matrix Shop B', 'injected businessId in settings PATCH never touches B')

    console.log('\n  --- List/export endpoints must not contain B data ---')

    const lists: [string, string[], string][] = [
      ['/api/dashboard/appointments', [M.confirm], 'appointments list'],
      ['/api/dashboard/customers', [M.email, M.secretNote], 'customers list'],
      ['/api/dashboard/customers/export', [M.email], 'customers CSV export'],
      ['/api/dashboard/services', [M.service], 'services list'],
      ['/api/dashboard/barbers', [M.barber], 'barbers list'],
      ['/api/dashboard/faqs', [M.faq], 'FAQ list'],
      ['/api/dashboard/reviews', [M.review], 'reviews list'],
      ['/api/dashboard/marketing/campaigns', [M.campaign], 'campaigns list'],
      ['/api/dashboard/inventory', [M.inventory], 'inventory list'],
      ['/api/dashboard/audit-logs', [`owner.b-${stamp}@matrix.test`], 'audit logs'],
      ['/api/dashboard/analytics', [M.confirm], 'analytics'],
      ['/api/dashboard/media', [`matrix-b-${stamp}`], 'media list'],
    ]
    for (const [path, markers, label] of lists) {
      const res = await api(path, {}, A)
      const leaked = markers.filter((m) => res.text.includes(m))
      assert(leaked.length === 0, `${label} contains no Business B data${leaked.length ? ' — LEAKED: ' + leaked.join(', ') : ''}`)
    }

    console.log('\n  --- Unauthenticated access is rejected ---')
    const anonRoutes = ['/api/dashboard/appointments', '/api/dashboard/customers', '/api/dashboard/settings', '/api/dashboard/audit-logs', '/api/platform/businesses', '/api/dashboard/analytics']
    for (const path of anonRoutes) {
      const res = await api(path)
      assert(res.status === 401 || res.status === 403, `anonymous ${path} rejected (got ${res.status})`)
    }

    console.log('\n  --- B data integrity after the attack matrix ---')
    const after = await snapshot()
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      assert(strip(before[key]) === strip(after[key]), `B's ${key} record unchanged after attacks`)
    }
  } finally {
    // ── cleanup ────────────────────────────────────────────────────────
    await prisma.appointment.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.customer.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.availabilityOverride.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.blockedTime.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.review.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.inventoryItem.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.marketingCampaign.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.faq.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.businessClosure.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    // join table has no businessId; scope via the test barbers
    await prisma.barberService.deleteMany({ where: { barberId: { in: [barberA.id, barberB.id] } } })
    await prisma.service.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.user.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.barber.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } })
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Cross-tenant matrix: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Test runner crashed:', e)
  process.exit(1)
})
