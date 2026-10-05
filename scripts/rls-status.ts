/**
 * Reports which tenant tables have Row-Level Security enabled and a
 * tenant_isolation policy — the post-deployment verification checklist
 * for Master Task Part 2.
 *
 * Usage:
 *   npx tsx scripts/rls-status.ts           # report
 *   npx tsx scripts/rls-status.ts --enforce  # exit 1 if incomplete
 *
 * Works against any connection (DATABASE_URL or DATABASE_ADMIN_URL;
 * the admin URL wins when both are set).
 */
import { PrismaClient } from '@prisma/client'

const TENANT_TABLES = [
  // direct businessId (incl. trigger-maintained denormalized tables)
  'User','Barber','AvailabilityOverride','Service','MediaAsset',
  'BusinessSEO','RetentionSettings','Customer','Appointment','BlockedTime',
  'Review','WaitlistEntry','NotificationLog','AuditLog','BusinessClosure',
  'BusinessRewardProgram','CustomerTagAssignment','CancellationRecord',
  'NoShowPolicy','InventoryItem','MarketingCampaign','WebsiteContent',
  'BookingQuestion','RescheduleHistory','PortalVerificationChallenge',
  'PortalSession','Faq','BarberService','BarberRewardProgram',
  'AppointmentIntakeResponse','Payment','BeforeAfterPair',
  // POS + commissions (settings, rate rules, participation, immutable ledger)
  'PaymentSettings','CommissionSettings','CommissionRule',
  'BarberCommissionParticipation','CommissionEntry',
  // tenant roots
  'Business','Schedule',
]

async function main() {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL
  if (!url) { console.error('No database URL configured'); process.exit(1) }
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  const enforce = process.argv.includes('--enforce')

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ relname: string; rls: boolean; policies: number }>>(`
      SELECT c.relname,
             c.relrowsecurity AS rls,
             COUNT(p.polname)::int AS policies
        FROM pg_class c
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE c.relname = ANY(ARRAY[${TENANT_TABLES.map(t => `'${t}'`).join(',')}]::text[])
       GROUP BY c.relname, c.relrowsecurity`)

    const byName = new Map(rows.map(r => [r.relname, r]))
    let missing = 0
    console.log(`RLS coverage report (${TENANT_TABLES.length} tenant tables):\n`)
    for (const t of TENANT_TABLES) {
      const r = byName.get(t)
      const ok = r?.rls && r.policies > 0
      if (!ok) missing++
      console.log(`${ok ? '\u2705' : '\u26a0\ufe0f '} ${t}${r?.rls ? '' : ' (RLS disabled or table missing)'}${r?.policies ? '' : r ? ' (no policy)' : ''}`)
    }
    const pct = Math.round(((TENANT_TABLES.length - missing) / TENANT_TABLES.length) * 100)
    console.log(`\n${TENANT_TABLES.length - missing}/${TENANT_TABLES.length} tables protected (${pct}%).`)
    if (missing > 0) {
      console.log('\nTo apply: follow "Enabling RLS" in docs/TENANT-ISOLATION.md')
      if (enforce) { console.log('--enforce set: failing.'); process.exit(1) }
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
