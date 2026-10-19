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
import { isStorefrontUsable } from '@/lib/ecommerce'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { SignOutButton } from '@/components/auth/SignOutButton'

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const business = await resolveBusiness().catch(() => null)

  // No business configured — show a simple "not yet set up" page
  // instead of redirecting to /setup (which no longer exists).
  // Signed-in non-owners get a visible session notice (with sign-out) so a
  // successful customer signup/login is never mistaken for "nothing
  // happened" while the shop is still unset up.
  if (!business) {
    const session = await getServerSession(authOptions)
    const user = session?.user as { name?: string | null; email?: string | null; role?: string } | undefined
    const isOwner = user?.role === 'OWNER'

    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4">
        <div className="text-center max-w-md">
          <h1 className="display-heading text-display-3 text-foreground mb-4">
            {isOwner ? 'Your Shop Setup Is Incomplete' : 'Shop Coming Soon'}
          </h1>
          <p className="text-muted-foreground">
            {isOwner
              ? 'Continue setup to finish configuring your shop.'
              : "This barbershop hasn't been set up yet. The owner needs to log in and complete the setup."}
          </p>

          {user && !isOwner && (
            <p className="mt-4 text-sm text-muted-foreground" data-testid="signed-in-notice">
              You&apos;re signed in as{' '}
              <span className="font-medium text-foreground">{user.email || user.name}</span> ({user.role === 'CUSTOMER' ? 'Customer' : user.role}). You&apos;ll be able to book online once the shop opens.
            </p>
          )}

          <div className="mt-6 flex flex-col items-center gap-4">
            <a
              href={isOwner ? '/dashboard' : '/login'}
              className="inline-block text-primary hover:brightness-125 transition-colors"
            >
              {isOwner ? 'Continue Setup →' : 'Owner Login →'}
            </a>
            {user && !isOwner && <SignOutButton redirectTo="/login" />}
          </div>
        </div>
      </div>
    )
  }

  // Gift cards nav link only when the shop enabled them
  const giftCardSettings = await getGiftCardSettings(business.id).catch(() => null)
  // Shop nav link only when the online store is enabled (feature flag + master switch)
  const shopEnabled = await isStorefrontUsable(business.id).catch(() => false)

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
          shopEnabled={shopEnabled}
        />
        <main className="flex-1">{children}</main>
        <Footer business={business} giftCardsEnabled={giftCardSettings?.enabled === true} shopEnabled={shopEnabled} />
        <MobileBottomNav
          mode={visual.mobileNavMode}
          walkInsWelcome={business.walkInsWelcome !== false}
        />
      </div>
    </MotionProvider>
  )
}
