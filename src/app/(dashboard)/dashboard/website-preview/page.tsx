import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ThemeStyle } from '@/components/customer/ThemeStyle'
import { Navbar } from '@/components/customer/Navbar'
import { Footer } from '@/components/customer/Footer'
import { MobileBottomNav } from '@/components/customer/MobileBottomNav'
import { MotionProvider } from '@/components/motion/MotionProvider'
import { CustomerHomepage } from '@/components/customer/home/CustomerHomepage'
import { visualConfigFromContent } from '@/lib/visual-config'
import type { BusinessHours } from '@/lib/business-hours'
import { getGiftCardSettings } from '@/lib/gift-cards'
import { isStorefrontUsable } from '@/lib/ecommerce'

export const dynamic = 'force-dynamic'

/**
 * Authenticated DRAFT preview of the website homepage. Staff-only (never
 * public): renders the tenant's DRAFT website content through the SAME
 * renderer the customer site uses (CustomerHomepage + the customer layout's
 * exact chrome: ThemeStyle, Navbar, Footer, MobileBottomNav, MotionProvider).
 * There is no second preview implementation — improvements to the public
 * site are reflected here automatically, and draft/published separation
 * stays intact: the public homepage renders the last published snapshot,
 * this route renders the live editable fields.
 *
 * `?embedded=1` renders inside the Website Appearance iframe (the surrounding
 * UI already labels it a draft preview, so the banner is suppressed).
 */
export default async function WebsitePreviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ embedded?: string }>
}) {
  const params = await searchParams
  const embedded = params?.embedded === '1'
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  const businessId = session.user.businessId
  if (!businessId) redirect('/dashboard')

  const [business, rawContent, giftCardSettings, shopEnabled] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId } }),
    prisma.websiteContent.findUnique({ where: { businessId } }),
    getGiftCardSettings(businessId).catch(() => null),
    isStorefrontUsable(businessId).catch(() => false),
  ])

  if (!business) redirect('/dashboard')

  // Footer expects the parsed hours shape (the public layout's `any` tenant
  // return masks this); same safe cast CustomerHomepage uses for hours.
  const footerBusiness = { ...business, hours: business.hours as unknown as BusinessHours }

  // DRAFT content — the live editable fields, NOT the published snapshot.
  // (The public homepage applies the publishedContent merge; this route must
  // not, or the owner would never see their unpublished changes.)
  const content = rawContent
  const visual = visualConfigFromContent(content)

  return (
    <MotionProvider level={visual.motionLevel}>
      {/* Identical wrapper to the customer layout: .brand-theme owns the
          theme surface; draft preset/motion drive the visual system. */}
      <div
        className="brand-theme min-h-screen bg-background text-foreground flex flex-col pb-16 md:pb-0"
        data-visual-style={visual.preset}
        data-motion={visual.motionLevel}
      >
        <ThemeStyle business={business} />
        <Navbar
          businessName={business.name}
          logo={business.logo}
          phone={business.phone}
          walkInsWelcome={business.walkInsWelcome !== false}
          giftCardsEnabled={giftCardSettings?.enabled === true}
          shopEnabled={shopEnabled}
        />
        {!embedded && (
          <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-700 dark:text-amber-300">
            DRAFT PREVIEW — only visible to signed-in staff. This is exactly what your homepage will
            show once you press &quot;Publish website&quot; in Settings.
          </div>
        )}
        <main className="flex-1">
          <CustomerHomepage business={business} content={content} />
        </main>
        <Footer business={footerBusiness} giftCardsEnabled={giftCardSettings?.enabled === true} shopEnabled={shopEnabled} />
        <MobileBottomNav mode={visual.mobileNavMode} walkInsWelcome={business.walkInsWelcome !== false} />
      </div>
    </MotionProvider>
  )
}
