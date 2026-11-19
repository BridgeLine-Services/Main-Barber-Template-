export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { buildShareLink } from '@/lib/barber/share-link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildMyNumbers } from '@/lib/barber/my-numbers'

const DAYS = 30

async function loadNumbers(barberId: string, businessId: string) {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000)

  const safe = async <T,>(run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run()
    } catch {
      return null
    }
  }

  const grouped = await safe(() =>
    prisma.appointment.groupBy({
      by: ['status'],
      where: { businessId, barberId, startTime: { gte: since } },
      _count: { _all: true },
    }),
  )
  const by = (status: string) =>
    grouped ? (grouped.find((g) => g.status === status)?._count._all ?? 0) : null

  const upcoming = await safe(() =>
    prisma.appointment.count({
      where: { businessId, barberId, startTime: { gte: new Date() }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
    }),
  )

  const barber = await safe(() =>
    prisma.barber.findFirst({ where: { id: barberId, businessId }, select: { slug: true } }),
  )
  const share = buildShareLink({
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    barberSlug: barber?.slug ?? null,
    businessId,
    barberId,
  })

  const serviceRows = await safe(() =>
    prisma.appointment.groupBy({
      by: ['serviceId'],
      where: { businessId, barberId, startTime: { gte: since }, status: 'COMPLETED' },
      _count: { _all: true },
      orderBy: { _count: { serviceId: 'desc' } },
      take: 3,
    }),
  )
  const services = serviceRows
    ? await safe(async () => {
        const names = await prisma.service.findMany({
          where: { businessId, id: { in: serviceRows.map((r) => r.serviceId).filter(Boolean) as string[] } },
          select: { id: true, name: true },
        })
        return serviceRows
          .map((r) => ({
            name: names.find((n) => n.id === r.serviceId)?.name ?? 'A service no longer on the list',
            count: r._count._all,
          }))
          .filter((s) => s.count > 0)
      })
    : null

  return {
    ...buildMyNumbers({
      finished: by('COMPLETED'),
      upcoming,
      cancelled: by('CANCELLED'),
      noShows: by('NO_SHOW'),
      topServices: services,
    }),
    share,
  }
}

export default async function MyNumbersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user
  // A barber's own page. The barber id comes from the session, never the URL, so one
  // barber cannot read another's numbers by editing an address.
  if (user.role !== 'BARBER' || !user.barberId || !user.businessId) redirect('/dashboard')

  const view = await loadNumbers(user.barberId, user.businessId)
  const share = view.share

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">My numbers</h1>
        <p className="text-sm text-muted-foreground">{view.headline}</p>
      </header>

      <section aria-label="Your numbers" className="grid gap-3 sm:grid-cols-2">
        {view.numbers.map((n) => (
          <div key={n.id} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{n.label}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {n.value === null ? 'Not available' : n.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{n.hint}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="top-services" className="rounded-xl border border-border bg-card p-4">
        <h2 id="top-services" className="text-lg font-semibold text-foreground">What people book you for</h2>
        {view.topServices.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {view.allRead ? 'No finished appointments yet in this period.' : 'This could not be checked just now.'}
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {view.topServices.map((s) => (
              <li key={s.name} className="flex justify-between gap-4">
                <span>{s.name}</span>
                <span className="text-muted-foreground">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="share" className="rounded-xl border border-border p-4">
        <h2 id="share" className="text-base font-semibold">Your own booking link</h2>
        {share ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">{share.note}</p>
            <p className="mt-2 break-all rounded-lg bg-muted p-2 text-xs">{share.url}</p>
            <p className="mt-2 text-xs text-muted-foreground">Copy it into a message, or print it on a card. If you would rather not share a link, this page still works without one.</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Your link is not available yet. Nothing is wrong with your appointments; the shop needs its website address set first.</p>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        This page only reads your own appointments. Your pay is handled on the commissions page, not here.
      </p>
    </div>
  )
}
