/**
 * QA seed: enable the featuredWork home module for the test shop by saving an
 * explicit homeModules config (same shape validateHomeModulesInput produces),
 * mirroring what the dashboard saves — draft + published snapshot so the
 * public homepage renders it. Idempotent.
 * Run: bash -c 'set -a; source ../local.env; set +a; npx tsx scripts/seed-featured-module-qa.ts'
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma'

const ALL_ON = [
  'hero', 'quickBook', 'shopStatus', 'featuredWork', 'services',
  'team', 'beforeAfter', 'reviews', 'visit', 'faq', 'finalCta',
] as const

async function main() {
  const wc = await prisma.websiteContent.findFirst()
  if (!wc) throw new Error('no websiteContent')

  const homeModules = {
    modules: ALL_ON.map((id) => ({
      id,
      enabled: true,
      ...(id === 'featuredWork' ? { settings: { count: 6 } } : {}),
    })),
  }

  const published =
    ((wc.publishedContent ?? {}) as Prisma.JsonObject)

  await prisma.websiteContent.update({
    where: { id: wc.id },
    data: { homeModules, publishedContent: { ...published, homeModules } },
  })

  console.log('featuredWork module enabled (explicit config, published snapshot updated)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
