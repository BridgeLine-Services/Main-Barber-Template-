'use client'

import { formatTime } from '@/lib/utils'
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/constants'
import { Clock, User, Scissors, Plus } from 'lucide-react'
import type { CalendarAppointment } from '@/lib/dashboard-appointment'

interface CalendarDayViewProps {
  date: Date
  appointments: CalendarAppointment[]
  onSelectAppointment: (appt: CalendarAppointment) => void
  onSelectSlot: (timeStr: string) => void
}

export function CalendarDayView({
  date,
  appointments,
  onSelectAppointment,
  onSelectSlot,
}: CalendarDayViewProps) {
  // Hours timeline from 8 AM to 8 PM (20:00)
  const hours = Array.from({ length: 13 }, (_, i) => i + 8)

  const getAppointmentsForHour = (hour: number) => {
    return appointments.filter((appt) => {
      const apptHour = new Date(appt.startTime).getHours()
      return apptHour === hour
    })
  }

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4">
      <div className="text-sm font-semibold text-zinc-300 border-b border-zinc-800 pb-3">
        Timeline — {date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
      </div>

      <div className="space-y-3 relative">
        {hours.map((hour) => {
          const appts = getAppointmentsForHour(hour)
          const hourLabel = formatTime(new Date(2026, 0, 1, hour, 0))
          const hourTimeStr = `${hour < 10 ? '0' : ''}${hour}:00`

          return (
            <div key={hour} className="flex gap-4 items-start min-h-[64px] border-b border-zinc-900 pb-2">
              <div className="w-16 shrink-0 text-xs font-mono text-zinc-500 pt-1">
                {hourLabel}
              </div>

              <div className="flex-1 space-y-2">
                {appts.length > 0 ? (
                  appts.map((appt) => {
                    const start = new Date(appt.startTime)
                    const end = new Date(appt.endTime)

                    return (
                      <div
                        key={appt.id}
                        onClick={() => onSelectAppointment(appt)}
                        className={`p-3 rounded-xl border bg-zinc-900 hover:bg-zinc-850 cursor-pointer transition-all ${
                          STATUS_COLORS[appt.status] || 'border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-semibold mb-1">
                          <span className="flex items-center gap-1 font-mono text-amber-400">
                            <Clock className="w-3.5 h-3.5" />
                            {formatTime(start)} - {formatTime(end)}
                          </span>
                          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-black/40">
                            {STATUS_LABELS[appt.status] || appt.status}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs text-zinc-200">
                          <span className="font-medium text-sm flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-zinc-400" />
                            {appt.customer
                              ? `${appt.customer.firstName} ${appt.customer.lastName}`
                              : 'Customer'}
                          </span>

                          <span className="text-xs text-zinc-400 flex items-center gap-1">
                            <Scissors className="w-3 h-3 text-amber-500" />
                            {appt.service?.name} {appt.barber?.name ? `(${appt.barber.name})` : ''}
                          </span>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <button
                    onClick={() => onSelectSlot(hourTimeStr)}
                    className="w-full py-2 px-3 rounded-lg border border-dashed border-zinc-800/80 hover:border-amber-500/40 text-zinc-600 hover:text-amber-400 text-xs flex items-center justify-between transition-colors group"
                  >
                    <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-600 group-hover:text-amber-400">
                      AVAILABLE SLOT
                    </span>
                    <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
