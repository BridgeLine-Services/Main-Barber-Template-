import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Scissors, LayoutDashboard, ArrowLeft } from 'lucide-react'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { startOfDayUTC, endOfDayUTC, formatDateInTimezone } from '@/lib/timezone'
import { deriveBarberModeDay } from '@/lib/barber-mode'
import { BarberModeClient } from '@/components/barber-mode/BarberModeClient'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

// Barber Mode — a mobile-first work surface for an individual barber.
// Reuses the dashboard shell, session auth, RBAC, and the canonical
// appointment model. No second appointment system: data is read through the
// same businessId/barberId-scoped Prisma queries, and every mutation goes
// through the existing PATCH /api/dashboard/appointments/[id] route.
export default async function BarberModePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const businessId = user?.businessId
  const userRole = user?.role || 'BARBER'
  const barberId = user?.barberId

  if (!businessId) redirect('/login')

  // BARBER without a linked profile cannot use the work surface
  // (mirrors requireStaff({ restrictToOwnBarber: true })).
  if (userRole === 'BARBER' && !barberId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
            <Scissors className="h-7 w-7" />
          </div>
          <h1 className="font-semibold tracking-tight text-foreground">No barber profile linked</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Barber Mode needs a barber profile linked to your account. Ask an owner
            to link your account to your barber profile, then come back.
          </p>
        </div>
      </div>
    )
  }

  // OWNER without a linked profile keeps the full dashboard (no reduced view).
  if (userRole === 'OWNER' && !barberId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
            <LayoutDashboard className="h-7 w-7" />
          </div>
          <h1 className="font-semibold tracking-tight text-foreground">Owner account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Barber Mode shows a barber their own chair&apos;s day. Your owner account
            isn&apos;t linked to a barber profile, so the full dashboard is your work
            surface.
          </p>
          <Link href="/dashboard" className="mt-6 inline-block">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, timezone: true },
  })
  const timezone = business?.timezone || 'UTC'

  // Day boundaries in the business timezone (timezone-safe, no server-local drift).
  const dayStart = startOfDayUTC(timezone)
  const dayEnd = endOfDayUTC(timezone)

  const appointments = await prisma.appointment.findMany({
    where: {
      businessId,
      barberId,
      startTime: { gte: dayStart, lt: dayEnd },
    },
    include: {
      customer: {
        select: {
          id: true, firstName: true, lastName: true, phone: true,
          notes: true, preferences: true,
        },
      },
      service: { select: { id: true, name: true, duration: true, price: true } },
    },
    orderBy: { startTime: 'asc' },
  })

  const day = deriveBarberModeDay(appointments)

  // Serialize for the client — ISO strings + preformatted labels.
  type Row = (typeof appointments)[number]
  const serialize = (a: Row) => ({
    id: a.id,
    confirmationNumber: a.confirmationNumber,
    status: a.status,
    startTime: a.startTime.toISOString(),
    endTime: a.endTime.toISOString(),
    timeLabel: new Date(a.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }),
    endLabel: new Date(a.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }),
    customer: a.customer,
    service: a.service,
    customerNotes: a.customerNotes,
  })

  return (
    <BarberModeClient
      timezone={timezone}
      todayLabel={formatDateInTimezone(new Date(), timezone)}
      counts={{
        total: day.all.length,
        upcoming: day.upcoming.length + (day.next ? 1 : 0),
        completed: day.completed.length,
      }}
      current={day.current ? serialize(day.current as Row) : null}
      next={day.next ? serialize(day.next as Row) : null}
      upcoming={day.upcoming.map(a => serialize(a as Row))}
      completed={day.completed.map(a => serialize(a as Row))}
      cancelled={day.cancelled.map(a => serialize(a as Row))}
      noShows={day.noShows.map(a => serialize(a as Row))}
      all={day.all.map(a => serialize(a as Row))}
    />
  )
}
