export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { buildSeoHealthReport, groupSeoIssues } from '@/lib/seo-health'

/**
 * Search readiness for this shop.
 *
 * Read-only. Every finding comes from what the business already has, and the
 * report never promises a ranking: a healthy report says plainly that nothing is
 * being lost for a fixable reason.
 *
 * Nothing here writes to the database, and nothing here is required for the
 * website to work.
 */
export default async function SeoHealthPage() {
  const auth = await requireOwner()
  if (!auth.success) redirect('/login')

  const user = await prisma.user.findUnique({
    where: auth.user.id ? { id: auth.user.id } : { email: auth.user.email },
    select: { businessId: true },
  })
  if (!user?.businessId) redirect('/dashboard/onboarding')

  const businessId = user.businessId

  // One pass of reads, all scoped to this tenant.
  const [business, seo, services, barbers, galleryCount] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, phone: true, address: true, city: true, hours: true },
    }),
    prisma.businessSEO.findUnique({ where: { businessId } }),
    prisma.service.findMany({
      where: { businessId },
      select: { name: true, description: true },
      take: 50,
    }),
    prisma.barber.findMany({
      where: { businessId },
      select: { name: true, bio: true },
      take: 50,
    }),
    // Any published photo counts: gallery, portfolio and before/after all feed the site.
    prisma.mediaAsset.count({ where: { businessId, isPublished: true } }).catch(() => 0),
  ])

  const hours = business?.hours && typeof business.hours === 'object'
    ? (business.hours as Record<string, { open?: string; close?: string; isOff?: boolean }>)
    : null

  const report = buildSeoHealthReport({
    pageTitle: seo?.siteTitle ?? null,
    description: seo?.siteDescription ?? null,
    businessName: business?.name ?? null,
    phone: business?.phone ?? null,
    address: business?.address ?? null,
    city: business?.city ?? null,
    hours,
    services,
    barbers,
    hasPhotos: galleryCount > 0,
    canonicalBase: seo?.canonicalUrl ?? null,
  })

  const grouped = groupSeoIssues(report)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Website</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Search readiness</h1>
        <p className="mt-2 text-muted-foreground">
          What search engines can read about this shop, and what is missing. Nothing here is required for your
          website to work; a complete listing simply gives search engines less to guess at.
        </p>
      </div>

      <section aria-labelledby="verdict" className="rounded-xl border border-border bg-[var(--dash-surface)]/60 p-5">
        <h2 id="verdict" className="text-lg font-semibold text-foreground">
          {report.isHealthy ? 'Nothing missing' : `${report.issues.length} thing${report.issues.length === 1 ? '' : 's'} to look at`}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{report.summary}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          {report.checksPassed} of {report.checksRun} checks passed. This is not a score and it does not predict
          where you appear in search results.
        </p>
      </section>

      {grouped.worthFixing.length > 0 && (
        <section aria-labelledby="worth-fixing" className="rounded-xl border border-border bg-[var(--dash-surface)]/60 p-5">
          <h2 id="worth-fixing" className="text-lg font-semibold text-foreground">Worth fixing</h2>
          <ul className="mt-4 space-y-4">
            {grouped.worthFixing.map((issue) => (
              <li key={issue.id}>
                <p className="font-medium text-foreground">{issue.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{issue.why}</p>
                <p className="mt-1 text-sm text-foreground">{issue.fix}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {grouped.niceToHave.length > 0 && (
        <section aria-labelledby="later" className="rounded-xl border border-border bg-[var(--dash-surface)]/60 p-5">
          <h2 id="later" className="text-lg font-semibold text-foreground">You could improve later</h2>
          <ul className="mt-4 space-y-4">
            {grouped.niceToHave.map((issue) => (
              <li key={issue.id}>
                <p className="font-medium text-foreground">{issue.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{issue.why}</p>
                <p className="mt-1 text-sm text-foreground">{issue.fix}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.isHealthy && (
        <section className="rounded-xl border border-border bg-[var(--dash-surface)]/60 p-5">
          <h2 className="text-lg font-semibold text-foreground">What this means</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your page title, description, contact details, hours, services and photos are all filled in. Search
            engines have what they need to describe the shop. Ranking also depends on things outside this page,
            such as other sites linking to you and how your customers search.
          </p>
        </section>
      )}
    </div>
  )
}
