'use client'

import { formatTime } from '@/lib/utils'
import type { CalendarAppointment } from '@/lib/dashboard-appointment'

interface CalendarMonthViewProps {
  currentDate: Date
  appointments: CalendarAppointment[]
  onSelectDay: (date: Date) => void
  onSelectAppointment: (appt: CalendarAppointment) => void
}

export function CalendarMonthView({
  currentDate,
  appointments,
  onSelectDay,
  onSelectAppointment,
}: CalendarMonthViewProps) {
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // Month details
  const firstDayOfMonth = new Date(year, month, 1)
  const lastDayOfMonth = new Date(year, month + 1, 0)
  const startingDayOfWeek = firstDayOfMonth.getDay() // 0 = Sun
  const totalDays = lastDayOfMonth.getDate()

  // Grid cells calculation
  const gridCells = []
  
  // Previous month padding
  const prevMonthLastDay = new Date(year, month, 0).getDate()
  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
    gridCells.push({
      date: new Date(year, month - 1, prevMonthLastDay - i),
      isCurrentMonth: false,
    })
  }

  // Current month days
  for (let d = 1; d <= totalDays; d++) {
    gridCells.push({
      date: new Date(year, month, d),
      isCurrentMonth: true,
    })
  }

  // Next month padding to fill grid (35 or 42 cells)
  const remaining = (7 - (gridCells.length % 7)) % 7
  for (let i = 1; i <= remaining; i++) {
    gridCells.push({
      date: new Date(year, month + 1, i),
      isCurrentMonth: false,
    })
  }

  const getAppointmentsForDate = (cellDate: Date) => {
    return appointments.filter((appt) => {
      const st = new Date(appt.startTime)
      return (
        st.getFullYear() === cellDate.getFullYear() &&
        st.getMonth() === cellDate.getMonth() &&
        st.getDate() === cellDate.getDate()
      )
    })
  }

  const weekDayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="bg-[var(--dash-surface)] border border-border rounded-2xl p-4 sm:p-6">
      {/* Month Days Header */}
      <div className="grid grid-cols-7 gap-1 text-center mb-2 font-semibold text-xs text-muted-foreground">
        {weekDayLabels.map((lbl) => (
          <div key={lbl} className="py-1">
            {lbl}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-1">
        {gridCells.map((cell, idx) => {
          const dayAppts = getAppointmentsForDate(cell.date)
          const isToday = new Date().toDateString() === cell.date.toDateString()

          return (
            <div
              key={idx}
              onClick={() => onSelectDay(cell.date)}
              className={`min-h-[100px] border p-2 rounded-xl flex flex-col justify-between cursor-pointer transition-all hover:border-[var(--dash-brand-border)] ${
                cell.isCurrentMonth
                  ? isToday
                    ? 'bg-[var(--dash-brand-soft)] border-[var(--dash-brand-border)]'
                    : 'bg-card/60 border-border/80 hover:bg-card'
                  : 'bg-[var(--dash-surface)]/40 border-border opacity-40'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-bold ${
                    isToday ? 'text-[var(--dash-brand)] font-mono' : 'text-foreground/85'
                  }`}
                >
                  {cell.date.getDate()}
                </span>
                {dayAppts.length > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--dash-brand-soft)] text-[var(--dash-brand)]">
                    {dayAppts.length}
                  </span>
                )}
              </div>

              {/* Appointment previews */}
              <div className="space-y-1 my-1 overflow-hidden">
                {dayAppts.slice(0, 2).map((appt) => (
                  <div
                    key={appt.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectAppointment(appt)
                    }}
                    className="p-1 rounded bg-card border border-border text-[10px] truncate text-foreground/85 hover:text-[var(--dash-brand)]"
                  >
                    <span className="font-mono text-[var(--dash-brand)] mr-1">
                      {formatTime(new Date(appt.startTime))}
                    </span>
                    {appt.customer?.firstName}
                  </div>
                ))}
                {dayAppts.length > 2 && (
                  <div className="text-[9px] text-muted-foreground font-medium text-right pr-1">
                    +{dayAppts.length - 2} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
