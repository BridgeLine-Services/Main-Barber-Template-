import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Barber, BlockedTime, Schedule } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ScheduleEditor } from '@/components/dashboard/ScheduleEditor'
import { AvailabilityOverrides } from '@/components/dashboard/AvailabilityOverrides'
import { TimeOffManager } from '@/components/dashboard/TimeOffManager'
import { Clock, UserCircle } from 'lucide-react'

interface SchedulePageProps {
  searchParams?: Promise<{
    barberId?: string
  }>
}

export default async function SchedulePage(props: SchedulePageProps) {
  const searchParams = await props.searchParams;
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  const businessId = user.businessId
  const isOwner = user.role === 'OWNER'

  let allBarbers: Barber[] = []
  try {
    allBarbers = await prisma.barber.findMany({
      where: { businessId, isActive: true },
      orderBy: { name: 'asc' },
    })
  } catch (error) {
    console.error('Failed to load barbers for schedule:', error)
  }

  let targetBarberId: string | null = null

  if (isOwner) {
    targetBarberId = searchParams?.barberId || allBarbers[0]?.id || user.barberId || null
  } else {
    targetBarberId = user.barberId || allBarbers[0]?.id || null
  }

  if (!targetBarberId) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center text-zinc-400 bg-zinc-950 border border-zinc-800 rounded-2xl">
        <p className="text-base font-semibold">No active barber profiles found for this business.</p>
        <p className="text-xs text-zinc-500 mt-1">Please create a barber profile first under Barbers management.</p>
      </div>
    )
  }

  const selectedBarber = allBarbers.find((b) => b.id === targetBarberId) || null

  let schedules: Schedule[] = []
  let blockedTimes: BlockedTime[] = []

  try {
    [schedules, blockedTimes] = await Promise.all([
      prisma.schedule.findMany({
        where: { barberId: targetBarberId },
      }),
      prisma.blockedTime.findMany({
        where: {
          businessId,
          OR: [{ barberId: targetBarberId }, { barberId: null }],
          endTime: { gte: new Date() },
        },
        orderBy: { startTime: 'asc' },
      }),
    ])
  } catch (error) {
    console.error('Failed to load schedule data:', error)
  }

  const serializedSchedules = schedules.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }))

  const serializedBlockedTimes = blockedTimes.map((bt) => ({
    ...bt,
    startTime: bt.startTime.toISOString(),
    endTime: bt.endTime.toISOString(),
    createdAt: bt.createdAt.toISOString(),
    updatedAt: bt.updatedAt.toISOString(),
  }))

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header & Barber Selector if Owner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-serif text-zinc-100 flex items-center gap-2">
            <Clock className="w-6 h-6 text-amber-500" />
            <span>Barber Schedule & Time Off</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Managing availability for{' '}
            <span className="text-amber-400 font-semibold">{selectedBarber?.name || 'Barber'}</span>
          </p>
        </div>

        {isOwner && allBarbers.length > 1 && (
          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 p-2 rounded-xl">
            <UserCircle className="w-4 h-4 text-amber-500" />
            <span className="text-xs text-zinc-400 font-medium">Select Barber:</span>
            <div className="flex gap-1 overflow-x-auto">
              {allBarbers.map((b) => (
                <Link
                  key={b.id}
                  href={`/dashboard/schedule?barberId=${b.id}`}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    b.id === targetBarberId
                      ? 'bg-amber-500 text-zinc-950'
                      : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {b.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Schedule Editor */}
      <ScheduleEditor barberId={targetBarberId} initialSchedules={serializedSchedules} />

      <AvailabilityOverrides barberId={targetBarberId} />

      {/* Time Off Manager */}
      <TimeOffManager barberId={targetBarberId} initialBlockedTimes={serializedBlockedTimes} />
    </div>
  )
}
