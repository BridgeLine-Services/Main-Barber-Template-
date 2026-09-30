import type { BusinessHours } from '@/lib/business-hours'

export interface BusinessData {
  name: string
  slug?: string
  logo?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
  latitude?: number | null
  longitude?: number | null
  hours?: Record<string, { open?: string; close?: string; isOff?: boolean }> | null
  aboutText?: string | null
}

export interface ServiceData {
  name: string
  description?: string | null
  price: number
  duration: number
}

export interface FAQItem {
  question: string
  answer: string
}

export interface BreadcrumbItem {
  name: string
  url: string
}

const getBaseUrl = () => process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'https://barber-template.invalid'

/**
 * Generate Schema.org LocalBusiness / BarberShop JSON-LD structure
 */
export function generateLocalBusinessSchema(business: BusinessData) {
  const baseUrl = getBaseUrl()
  const shopUrl = business.slug ? `${baseUrl}/shop/${business.slug}` : baseUrl

  const openingHoursSpecification = []
  if (business.hours && typeof business.hours === 'object') {
    const dayMap: Record<string, string> = {
      monday: 'Monday',
      tuesday: 'Tuesday',
      wednesday: 'Wednesday',
      thursday: 'Thursday',
      friday: 'Friday',
      saturday: 'Saturday',
      sunday: 'Sunday',
    }

    for (const [dayKey, dayConfig] of Object.entries(business.hours as BusinessHours)) {
      if (dayConfig && !dayConfig.isOff && dayConfig.open && dayConfig.close) {
        const dayOfWeek = dayMap[dayKey.toLowerCase()] || dayKey
        openingHoursSpecification.push({
          '@type': 'OpeningHoursSpecification',
          dayOfWeek,
          opens: dayConfig.open,
          closes: dayConfig.close,
        })
      }
    }
  }

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BarberShop',
    '@id': `${shopUrl}#barbershop`,
    name: business.name || 'Barber Shop',
    url: shopUrl,
    telephone: business.phone || undefined,
    email: business.email || undefined,
    image: business.logo || `${baseUrl}/og-image.png`,
    description: business.aboutText || `Premium barber shop services at ${business.name}.`,
    priceRange: '$$',
  }

  if (business.address || business.city || business.state || business.zipCode) {
    schema.address = {
      '@type': 'PostalAddress',
      streetAddress: business.address || '',
      addressLocality: business.city || '',
      addressRegion: business.state || '',
      postalCode: business.zipCode || '',
      addressCountry: 'US',
    }
  }

  if (business.latitude && business.longitude) {
    schema.geo = {
      '@type': 'GeoCoordinates',
      latitude: business.latitude,
      longitude: business.longitude,
    }
  }

  if (openingHoursSpecification.length > 0) {
    schema.openingHoursSpecification = openingHoursSpecification
  }

  return schema
}

/**
 * Generate Schema.org Service JSON-LD structure
 */
export function generateServiceSchema(service: ServiceData, business?: BusinessData) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name,
    description: service.description || `${service.name} service (${service.duration} mins)`,
    provider: business
      ? {
          '@type': 'BarberShop',
          name: business.name,
          telephone: business.phone || undefined,
        }
      : undefined,
    offers: {
      '@type': 'Offer',
      price: service.price.toFixed(2),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
  }
}

/**
 * Generate Schema.org FAQPage JSON-LD structure
 */
export function generateFAQSchema(faqs: FAQItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }
}

/**
 * Generate Schema.org BreadcrumbList JSON-LD structure
 */
export function generateBreadcrumbSchema(items: BreadcrumbItem[]) {
  const baseUrl = getBaseUrl()

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => {
      const fullUrl = item.url.startsWith('http')
        ? item.url
        : `${baseUrl}${item.url.startsWith('/') ? '' : '/'}${item.url}`
      return {
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: fullUrl,
      }
    }),
  }
}

/**
 * Generate Schema.org WebSite JSON-LD structure with SearchAction
 */
export function generateWebsiteSchema(business?: BusinessData) {
  const baseUrl = getBaseUrl()
  const name = business?.name || 'Barber Booking System'

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: name,
    url: baseUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${baseUrl}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}
