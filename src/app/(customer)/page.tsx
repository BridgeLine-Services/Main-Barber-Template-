import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { CustomerHomepage } from '@/components/customer/home/CustomerHomepage'


export async function generateMetadata(): Promise<Metadata> {
  const business = await resolveBusiness().catch(() => null)
  if (!business) {
    return {
      title: 'Barber Shop | Book Your Appointment',
      description: 'Book your next haircut or beard trim online.',
    }
  }

  const shopName = business.name || 'Barber Shop'
  const city = business.city || ''
  const state = business.state || ''
  const locationStr = [city, state].filter(Boolean).join(', ')

  // Fetch SEO overrides if available
  const seo = await prisma.businessSEO.findUnique({
    where: { businessId: business.id },
  }).catch(() => null)

  const title = seo?.siteTitle || (locationStr
    ? `${shopName} | Premium Barbershop in ${locationStr}`
    : `${shopName} | Book Your Appointment`)

  const description = seo?.siteDescription || business.aboutText?.slice(0, 160) ||
    `Book your next haircut, fade, or beard trim at ${shopName}${locationStr ? ` in ${locationStr}` : ''}. Easy online booking, pay in person.`

  const keywords = seo?.keywords?.split(',').map(k => k.trim()) || [
    'barber shop', 'haircut', 'beard trim', 'fades',
    ...(city ? [`barbershop ${city}`, `haircuts ${city}`, `barber near me ${city}`] : ['barber near me']),
  ]

  return {
    title,
    description,
    keywords,
    openGraph: {
      title: seo?.ogTitle || title,
      description: seo?.ogDescription || description,
      type: 'website',
      locale: 'en_US',
      ...(seo?.ogImage || business.logo ? { images: [seo?.ogImage || business.logo!] } : {}),
    },
    alternates: {
      canonical: seo?.canonicalUrl || undefined,
    },
    robots: {
      index: seo?.robotsIndex !== false,
      follow: seo?.robotsFollow !== false,
    },
    ...(seo?.googleVerification ? {
      verification: { google: seo.googleVerification },
    } : {}),
  }
}

export default async function HomePage() {
  const business = await resolveBusiness().catch(() => null)

  if (!business) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h1 className="font-display text-3xl font-semibold mb-4">Shop Coming Soon</h1>
          <p className="text-muted-foreground">This barbershop hasn&apos;t been set up yet.</p>
        </div>
      </div>
    )
  }

  // Owner-editable hero + section copy/toggles (dashboard → Settings → Website
  // Content). Every field is optional; the site falls back to business data.
  const rawContent = await prisma.websiteContent.findUnique({
    where: { businessId: business.id },
  }).catch(() => null)

  // Draft/publish: render the published snapshot when one exists; the live
  // editable fields are the DRAFT and only reach the public site after the
  // owner publishes (or before the first publish, for legacy parity).
  const content = rawContent?.publishedContent
    ? { ...rawContent, ...(rawContent.publishedContent as Record<string, unknown>) }
    : rawContent

  // Single source of truth: the SAME renderer the dashboard draft preview
  // uses (CustomerHomepage). The public site always renders the PUBLISHED
  // content; the preview renders the draft.
  return <CustomerHomepage business={business} content={content} />
}
