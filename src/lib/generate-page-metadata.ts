// ============================================================================
// generateMetadata helper — produces SEO-optimized metadata for any
// customer-facing page, pulling the shop name, city, and SEO overrides
// from the database so every page gets unique, location-aware titles.
// ============================================================================

import type { Metadata } from 'next'
import { resolveBusiness } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'
import { getAppUrlString } from '@/lib/app-url'

interface PageMetaOptions {
  /** Page-specific title suffix, e.g. "Services & Pricing" */
  titleSuffix: string
  /** Page-specific description fallback */
  description?: string
  /** Optional path appended to the canonical URL, e.g. "/services" */
  path?: string
}

export async function generatePageMetadata({
  titleSuffix,
  description,
  path,
}: PageMetaOptions): Promise<Metadata> {
  const business = await resolveBusiness().catch(() => null)

  if (!business) {
    return {
      title: titleSuffix,
      description: description || undefined,
    }
  }

  const shopName = business.name || 'Barber Shop'
  const city = business.city || ''
  const state = business.state || ''
  const locationStr = [city, state].filter(Boolean).join(', ')
  const fullTitle = locationStr
    ? `${titleSuffix} | ${shopName} in ${locationStr}`
    : `${titleSuffix} | ${shopName}`

  const seo = await prisma.businessSEO.findUnique({
    where: { businessId: business.id },
  }).catch(() => null)

  // Prefer a configured business canonical URL, then fall back to the deployment URL.
  const configuredCanonical = seo?.canonicalUrl?.trim()
  const canonicalBase = configuredCanonical || getAppUrlString()
  const canonical = new URL(path || '/', canonicalBase.endsWith('/') ? canonicalBase : `${canonicalBase}/`).toString()

  // Use the site-level description as a fallback, then the page-level one
  const metaDescription =
    description ||
    seo?.siteDescription ||
    business.aboutText?.slice(0, 160) ||
    undefined

  // Include location-based keywords
  const keywords = seo?.keywords?.split(',').map((k) => k.trim()) || [
    titleSuffix.toLowerCase(),
    'barbershop',
    ...(city ? [`barbershop ${city}`, `${titleSuffix.toLowerCase()} ${city}`] : []),
  ]

  const ogTitle = seo?.ogTitle || fullTitle
  const ogDescription = seo?.ogDescription || metaDescription
  const ogImage = seo?.ogImage || business.logo || undefined

  return {
    title: fullTitle,
    description: metaDescription,
    keywords,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      title: ogTitle,
      description: ogDescription || undefined,
      type: 'website',
      locale: 'en_US',
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDescription || undefined,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    robots: {
      index: seo?.robotsIndex !== false,
      follow: seo?.robotsFollow !== false,
    },
    ...(seo?.googleVerification
      ? { verification: { google: seo.googleVerification } }
      : {}),
  }
}
