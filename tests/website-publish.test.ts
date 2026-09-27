// Website content draft/publish tests (requires live server on :3000).
// Verifies: publish flow, draft isolation from the public site, preview
// gating, permissions, and audit trail.

import { prisma } from '../src/lib/prisma'

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
  const token = /next-auth\.session-token=([^;]+)/.exec(setCookie)?.[1]
  return { ok: !!token, cookie: token ? `next-auth.session-token=${token}` : '' }
}

async function main() {
  const stamp = Date.now()
  const slug = `pubtest-${stamp}`
  const business = await prisma.business.create({
    data: {
      name: 'Publish Test Shop', slug, timezone: 'America/Los_Angeles',
      bookingPolicy: '24h notice', cancellationPolicy: 'Free up to 24h before',
      onboardingCompleted: true,
    },
  })
  const bcrypt = (await import('bcryptjs')).default
  const owner = await prisma.user.create({
    data: {
      email: `pub-owner-${stamp}@test.local`, name: 'Pub Owner', role: 'OWNER',
      businessId: business.id, passwordHash: await bcrypt.hash('Password123!', 10), isActive: true,
    },
  })
  const barber = await prisma.user.create({
    data: {
      email: `pub-barber-${stamp}@test.local`, name: 'Pub Barber', role: 'BARBER',
      businessId: business.id, passwordHash: await bcrypt.hash('Password123!', 10), isActive: true,
    },
  })
  const content = await prisma.websiteContent.create({
    data: { businessId: business.id, heroTitle: 'Published Hero', heroDescription: 'First live copy.' },
  })

  const ownerLogin = await login(owner.email, 'Password123!')
  const barberLogin = await login(barber.email, 'Password123!')
  assert(ownerLogin.ok, 'owner signs in')

  const home = (extra: Record<string, string> = {}) =>
    fetch(`${BASE}/`, { headers: { 'x-forwarded-host': slug, ...extra } }).then((r) => r.text())

  // ── before first publish: legacy parity (live fields shown) ───────────
  const h0 = await home()
  assert(h0.includes('Published Hero'), 'pre-publish: public site shows live content (legacy parity)')

  // ── permissions ───────────────────────────────────────────────────────
  const noAuth = await fetch(`${BASE}/api/dashboard/website-content/publish`, { method: 'POST' })
  assert(noAuth.status === 401, 'unauthenticated publish rejected (401)')

  const barberTry = await fetch(`${BASE}/api/dashboard/website-content/publish`, {
    method: 'POST', headers: { cookie: barberLogin.cookie },
  })
  assert(barberTry.status === 403, 'BARBER cannot publish (403)')

  // ── first publish snapshots the live content ──────────────────────────
  const statusBefore = await fetch(`${BASE}/api/dashboard/website-content/publish`, {
    headers: { cookie: ownerLogin.cookie },
  }).then((r) => r.json())
  assert(statusBefore.publishedAt === null && statusBefore.hasUnpublishedChanges === false,
    'status endpoint reports never-published state')

  const pub1 = await fetch(`${BASE}/api/dashboard/website-content/publish`, {
    method: 'POST', headers: { cookie: ownerLogin.cookie },
  })
  const pub1Body = await pub1.json()
  assert(pub1.status === 200 && pub1Body.success === true, 'owner publishes content')

  const h1 = await home()
  assert(h1.includes('Published Hero'), 'post-publish: public site renders the published snapshot')

  // ── draft edits stay private until published ──────────────────────────
  await prisma.websiteContent.update({
    where: { id: content.id },
    data: { heroTitle: 'Draft Hero Title' },
  })
  const h2 = await home()
  assert(!h2.includes('Draft Hero Title') && h2.includes('Published Hero'),
    'draft edit does NOT reach the public site before publishing')

  const statusMid = await fetch(`${BASE}/api/dashboard/website-content/publish`, {
    headers: { cookie: ownerLogin.cookie },
  }).then((r) => r.json())
  assert(statusMid.publishedAt !== null && statusMid.hasUnpublishedChanges === true,
    'status endpoint detects unpublished draft changes')

  // ── preview shows the DRAFT, authenticated only ────────────────────────
  const previewAuth = await fetch(`${BASE}/dashboard/website-preview`, {
    headers: { cookie: ownerLogin.cookie }, redirect: 'manual',
  })
  const previewHtml = await previewAuth.text()
  assert(
    previewAuth.status === 200 && previewHtml.includes('Draft Hero Title'),
    'staff can open the draft preview (not an anonymous shell)'
  )
  const previewAnon = await fetch(`${BASE}/dashboard/website-preview`, { redirect: 'manual' })
  assert(previewAnon.status === 307 || previewAnon.status === 302,
    'anonymous preview access redirects to login (draft never public)')

  // ── publish the draft ─────────────────────────────────────────────────
  const pub2 = await fetch(`${BASE}/api/dashboard/website-content/publish`, {
    method: 'POST', headers: { cookie: ownerLogin.cookie },
  })
  assert(pub2.status === 200, 're-publish succeeds')
  const h3 = await home()
  assert(h3.includes('Draft Hero Title') && !h3.includes('Published Hero'),
    'after publishing, the public site shows the new content')

  // ── audit trail ───────────────────────────────────────────────────────
  const audit = await prisma.auditLog.findMany({
    where: { businessId: business.id, action: 'WEBSITE_CONTENT_PUBLISHED' },
  })
  assert(audit.length === 2, 'both publishes are audited')

  // cleanup
  await prisma.auditLog.deleteMany({ where: { businessId: business.id } })
  await prisma.websiteContent.deleteMany({ where: { businessId: business.id } })
  await prisma.user.deleteMany({ where: { businessId: business.id } })
  await prisma.business.delete({ where: { id: business.id } })

  console.log(`\nWebsite draft/publish tests: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
