/**
 * Reports whether every classified tenant table has enabled + forced RLS
 * and a recognized tenant/organization isolation policy.
 *
 * Usage (set RLS_STATUS_DATABASE_URL only in a verified disposable/staging environment):
 *   npx tsx scripts/rls-status.ts
 *   npx tsx scripts/rls-status.ts --enforce
 *
 * Never falls back to the project's ordinary database connection.
 */
import { PrismaClient } from '@prisma/client'

const TENANT_TABLES = [
  // direct businessId (incl. trigger-maintained denormalized tables)
  'User','Barber','AvailabilityOverride','Service','MediaAsset','MaintenanceAction',
  'BusinessSEO','RetentionSettings','Customer','Appointment','BlockedTime',
  'Review','WaitlistEntry','NotificationLog','AuditLog','BusinessClosure',
  'BusinessRewardProgram','CustomerTagAssignment','CancellationRecord',
  'NoShowPolicy','InventoryItem','MarketingCampaign','WebsiteContent',
  'ReviewRequestSettings','ReviewRequest','SmsConsentLog','StaffInvitation',
  'MembershipSettings','MembershipPlan','Membership','MembershipUsage',
  'EcommerceSettings','Product','ShopOrder',
  'BookingQuestion','RescheduleHistory','PortalVerificationChallenge',
  'PortalSession','Faq','BarberService','BarberRewardProgram',
  'AppointmentIntakeResponse','Payment','BeforeAfterPair',
  // POS + commissions (settings, rate rules, participation, immutable ledger)
  'PaymentSettings','CommissionSettings','CommissionRule',
  'BarberCommissionParticipation','CommissionEntry',
  'TimeClockSettings','BarberTimeClockAccess','TimeClockEntry',
  'TimeClockBreak','TimeClockEntryRevision',
  // payroll-ready reporting (settings, immutable report snapshots, adjustments)
  'PayrollSettings','PayrollReport','PayrollReportLine',
  'PayrollReportAdjustment',
  // gift cards (settings, cards, balance ledger)
  'GiftCardSettings','GiftCard','GiftCardTransaction',
  // organization-scoped rows, plus dual-scoped location/link models
  'Organization','OrganizationMember','OrganizationInvitation',
  'OrganizationBrandSettings','OrganizationReportingConfiguration',
  'OrganizationServiceTemplate','OrganizationAnnouncement',
  'OrganizationAnnouncementRead','OrganizationConfigAudit',
  'OrganizationLocation','StaffLocationAssignment',
  'OrganizationServicePriceException','OrganizationServicePriceRequest','CustomerLocationLink',
  'ReferralProgram','ReferralCode','ReferralAttribution',
  // referral rewards + website content history: direct businessId, added after the
  // enforcement test caught them missing from the SQL protection list
  'ReferralReward','ReferralRewardEvent','WebsiteContentVersion',
  // indirect rows whose tenant is inherited from a protected parent
  'OrderItem','TwoFactorRecoveryCode',
  // tenant roots and indirect schedule rows
  'Business','Schedule',
]

async function main() {
  const url = process.env.RLS_STATUS_DATABASE_URL
  if (!url) { console.error('Set RLS_STATUS_DATABASE_URL to a positively identified disposable or staging database'); process.exit(1) }
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  const enforce = process.argv.includes('--enforce')

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ relname: string; rls: boolean; forced: boolean; policies: number }>>(`
      SELECT c.relname,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS forced,
             COUNT(p.polname) FILTER (WHERE p.polname IN ('tenant_isolation', 'organization_isolation'))::int AS policies
        FROM pg_class c
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname = ANY(ARRAY[${TENANT_TABLES.map(t => `'${t}'`).join(',')}]::text[])
       GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity`)

    const byName = new Map(rows.map(r => [r.relname, r]))
    let missing = 0
    console.log(`RLS coverage report (${TENANT_TABLES.length} tenant tables):\n`)
    for (const t of TENANT_TABLES) {
      const r = byName.get(t)
      const ok = r?.rls && r.forced && r.policies > 0
      if (!ok) missing++
      const state = !r ? ' (table missing)' : !r.rls ? ' (RLS disabled)' : !r.forced ? ' (FORCE RLS disabled)' : !r.policies ? ' (no policy)' : ''
      console.log(`${ok ? '\u2705' : '\u26a0\ufe0f '} ${t}${state}`)
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
