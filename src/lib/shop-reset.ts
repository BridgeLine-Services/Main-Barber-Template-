import { prisma } from '@/lib/prisma'

/**
 * Shop configuration reset.
 *
 * Resets ONLY the configurable content of one business (scoped by businessId)
 * and returns the site to a setup-ready state. It never touches:
 *   - users / authentication / security records
 *   - customers
 *   - appointments or any financial/audit history
 *   - the database schema or migrations
 *
 * Records that are referenced by historical appointments are NOT deleted —
 * they are deactivated/archived so history and reporting stay intact.
 */

export interface ResetSummary {
  businessId: string
  barbersDeleted: number
  barbersDeactivated: number
  servicesDeleted: number
  servicesDeactivated: number
  mediaDeleted: number
  reviewsDeleted: number
  faqsDeleted: number
  closuresDeleted: number
  inventoryDeleted: number
  campaignsDeleted: number
  otherRecordsRemoved: number
  storageCleanup: { attempted: number; failed: number }
  storageWarning?: string
}

/**
 * Collect all blob-storage URLs owned by a business so the storage objects can
 * be removed after the database transaction commits. Only Vercel Blob URLs
 * are managed by this app; external URLs are left untouched.
 */
async function collectMediaUrls(businessId: string): Promise<string[]> {
  const media = await prisma.mediaAsset.findMany({
    where: { businessId },
    select: { url: true },
  })
  return media.map((m) => m.url).filter((u) => u.includes('blob.vercel-storage.com'))
}

/** Best-effort storage cleanup. Never throws; failures are reported. */
export async function cleanupStorageObjects(urls: string[]): Promise<{ attempted: number; failed: number }> {
  if (urls.length === 0) return { attempted: 0, failed: 0 }
  let failed = 0
  try {
    const { del } = await import('@vercel/blob')
    await del(urls)
    return { attempted: urls.length, failed }
  } catch (error) {
    failed = urls.length
    console.error(
      '[shop-reset] storage cleanup failed:',
      error instanceof Error ? error.message : 'unknown error'
    )
    return { attempted: urls.length, failed }
  }
}

/**
 * Run the shop configuration reset. All database work happens inside one
 * transaction; media storage cleanup happens after commit and is reported
 * rather than rolled back (the DB must stay consistent and truthful).
 */
export async function resetShopConfiguration(businessId: string): Promise<ResetSummary> {
  const business = await prisma.business.findUnique({ where: { id: businessId } })
  if (!business) throw new Error('Business not found')

  const mediaUrls = await collectMediaUrls(businessId)

  const summary = await prisma.$transaction(async (tx) => {
    const count = (n: number) => n

    // ── Identify history-protected records ────────────────────────────────
    const barbers = await tx.barber.findMany({
      where: { businessId },
      select: { id: true, name: true },
    })
    const barberIds = barbers.map((b) => b.id)

    const barbersWithHistory: string[] = []
    const barbersDeletable: string[] = []
    for (const b of barbers) {
      const appts = await tx.appointment.count({ where: { barberId: b.id } })
      if (appts > 0) barbersWithHistory.push(b.id)
      else barbersDeletable.push(b.id)
    }

    const services = await tx.service.findMany({
      where: { businessId },
      select: { id: true },
    })
    const servicesWithHistory: string[] = []
    const servicesDeletable: string[] = []
    for (const s of services) {
      const appts = await tx.appointment.count({ where: { serviceId: s.id } })
      if (appts > 0) servicesWithHistory.push(s.id)
      else servicesDeletable.push(s.id)
    }

    // ── Delete pure content / setup data (no historical dependencies) ─────
    const [, , , , mediaDeleted, reviewsDeleted, faqsDeleted, inventoryDeleted, campaignsDeleted, closuresDeleted] =
      await Promise.all([
        tx.bookingQuestion.deleteMany({ where: { businessId } }),
        tx.waitlistEntry.deleteMany({ where: { businessId } }),
        tx.blockedTime.deleteMany({ where: { businessId } }),
        tx.availabilityOverride.deleteMany({ where: { businessId } }),
        tx.mediaAsset.deleteMany({ where: { businessId } }),
        tx.review.deleteMany({ where: { businessId } }),
        tx.faq.deleteMany({ where: { businessId } }),
        tx.inventoryItem.deleteMany({ where: { businessId } }),
        tx.marketingCampaign.deleteMany({ where: { businessId } }),
        tx.businessClosure.deleteMany({ where: { businessId } }),
      ])

    // Loyalty configuration (reward programs)
    const loyaltyBarber = barberIds.length
      ? await tx.barberRewardProgram.deleteMany({ where: { barberId: { in: barberIds } } })
      : { count: 0 }
    const loyaltyBusiness = await tx.businessRewardProgram.deleteMany({ where: { businessId } })

    // Website content / SEO / policy configuration
    const [websiteContent, seo, noShow, retention] = await Promise.all([
      tx.websiteContent.deleteMany({ where: { businessId } }),
      tx.businessSEO.deleteMany({ where: { businessId } }),
      tx.noShowPolicy.deleteMany({ where: { businessId } }),
      tx.retentionSettings.deleteMany({ where: { businessId } }),
    ])

    // ── Barbers: unlink logins, delete the deletable, deactivate the rest ─
    if (barbersDeletable.length > 0) {
      await tx.user.updateMany({ where: { barberId: { in: barbersDeletable } }, data: { barberId: null } })
      await tx.barber.deleteMany({ where: { id: { in: barbersDeletable } } })
    }
    if (barbersWithHistory.length > 0) {
      await tx.barber.updateMany({ where: { id: { in: barbersWithHistory } }, data: { isActive: false } })
    }

    // ── Services: delete the deletable, deactivate the rest ───────────────
    if (servicesDeletable.length > 0) {
      await tx.service.deleteMany({ where: { id: { in: servicesDeletable } } })
    }
    if (servicesWithHistory.length > 0) {
      await tx.service.updateMany({ where: { id: { in: servicesWithHistory } }, data: { isActive: false } })
    }

    // ── Reset the business record itself to setup-ready defaults ─────────
    await tx.business.update({
      where: { id: businessId },
      data: {
        // Branding back to template defaults
        logo: null,
        primaryColor: '#1a1a1a',
        accentColor: '#d4af37',
        secondaryColor: '#2a2a2a',
        fontFamily: null,
        themeMode: 'dark',
        // Content cleared — owner re-enters it through onboarding/settings
        aboutText: null,
        teamSectionLabel: null,
        teamSectionTitle: null,
        teamSectionDescription: null,
        bookingPolicy: null,
        cancellationPolicy: null,
        latePolicy: null,
        noShowPolicyText: null,
        paymentPolicy: null,
        // Booking behavior back to template defaults
        walkInsWelcome: true,
        firstAvailableBookingEnabled: true,
        parkingAvailable: false,
        paymentInPerson: true,
        customerRescheduleEnabled: true,
        customerRescheduleMinNoticeHours: 24,
        // Social links cleared
        instagram: null,
        facebook: null,
        tiktok: null,
        youtube: null,
        xTwitter: null,
        // Hours cleared — onboarding schedule step rebuilds them
        hours: null,
        // Back to the start of the setup wizard
        onboardingCompleted: false,
        onboardingStep: 'business',
        onboardingCompletedAt: null,
      },
    })

    const otherRecordsRemoved =
      count(loyaltyBarber.count) +
      count(loyaltyBusiness.count) +
      count(websiteContent.count) +
      count(seo.count) +
      count(noShow.count) +
      count(retention.count)

    const result: ResetSummary = {
      businessId,
      barbersDeleted: barbersDeletable.length,
      barbersDeactivated: barbersWithHistory.length,
      servicesDeleted: servicesDeletable.length,
      servicesDeactivated: servicesWithHistory.length,
      mediaDeleted: mediaDeleted.count,
      reviewsDeleted: reviewsDeleted.count,
      faqsDeleted: faqsDeleted.count,
      closuresDeleted: closuresDeleted.count,
      inventoryDeleted: inventoryDeleted.count,
      campaignsDeleted: campaignsDeleted.count,
      otherRecordsRemoved,
      storageCleanup: { attempted: 0, failed: 0 },
    }
    return result
  })

  // Storage cleanup AFTER commit so DB state is never corrupted by a
  // storage provider outage mid-transaction.
  const storageCleanup = await cleanupStorageObjects(mediaUrls)
  summary.storageCleanup = storageCleanup
  if (storageCleanup.failed > 0) {
    summary.storageWarning =
      `${storageCleanup.failed} uploaded file(s) could not be removed from storage. ` +
      'Database records were reset, but the storage files may need manual cleanup.'
  }

  return summary
}
