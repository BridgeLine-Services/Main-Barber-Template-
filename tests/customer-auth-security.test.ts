/**
 * CUSTOMER AUTHENTICATION & IDENTITY SECURITY MATRIX
 *
 * Proves, against a live server:
 *  - Public signup always creates a CUSTOMER (role is server-determined; any
 *    client-supplied role is ignored — never OWNER/staff).
 *  - Owner creation is NOT public: /api/auth/register-owner rejects every
 *    unauthenticated/forged request, and only the authorized provisioning
 *    token (server-side secret) can create an OWNER.
 *  - A CUSTOMER session cannot reach any dashboard page or API (403/redirect).
 *  - The customer portal resolves the customer from the SESSION — query
 *    params (e.g. ?customerId=) are ignored, so there is no IDOR.
 *  - A signed-in customer booking with someone else's email is overridden
 *    server-side: the appointment attaches to the ACCOUNT identity, and the
 *    account → customer-record link is established and audited on first
 *    booking.
 *  - One customer can never see or cancel another customer's appointment.
 *
 * Run: npx tsx tests/customer-auth-security.test.ts  (server on :3000)
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma'
import { can, capabilitiesOf } from '../src/lib/permissions'

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

async function api(path: string, init: RequestInit = {}, cookie = '', host?: string): Promise<{ status: number; body: Record<string, unknown> | null; res: Response }> {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie: cookiePairs(cookie) } : {}),
      ...(host ? { 'x-forwarded-host': host } : {}),
      ...(init.headers as Record<string, string> || {}),
    },
  })
  let body: Record<string, unknown> | null = null
  try { body = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, body, res }
}

async function main() {
  const stamp = Date.now()
  const password = 'Customer-Test-123!'
  const pwHash = await bcrypt.hash(password, 10)

  // Two businesses, so tenant resolution is unambiguous via x-forwarded-host
  const mkBiz = async (name: string, slug: string) =>
    prisma.business.create({
      data: {
        name, slug,
        email: `${slug}@test.com`, phone: '555-0101', address: '1 Sec St',
        city: 'SecCity', state: 'CA', zipCode: '90001', timezone: 'UTC',
        cancellationDeadlineHours: 0,
      },
    })
  const bizA = await mkBiz(`Customer Sec A ${stamp}`, `custsec-a-${stamp}`)
  const bizB = await mkBiz(`Customer Sec B ${stamp}`, `custsec-b-${stamp}`)

  const barberA = await prisma.barber.create({ data: { name: 'Sec Barber A', businessId: bizA.id } })
  const serviceA = await prisma.service.create({
    data: { businessId: bizA.id, name: `Sec Cut ${stamp}`, duration: 60, price: 30 },
  })
  for (let day = 0; day < 7; day++) {
    await prisma.schedule.create({
      data: { barberId: barberA.id, dayOfWeek: day, startTime: '00:00', endTime: '23:45', isOff: false },
    })
  }

  const ownerA = await prisma.user.create({
    data: { email: `owner-custsec-${stamp}@test.com`, name: 'Owner A', role: 'OWNER', businessId: bizA.id, passwordHash: pwHash },
  })

  // Booking date: 3 days out, 10:00 UTC (well inside the 00:00-23:45 schedule)
  const slotDate = new Date(Date.now() + 3 * 86400000)
  const dateStr = slotDate.toISOString().slice(0, 10)

  try {
    console.log('\n── CUSTOMER role capability matrix (unit) ──')
    assert(can('CUSTOMER', 'customer.view-own-appointments'), 'CUSTOMER can view own appointments')
    assert(can('CUSTOMER', 'customer.manage-own-profile'), 'CUSTOMER can manage own profile')
    assert(!can('CUSTOMER', 'business.manage'), 'CUSTOMER cannot manage business')
    assert(!can('CUSTOMER', 'business.manage-staff'), 'CUSTOMER cannot manage staff')
    assert(!can('CUSTOMER', 'business.export-data'), 'CUSTOMER cannot export data')
    assert(!capabilitiesOf('CUSTOMER').some((c) => c.startsWith('platform.')), 'CUSTOMER has zero platform capabilities')
    assert(!can('CUSTOMER', 'appointments.view-all'), 'CUSTOMER cannot view all appointments')

    console.log('\n── Public signup is ALWAYS a customer (server-determined role) ──')
    const custAEmail = `alice-custsec-${stamp}@test.com`
    let r = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Alice A', email: custAEmail, password, role: 'OWNER' as string, businessId: bizB.id }),
    })
    assert(r.status === 201, `signup with role:"OWNER" in body accepted as new account (got ${r.status})`)
    const custA = await prisma.user.findUnique({ where: { email: custAEmail } })
    assert(!!custA, 'signup created the user')
    assert(custA?.role === 'CUSTOMER', `created role is CUSTOMER, not the client-supplied OWNER (got ${custA?.role})`)
    assert(custA?.businessId === null, 'customer account is not bound to any business')
    assert(custA?.customerId === null, 'no customer-record link before first booking')

    r = await api('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ name: 'Dup', email: custAEmail, password }),
    })
    assert(r.status === 409, `duplicate signup rejected (got ${r.status})`)

    const custBEmail = `bob-custsec-${stamp}@test.com`
    r = await api('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ name: 'Bob B', email: custBEmail, password }),
    })
    assert(r.status === 201, 'second customer signup ok')

    console.log('\n── Owner creation is authorized provisioning only (never public) ──')
    // 1. No token, plain public request → refused, nothing created.
    const forgedOwnerEmail = `owner2-custsec-${stamp}@test.com`
    r = await api('/api/auth/register-owner', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Owner', email: forgedOwnerEmail, password }),
    })
    assert(r.status === 404, `public request to register-owner is refused (got ${r.status})`)
    assert(!(await prisma.user.findUnique({ where: { email: forgedOwnerEmail } })), 'no OWNER account created by a public request')

    // 2. Forged role field + mode query param + fake token header → refused.
    r = await api(`/api/auth/register-owner?mode=onboarding`, {
      method: 'POST',
      headers: { 'x-provisioning-token': 'forged-token', 'x-role': 'OWNER' },
      body: JSON.stringify({ name: 'New Owner', email: forgedOwnerEmail, password, role: 'OWNER', businessId: 'x' }),
    })
    assert(r.status === 404, `forged token/role/params cannot create an owner (got ${r.status})`)
    assert(!(await prisma.user.findUnique({ where: { email: forgedOwnerEmail } })), 'no partial/privileged account from forged provisioning')

    // 3. Authorized provisioning (server-side secret) CAN create the owner.
    const provisioningToken = process.env.OWNER_PROVISIONING_TOKEN
    if (provisioningToken) {
      r = await api('/api/auth/register-owner', {
        method: 'POST',
        headers: { 'x-provisioning-token': provisioningToken },
        body: JSON.stringify({ name: 'Provisioned Owner', email: forgedOwnerEmail, password }),
      })
      const provisionedOwner = await prisma.user.findUnique({ where: { email: forgedOwnerEmail } })
      assert(r.status === 201 && provisionedOwner?.role === 'OWNER', 'authorized provisioning token creates an OWNER')
    } else {
      console.log('  ⚠️ OWNER_PROVISIONING_TOKEN not set — authorized provisioning not verified here')
    }

    console.log('\n── Login & session ──')
    const custALogin = await login(custAEmail, password)
    const custBLogin = await login(custBEmail, password)
    assert(custALogin.ok && custBLogin.ok, 'both customers sign in')
    r = await api('/api/auth/session', {}, custALogin.sessionCookie)
    assert((r.body?.user as { role?: string } | undefined)?.role === 'CUSTOMER', 'session exposes role CUSTOMER')

    console.log('\n── CUSTOMER is locked out of every dashboard API ──')
    r = await api('/api/dashboard/staff', {}, custALogin.sessionCookie)
    assert(r.status === 403, `customer blocked from staff API (got ${r.status})`)
    r = await api('/api/dashboard/settings', {}, custALogin.sessionCookie)
    assert(r.status === 403, `customer blocked from settings API (got ${r.status})`)
    r = await api('/api/dashboard/customers', {}, custALogin.sessionCookie)
    assert(r.status === 403, `customer blocked from customers API (got ${r.status})`)
    r = await api('/api/dashboard/appointments', {}, custALogin.sessionCookie)
    assert(r.status === 403, `customer blocked from appointments API (got ${r.status})`)
    r = await api('/api/dashboard/audit-logs', {}, custALogin.sessionCookie)
    assert(r.status === 403, `customer blocked from audit logs (got ${r.status})`)

    console.log('\n── CUSTOMER is redirected away from dashboard pages (server gate) ──')
    const dashRes = await fetch(`${BASE}/dashboard`, {
      redirect: 'manual', headers: { cookie: cookiePairs(custALogin.sessionCookie) },
    })
    assert(dashRes.status >= 300 && dashRes.status < 400, `dashboard redirects a customer (got ${dashRes.status})`)
    assert((dashRes.headers.get('location') || '').includes('/portal'), `dashboard redirect points to /portal (got ${dashRes.headers.get('location')})`)
    const portalRes = await fetch(`${BASE}/portal`, {
      redirect: 'manual', headers: { cookie: cookiePairs(custALogin.sessionCookie), 'x-forwarded-host': bizA.slug },
    })
    assert(portalRes.status === 200, `portal page renders for the customer (got ${portalRes.status})`)

    console.log('\n── Authenticated booking: server forces the account identity ──')
    // Alice books while signed in, submitting SOMEONE ELSE'S email.
    r = await api('/api/public/appointments', {
      method: 'POST',
      body: JSON.stringify({
        serviceId: serviceA.id, date: dateStr, time: '10:00',
        customer: { firstName: 'Alice', lastName: 'A', phone: '555-0111', email: `victim-${stamp}@test.com` },
      }),
    }, custALogin.sessionCookie, bizA.slug)
    assert(r.status === 200 && (r.body?.success as boolean | undefined) === true, `signed-in customer books successfully (got ${r.status}, body ${JSON.stringify(r.body)})`)
    const bookedEmail = await prisma.appointment.findFirst({
      where: { businessId: bizA.id },
      orderBy: { createdAt: 'desc' },
      include: { customer: true },
    })
    assert(bookedEmail?.customer?.email === custAEmail,
      `appointment attached to the ACCOUNT email, not the submitted email (got ${bookedEmail?.customer?.email})`)

    const custALinked = await prisma.user.findUnique({ where: { email: custAEmail } })
    assert(custALinked?.customerId === bookedEmail?.customerId,
      'account → customer-record link established on first booking')

    const linkAudit = await prisma.auditLog.findFirst({
      where: { userId: custALinked!.id, action: 'CUSTOMER_LINKED', entityId: bookedEmail!.customerId },
    })
    assert(!!linkAudit, 'CUSTOMER_LINKED audit entry recorded with human-readable description')

    console.log('\n── Portal: session-resolved customer, no IDOR ──')
    r = await api('/api/portal/me', {}, custALogin.sessionCookie, bizA.slug)
    assert(r.status === 200 && (r.body?.customer as { email?: string } | undefined)?.email === custAEmail, 'portal /me resolves Alice from the session')
    r = await api('/api/portal/appointments', {}, custALogin.sessionCookie, bizA.slug)
    assert(r.status === 200 && ((r.body?.upcoming as unknown[] | undefined) || []).length === 1, `Alice sees her own upcoming appointment (got ${((r.body?.upcoming as unknown[] | undefined) || []).length})`)

    // Bob has never booked here: empty portal, and cannot see Alice's data
    r = await api('/api/portal/me', {}, custBLogin.sessionCookie, bizA.slug)
    assert(r.status === 200 && r.body?.customer === null, 'Bob has no customer record at shop A (empty, not an error)')
    r = await api('/api/portal/appointments?customerId=' + bookedEmail!.customerId, {}, custBLogin.sessionCookie, bizA.slug)
    assert(r.status === 200 && ((r.body?.upcoming as unknown[] | undefined) || []).length === 0 && ((r.body?.history as unknown[] | undefined) || []).length === 0,
      'Bob cannot see Alice\'s appointments even by passing ?customerId=')

    // Bob tries to cancel Alice's appointment → 404 (ownership-scoped lookup)
    r = await api(`/api/portal/appointments/${bookedEmail!.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'cancel' }),
    }, custBLogin.sessionCookie, bizA.slug)
    assert(r.status === 404, `Bob cannot cancel Alice's appointment (got ${r.status})`)
    const stillActive = await prisma.appointment.findUnique({ where: { id: bookedEmail!.id } })
    assert(stillActive?.status !== 'CANCELLED', "Alice's appointment is untouched")

    // Anonymous call to a portal API → 401
    r = await api('/api/portal/appointments', {}, '', bizA.slug)
    assert(r.status === 401, `anonymous portal API call rejected (got ${r.status})`)

    console.log('\n── Portal cancel (own appointment, within policy) ──')
    r = await api(`/api/portal/appointments/${bookedEmail!.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'cancel' }),
    }, custALogin.sessionCookie, bizA.slug)
    assert(r.status === 200 && (r.body?.success as boolean | undefined) === true, `Alice cancels her own appointment (got ${r.status})`)
    const cancelAudit = await prisma.auditLog.findFirst({
      where: { businessId: bizA.id, action: 'APPOINTMENT_CANCELLED', entityId: bookedEmail!.id },
    })
    assert(!!cancelAudit, 'APPOINTMENT_CANCELLED audit entry recorded')
    r = await api(`/api/portal/appointments/${bookedEmail!.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'cancel' }),
    }, custALogin.sessionCookie, bizA.slug)
    assert(r.status === 409, `double cancel rejected (got ${r.status})`)

    console.log('\n── Portal reschedule (own appointment, within policy) ──')
    // Alice books a second appointment while signed in (account already linked)
    r = await api('/api/public/appointments', {
      method: 'POST',
      body: JSON.stringify({
        serviceId: serviceA.id, date: dateStr, time: '12:00',
        customer: { firstName: 'Alice', lastName: 'A', phone: '555-0111', email: custAEmail },
      }),
    }, custALogin.sessionCookie, bizA.slug)
    assert(r.status === 200, `Alice books a second appointment (got ${r.status})`)
    const appt2 = await prisma.appointment.findFirst({
      where: { businessId: bizA.id, status: 'CONFIRMED' },
      orderBy: { createdAt: 'desc' },
    })
    assert(!!appt2, 'second appointment exists')

    // Bob cannot reschedule Alice's appointment → 404 (ownership-scoped)
    r = await api(`/api/portal/appointments/${appt2!.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'reschedule', startTime: `${dateStr}T15:00:00.000Z` }),
    }, custBLogin.sessionCookie, bizA.slug)
    assert(r.status === 404, `Bob cannot reschedule Alice's appointment (got ${r.status})`)

    // Alice reschedules to a valid future slot
    r = await api(`/api/portal/appointments/${appt2!.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'reschedule', startTime: `${dateStr}T14:00:00.000Z` }),
    }, custALogin.sessionCookie, bizA.slug)
    assert(r.status === 200, `Alice reschedules her own appointment (got ${r.status}, body ${JSON.stringify(r.body)})`)
    const afterReschedule = await prisma.appointment.findUnique({ where: { id: appt2!.id } })
    assert(afterReschedule?.startTime.toISOString() === `${dateStr}T14:00:00.000Z`,
      `appointment start time moved (got ${afterReschedule?.startTime.toISOString()})`)
    const rh = await prisma.rescheduleHistory.findFirst({
      where: { appointmentId: appt2!.id }, orderBy: { createdAt: 'desc' },
    })
    assert(!!rh && rh.actor === 'CUSTOMER' && rh.previousStartTime.toISOString() === `${dateStr}T12:00:00.000Z`,
      `RescheduleHistory recorded with actor CUSTOMER (got actor ${rh?.actor})`)

    // Alice tries to reschedule into the past → 400
    r = await api(`/api/portal/appointments/${appt2!.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'reschedule', startTime: '2020-01-01T10:00:00.000Z' }),
    }, custALogin.sessionCookie, bizA.slug)
    assert(r.status === 400, `past-time reschedule rejected (got ${r.status})`)

    console.log('\n── Cross-business isolation for the account ──')
    // Alice has a customer record at shop A. On shop B she resolves to nothing.
    r = await api('/api/portal/me', {}, custALogin.sessionCookie, bizB.slug)
    assert(r.status === 200 && r.body?.customer === null,
      'Alice\'s shop-A record does not leak to shop B (resolves to no customer there)')
    r = await api(`/api/portal/appointments/${appt2!.id}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'cancel' }),
    }, custALogin.sessionCookie, bizB.slug)
    assert(r.status === 404, `Alice's shop-A appointment is not actionable from shop B (got ${r.status})`)

    console.log('\n── Expired / invalid access credentials are rejected ──')
    r = await api('/api/portal/me', {}, 'next-auth.session-token=garbage-token-value', bizA.slug)
    assert(r.status === 401, `invalid session cookie rejected (got ${r.status})`)
    r = await api('/api/public/appointments/shorttoken/reschedule', {
      method: 'POST', body: JSON.stringify({ startTime: `${dateStr}T16:00:00.000Z` }),
    }, '', bizA.slug)
    assert(r.status === 400, `malformed access token rejected (got ${r.status})`)
    r = await api('/api/public/appointments/' + 'x'.repeat(40) + '/reschedule', {
      method: 'POST', body: JSON.stringify({ startTime: `${dateStr}T16:00:00.000Z` }),
    }, '', bizA.slug)
    assert(r.status === 404, `unknown access token rejected (got ${r.status})`)

    console.log('\n── Login/logout audit trail ──')
    const loginAudit = await prisma.auditLog.findFirst({
      where: { userId: custA!.id, action: 'LOGIN_SUCCESS' },
    })
    assert(!!loginAudit, 'LOGIN_SUCCESS audit recorded for customer sign-in')

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exit(failed === 0 ? 0 : 1)
  } finally {
    // cleanup
    const emails = [
      `alice-custsec-${stamp}@test.com`, `bob-custsec-${stamp}@test.com`,
      `owner2-custsec-${stamp}@test.com`, `owner-custsec-${stamp}@test.com`,
    ]
    await prisma.auditLog.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.rescheduleHistory.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.appointment.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.customer.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    await prisma.user.deleteMany({ where: { OR: [{ email: { in: emails } }, { customerId: { not: null } }] } })
    await prisma.schedule.deleteMany({ where: { barberId: barberA.id } })
    await prisma.service.deleteMany({ where: { businessId: bizA.id } })
    await prisma.barber.deleteMany({ where: { businessId: bizA.id } })
    await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } })
    void ownerA
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
