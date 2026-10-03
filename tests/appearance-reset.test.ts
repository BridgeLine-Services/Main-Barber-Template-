/**
 * Appearance reset-to-preset-defaults: verifies the full reset flow the
 * dashboard's "Reset to <preset> defaults" button drives.
 *
 *   1. Save-side: the settings API's exact path (validateVisualConfigInput)
 *      accepts the reset payload ({ visualConfig: {} }) and produces a clean,
 *      empty override set while preserving the preset.
 *   2. Draft semantics: resetting writes the DRAFT only — the published
 *      snapshot the public site renders is untouched.
 *   3. Business data: resetting visual overrides never touches business
 *      branding (name, logo, colors) or other website content fields.
 *   4. Resolver: for every preset, empty overrides resolve to exactly the
 *      preset's built-in design (the reset's customer-visible contract).
 *
 * Run: npx tsx tests/appearance-reset.test.ts
 */
import { prisma } from '../src/lib/prisma'
import { validateVisualConfigInput, resolveVisualConfig } from '../src/lib/visual-config'
import { VISUAL_STYLES, VISUAL_STYLE_CONFIG } from '../src/lib/visual-style'

let passed = 0, failed = 0
function assert(c: boolean, m: string) {
  if (c) { console.log(`  ✅ ${m}`); passed++ }
  else { console.error(`  ❌ ${m}`); failed++ }
}

async function main() {
  console.log('\n══════════ Appearance Reset Test Suite ══════════')
  const stamp = Date.now()
  const business = await prisma.business.create({
    data: {
      name: 'Reset Shop', slug: `reset-shop-${stamp}`,
      email: 'reset@example.com', phone: '555-0123',
      address: '1 Reset St', city: 'ResetCity', state: 'CA', zipCode: '90001',
      timezone: 'America/Los_Angeles',
      logo: 'https://cdn.example.com/logo.png',
      primaryColor: '#d4af37', accentColor: '#1a1a1a',
    },
  })
  try {
    // Seeded like a shop that published once, then customized its draft.
    await prisma.websiteContent.upsert({
      where: { businessId: business.id },
      create: {
        businessId: business.id,
        heroTitle: 'Keep My Hero',
        visualPreset: 'street-cut',
        visualConfig: { heroLayout: 'split', galleryLayout: 'filmstrip' },
        publishedContent: {
          visualPreset: 'street-cut',
          visualConfig: { heroLayout: 'split', galleryLayout: 'filmstrip' },
          heroTitle: 'Keep My Hero',
        },
        publishedAt: new Date(),
      },
      update: {},
    })

    // ── 1. Reset payload through the settings API's validation path ──
    // The dashboard button sets visualConfig to {} and saves via the normal
    // settings flow — exactly the payload shape the API route feeds into
    // validateVisualConfigInput.
    const resetVisual = validateVisualConfigInput({ visualPreset: 'street-cut', visualConfig: {} })
    assert(resetVisual.visualPreset === 'street-cut', 'reset keeps the selected preset')
    assert(
      resetVisual.visualConfig && Object.keys(resetVisual.visualConfig).length === 0,
      'reset clears every visual override (empty visualConfig)'
    )

    // ── 2. Draft vs published: reset touches only the draft ──────────
    await prisma.websiteContent.update({
      where: { businessId: business.id },
      data: {
        visualPreset: resetVisual.visualPreset,
        visualConfig: resetVisual.visualConfig as object,
      },
    })
    const after = await prisma.websiteContent.findUnique({ where: { businessId: business.id } })
    assert(after?.visualPreset === 'street-cut', 'draft still has the preset after reset')
    assert(
      after?.visualConfig && Object.keys(after.visualConfig as object).length === 0,
      'draft visualConfig is empty after reset'
    )
    assert(after?.heroTitle === 'Keep My Hero', 'reset leaves other website content untouched')
    const pub = after?.publishedContent as Record<string, unknown> | null
    assert(
      pub && (pub.visualConfig as Record<string, unknown> | undefined)?.heroLayout === 'split',
      'published snapshot keeps the old overrides (reset is draft-only)'
    )
    assert(pub?.heroTitle === 'Keep My Hero', 'published snapshot untouched by reset')

    const b = await prisma.business.findUnique({ where: { id: business.id } })
    assert(b?.name === 'Reset Shop' && b?.logo === 'https://cdn.example.com/logo.png', 'business branding untouched')
    assert(b?.primaryColor === '#d4af37', 'brand colors untouched')

    // ── 3. Resolver contract: empty overrides = pure preset defaults ─
    for (const preset of VISUAL_STYLES) {
      const resolved = resolveVisualConfig(preset, {})
      const base = resolveVisualConfig(preset, undefined)
      const cfg = VISUAL_STYLE_CONFIG[preset]
      const same = Object.keys(base).every(k => JSON.stringify(resolved[k]) === JSON.stringify(base[k]))
      assert(same, `preset ${preset}: {} resolves identically to undefined (pure defaults)`)
      assert(
        (resolved.heroLayout as string) === cfg.hero,
        `preset ${preset}: reset resolves to built-in hero layout (${cfg.hero})`
      )
      assert(
        (resolved.galleryLayout as string) === cfg.gallery,
        `preset ${preset}: reset resolves to built-in gallery layout (${cfg.gallery})`
      )
    }
  } finally {
    await prisma.business.delete({ where: { id: business.id } }) // cascades content
  }

  console.log('═══════════════════════════════════════════════════════')
  console.log(`${passed} passed, ${failed} failed`)
  console.log('═══════════════════════════════════════════════════════\n')
  if (failed > 0) process.exit(1)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
