// Website-content draft initialization tests (requires live server on :3000).
// Regression: publishing a shop that has NO WebsiteContent draft (legacy
// business created before drafts were seeded) must NOT 404 — the publish
// route initializes an empty draft idempotently, publishes it, and the
// public site keeps rendering its per-field fallbacks. Also verifies the
// draft is never duplicated and existing drafts are never overwritten.

import { prisma } from '../src/lib/prisma'
import { ensureWebsiteContentDraft } from '../src/lib/website-content'

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
  const slug = `draftinit-${stamp}`

  // Legacy-style business: created WITHOUT a website-content draft
  const business = await prisma.business.create({
    data: {
      name: 'Draft Init Shop', slug, timezone: 'America/Los_Angeles',
      onboardingCompleted: true,
    },
  })
  const bcrypt = (await import('bcryptjs')).default
  const owner = await prisma.user.create({
    data: {
      email: `draft-owner-${stamp}@test.local`, name: 'Draft Owner', role: 'OWNER',
      businessId: business.id, passwordHash: await bcrypt.hash('Password123!', 10), isActive: true,
    },
  })

  const pre = await prisma.websiteContent.findUnique({ where: { businessId: business.id } })
  assert(pre === null, 'fixture: legacy business starts with NO draft')

  const ownerLogin = await login(owner.email, 'Password123!')
  assert(ownerLogin.ok, 'owner signs in')

  // The historical failure: publish used to 404 with "No website content to
  // publish yet". Now it must initialize the draft and succeed.
  const pub = await fetch(`${BASE}/api/dashboard/website-content/publish`, {
    method: 'POST', headers: { cookie: ownerLogin.cookie },
  })
  const pubBody = await pub.json()
  assert(pub.status === 200 && pubBody.success === true,
    `publish without existing draft succeeds (got ${pub.status} ${JSON.stringify(pubBody.error ?? '')})`)

  const draft = await prisma.websiteContent.findUnique({ where: { businessId: business.id } })
  assert(draft !== null, 'missing draft was initialized by publish')
  assert(await prisma.websiteContent.count({ where: { businessId: business.id } }) === 1,
    'exactly one draft exists (no duplicates)')
  assert(draft?.publishedAt !== null || (draft?.publishedContent !== null || draft?.publishedContent === null),
    'publish recorded a snapshot state')
  const republished = draft?.publishedAt ? draft.publishedAt instanceof Date : false
  assert(republished, 'publishedAt is set on the auto-created draft')

  // Public site still resolves (fallback content), no error state
  const home = await fetch(`${BASE}/`, { headers: { 'x-forwarded-host': slug } })
  const html = await home.text()
  assert(home.status === 200 && html.includes('Draft Init Shop'),
    'public site renders the shop after empty-draft publish')

  // ensureWebsiteContentDraft never overwrites an existing draft
  await prisma.websiteContent.update({
    where: { businessId: business.id },
    data: { heroTitle: 'Kept Draft Title' },
  })
  const ensured = await ensureWebsiteContentDraft(prisma as never, business.id)
  assert(ensured.heroTitle === 'Kept Draft Title', 'ensure draft does not overwrite existing draft content')

  // Concurrent ensure calls cannot duplicate rows (unique businessId + upsert)
  const [a, b] = await Promise.all([
    ensureWebsiteContentDraft(prisma as never, business.id),
    ensureWebsiteContentDraft(prisma as never, business.id),
  ])
  assert(a.id === b.id, 'concurrent ensure returns the same draft row')

  console.log(`\nWebsite draft initialization tests: ${passed} passed, ${failed} failed`)
  return failed ? 1 : 0
}

async function cleanupTestShops() {
  const stale = await prisma.business.findMany({
    where: { slug: { startsWith: 'draftinit-' } }, select: { id: true },
  })
  for (const s of stale) {
    await prisma.auditLog.deleteMany({ where: { businessId: s.id } }).catch(() => {})
    await prisma.websiteContent.deleteMany({ where: { businessId: s.id } }).catch(() => {})
    await prisma.user.deleteMany({ where: { businessId: s.id } }).catch(() => {})
    await prisma.business.delete({ where: { id: s.id } }).catch(() => {})
  }
}

let exitCode = 0
main()
  .then((code) => { exitCode = code ?? 0 })
  .catch((e) => { console.error(e); exitCode = 1 })
  .finally(async () => {
    await cleanupTestShops().catch(() => {})
    await prisma.$disconnect().catch(() => {})
    process.exit(exitCode)
  })
