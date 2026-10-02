'use client'

import { useState } from 'react'
import { AppointmentCard } from '@/components/dashboard/AppointmentCard'
import { AddAppointmentDialog } from '@/components/dashboard/AddAppointmentDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  CalendarDays,
  Plus,
  CheckCircle2,
  Clock,
  XCircle,
  Scissors,RefreshCw } from 'lucide-react'
import { formatFullDate } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import type { CalendarAppointment } from '@/lib/dashboard-appointment'

interface TodayAppointmentsViewProps {
  initialAppointments: CalendarAppointment[]
  todayDateStr: string
  userName: string
  userRole: string
  barberId?: string
}

export function TodayAppointmentsView({
  initialAppointments,
  todayDateStr,
  userName,
    barberId,
}: TodayAppointmentsViewProps) {
  const router = useRouter()
  const [appointments, setAppointments] = useState(initialAppointments)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const refreshData = async () => {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/dashboard/appointments?date=${todayDateStr}`)
      if (res.ok) {
        const data = await res.json()
        setAppointments(data)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setRefreshing(false)
      router.refresh()
    }
  }

  // Calculate statistics
  const total = appointments.length
  const confirmed = appointments.filter((a) => a.status === 'CONFIRMED' || a.status === 'PENDING').length
  const completed = appointments.filter((a) => a.status === 'COMPLETED').length
  const cancelled = appointments.filter((a) => a.status === 'CANCELLED' || a.status === 'NO_SHOW').length

  const todayDate = new Date()

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-serif text-foreground flex items-center gap-2">
            <span>Today's Schedule</span>
            <span className="text-xs font-sans font-normal px-2.5 py-1 bg-[var(--dash-brand-soft)] text-[var(--dash-brand)] border border-[var(--dash-brand-border)] rounded-full">
              {formatFullDate(todayDate)}
            </span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Welcome back, {userName}. Here is what's scheduled for today.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshData}
            disabled={refreshing}
            className="bg-[var(--dash-surface)] border-border text-foreground/85 hover:bg-card text-xs h-9 gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => setAddDialogOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs h-9 gap-1.5 shadow-lg shadow-black/10"
          >
            <Plus className="w-4 h-4" />
            Add Appointment
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="bg-[var(--dash-surface)] border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Today</p>
              <p className="text-2xl font-bold text-foreground mt-1">{total}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center text-[var(--dash-brand)]">
              <CalendarDays className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[var(--dash-surface)] border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Confirmed / Pending</p>
              <p className="text-2xl font-bold text-green-400 mt-1">{confirmed}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-green-950/40 border border-green-900/50 flex items-center justify-center text-green-400">
              <Clock className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[var(--dash-surface)] border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Completed</p>
              <p className="text-2xl font-bold text-blue-400 mt-1">{completed}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-950/40 border border-blue-900/50 flex items-center justify-center text-blue-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[var(--dash-surface)] border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Cancelled / No-Show</p>
              <p className="text-2xl font-bold text-red-400 mt-1">{cancelled}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-red-950/40 border border-red-900/50 flex items-center justify-center text-red-400">
              <XCircle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Today's timeline view */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Timeline</h2>
          <span className="text-xs text-muted-foreground">Sorted chronologically</span>
        </div>

        {appointments.length === 0 ? (
          <div className="bg-[var(--dash-surface)] border border-border rounded-2xl p-12 text-center max-w-md mx-auto my-8 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-card border border-border text-[var(--dash-brand)] flex items-center justify-center mx-auto">
              <Scissors className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">No appointments today</h3>
              <p className="text-xs text-muted-foreground mt-1">
                There are no appointments scheduled for today. You can manually create one anytime.
              </p>
            </div>
            <Button
              onClick={() => setAddDialogOpen(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Book Appointment
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {appointments.map((appt) => (
              <AppointmentCard key={appt.id} appointment={appt} onUpdated={refreshData} />
            ))}
          </div>
        )}
      </div>

      {/* Add dialog */}
      <AddAppointmentDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onSuccess={refreshData}
        initialDate={todayDateStr}
        initialBarberId={barberId}
      />
    </div>
  )
}
