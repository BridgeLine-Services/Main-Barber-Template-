import React from 'react'

interface SEOProps {
  business?: {
    name?: string
    phone?: string | null
    email?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    zipCode?: string | null
    latitude?: number | null
    longitude?: number | null
    hours?: Record<string, { open?: string; close?: string; isOff?: boolean }> | null
    logo?: string | null
    slug?: string
    aboutText?: string | null
  } | null
  seo?: {
    siteTitle?: string | null
    siteDescription?: string | null
    ogTitle?: string | null
    ogDescription?: string | null
    ogImage?: string | null
    keywords?: string | null
    canonicalUrl?: string | null
    robotsIndex?: boolean | null
    robotsFollow?: boolean | null
    googleVerification?: string | null
  } | null
}

const DAY_MAP: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

export function SEO({ business, seo }: SEOProps) {
  if (!business) return null

  const name = business.name || 'Barber Shop'
  const telephone = business.phone || undefined
  const email = business.email || undefined

  // Use SEO overrides if available, otherwise derive from business
  const metaTitle = seo?.siteTitle || name
  const metaDescription = seo?.siteDescription || business.aboutText?.slice(0, 160) || undefined
  const ogTitle = seo?.ogTitle || metaTitle
  const ogDescription = seo?.ogDescription || metaDescription
  const ogImage = seo?.ogImage || business.logo || undefined
  const keywords = seo?.keywords || undefined

  const openingHoursSpec: Array<Record<string, string>> = []

  if (business.hours && typeof business.hours === 'object') {
    Object.entries(business.hours).forEach(([day, val]) => {
      const fullDay = DAY_MAP[day.toLowerCase()]
      if (fullDay && val && !val.isOff && val.open && val.close) {
        openingHoursSpec.push({
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: `https://schema.org/${fullDay}`,
          opens: val.open,
          closes: val.close,
        })
      }
    })
  }

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'BarberShop'],
    name,
    description: metaDescription,
    image: ogImage,
    url: seo?.canonicalUrl || undefined,
    telephone,
    email,
    priceRange: '$$',
    ...(business.address
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: business.address,
            addressLocality: business.city || undefined,
            addressRegion: business.state || undefined,
            postalCode: business.zipCode || undefined,
            addressCountry: 'US',
          },
        }
      : {}),
    ...(business.latitude && business.longitude
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: business.latitude,
            longitude: business.longitude,
          },
        }
      : {}),
    ...(openingHoursSpec.length > 0
      ? { openingHoursSpecification: openingHoursSpec }
      : { openingHours: 'Mo-Sa 09:00-19:00' }),
  }

  // Build robots content
  const robotsParts: string[] = []
  if (seo?.robotsIndex === false) robotsParts.push('noindex')
  else robotsParts.push('index')
  if (seo?.robotsFollow === false) robotsParts.push('nofollow')
  else robotsParts.push('follow')
  const robotsContent = robotsParts.join(', ')

  const metaTags = (
    <>
      {metaTitle && <title>{metaTitle}</title>}
      {metaDescription && <meta name="description" content={metaDescription} />}
      {keywords && <meta name="keywords" content={keywords} />}
      <meta name="robots" content={robotsContent} />

      {/* Open Graph */}
      <meta property="og:title" content={ogTitle} />
      <meta property="og:description" content={ogDescription} />
      <meta property="og:type" content="website" />
      {ogImage && <meta property="og:image" content={ogImage} />}

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={ogTitle} />
      <meta name="twitter:description" content={ogDescription} />
      {ogImage && <meta name="twitter:image" content={ogImage} />}

      {/* Canonical */}
      {seo?.canonicalUrl && <link rel="canonical" href={seo.canonicalUrl} />}

      {/* Google Search Console verification */}
      {seo?.googleVerification && (
        <meta name="google-site-verification" content={seo.googleVerification} />
      )}
    </>
  )

  return (
    <>
      {metaTags}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </>
  )
}
