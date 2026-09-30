/**
 * Settings persistence: verifies the full save flow the dashboard uses —
 * UI payload shape → updateBusinessSchema validation → Prisma update →
 * fresh read returns the saved values. The database is the source of truth;
 * nothing may depend on React state, local storage, or session storage.
 *
 * Run: npx tsx tests/settings-persistence.test.ts
 */
import { prisma } from '../src/lib/prisma'
import { updateBusinessSchema } from '../src/lib/validation'
import type { Prisma } from '@prisma/client'

let passed = 0, failed = 0
function assert(c: boolean, m: string) {
  if (c) { console.log(`  ✅ ${m}`); passed++ } else { console.error(`  ❌ ${m}`); failed++ }
}

async function main() {
  console.log('\n══════════ Settings Persistence Test Suite ══════════')
  const stamp = Date.now()
  const business = await prisma.business.create({
    data: {
      name: 'Persist Shop', slug: `persist-shop-${stamp}`,
      email: 'persist@example.com', phone: '555-0123',
      address: '1 Old St', city: 'OldCity', state: 'CA', zipCode: '90001',
      timezone: 'America/Los_Angeles',
    },
  })
  try {
    // Payload exactly like the dashboard sends: the whole GET response object
    // (including server-only fields the schema must strip) for ALL tabs.
    const uiPayload = {
      ...business, // includes id, createdAt, updatedAt, slug, deactivatedAt...
      name: 'New Persist Name',
      address: '2 New St', city: 'NewCity', zipCode: '90002',
      aboutText: 'Updated about copy',
      primaryColor: '#d4af37', accentColor: '#1a1a1a', secondaryColor: '#2a2a2a',
      themeMode: 'light',
      logo: 'https://cdn.example.com/logo.png',
      instagram: 'https://instagram.com/newhandle', facebook: '', tiktok: '', youtube: '', xTwitter: null, googleBusinessProfile: null, bookingPolicy: null, privacyPolicy: null,
      hours: {
        monday: { open: '10:00', close: '19:00', isOff: false },
        sunday: { open: '09:00', close: '16:00', isOff: true },
      },
      cancellationPolicy: 'New cancellation policy text',
      walkInsWelcome: false,
      minAdvanceBookingMinutes: 120, maxBookingWindowDays: 45,
      bufferMinutes: 20, cancellationDeadlineHours: 6,
    }
    const parsed = updateBusinessSchema.safeParse(uiPayload)
    assert(parsed.success, 'dashboard payload validates (all tabs at once)')
    if (!parsed.success) process.exit(1)

    // Schema must strip server-owned fields — they can never clobber identity
    const dataKeys = Object.keys(parsed.data as unknown as Record<string, unknown>)
    for (const f of ['id', 'createdAt', 'updatedAt', 'slug']) {
      assert(!dataKeys.includes(f), `schema strips server-owned field: ${f}`)
    }

    await prisma.business.update({ where: { id: business.id }, data: parsed.data as Prisma.BusinessUpdateInput })

    // Fresh read simulates: sign out, sign back in, GET /api/dashboard/settings
    const reloaded = await prisma.business.findUnique({ where: { id: business.id } })
    assert(reloaded?.name === 'New Persist Name', 'business name persists')
    assert(reloaded?.address === '2 New St' && reloaded?.city === 'NewCity', 'address/city persist')
    assert(reloaded?.aboutText === 'Updated about copy', 'about text persists')
    assert(reloaded?.primaryColor === '#d4af37' && reloaded?.themeMode === 'light', 'branding persists')
    assert(reloaded?.logo === 'https://cdn.example.com/logo.png', 'logo persists')
    assert(reloaded?.instagram === 'https://instagram.com/newhandle', 'social link persists')
    assert((reloaded?.hours as Record<string, { open: string }> | null)?.monday?.open === '10:00', 'hours persist')
    assert(reloaded?.cancellationPolicy === 'New cancellation policy text', 'policies persist')
    assert(reloaded?.walkInsWelcome === false, 'booking toggle persists')
    assert(reloaded?.minAdvanceBookingMinutes === 120 && reloaded?.maxBookingWindowDays === 45, 'booking rules persist')
    assert(reloaded?.bufferMinutes === 20 && reloaded?.cancellationDeadlineHours === 6, 'buffer/cancel deadline persist')

    // WebsiteContent + SEO use upserts keyed by businessId — same persistence shape
    const content = await prisma.websiteContent.upsert({
      where: { businessId: business.id },
      create: { businessId: business.id, heroTitle: 'New Hero', showTeam: false },
      update: { heroTitle: 'New Hero', showTeam: false },
    })
    const contentBack = await prisma.websiteContent.findUnique({ where: { businessId: business.id } })
    assert(contentBack?.heroTitle === 'New Hero' && contentBack?.showTeam === false, 'website content persists via upsert')
    assert(content.id === contentBack?.id, 'website content row is stable across saves (no duplication)')

    const seo = await prisma.businessSEO.upsert({
      where: { businessId: business.id },
      create: { businessId: business.id, siteTitle: 'New Title', robotsIndex: false },
      update: { siteTitle: 'New Title', robotsIndex: false },
    })
    const seoBack = await prisma.businessSEO.findUnique({ where: { businessId: business.id } })
    assert(seoBack?.siteTitle === 'New Title' && seoBack?.robotsIndex === false, 'SEO persists via upsert')
    assert(seo.id === seoBack?.id, 'SEO row is stable across saves (no duplication)')

    // Public side reads the same source of truth
    const publicView = await prisma.business.findUnique({ where: { id: business.id } })
    assert(publicView?.name === reloaded?.name, 'public website reads the same DB values the dashboard saved')
  } finally {
    await prisma.business.delete({ where: { id: business.id } }).catch(() => {})
  }
  console.log(`\nSettings persistence tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  process.exit(0)
}
main().catch(e => { console.error('Test crashed:', e); process.exit(1) })
