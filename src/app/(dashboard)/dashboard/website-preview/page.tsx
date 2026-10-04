import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ThemeStyle } from '@/components/customer/ThemeStyle'
import { getVisualStyle } from '@/lib/visual-style'
import { VISUAL_STYLE_CONFIG } from '@/lib/visual-style'
import { resolveVisualConfig } from '@/lib/visual-config'

export const dynamic = 'force-dynamic'

/**
 * Authenticated DRAFT preview of the website homepage content. Staff-only
 * (never public): renders the editable draft fields exactly as the public
 * site would if published. Draft content is never reachable by the public
 * through this route.
 *
 * Fidelity: the preview reuses the customer site's exact visual system —
 * `.brand-theme` (business colors/font via ThemeStyle) + the draft preset's
 * `data-visual-style` attribute — and renders the tenant's REAL logo, hero
 * image, services and gallery photos from the database. No second preview or
 * configuration system; the same resolver the public site uses
 * (resolveVisualConfig) drives the layout summary.
 */
export default async function WebsitePreviewPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  const businessId = session.user.businessId
  if (!businessId) redirect('/dashboard')

  const [content, business, draftServices, draftPhotos] = await Promise.all([
    prisma.websiteContent.findUnique({ where: { businessId } }),
    prisma.business.findUnique({ where: { id: businessId } }),
    prisma.service.findMany({
      where: { businessId, isActive: true },
      orderBy: { order: 'asc' },
      take: 8,
      select: { id: true, name: true, price: true, duration: true },
    }).catch(() => []),
    prisma.mediaAsset.findMany({
      where: { businessId, isPublished: true, type: { in: ['BARBER_PORTFOLIO', 'GALLERY'] } },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: { id: true, url: true, altText: true },
    }).catch(() => []),
  ])

  if (!business) redirect('/dashboard')

  const d = content
  const name = business.name || 'Your Shop'
  // Draft visual identity — exactly what resolveVisualConfig will render on
  // publish (preset defaults + the owner's optional overrides).
  const draftPreset = getVisualStyle(d?.visualPreset)
  const draftOverrides =
    d?.visualConfig && typeof d.visualConfig === 'object' && !Array.isArray(d.visualConfig)
      ? (d.visualConfig as Record<string, string>)
      : {}
  const visual = resolveVisualConfig(draftPreset, draftOverrides)

  const sections = [
    { on: d?.showServices ?? true, title: d?.servicesTitle || 'Services', desc: d?.servicesDescription || '' },
    { on: d?.showTeam ?? true, title: d?.teamTitle || 'Our Team', desc: d?.teamDescription || '' },
    { on: d?.showReviews ?? true, title: d?.reviewsTitle || 'Reviews', desc: d?.reviewsDescription || '' },
    { on: d?.showVisit ?? true, title: d?.visitTitle || 'Visit Us', desc: d?.visitDescription || '' },
    { on: d?.showFaq ?? true, title: d?.faqTitle || 'FAQ', desc: d?.faqDescription || '' },
    { on: d?.showFinalCta ?? true, title: d?.finalCtaTitle || 'Book Now', desc: d?.finalCtaDescription || '' },
  ]

  return (
    <main className="min-h-screen bg-[var(--dash-surface)] text-foreground">
      <div className="border-b border-amber-500/40 bg-[var(--dash-brand-soft)] px-4 py-2 text-center text-xs text-[var(--dash-brand)]">
        DRAFT PREVIEW — only visible to signed-in staff. This is exactly what your homepage will
        show once you press &quot;Publish website&quot; in Settings.
      </div>

      {/* ── The actual site surface: business theme + draft preset ──────
          Scoped .brand-theme wrapper so the dashboard's own chrome is
          untouched; inside, the customer visual system applies exactly as
          on the public site (colors, fonts, preset shape/typography). */}
      <div
        className="brand-theme bg-background text-foreground rounded-lg border border-border"
        data-visual-style={draftPreset}
      >
        <ThemeStyle business={business} />
        <main className="overflow-hidden rounded-lg">
          {/* Shop header: real logo + name, as the customer navbar renders it */}
          <div className="flex items-center gap-3 border-b border-accent/30 bg-background/60 px-6 py-4">
            {business.logo ? (
               
              <img src={business.logo} alt={name} className="h-9 w-9 rounded-full object-cover ring-1 ring-border" />
            ) : null}
            <span className="font-display text-lg font-semibold text-foreground">{name}</span>
            <span className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
              Book Now
            </span>
          </div>

          {/* Draft hero: real copy + real uploaded hero image if set */}
          <section className="px-6 py-10">
            <p className="text-sm uppercase tracking-widest text-primary">{d?.heroEyebrow || 'Premium Barbershop'}</p>
            <h1 className="font-display mt-2 text-4xl font-bold text-foreground">{d?.heroTitle || name}</h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">{d?.heroDescription || `Experience top-tier craftsmanship at ${name}.`}</p>
            {d?.heroImageUrl ? (
               
              <img src={d.heroImageUrl} alt={`${name} hero`} className="mt-6 max-h-72 w-full rounded-lg object-cover" />
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                No hero photo yet — upload one in Appearance → Photos. Until then customers see a clean typography-only hero.
              </p>
            )}
          </section>

          {/* Real services from the database */}
          <section className="border-t border-border/60 px-6 py-8">
            <h2 className="font-display text-xl font-semibold text-foreground">Services</h2>
            {draftServices.length > 0 ? (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {draftServices.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 rounded-md border border-border/60 bg-card px-4 py-2.5 text-sm">
                    <span className="text-foreground">{s.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {s.duration} min · ${s.price}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No services yet — add them in the Services tab and they appear here.
              </p>
            )}
          </section>

          {/* Real shop photography from the database */}
          <section className="border-t border-border/60 px-6 py-8">
            <h2 className="font-display text-xl font-semibold text-foreground">Your latest work</h2>
            {draftPhotos.length > 0 ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {draftPhotos.map((p) => (
                   
                  <img
                    key={p.id}
                    src={p.url}
                    alt={p.altText || `${name} portfolio photo`}
                    className="aspect-[3/4] w-full rounded-lg object-cover"
                  />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No photos published yet — portfolio images you publish appear here and on your gallery.
              </p>
            )}
          </section>

          {/* Draft section outline: what shows/hides on publish */}
          <section className="border-t border-border/60 px-6 py-8">
            <h2 className="font-display text-xl font-semibold text-foreground">Homepage sections</h2>
            <div className="mt-4 space-y-2">
              {sections.map((s) =>
                s.on ? (
                  <div key={s.title} className="rounded-md border border-border/60 bg-card px-4 py-2.5">
                    <span className="text-sm font-medium text-foreground">{s.title}</span>
                    {s.desc && <p className="mt-0.5 text-xs text-muted-foreground">{s.desc}</p>}
                  </div>
                ) : (
                  <div key={s.title} className="rounded-md border border-dashed border-border/60 px-4 py-2.5">
                    <span className="text-sm text-muted-foreground line-through">{s.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">hidden on your site</span>
                  </div>
                )
              )}
            </div>
          </section>

          {/* Resolved draft design: preset + layout overrides, from the same
              resolver the public site uses */}
          <section className="border-t border-border/60 px-6 py-8">
            <h2 className="font-display text-xl font-semibold text-foreground">Design applied</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {VISUAL_STYLE_CONFIG[draftPreset].label}
              {Object.keys(draftOverrides).length > 0
                ? ` with ${Object.keys(draftOverrides).length} override${Object.keys(draftOverrides).length === 1 ? '' : 's'}`
                : ' (pure preset defaults)'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {[
                `Hero: ${visual.heroLayout}`,
                `Services: ${visual.serviceLayout}`,
                `Team: ${visual.barberLayout}`,
                `Gallery: ${visual.galleryLayout}`,
                `Reviews: ${visual.reviewPresentation}`,
                `Motion: ${visual.motionLevel}`,
                `Mobile nav: ${visual.mobileNavMode}`,
              ].map((chip) => (
                <span key={chip} className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-muted-foreground">
                  {chip}
                </span>
              ))}
            </div>
          </section>
        </main>
      </div>

      <p className="px-6 py-6 text-xs text-muted-foreground">
        Preview reflects draft content only; the live customer site shows the last published snapshot.
      </p>
    </main>
  )
}
