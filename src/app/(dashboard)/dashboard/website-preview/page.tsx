import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Authenticated DRAFT preview of the website homepage content. Staff-only
 * (never public): renders the editable draft fields exactly as the public
 * site would if published. Draft content is never reachable by the public
 * through this route.
 */
export default async function WebsitePreviewPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  const businessId = session.user.businessId
  if (!businessId) redirect('/dashboard')

  const [content, business] = await Promise.all([
    prisma.websiteContent.findUnique({ where: { businessId } }),
    prisma.business.findUnique({ where: { id: businessId } }),
  ])

  const d = content || {} as Record<string, any>
  const name = business?.name || 'Your Shop'
  const sections = [
    { on: d.showServices ?? true, title: d.servicesTitle || 'Services', desc: d.servicesDescription || '' },
    { on: d.showTeam ?? true, title: d.teamTitle || 'Our Team', desc: d.teamDescription || '' },
    { on: d.showReviews ?? true, title: d.reviewsTitle || 'Reviews', desc: d.reviewsDescription || '' },
    { on: d.showVisit ?? true, title: d.visitTitle || 'Visit Us', desc: d.visitDescription || '' },
    { on: d.showFaq ?? true, title: d.faqTitle || 'FAQ', desc: d.faqDescription || '' },
    { on: d.showFinalCta ?? true, title: d.finalCtaTitle || 'Book Now', desc: d.finalCtaDescription || '' },
  ]

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-300">
        DRAFT PREVIEW — only visible to signed-in staff. This is exactly what your homepage will
        show once you press &quot;Publish website&quot; in Settings.
      </div>
      <div className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-sm uppercase tracking-widest text-amber-400">{d.heroEyebrow || 'Premium Barbershop'}</p>
        <h1 className="mt-2 text-4xl font-bold">{d.heroTitle || name}</h1>
        <p className="mt-3 max-w-2xl text-zinc-400">{d.heroDescription || `Experience top-tier craftsmanship at ${name}.`}</p>
        <div className="mt-8 space-y-6">
          {sections.map((s) =>
            s.on ? (
              <section key={s.title} className="rounded-lg border border-zinc-800 p-4">
                <h2 className="text-lg font-semibold">{s.title}</h2>
                {s.desc && <p className="mt-1 text-sm text-zinc-400">{s.desc}</p>}
              </section>
            ) : null
          )}
        </div>
        <p className="mt-8 text-xs text-zinc-500">
          Preview reflects draft content only; the live customer site shows the last published snapshot.
        </p>
      </div>
    </main>
  )
}
