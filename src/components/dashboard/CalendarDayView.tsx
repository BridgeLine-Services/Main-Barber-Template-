'use client'

import { formatTime } from '@/lib/utils'
import { hourInZone, timeInZone } from '@/lib/calendar-tz'
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/constants'
import { Clock, User, Scissors, Plus } from 'lucide-react'
import type { CalendarAppointment } from '@/lib/dashboard-appointment'

interface CalendarDayViewProps {
  date: Date
  /** Business timezone — appointments bucket/format in the shop's zone. */
  timezone?: string
  appointments: CalendarAppointment[]
  onSelectAppointment: (appt: CalendarAppointment) => void
  onSelectSlot: (timeStr: string) => void
}

export function CalendarDayView({
  date,
  timezone,
  appointments,
  onSelectAppointment,
  onSelectSlot,
}: CalendarDayViewProps) {
  // Hours timeline from 8 AM to 8 PM (20:00)
  const hours = Array.from({ length: 13 }, (_, i) => i + 8)

  // Bucket by the BUSINESS wall-clock hour, not the viewer's — an owner
  // travelling abroad still sees each appointment at the hour the shop
  // scheduled it. (timezone is undefined only for a beat before the first
  // API response arrives; fall back to the browser zone then.)
  const getAppointmentsForHour = (hour: number) => {
    return appointments.filter((appt) => {
      const apptHour = timezone ? hourInZone(appt.startTime, timezone) : new Date(appt.startTime).getHours()
      return apptHour === hour
    })
  }

  return (
    <div className="bg-[var(--dash-surface)] border border-border rounded-2xl p-4 sm:p-6">
      <div className="text-sm font-semibold text-foreground/85 border-b border-border pb-3">
        Timeline — {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
      </div>

      {/* Timeline: every hour is a row of the SAME two-column grid template
          (fixed time-label column + flexible appointment column). Labels,
          separators and slots therefore align exactly, whatever the height
          of the appointment cards in a row. Separators are the row borders,
          so they span the full content width of every row. */}
      <div className="border-b border-border">
        {hours.map((hour, idx) => {
          const appts = getAppointmentsForHour(hour)
          const hourLabel = formatTime(new Date(2026, 0, 1, hour, 0))
          const hourTimeStr = `${hour < 10 ? '0' : ''}${hour}:00`

          return (
            <div
              key={hour}
              className={`grid grid-cols-[3.5rem_1fr] sm:grid-cols-[4.5rem_1fr] gap-x-3 sm:gap-x-4 min-h-[64px] border-border ${idx > 0 ? 'border-t' : ''}`}
            >
              {/* Time label — identical column position for every row */}
              <div className="pt-2.5 text-xs font-mono text-muted-foreground text-right sm:text-left">
                {hourLabel}
              </div>

              {/* Appointment column */}
              <div className="pt-2 pb-3 space-y-2 min-w-0">
                {appts.length > 0 ? (
                  appts.map((appt) => {
                    const start = new Date(appt.startTime)
                    const end = new Date(appt.endTime)
                    const startLabel = timezone ? timeInZone(appt.startTime, timezone) : formatTime(start)
                    const endLabel = timezone ? timeInZone(appt.endTime, timezone) : formatTime(end)

                    return (
                      <div
                        key={appt.id}
                        onClick={() => onSelectAppointment(appt)}
                        className={`p-3 rounded-xl border bg-card hover:bg-accent cursor-pointer transition-colors min-w-0 ${
                          STATUS_COLORS[appt.status] || 'border-border'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-semibold mb-1">
                          <span className="flex items-center gap-1 font-mono text-[var(--dash-brand)]">
                            <Clock className="w-3.5 h-3.5" />
                            {startLabel} - {endLabel}
                          </span>
                          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-muted text-foreground border border-border/60">
                            {STATUS_LABELS[appt.status] || appt.status}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-foreground min-w-0">
                          <span className="font-medium text-sm flex items-center gap-1.5 min-w-0">
                            <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">
                              {appt.customer
                                ? `${appt.customer.firstName} ${appt.customer.lastName}`
                                : 'Customer'}
                            </span>
                          </span>

                          <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                            <Scissors className="w-3 h-3 text-[var(--dash-brand)] shrink-0" />
                            <span className="truncate">
                              {appt.service?.name} {appt.barber?.name ? `(${appt.barber.name})` : ''}
                            </span>
                          </span>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <button
                    onClick={() => onSelectSlot(hourTimeStr)}
                    className="w-full py-2 px-3 rounded-lg border border-dashed border-border/80 hover:border-[var(--dash-brand-border)] text-muted-foreground hover:text-[var(--dash-brand)] text-xs flex items-center justify-between transition-colors group"
                  >
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground group-hover:text-[var(--dash-brand)]">
                      AVAILABLE SLOT
                    </span>
                    <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">
                      <Plus className="w-3.5 h-3.5" /> Add
                    </span>
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
