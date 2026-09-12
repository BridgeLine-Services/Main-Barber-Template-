import Link from 'next/link'
import type { Metadata } from 'next'
import Image from 'next/image'
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { formatDuration, formatPrice, getInitials } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Scissors,
  Phone,
  MessageSquare,
  Star,
  MapPin,
  Clock,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Sparkles,
} from 'lucide-react'
import { Section, SectionHeading } from '@/components/customer/Section'
import { BookButton, GhostButton } from '@/components/customer/Cta'
import { Reveal, Stagger, StaggerItem, HeroReveal, ScrollHint } from '@/components/motion/reveal'

export const revalidate = 60

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
  const content = await prisma.websiteContent.findUnique({
    where: { businessId: business.id },
  }).catch(() => null)

  const [barbers, services, reviews] = await Promise.all([
    prisma.barber.findMany({
      where: { businessId: business.id, isActive: true },
      orderBy: { order: 'asc' },
    }),
    prisma.service.findMany({
      where: { businessId: business.id, isActive: true },
      orderBy: { order: 'asc' },
    }),
    prisma.review.findMany({
      where: { businessId: business.id, isFeatured: true },
      orderBy: { createdAt: 'desc' },
      take: content?.featuredReviewCount ?? 3,
    }),
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
    ? Object.entries(business.hours).map(([day, val]: [string, any]) => ({
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

  const showServices = content?.showServices ?? true
  const showTeam = content?.showTeam ?? true
  const showReviews = content?.showReviews ?? true
  const showVisit = content?.showVisit ?? true
  const showFinalCta = content?.showFinalCta ?? true

  // Trust highlights driven by real business configuration — never fake claims
  const highlights = [
    { icon: CheckCircle2, label: 'Instant Confirmation' },
    ...(business?.paymentInPerson ? [{ icon: Sparkles, label: 'Pay In Person' }] : []),
    ...(business?.walkInsWelcome ? [{ icon: Clock, label: 'Walk-Ins Welcome' }] : []),
  ]

  return (
    <div className="pb-12">
      {/* ─── Cinematic Hero ──────────────────────────────────────────────── */}
      <section className="relative -mt-16 flex min-h-[92svh] items-center justify-center overflow-hidden border-b border-border/60">
        {/* Background: owner-configured hero image, or an elegant accent-lit
            gradient when none is set. Never a permanently hard-coded photo. */}
        {heroImage ? (
          <Image
            src={heroImage}
            alt=""
            fill
            priority
            sizes="100vw"
            quality={80}
            className="img-cinematic object-cover"
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
              className="w-full sm:w-auto"
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

      {/* ─── Services ────────────────────────────────────────────────────── */}
      {showServices && (
      <Section>
        <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end lg:mb-14">
          <SectionHeading
            align="left"
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
          <Stagger className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {services.slice(0, 6).map((service) => (
              <StaggerItem key={service.id}>
                <Card className="group flex h-full flex-col justify-between border-border/70 bg-card/60 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl hover:shadow-black/20">
                  <CardContent className="flex h-full flex-col p-6">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="font-display text-xl font-semibold text-foreground">{service.name}</h3>
                      <span className="shrink-0 text-lg font-bold text-accent">
                        {formatPrice(service.price)}
                      </span>
                    </div>
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatDuration(service.duration)}
                    </p>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-foreground/70">
                      {service.description || 'Full haircut service with lineup, neck shave, and styling.'}
                    </p>
                    <div className="mt-6 border-t border-border/60 pt-4">
                      <Button
                        asChild
                        className="w-full border border-border bg-secondary font-semibold text-secondary-foreground transition-colors duration-300 hover:border-accent/40 hover:bg-accent hover:text-accent-foreground"
                        size="sm"
                      >
                        <Link href={`/book?serviceId=${service.id}`}>Book This Service</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <Reveal className="flex flex-col items-center justify-center space-y-3 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
              <Scissors className="h-7 w-7" aria-hidden="true" />
            </div>
            <p className="text-sm text-muted-foreground">Our service menu is being updated. Check back soon!</p>
          </Reveal>
        )}
      </Section>
      )}

      {/* ─── Meet the Barbers ─────────────────────────────────────────────── */}
      {showTeam && (
      <Section tone="muted" bleed>
        <SectionHeading
          eyebrow={content?.teamTitle ? undefined : 'The Team'}
          title={content?.teamTitle || 'Meet Our Master Barbers'}
          description={content?.teamDescription || 'Skilled professionals dedicated to giving you the exact look you want.'}
        />

        {barbers.length > 0 ? (
          <Stagger className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {barbers.map((barber) => (
              <StaggerItem key={barber.id}>
                <Card className="group flex h-full flex-col border-border/70 bg-card transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl hover:shadow-black/20">
                  <div className="flex flex-1 flex-col items-center p-6 text-center">
                    <Avatar className="h-24 w-24 border-2 border-accent/30 ring-4 ring-background transition-transform duration-300 group-hover:scale-[1.03]">
                      <AvatarImage src={barber.photo || '/images/default-barber.svg'} alt={barber.name} />
                      <AvatarFallback className="bg-secondary font-display text-xl font-bold text-accent">
                        {getInitials(barber.name)}
                      </AvatarFallback>
                    </Avatar>
                    <h3 className="font-display mt-4 text-xl font-semibold text-foreground">{barber.name}</h3>
                    {barber.specialty && (
                      <p className="mt-1 text-xs font-medium uppercase tracking-wider text-accent">{barber.specialty}</p>
                    )}
                    <p className="mt-3 line-clamp-3 flex-1 px-2 text-sm leading-relaxed text-muted-foreground">
                      {barber.bio || 'Expert in fades, tapers, razor line-ups, and luxury beard sculpting.'}
                    </p>
                  </div>
                  <div className="px-6 pb-6">
                    <Link
                      href={`/book?barberId=${barber.id}`}
                      className="w-full rounded-md border border-accent/30 bg-accent/10 px-4 py-2.5 text-center text-sm font-semibold text-accent transition-all duration-300 hover:bg-accent hover:text-accent-foreground"
                    >
                      Book with {barber.name.split(' ')[0]}
                    </Link>
                  </div>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <Reveal className="flex flex-col items-center justify-center space-y-3 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
              <Scissors className="h-7 w-7" aria-hidden="true" />
            </div>
            <p className="text-sm text-muted-foreground">Our team is being assembled. Check back soon!</p>
          </Reveal>
        )}
      </Section>
      )}

      {/* ─── Reviews ──────────────────────────────────────────────────────── */}
      {showReviews && reviews.length > 0 && (
      <Section>
        <SectionHeading
          eyebrow={content?.reviewsTitle ? undefined : 'Reviews'}
          title={content?.reviewsTitle || 'What Our Clients Say'}
          description={content?.reviewsDescription || undefined}
        />
        <Stagger className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {reviews.map((review) => (
            <StaggerItem key={review.id}>
              <Card className="h-full border-border/70 bg-card/60 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-accent/40">
                <CardContent className="space-y-3 p-6">
                  <div className="flex items-center gap-1" aria-label={`${review.rating} out of 5 stars`}>
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
      </Section>
      )}

      {/* ─── Location & Hours ─────────────────────────────────────────────── */}
      {showVisit && (
      <Section tone="muted" bleed>
        <SectionHeading
          eyebrow={content?.visitTitle ? undefined : 'Visit Us'}
          title={content?.visitTitle || `Find ${shopName}`}
          description={content?.visitDescription || undefined}
        />

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
                  <div className="flex flex-col gap-2">
                    <a href={`tel:${shopPhoneDigits}`} className="text-sm text-accent hover:underline">
                      📞 {shopPhone}
                    </a>
                    {business?.email && (
                      <a href={`mailto:${business.email}`} className="text-sm text-accent hover:underline">
                        ✉️ {business.email}
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
      )}

      {/* ─── Final CTA ────────────────────────────────────────────────────── */}
      {showFinalCta && (
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 80% at 50% 100%, hsl(var(--accent) / 0.12), transparent 65%)',
          }}
        />
        <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:py-28">
          <Reveal>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {content?.finalCtaTitle || 'Ready for Your Next Cut?'}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
              {content?.finalCtaDescription ||
                `Book online in under a minute. ${shopPhone ? `Prefer to talk? Call ${shopPhone}.` : 'See real-time availability and lock in your spot.'}`}
            </p>
          </Reveal>
          <Reveal delay={0.2} className="mt-10">
            <BookButton label="Book Your Appointment" className="w-full sm:w-auto" />
          </Reveal>
        </div>
      </section>
      )}
    </div>
  )
}
