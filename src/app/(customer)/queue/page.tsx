import type { Metadata } from 'next'
import { Clock, Users, Zap } from 'lucide-react'
import { generatePageMetadata } from '@/lib/generate-page-metadata'
import { resolveBusiness } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'
import QueueJoinForm from '@/components/customer/QueueJoinForm'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: 'Walk-In Queue',
    description: 'Skip the uncertainty — join the walk-in queue from your phone and we’ll text you when it’s your turn.',
    path: '/queue',
  })
}

export default async function QueuePage() {
  const business = await resolveBusiness().catch(() => null)

  if (!business || business.walkInsWelcome !== true) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="text-3xl font-bold">Walk-in queue unavailable</h1>
        <p className="mt-3 text-muted-foreground">
          This shop isn&apos;t accepting online walk-in queue joins right now.
        </p>
      </div>
    )
  }

  const [services, barbers] = await Promise.all([
    prisma.service.findMany({
      where: { businessId: business.id, isActive: true },
      select: { id: true, name: true, duration: true },
      orderBy: { order: 'asc' },
    }),
    prisma.barber.findMany({
      where: { businessId: business.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  if (services.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="text-3xl font-bold">Walk-in queue unavailable</h1>
        <p className="mt-3 text-muted-foreground">This shop hasn&apos;t set up services yet.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <header className="mx-auto max-w-2xl text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          Walk-In Queue
        </h1>
        <p className="mt-4 text-pretty leading-6 text-muted-foreground">
          In the neighborhood? Join the queue from your phone — no calling, no standing around.
          We&apos;ll tell you your spot and text you when it&apos;s your turn.
        </p>
      </header>

      <div className="mt-10 grid gap-3 text-center sm:grid-cols-3">
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Zap className="size-4 text-accent" aria-hidden="true" /> Takes 30 seconds
        </p>
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4 text-accent" aria-hidden="true" /> See your spot & estimated wait
        </p>
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4 text-accent" aria-hidden="true" /> Pay in person as always
        </p>
      </div>

      <div className="mt-8">
        <QueueJoinForm services={services} barbers={barbers} />
      </div>
    </div>
  )
}
