'use client'

import { formatTime } from '@/lib/utils'
import { STATUS_COLORS } from '@/lib/constants'
import { Plus } from 'lucide-react'
import type { CalendarAppointment } from '@/lib/dashboard-appointment'

interface CalendarWeekViewProps {
  currentDate: Date
  appointments: CalendarAppointment[]
  onSelectAppointment: (appt: CalendarAppointment) => void
  onSelectDay: (dateStr: string) => void
}

export function CalendarWeekView({
  currentDate,
  appointments,
  onSelectAppointment,
  onSelectDay,
}: CalendarWeekViewProps) {
  // Get week days starting from Sunday or Monday
  const getWeekDays = (baseDate: Date) => {
    const start = new Date(baseDate)
    const day = start.getDay()
    const diff = start.getDate() - day // adjust when day is Sunday
    start.setDate(diff)

    const days = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      days.push(d)
    }
    return days
  }

  const weekDays = getWeekDays(currentDate)

  const getAppointmentsForDay = (dayDate: Date) => {
    return appointments.filter((appt) => {
      const st = new Date(appt.startTime)
      return (
        st.getFullYear() === dayDate.getFullYear() &&
        st.getMonth() === dayDate.getMonth() &&
        st.getDate() === dayDate.getDate()
      )
    })
  }

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 sm:p-6 overflow-x-auto">
      <div className="grid grid-cols-7 min-w-[700px] gap-2">
        {weekDays.map((dayDate) => {
          const dayAppts = getAppointmentsForDay(dayDate)
          const dateStr = dayDate.toISOString().split('T')[0]
          const isToday = new Date().toDateString() === dayDate.toDateString()

          return (
            <div
              key={dateStr}
              className={`flex flex-col rounded-xl border p-2.5 min-h-[360px] bg-zinc-900/40 ${
                isToday ? 'border-amber-500/50 bg-amber-500/5' : 'border-zinc-800/80'
              }`}
            >
              {/* Day Header */}
              <div className="text-center pb-2.5 mb-2 border-b border-zinc-800/60">
                <p className="text-[11px] uppercase font-semibold text-zinc-400">
                  {dayDate.toLocaleDateString('en-US', { weekday: 'short' })}
                </p>
                <p
                  className={`text-base font-bold mt-0.5 ${
                    isToday ? 'text-amber-400' : 'text-zinc-200'
                  }`}
                >
                  {dayDate.getDate()}
                </p>
              </div>

              {/* Day Appointments List */}
              <div className="flex-1 space-y-1.5 overflow-y-auto">
                {dayAppts.map((appt) => {
                  const start = new Date(appt.startTime)
                  return (
                    <div
                      key={appt.id}
                      onClick={() => onSelectAppointment(appt)}
                      className={`p-2 rounded-lg border text-left cursor-pointer transition-all hover:scale-[1.02] ${
                        STATUS_COLORS[appt.status] || 'bg-zinc-900 border-zinc-800 text-zinc-200'
                      }`}
                    >
                      <div className="text-[10px] font-mono font-bold text-amber-400">
                        {formatTime(start)}
                      </div>
                      <div className="text-xs font-bold text-zinc-100 truncate">
                        {appt.customer
                          ? `${appt.customer.firstName} ${appt.customer.lastName[0]}.`
                          : 'Client'}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">
                        {appt.service?.name}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Add button at bottom of day */}
              <button
                onClick={() => onSelectDay(dateStr)}
                className="mt-2 w-full py-1.5 border border-dashed border-zinc-800 hover:border-amber-500/40 text-zinc-500 hover:text-amber-400 rounded text-[11px] flex items-center justify-center gap-1 transition-colors"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
