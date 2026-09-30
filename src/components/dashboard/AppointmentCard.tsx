'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/constants'
import { formatTime } from '@/lib/utils'
import { Clock, User, Scissors, Phone } from 'lucide-react'
import { AppointmentDetailsDialog } from '@/components/dashboard/AppointmentDetailsDialog'
import type { CalendarAppointment } from '@/lib/dashboard-appointment'

interface AppointmentCardProps {
  appointment: CalendarAppointment
  onUpdated?: () => void
}

export function AppointmentCard({ appointment, onUpdated }: AppointmentCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  const startDate = new Date(appointment.startTime)
  const endDate = new Date(appointment.endTime)

  // Status border mapping
  const borderColors: Record<string, string> = {
    PENDING: 'border-l-yellow-500',
    CONFIRMED: 'border-l-green-500',
    COMPLETED: 'border-l-blue-500',
    CANCELLED: 'border-l-red-500',
    NO_SHOW: 'border-l-zinc-500',
    RESCHEDULED: 'border-l-purple-500',
  }

  const borderClass = borderColors[appointment.status] || 'border-l-amber-500'

  return (
    <>
      <div
        onClick={() => setDetailsOpen(true)}
        className={`bg-zinc-950 border border-zinc-800 border-l-4 ${borderClass} rounded-xl p-4 hover:border-zinc-700 hover:shadow-lg transition-all cursor-pointer group`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 font-mono text-sm text-amber-400 font-semibold">
            <Clock className="w-4 h-4 text-amber-500" />
            <span>
              {formatTime(startDate)} – {formatTime(endDate)}
            </span>
          </div>

          <Badge
            variant="outline"
            className={`${STATUS_COLORS[appointment.status] || 'bg-zinc-800 text-zinc-300'} text-[11px] font-medium w-fit`}
          >
            {STATUS_LABELS[appointment.status] || appointment.status}
          </Badge>
        </div>

        <div className="space-y-1.5">
          <div className="font-semibold text-base text-zinc-100 group-hover:text-amber-400 transition-colors flex items-center gap-2">
            <User className="w-4 h-4 text-zinc-500" />
            {appointment.customer
              ? `${appointment.customer.firstName} ${appointment.customer.lastName}`
              : 'Unknown Customer'}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
            <span className="flex items-center gap-1.5 text-zinc-300">
              <Scissors className="w-3.5 h-3.5 text-amber-500" />
              {appointment.service?.name || 'Service'}
            </span>

            {appointment.barber?.name && (
              <span className="flex items-center gap-1 text-zinc-400">
                • Barber: <strong className="text-zinc-300">{appointment.barber.name}</strong>
              </span>
            )}

            {appointment.customer?.phone && (
              <span className="flex items-center gap-1 text-zinc-400">
                • <Phone className="w-3 h-3 text-zinc-500" />
                {appointment.customer.phone}
              </span>
            )}
          </div>
        </div>
      </div>

      <AppointmentDetailsDialog
        appointment={appointment}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onUpdated={onUpdated}
      />
    </>
  )
}
