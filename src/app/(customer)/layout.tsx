export const dynamic = 'force-dynamic'

import { resolveBusiness } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'
import { Navbar } from '@/components/customer/Navbar'
import { Footer } from '@/components/customer/Footer'
import { MobileBottomNav } from '@/components/customer/MobileBottomNav'
import { SEO } from '@/components/customer/SEO'
import { ThemeStyle } from '@/components/customer/ThemeStyle'
import { MotionProvider } from '@/components/motion/MotionProvider'
import { visualConfigFromContent } from '@/lib/visual-config'
import { getGiftCardSettings } from '@/lib/gift-cards'

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const business = await resolveBusiness().catch(() => null)

  // No business configured — show a simple "not yet set up" page
  // instead of redirecting to /setup (which no longer exists)
  if (!business) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4">
        <div className="text-center max-w-md">
          <h1 className="display-heading text-display-3 text-foreground mb-4">Shop Coming Soon</h1>
          <p className="text-muted-foreground">
            This barbershop hasn't been set up yet. The owner needs to log in and complete the setup.
          </p>
          <a href="/login" className="inline-block mt-6 text-primary hover:brightness-125 transition-colors">
            Owner Login →
          </a>
        </div>
      </div>
    )
  }

  // Gift cards nav link only when the shop enabled them
  const giftCardSettings = await getGiftCardSettings(business.id).catch(() => null)

  // Fetch SEO settings for this business
  const seo = await prisma.businessSEO.findUnique({
    where: { businessId: business.id },
  }).catch(() => null)

  // Tenant visual identity: motion level enforced site-wide via MotionProvider,
  // preset + motion emitted as data attributes for CSS-level styling.
  const rawContent = await prisma.websiteContent.findUnique({
    where: { businessId: business.id },
  }).catch(() => null)
  const content = rawContent?.publishedContent
    ? { ...rawContent, ...(rawContent.publishedContent as Record<string, unknown>) }
    : rawContent
  const visual = visualConfigFromContent(content)

  // The .brand-theme class (styled by ThemeStyle/generateThemeCSS) owns the
  // entire surface: --background, --foreground, --card, --accent, etc. The
  // wrapper must consume those variables, NOT hardcoded zinc/white classes,
  // so the business's primary/secondary colors and light/dark mode actually
  // render. Never inline a raw hex here — Tailwind maps bg-accent etc. to
  // hsl(var(--accent)), and a hex value inside hsl() is invalid CSS.
  return (
    <MotionProvider level={visual.motionLevel}>
      <div
        className="brand-theme min-h-screen bg-background text-foreground flex flex-col pb-16 md:pb-0"
        data-visual-style={visual.preset}
        data-motion={visual.motionLevel}
      >
        <ThemeStyle business={business} />
        <SEO business={business} seo={seo} />
        <Navbar
          businessName={business.name}
          logo={business.logo}
          phone={business.phone}
          walkInsWelcome={business.walkInsWelcome !== false}
          giftCardsEnabled={giftCardSettings?.enabled === true}
        />
        <main className="flex-1">{children}</main>
        <Footer business={business} giftCardsEnabled={giftCardSettings?.enabled === true} />
        <MobileBottomNav
          mode={visual.mobileNavMode}
          walkInsWelcome={business.walkInsWelcome !== false}
        />
      </div>
    </MotionProvider>
  )
}
