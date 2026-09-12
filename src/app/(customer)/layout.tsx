export const dynamic = 'force-dynamic'

import { resolveBusiness } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'
import { Navbar } from '@/components/customer/Navbar'
import { Footer } from '@/components/customer/Footer'
import { MobileBottomNav } from '@/components/customer/MobileBottomNav'
import { SEO } from '@/components/customer/SEO'
import { ThemeStyle } from '@/components/customer/ThemeStyle'
import { MotionProvider } from '@/components/motion/MotionProvider'

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
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-4">Shop Coming Soon</h1>
          <p className="text-zinc-400">
            This barbershop hasn't been set up yet. The owner needs to log in and complete the setup.
          </p>
          <a href="/login" className="inline-block mt-6 text-amber-400 hover:text-amber-300 transition-colors">
            Owner Login →
          </a>
        </div>
      </div>
    )
  }

  // Fetch SEO settings for this business
  const seo = await prisma.businessSEO.findUnique({
    where: { businessId: business.id },
  }).catch(() => null)

  const isDark = (business.themeMode || 'dark') === 'dark'

  return (
    <MotionProvider>
      <div className={`brand-theme min-h-screen ${isDark ? 'bg-zinc-950 text-zinc-100' : 'bg-white text-zinc-900'} flex flex-col pb-16 md:pb-0`}
           style={{ ['--accent' as any]: business.accentColor }}>
        <ThemeStyle business={business} />
        <SEO business={business} seo={seo} />
        <Navbar
          businessName={business.name}
          logo={business.logo}
          phone={business.phone}
        />
        <main className="flex-1">{children}</main>
        <Footer business={business} />
        <MobileBottomNav />
      </div>
    </MotionProvider>
  )
}
