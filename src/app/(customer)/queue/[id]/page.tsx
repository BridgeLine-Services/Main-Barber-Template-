import type { Metadata } from 'next'
import Link from 'next/link'
import { Calendar, Clock, Users } from 'lucide-react'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { startOfDayUTC } from '@/lib/timezone'
import {
  computeQueuePositions,
  entriesAheadOf,
  estimateWaitMinutes,
  isWalkInEntry,
} from '@/lib/queue'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Your Queue Spot' }
}

export default async function QueueStatusPage({ params }: { params: { id: string } }) {
  const business = await resolveBusiness().catch(() => null)
  if (!business) notFound()

  const entry = await prisma.waitlistEntry.findFirst({
    where: { id: params.id, businessId: business.id },
    include: {
      service: { select: { name: true, duration: true } },
      barber: { select: { name: true } },
    },
  })
  // Tenant check + only walk-in entries are addressable through this page
  if (!entry || !isWalkInEntry(entry)) notFound()

  const today = startOfDayUTC(business.timezone)
  const isToday = entry.preferredDate.getTime() === today.getTime()

  // Queue expired for another day — don't show stale positions
  if (!isToday && entry.status === 'WAITING') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="text-3xl font-bold">Queue entry ended</h1>
        <p className="mt-3 text-muted-foreground">
          This queue entry was for a different day. Join today&apos;s queue any time.
        </p>
        <Button asChild className="mt-6">
          <Link href="/queue">Join today&apos;s queue</Link>
        </Button>
      </div>
    )
  }

  // Current position + estimate (only meaningful while WAITING today)
  let position: number | null = null
  let estimatedWaitMinutes: number | null = null
  if (entry.status === 'WAITING' && isToday) {
    const waitingEntries = await prisma.waitlistEntry.findMany({
      where: {
        businessId: business.id,
        status: 'WAITING',
        preferredDate: today,
        preferredTimeRange: 'walk-in',
      },
      include: { service: { select: { duration: true } } },
      orderBy: { createdAt: 'asc' },
    })
    position = computeQueuePositions(waitingEntries).get(entry.id) ?? null
    const activeBarbers = await prisma.barber.count({
      where: { businessId: business.id, isActive: true },
    })
    estimatedWaitMinutes = estimateWaitMinutes(entriesAheadOf(entry, waitingEntries), activeBarbers)
  }

  const statusCopy: Record<string, { title: string; body: string }> = {
    WAITING: {
      title: position ? `You're #${position} in line` : 'You are in the queue',
      body:
        typeof estimatedWaitMinutes === 'number'
          ? `Estimated wait: about ${estimatedWaitMinutes} minutes. We'll call or text you when it's your turn.`
          : "We'll call or text you when it's your turn.",
    },
    NOTIFIED: {
      title: "It's almost your turn",
      body: 'We just called you — please head to the shop. Ask for the front desk when you arrive.',
    },
    BOOKED: {
      title: 'You were served — thank you!',
      body: 'Hope the cut was great. Book ahead next time to skip the queue.',
    },
    EXPIRED: {
      title: 'Your turn passed',
      body: 'We could not reach you when it was your turn. Join the queue again any time.',
    },
    CANCELLED: {
      title: 'You left the queue',
      body: 'No hard feelings — join again any time, or book ahead.',
    },
  }
  const copy = statusCopy[entry.status] ?? statusCopy.WAITING

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Users className="size-7" aria-hidden="true" />
        </div>
        <p className="mt-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {business.name}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-foreground">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.body}</p>

        <div className="mt-6 space-y-2 rounded-xl border border-border/60 bg-background/60 p-4 text-left text-sm">
          <p className="flex items-center justify-between">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">
              {entry.firstName} {entry.lastName.charAt(0)}.
            </span>
          </p>
          <p className="flex items-center justify-between">
            <span className="text-muted-foreground">Service</span>
            <span className="font-medium">{entry.service.name}</span>
          </p>
          {entry.barber && (
            <p className="flex items-center justify-between">
              <span className="text-muted-foreground">Barber</span>
              <span className="font-medium">{entry.barber.name}</span>
            </p>
          )}
          <p className="flex items-center justify-between">
            <span className="text-muted-foreground">Joined</span>
            <span className="font-medium">
              {new Date(entry.createdAt).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          {(entry.status === 'BOOKED' || entry.status === 'CANCELLED' || entry.status === 'EXPIRED') && (
            <Button asChild className="w-full font-bold">
              <Link href="/book">
                <Calendar className="size-4" aria-hidden="true" /> Book ahead next time
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" className="w-full">
            <Link href="/queue">
              <Clock className="size-4" aria-hidden="true" /> Queue info
            </Link>
          </Button>
          <a href={`tel:${business.phone?.replace(/\D/g, '')}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            Questions? Call the shop
          </a>
        </div>
      </div>
    </div>
  )
}
