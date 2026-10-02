import Link from 'next/link'
import type { Metadata } from 'next'
import Image from 'next/image'
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { formatDuration, formatPrice, getInitials } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Scissors,
  Phone,
  MessageSquare,
  Star,
  MapPin,
  Mail,
  Clock,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Sparkles,
} from 'lucide-react'
import { focalPositionStyle } from '@/lib/image-roles'
import { Section, SectionHeading } from '@/components/customer/Section'
import { ShopStatus } from '@/components/customer/ShopStatus'
import { BookButton, GhostButton } from '@/components/customer/Cta'
import { Reveal, Stagger, StaggerItem, HeroReveal, ScrollHint } from '@/components/motion/reveal'
import type { BusinessHours } from '@/lib/business-hours'
import { visualConfigFromContent } from '@/lib/visual-config'
import { resolveHomeModules, type HomeModuleId } from '@/lib/home-modules'
import { resolvedButtonShapeClass, resolvedImageShapeClass } from '@/lib/visual-config'
import { mapFontFamily } from '@/lib/theme'
import { Fragment } from 'react'
import { FeaturedWorkSection } from '@/components/customer/home/FeaturedWorkSection'
import { BeforeAfterSection } from '@/components/customer/home/BeforeAfterSection'
import { SocialGallerySection } from '@/components/customer/home/SocialGallerySection'
import { ShopExperienceSection } from '@/components/customer/home/ShopExperienceSection'
import type { BeforeAfterData } from '@/components/customer/BeforeAfterSlider'


// ─── Dynamic SEO Metadata ──────────────────────────────────────────────
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

  const visual = visualConfigFromContent(content)

  // Homepage module system: ordered, owner-configured sections. Derived
  // from legacy show* toggles until the owner saves a module config.
  const home = resolveHomeModules(content)
  const moduleFor = (id: HomeModuleId) => home.modules.find((m) => m.id === id)
  const isModuleEnabled = (id: HomeModuleId) => moduleFor(id)?.enabled ?? false
  const moduleSettings = (id: HomeModuleId) => moduleFor(id)?.settings

  const [barbers, services, reviews, servicePhotoRows] = await Promise.all([
    prisma.barber.findMany({
      where: { businessId: business.id, isActive: true },
      orderBy: { order: 'asc' },
    }),
    prisma.service.findMany({
      where: { businessId: business.id, isActive: true },
      orderBy: { order: 'asc' },
    }),
    prisma.review.findMany({
      where: { businessId: business.id, isFeatured: true, isPublished: true },
      orderBy: { createdAt: 'desc' },
      take: content?.featuredReviewCount ?? 3,
    }),
    // Real service photography for the image-led menu variant — only loaded
    // when that layout is actually selected (never fabricated placeholders).
    visual.serviceLayout === 'visual-menu'
      ? prisma.mediaAsset.findMany({
          where: { businessId: business.id, type: 'SERVICE_PHOTO', isPublished: true },
          orderBy: { sortOrder: 'asc' },
        })
      : Promise.resolve([]),
  ])

  const servicePhotoByServiceId = new Map(
    servicePhotoRows.filter((a) => a.serviceId).map((a) => [a.serviceId as string, a])
  )

  // Module-dependent data — only loaded when the module is enabled.
  const [featuredRows, shopPhotoRows, beforeAfterPairRows] = await Promise.all([
    isModuleEnabled('featuredWork') || isModuleEnabled('socialGallery')
      ? prisma.mediaAsset.findMany({
          where: { businessId: business.id, type: { in: ['BARBER_PORTFOLIO', 'GALLERY'] }, isPublished: true },
          orderBy: { sortOrder: 'asc' },
          take: Math.max(
            moduleSettings('featuredWork')?.count ?? 6,
            moduleSettings('socialGallery')?.social?.count ?? 6
          ),
          select: { id: true, url: true, altText: true, caption: true, focalX: true, focalY: true },
        })
      : Promise.resolve([]),
    isModuleEnabled('shopExperience')
      ? prisma.mediaAsset.findMany({
          where: { businessId: business.id, type: 'SHOP_PHOTO', isPublished: true },
          orderBy: { sortOrder: 'asc' },
          take: moduleSettings('shopExperience')?.count ?? 4,
          select: { id: true, url: true, altText: true, focalX: true, focalY: true },
        })
      : Promise.resolve([]),
    isModuleEnabled('beforeAfter')
      ? prisma.beforeAfterPair.findMany({
          where: { businessId: business.id, isPublished: true },
          orderBy: { sortOrder: 'asc' },
          take: moduleSettings('beforeAfter')?.count ?? 3,
          include: {
            beforeAsset: { select: { url: true, altText: true, focalX: true, focalY: true } },
            afterAsset: { select: { url: true, altText: true, focalX: true, focalY: true } },
            barber: { select: { id: true, name: true } },
            service: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
  ])

  const shopName = business?.name || 'Barber Shop'
  const shopPhone = business?.phone || ''
  const shopPhoneDigits = shopPhone.replace(/\D/g, '')
  const fullAddress = [business?.address, business?.city, business?.state, business?.zipCode]
    .filter(Boolean)
    .join(', ') || ''

  // Location string for SEO-friendly H1
  const city = business?.city || ''
  const state = business?.state || ''
  const locationStr = [city, state].filter(Boolean).join(', ')

  // Google Maps embed URL using the shop address
  const mapsQuery = encodeURIComponent(`${shopName} ${fullAddress}`)
  const mapsEmbedUrl = `https://www.google.com/maps?q=${mapsQuery}&output=embed`
  const mapsLinkUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`

  const hoursList = business?.hours && typeof business.hours === 'object'
    ? Object.entries(business.hours as BusinessHours).map(([day, val]) => ({
        day: day.charAt(0).toUpperCase() + day.slice(1),
        hours: val?.isOff ? 'Closed' : `${val?.open || '09:00'} - ${val?.close || '18:00'}`,
      }))
    : [] // no database hours → show the by-appointment note, never invented hours

  // Hero copy — WebsiteContent first, business data as fallback. Never invented.
  const heroEyebrow = content?.heroEyebrow || (locationStr ? `Premium Barbershop — ${locationStr}` : 'Premium Barbershop')
  const heroTitle = content?.heroTitle || shopName
  const heroDescription =
    content?.heroDescription ||
    business?.aboutText ||
    `Experience top-tier craftsmanship at ${shopName}. From classic razor fades to precision beard styling, walk out looking and feeling sharp.`
  const heroImage = content?.heroImageUrl || null
  // Tenant visual identity — resolved from the published WebsiteContent
  // snapshot (draft → publish → this). Single source of truth:
  // resolveVisualConfig handles defaults, invalid values, and legacy keys.
  const styleClass = `visual-style-${visual.preset}`
  // Owner override wins over the preset default (gap 6).
  const buttonShape = resolvedButtonShapeClass(visual)
  const imageShape = resolvedImageShapeClass(visual)


  // Trust highlights driven by real business configuration — never fake claims
  const highlights = [
    { icon: CheckCircle2, label: 'Instant Confirmation' },
    ...(business?.paymentInPerson ? [{ icon: Sparkles, label: 'Pay In Person' }] : []),
    ...(business?.walkInsWelcome ? [{ icon: Clock, label: 'Walk-Ins Welcome' }] : []),
  ]


  // Heading scale — swaps concrete size tokens on editorial hero h1s
  // (the poster hero is intentionally display-size and keeps its scale).
  const heroH1Size = (standard: string, compact: string, grand: string) =>
    visual.headingScale === 'compact' ? compact : visual.headingScale === 'grand' ? grand : standard

  // ─── Section nodes — data-dependent modules render null when empty ─────
  const heroNode = (
    <>
      {/* ─── Hero — three genuinely distinct owner-selectable compositions ── */}
      {visual.heroLayout === 'split' && (
        /* SPLIT: real two-column — editorial text region beside an image
           region. The photo is its own composition element, not a backdrop. */
        <section className="relative -mt-16 overflow-hidden pt-16 lg:min-h-[78svh] lg:flex lg:items-center border-b border-border/60">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-16 lg:pt-8 lg:pb-24">
            <div className="order-2 flex flex-col items-start text-left lg:order-1">
              <HeroReveal>
                <span className="eyebrow text-accent">{heroEyebrow}</span>
              </HeroReveal>
              <HeroReveal delay={0.12} className="mt-5">
                <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
                  {heroTitle}
                  {locationStr && !content?.heroTitle ? (
                    <span className="block text-2xl text-accent sm:text-3xl">Barbershop in {locationStr}</span>
                  ) : null}
                </h1>
              </HeroReveal>
              <HeroReveal delay={0.24} className="mt-6 max-w-xl">
                <p className="text-balance text-base leading-relaxed text-foreground/70 sm:text-lg">{heroDescription}</p>
              </HeroReveal>
              <HeroReveal delay={0.36} className="mt-10 flex w-full flex-col gap-4 sm:flex-row sm:items-center">
                <BookButton
                  href={content?.heroPrimaryCtaHref || '/book'}
                  label={content?.heroPrimaryCtaLabel || 'Book Your Appointment'}
                  className={`w-full sm:w-auto ${buttonShape}`}
                />
                <div className="flex gap-3">
                  {shopPhoneDigits && (
                    <GhostButton href={`tel:${shopPhoneDigits}`} className="px-5 py-4">Call</GhostButton>
                  )}
                  {shopPhoneDigits && (
                    <GhostButton href={`sms:${shopPhoneDigits}`} className="px-5 py-4">Text Us</GhostButton>
                  )}
                </div>
              </HeroReveal>
              <HeroReveal delay={0.48} className="mt-12 w-full max-w-md">
                <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-5 text-xs text-foreground/60 sm:text-sm">
                  {highlights.map((h) => (
                    <span key={h.label} className="inline-flex items-center gap-2">
                      <h.icon className="h-4 w-4 text-accent" aria-hidden="true" />{h.label}
                    </span>
                  ))}
                </div>
              </HeroReveal>
            </div>
            {/* Image region: the shop's own hero photo (portrait crop), or an
                accent-lit surface with the shop monogram — never a stock photo. */}
            <div className={`order-1 lg:order-2 ${heroImage ? '' : 'relative aspect-[4/3] lg:aspect-[4/5]'}`}>
              {heroImage ? (
                <div className="relative aspect-[4/3] overflow-hidden border border-border/60 lg:aspect-[4/5]">
                  <Image
                    src={heroImage}
                    alt={`Inside ${shopName}`}
                    fill
                    priority
                    sizes="(min-width: 1024px) 40vw, 100vw"
                    quality={80}
                    className={`img-cinematic object-cover ${imageShape === 'rounded-2xl' ? '' : imageShape}`}
                  />
                </div>
              ) : (
                <div
                  aria-hidden="true"
                  className={`flex h-full items-center justify-center border border-border/60 ${imageShape === 'rounded-2xl' ? '' : imageShape}`}
                  style={{ background: 'radial-gradient(ellipse 90% 70% at 50% 20%, hsl(var(--accent) / 0.16), hsl(var(--muted)) 75%)' }}
                >
                  <span className="font-display text-8xl font-semibold text-foreground/15">
                    {shopName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {visual.heroLayout === 'poster' && (
        /* POSTER: typography-led. The headline IS the design; photography is
           a supporting inset, and the booking action is unmissable. */
        <section className="relative -mt-16 overflow-hidden pt-16 border-b border-border/60">
          <div className="mx-auto w-full max-w-7xl px-4 pb-20 pt-14 sm:px-6 lg:pb-28 lg:pt-20">
            <HeroReveal>
              <span className="eyebrow text-accent">{heroEyebrow}</span>
            </HeroReveal>
            <HeroReveal delay={0.12} className="mt-6">
              <h1 className="font-display text-6xl font-semibold uppercase leading-[0.92] tracking-tight text-foreground sm:text-8xl lg:text-[clamp(5rem,12vw,9.5rem)]">
                {heroTitle}
              </h1>
            </HeroReveal>
            {locationStr && !content?.heroTitle ? (
              <HeroReveal delay={0.2}>
                <p className="mt-3 text-xl font-medium uppercase tracking-[0.35em] text-accent sm:text-2xl">
                  Barbershop — {locationStr}
                </p>
              </HeroReveal>
            ) : null}
            <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_0.6fr] lg:items-end">
              <HeroReveal delay={0.32}>
                <p className="max-w-2xl text-balance text-base leading-relaxed text-foreground/70 sm:text-lg">
                  {heroDescription}
                </p>
                <div className="mt-10 flex w-full flex-col gap-4 sm:flex-row sm:items-center">
                  <BookButton
                    href={content?.heroPrimaryCtaHref || '/book'}
                    label={content?.heroPrimaryCtaLabel || 'Book Your Appointment'}
                    className={`w-full text-base sm:w-auto sm:px-10 sm:py-5 ${buttonShape}`}
                  />
                  {shopPhoneDigits && (
                    <GhostButton href={`tel:${shopPhoneDigits}`} className="px-5 py-4">Call</GhostButton>
                  )}
                </div>
                <div className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-foreground/15 pt-5 text-xs text-foreground/60 sm:text-sm">
                  {highlights.map((h) => (
                    <span key={h.label} className="inline-flex items-center gap-2">
                      <h.icon className="h-4 w-4 text-accent" aria-hidden="true" />{h.label}
                    </span>
                  ))}
                </div>
              </HeroReveal>
              {heroImage ? (
                <HeroReveal delay={0.44}>
                  <div className={`relative aspect-square overflow-hidden border border-border/60 ${imageShape === 'rounded-2xl' ? '' : imageShape}`}>
                    <Image
                      src={heroImage}
                      alt=""
                      fill
                      priority
                      sizes="(min-width: 1024px) 35vw, 100vw"
                      quality={80}
                      className="img-cinematic object-cover"
                    />
                  </div>
                </HeroReveal>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {visual.heroLayout === 'cinematic' && (
        /* CINEMATIC: immersive full-bleed imagery with a legibility overlay —
           the classic premium barbershop opening. */
        <section className={`visual-hero relative -mt-16 flex min-h-[92svh] items-center justify-center overflow-hidden border-b border-border/60 ${visual.preset === 'black-label' ? 'lg:min-h-[86svh]' : ''}`}>
          {heroImage ? (
            <Image
              src={heroImage}
              alt=""
              fill
              priority
              sizes="100vw"
              quality={80}
              className={`img-cinematic object-cover ${imageShape}`}
            />
          ) : (
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse 80% 60% at 50% 0%, hsl(var(--accent) / 0.14), transparent 60%), radial-gradient(ellipse 100% 80% at 50% 100%, hsl(var(--background)), hsl(var(--background)) 70%)',
              }}
            />
          )}
          {/* Dark overlays keep text readable over any photo */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/55 to-background"
          />
          <div aria-hidden="true" className="absolute inset-0 bg-black/15" />

          <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-24 pb-16 text-center sm:px-6">
            <HeroReveal>
              <span className="eyebrow border border-accent/30 bg-accent/10 px-3 py-1.5 backdrop-blur-sm">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {heroEyebrow}
              </span>
            </HeroReveal>

            {/* SEO-optimized H1: includes shop name + city for local search */}
            <HeroReveal delay={0.12} className="mt-6">
              <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                {heroTitle}
                {locationStr && !content?.heroTitle ? (
                  <span className="text-accent"> — Barbershop in {locationStr}</span>
                ) : null}
              </h1>
            </HeroReveal>

            <HeroReveal delay={0.24} className="mt-6 max-w-2xl">
              <p className="text-balance text-base leading-relaxed text-foreground/70 sm:text-lg">
                {heroDescription}
              </p>
            </HeroReveal>

            <HeroReveal delay={0.36} className="mt-10 flex w-full flex-col items-center justify-center gap-4 sm:flex-row">
              <BookButton
                href={content?.heroPrimaryCtaHref || '/book'}
                label={content?.heroPrimaryCtaLabel || 'Book Your Appointment'}
                className={`w-full sm:w-auto ${buttonShape}`}
              />
              <div className="flex w-full items-center justify-center gap-3 sm:w-auto">
                {shopPhoneDigits && (
                  <GhostButton href={`tel:${shopPhoneDigits}`} className="w-auto px-5 py-4">
                    <Phone className="h-4 w-4 text-accent" aria-hidden="true" />
                    Call
                  </GhostButton>
                )}
                {shopPhoneDigits && (
                  <GhostButton href={`sms:${shopPhoneDigits}`} className="w-auto px-5 py-4">
                    <MessageSquare className="h-4 w-4 text-accent" aria-hidden="true" />
                    Text Us
                  </GhostButton>
                )}
              </div>
            </HeroReveal>

            {/* Trust highlights — driven by real business settings */}
            <HeroReveal delay={0.48} className="mt-12 w-full max-w-xl">
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-foreground/10 pt-6 text-xs text-foreground/60 sm:text-sm">
                {highlights.map((h) => (
                  <span key={h.label} className="inline-flex items-center gap-2">
                    <h.icon className="h-4 w-4 text-accent" aria-hidden="true" />
                    {h.label}
                  </span>
                ))}
              </div>
            </HeroReveal>
          </div>

          <ScrollHint className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 text-foreground/50">
            <ChevronDown className="h-6 w-6" />
          </ScrollHint>
        </section>
      )}
    </>
  )

  const shopStatusNode = (
    <Section tone="muted">
      <div className="flex justify-center">
        <ShopStatus />
      </div>
    </Section>
  )

  const featuredSettings = moduleSettings('featuredWork')
  const featuredWorkNode = featuredRows.length > 0 ? (
    <FeaturedWorkSection
      images={featuredRows.slice(0, featuredSettings?.count ?? 6)}
      heading={featuredSettings?.heading}
      blurb={featuredSettings?.blurb}
      shopName={shopName}
      buttonShape={buttonShape}
    />
  ) : null

  const servicesNode = (
      <Section>
        <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end lg:mb-14">
          <SectionHeading
        scale={visual.headingScale}
            align={visual.serviceLayout === 'editorial' ? 'left' : undefined}
            eyebrow={content?.servicesTitle ? undefined : 'Our Services'}
            title={content?.servicesTitle || 'Crafted Cuts & Barbering Services'}
            description={content?.servicesDescription || undefined}
            className="mb-0"
          />
          {services.length > 0 && (
            <Reveal delay={0.1}>
              <Link
                href="/services"
                className="group inline-flex items-center text-sm font-semibold text-accent transition hover:brightness-125"
              >
                View All Services
                <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </Reveal>
          )}
        </div>

        {services.length > 0 ? (
          /* EDITORIAL — hairline menu rows: large names, quiet metadata,
             price right, Book one tap away. */
          visual.serviceLayout === 'editorial' ? (
            <Stagger className="visual-services border-t border-border/60">
              {services.slice(0, 6).map((service) => (
                <StaggerItem key={service.id} className="border-b border-border/60">
                  <div className="group flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:py-7">
                    <div className="min-w-0">
                      <h3 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                        {service.name}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground line-clamp-2 max-w-2xl">
                        {service.description || 'Full haircut service with lineup, neck shave, and styling.'}
                      </p>
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatDuration(service.duration)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-6 sm:shrink-0 sm:self-center">
                      <span className="font-display text-lg font-bold text-foreground tabular-nums sm:text-xl">
                        {formatPrice(service.price)}
                      </span>
                      <Link
                        href={`/book?serviceId=${service.id}`}
                        className="group/book inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors duration-micro hover:brightness-125 focus-ring rounded-sm px-1 py-1"
                        aria-label={`Book ${service.name}`}
                      >
                        Book
                        <ArrowRight className="h-4 w-4 transition-transform duration-micro group-hover/book:translate-x-0.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          )

          /* CARDS — compact panels for scannable browsing. */
          : visual.serviceLayout === 'cards' ? (
            <Stagger className="visual-services grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {services.slice(0, 6).map((service) => (
                <StaggerItem key={service.id} className="flex flex-col justify-between rounded-xl border border-border/70 bg-card p-5 shadow-sm">
                  <div>
                    <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
                      {service.name}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground line-clamp-2">
                      {service.description || 'Full haircut service with lineup, neck shave, and styling.'}
                    </p>
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatDuration(service.duration)}
                    </p>
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4">
                    <span className="font-display text-lg font-bold text-foreground tabular-nums">
                      {formatPrice(service.price)}
                    </span>
                    <Link
                      href={`/book?serviceId=${service.id}`}
                      className="group/book inline-flex items-center gap-1.5 rounded-sm px-1 py-1 text-sm font-semibold text-primary transition-colors duration-micro hover:brightness-125 focus-ring"
                      aria-label={`Book ${service.name}`}
                    >
                      Book
                      <ArrowRight className="h-4 w-4 transition-transform duration-micro group-hover/book:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          )

          /* VISUAL MENU — image-led: the shop's own service photography
             drives the composition; text rows sit beside it. */
          : (
            <Stagger className="visual-services grid gap-5 border-t-2 border-accent/30 pt-5 sm:grid-cols-2 lg:grid-cols-3">
              {services.slice(0, 6).map((service) => {
                const photo = servicePhotoByServiceId.get(service.id)
                return (
                  <StaggerItem key={service.id} className="group">
                    <Link
                      href={`/book?serviceId=${service.id}`}
                      className="focus-ring block overflow-hidden rounded-lg"
                      aria-label={`Book ${service.name}`}
                    >
                      <div className="relative aspect-[4/3] overflow-hidden border border-border/60">
                        {photo ? (
                          <Image
                            src={photo.url}
                            alt={photo.altText || `${service.name} at ${shopName}`}
                            fill
                            loading="lazy"
                            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                            className="img-cinematic object-cover transition-transform duration-slow group-hover:scale-[1.03]"
                            style={focalPositionStyle(photo.focalX, photo.focalY)}
                          />
                        ) : (
                          /* No photo on record: a quiet accent tile with the
                             service initial — honest, not a fake stock image. */
                          <div
                            aria-hidden="true"
                            className="flex h-full items-center justify-center"
                            style={{ background: 'linear-gradient(160deg, hsl(var(--accent) / 0.12), hsl(var(--muted)) 70%)' }}
                          >
                            <span className="font-display text-4xl font-semibold text-foreground/15">
                              {service.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="mt-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
                            {service.name}
                          </h3>
                          <span className="font-display text-base font-bold text-foreground tabular-nums">
                            {formatPrice(service.price)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
                          {service.description || 'Full haircut service with lineup, neck shave, and styling.'}
                        </p>
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          {formatDuration(service.duration)}
                          <ArrowRight className="ml-auto h-3.5 w-3.5 text-accent transition-transform duration-micro group-hover:translate-x-0.5" aria-hidden="true" />
                        </p>
                      </div>
                    </Link>
                  </StaggerItem>
                )
              })}
            </Stagger>
          )
        ) : (
          <Reveal className="flex flex-col items-center justify-center space-y-3 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
              <Scissors className="h-7 w-7" aria-hidden="true" />
            </div>
            <p className="text-sm text-muted-foreground">Our service menu is being updated. Check back soon!</p>
          </Reveal>
        )}
      </Section>
  )

  const teamNode = (
      <Section tone="muted" bleed>
        <SectionHeading
        scale={visual.headingScale}
          eyebrow={content?.teamTitle ? undefined : 'The Team'}
          title={content?.teamTitle || 'Meet Our Master Barbers'}
          description={content?.teamDescription || 'Skilled professionals dedicated to giving you the exact look you want.'}
        />

        {barbers.length > 0 ? (
          /* EDITORIAL — portrait-led rows: photo beside name/specialty/bio,
             Book as a quiet text action. Two columns feel like people. */
          visual.barberLayout === 'editorial' ? (
          <Stagger className="visual-team grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2">
            {barbers.map((barber) => (
              <StaggerItem key={barber.id}>
                <div className="group flex flex-col gap-5 sm:flex-row sm:gap-6">
                  <Avatar className="h-28 w-28 shrink-0 rounded-lg border border-border/70 ring-2 ring-background transition-transform duration-ui group-hover:scale-[1.02] sm:h-32 sm:w-32">
                    <AvatarImage src={barber.photo || '/images/default-barber.svg'} alt={barber.name} className="rounded-lg object-cover" />
                    <AvatarFallback className="rounded-lg bg-secondary font-display text-2xl font-semibold text-primary">
                      {getInitials(barber.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 border-t border-border/60 pt-4 sm:border-t-0 sm:pt-1">
                    <h3 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                      {barber.name}
                    </h3>
                    {barber.specialty && (
                      <p className="eyebrow-accent mt-1.5">{barber.specialty}</p>
                    )}
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                      {barber.bio || 'Expert in fades, tapers, razor line-ups, and luxury beard sculpting.'}
                    </p>
                    <Link
                      href={`/book?barberId=${barber.id}`}
                      className="group/book mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors duration-micro hover:brightness-125 focus-ring rounded-sm px-1 py-1"
                    >
                      Book with {barber.name.split(' ')[0]}
                      <ArrowRight className="h-4 w-4 transition-transform duration-micro group-hover/book:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
          )

          /* PORTRAIT GRID — photography-first tiles: the portrait is the
             composition; name + specialty sit beneath it. */
          : visual.barberLayout === 'portrait-grid' ? (
          <Stagger className="visual-team grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
            {barbers.map((barber) => (
              <StaggerItem key={barber.id}>
                <Link href={`/barbers/${barber.slug || barber.id}`} className="group block focus-ring rounded-lg">
                  <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-border/70">
                    {barber.photo ? (
                      <img
                        src={barber.photo}
                        alt={barber.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-slow group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-secondary">
                        <span className="font-display text-4xl font-semibold text-primary">
                          {getInitials(barber.name)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-3">
                    <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
                      {barber.name}
                    </h3>
                    {barber.specialty && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{barber.specialty}</p>
                    )}
                    <p className="eyebrow mt-2 opacity-0 transition-opacity duration-micro group-hover:opacity-100 group-focus-visible:opacity-100">
                      Book a chair
                    </p>
                  </div>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
          )

          /* LARGE PROFILE — full-width editorial features: prominent
             photography, expanded bio, and a primary booking action. */
          : (
          <Stagger className="visual-team flex flex-col gap-14">
            {barbers.map((barber) => (
              <StaggerItem key={barber.id}>
                <div className="group grid gap-8 border-t border-border/60 pt-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
                  <div className="relative aspect-[4/5] max-h-[30rem] overflow-hidden rounded-lg border border-border/70 sm:aspect-[16/10] lg:aspect-[4/5]">
                    {barber.photo ? (
                      <img
                        src={barber.photo}
                        alt={barber.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-slow group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-secondary">
                        <span className="font-display text-7xl font-semibold text-primary">
                          {getInitials(barber.name)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col justify-center">
                    <h3 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                      {barber.name}
                    </h3>
                    {barber.specialty && (
                      <p className="eyebrow-accent mt-2">{barber.specialty}</p>
                    )}
                    <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
                      {barber.bio || 'Expert in fades, tapers, razor line-ups, and luxury beard sculpting.'}
                    </p>
                    <div className="mt-8 flex flex-wrap items-center gap-4">
                      <BookButton
                        href={`/book?barberId=${barber.id}`}
                        label={`Book with ${barber.name.split(' ')[0]}`}
                        className={`${buttonShape}`}
                      />
                      <Link
                        href={`/barbers/${barber.slug || barber.id}`}
                        className="group/profile inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors duration-micro hover:brightness-125 focus-ring rounded-sm px-1 py-1"
                      >
                        Full profile
                        <ArrowRight className="h-4 w-4 transition-transform duration-micro group-hover/profile:translate-x-0.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
          )
        ) : (
          <Reveal className="flex flex-col items-center justify-center space-y-3 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
              <Scissors className="h-7 w-7" aria-hidden="true" />
            </div>
            <p className="text-sm text-muted-foreground">Our team is being assembled. Check back soon!</p>
          </Reveal>
        )}
      </Section>
  )

  const baSettings = moduleSettings('beforeAfter')
  const beforeAfterData: BeforeAfterData[] = beforeAfterPairRows.map((pair) => ({
    id: pair.id,
    before: { url: pair.beforeAsset.url, alt: pair.beforeAsset.altText || '' },
    after: { url: pair.afterAsset.url, alt: pair.afterAsset.altText || '' },
    caption: pair.caption,
    details: pair.details,
    barberName: pair.barber?.name ?? null,
    barberId: pair.barberId,
    serviceName: pair.service?.name ?? null,
    serviceId: pair.serviceId,
  }))
  const beforeAfterNode = beforeAfterData.length > 0 ? (
    <BeforeAfterSection
      pairs={beforeAfterData.slice(0, baSettings?.count ?? 3)}
      heading={baSettings?.heading}
      blurb={baSettings?.blurb}
      shopName={shopName}
      buttonShape={buttonShape}
    />
  ) : null

  const reviewsNode = reviews.length > 0 ? (
      <Section>
        <SectionHeading
        scale={visual.headingScale}
          eyebrow={content?.reviewsTitle ? undefined : 'Reviews'}
          title={content?.reviewsTitle || 'What Our Clients Say'}
          description={content?.reviewsDescription || undefined}
        />
        {/* EDITORIAL — quote-led: large serif-feeling pull quotes in an
            asymmetric two-column flow. */}
        {visual.reviewPresentation === 'editorial' && (
        <Stagger className="visual-reviews grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-x-14">
          {reviews.map((review, idx) => (
            <StaggerItem key={review.id} className={idx === 0 ? 'md:col-span-2 md:mx-auto md:max-w-3xl' : ''}>
              <blockquote className={idx === 0 ? 'text-center' : ''}>
                <div className="flex items-center justify-center gap-1" role="img" aria-label={`${review.rating} out of 5 stars`}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className={`h-4 w-4 ${i < review.rating ? 'fill-accent text-accent' : 'text-muted-foreground/30'}`} aria-hidden="true" />
                  ))}
                </div>
                <p className={`mt-4 font-display font-medium leading-snug tracking-tight text-foreground ${idx === 0 ? 'text-2xl sm:text-3xl' : 'text-xl'}`}>
                  &ldquo;{review.comment}&rdquo;
                </p>
                <footer className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="h-px w-8 bg-accent/50" aria-hidden="true" />
                  {review.authorName}
                </footer>
              </blockquote>
            </StaggerItem>
          ))}
        </Stagger>
        )}

        {/* CARDS — compact panels for scannable browsing (default). */}
        {visual.reviewPresentation === 'cards' && (
        <Stagger className="visual-reviews grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {reviews.map((review) => (
            <StaggerItem key={review.id}>
              <Card className={`h-full border-border/70 bg-card/60 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 ${visual.preset === 'street-cut' ? 'rounded-none shadow-[5px_5px_0_hsl(var(--accent)/0.18)]' : visual.preset === 'clean-club' ? 'rounded-2xl' : ''}`}>
                <CardContent className="space-y-3 p-6">
                  <div className="flex items-center gap-1" role="img" aria-label={`${review.rating} out of 5 stars`}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-4 w-4 ${i < review.rating ? 'fill-accent text-accent' : 'text-muted-foreground/30'}`}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                  <p className="line-clamp-4 text-sm leading-relaxed text-foreground/80">
                    &ldquo;{review.comment}&rdquo;
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    — {review.authorName}
                  </p>
                </CardContent>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
        )}

        {/* STRIP — horizontal scrolling row of compact quotes. */}
        {visual.reviewPresentation === 'strip' && (
        <Stagger className="visual-reviews -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
          {reviews.map((review) => (
            <StaggerItem key={review.id} className="w-72 shrink-0 snap-center sm:w-80">
              <Card className="h-full border-border/70 bg-card/60 p-5 backdrop-blur-sm">
                <div className="flex items-center gap-1" role="img" aria-label={`${review.rating} out of 5 stars`}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className={`h-3.5 w-3.5 ${i < review.rating ? 'fill-accent text-accent' : 'text-muted-foreground/30'}`} aria-hidden="true" />
                  ))}
                </div>
                <p className="mt-3 line-clamp-5 text-sm leading-relaxed text-foreground/80">
                  &ldquo;{review.comment}&rdquo;
                </p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  — {review.authorName}
                </p>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
        )}
      </Section>
  ) : null

  const socialSettings = moduleSettings('socialGallery')?.social
  const socialGalleryNode =
    socialSettings && featuredRows.length > 0 ? (
      <SocialGallerySection
        images={featuredRows
          .slice(0, socialSettings.count)
          .map((img) => ({ id: img.id, url: img.url, altText: img.altText, focalX: img.focalX, focalY: img.focalY }))}
        settings={socialSettings}
        shopName={shopName}
        buttonShape={buttonShape}
      />
    ) : null

  const experienceSettings = moduleSettings('shopExperience')
  const shopExperienceNode = shopPhotoRows.length > 0 ? (
    <ShopExperienceSection
      photos={shopPhotoRows}
      heading={experienceSettings?.heading}
      blurb={experienceSettings?.blurb}
      shopName={shopName}
    />
  ) : null

  const visitNode = (
      <Section tone="muted" bleed>
        <SectionHeading
        scale={visual.headingScale}
          eyebrow={content?.visitTitle ? undefined : 'Visit Us'}
          title={content?.visitTitle || `Find ${shopName}`}
          description={content?.visitDescription || undefined}
        />

        {/* Live shop status: real open/closed state, today's hours, and
            the current walk-in queue. */}
        <Reveal className="mb-8">
          <ShopStatus />
        </Reveal>

        <Stagger className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <StaggerItem>
            <Card className="h-full space-y-5 border-border/70 bg-card p-6">
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <h3 className="text-base font-bold text-foreground">Our Location</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{fullAddress}</p>
                  <a
                    href={mapsLinkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-sm text-accent hover:underline"
                  >
                    Get Directions →
                  </a>
                </div>
              </div>

              <div className="border-t border-border/60 pt-4">
                <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-foreground">
                  <Clock className="h-5 w-5 text-accent" aria-hidden="true" />
                  Hours of Operation
                </h3>
                <div className="space-y-2">
                  {hoursList.length > 0 ? (
                    hoursList.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{item.day}</span>
                        <span className={`font-medium ${item.hours === 'Closed' ? 'text-destructive' : 'text-foreground/90'}`}>
                          {item.hours}
                        </span>
                      </div>
                    ))
                  ) : (
                    // Shop owner hasn't configured hours — never invent them
                    <p className="text-sm text-muted-foreground">
                      By appointment — see available times when booking.
                    </p>
                  )}
                </div>
              </div>

              {shopPhoneDigits && (
                <div className="border-t border-border/60 pt-4">
                  <h3 className="mb-3 text-base font-bold text-foreground">Contact</h3>
                  <div className="flex flex-col gap-2.5">
                    <a href={`tel:${shopPhoneDigits}`} className="inline-flex items-center gap-2 text-sm text-accent hover:underline focus-ring rounded-sm">
                      <Phone className="h-4 w-4" aria-hidden="true" />
                      {shopPhone}
                    </a>
                    {business?.email && (
                      <a href={`mailto:${business.email}`} className="inline-flex items-center gap-2 text-sm text-accent hover:underline focus-ring rounded-sm">
                        <Mail className="h-4 w-4" aria-hidden="true" />
                        {business.email}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </StaggerItem>

          {/* Google Maps Embed */}
          <StaggerItem>
            <Card className="relative min-h-[320px] overflow-hidden border-border/70 bg-card p-0">
              <iframe
                src={mapsEmbedUrl}
                width="100%"
                height="100%"
                style={{ border: 0, minHeight: '320px' }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title={`${shopName} location map`}
              />
            </Card>
          </StaggerItem>
        </Stagger>
      </Section>
  )

  const finalCtaNode = (
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 80% at 50% 100%, hsl(var(--accent) / 0.12), transparent 65%)',
          }}
        />
        <div className="relative mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:py-28">
          <Reveal>
            <p className="eyebrow-accent mb-5">Book Your Chair</p>
            <h2 className="display-heading text-display-1 text-foreground">
              {content?.finalCtaTitle || 'Ready for Your Next Cut?'}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-5 max-w-xl text-large text-muted-foreground">
              {content?.finalCtaDescription ||
                `Book online in under a minute. ${shopPhone ? `Prefer to talk? Call ${shopPhone}.` : 'See real-time availability and lock in your spot.'}`}
            </p>
          </Reveal>
          <Reveal delay={0.2} className="mt-10">
            <BookButton label="Book Your Appointment" className={`w-full sm:w-auto ${buttonShape}`} />
          </Reveal>
        </div>
      </section>
  )

  // Ordered render — the module system decides which sections appear and in
  // what order (hero is structural and always first).
  const moduleNode: Partial<Record<HomeModuleId, React.ReactNode>> = {
    hero: heroNode,
    shopStatus: shopStatusNode,
    featuredWork: featuredWorkNode,
    services: servicesNode,
    team: teamNode,
    beforeAfter: beforeAfterNode,
    reviews: reviewsNode,
    socialGallery: socialGalleryNode,
    shopExperience: shopExperienceNode,
    visit: visitNode,
    finalCta: finalCtaNode,
  }

  // Typography: heading font override scopes --font-display (used by
  // .font-display headings); body font override cascades from the root.
  const pageFontStyle = {
    ...(visual.headingFont ? { '--font-display': mapFontFamily(visual.headingFont) } : undefined),
    ...(visual.bodyFont ? { fontFamily: mapFontFamily(visual.bodyFont) } : undefined),
  } as React.CSSProperties

  return (
    <div
      className={`pb-12 ${styleClass} heading-scale-${visual.headingScale}`}
      style={pageFontStyle}
    >
      {home.modules
        .filter((m) => m.enabled && moduleNode[m.id] != null)
        .map((m) => (
          <Fragment key={m.id}>{moduleNode[m.id]}</Fragment>
        ))}
    </div>
  )
}
