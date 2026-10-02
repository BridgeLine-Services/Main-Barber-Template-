'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/constants'
import { formatFullDate, formatTime, formatPrice, formatDuration } from '@/lib/utils'
import {
  User,
  Phone,
  Mail,
  Calendar,
  Clock,
  Scissors,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  CalendarClock,
  CreditCard,
  FileText,
  Hash,
} from 'lucide-react'
import type { CalendarAppointment } from '@/lib/dashboard-appointment'

interface AppointmentDetailsDialogProps {
  appointment: CalendarAppointment | null
  open: boolean
  onClose: () => void
  onUpdated?: () => void
}

export function AppointmentDetailsDialog({
  appointment,
  open,
  onClose,
  onUpdated,
}: AppointmentDetailsDialogProps) {
  const [loading, setLoading] = useState(false)
  const [isRescheduling, setIsRescheduling] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [showCancelReasonInput, setShowCancelReasonInput] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!appointment) return null

  const handleStatusChange = async (newStatus: string, reason?: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/appointments/${appointment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          cancellationReason: reason,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update appointment status')
      }

      setShowCancelReasonInput(false)
      if (onUpdated) onUpdated()
      onClose()
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const handleReschedule = async () => {
    if (!newDate || !newTime) {
      setError('Please select both a new date and time')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const newStartTime = new Date(`${newDate}T${newTime}`)

      const res = await fetch(`/api/dashboard/appointments/${appointment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'RESCHEDULED',
          startTime: newStartTime.toISOString(),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to reschedule appointment')
      }

      setIsRescheduling(false)
      if (onUpdated) onUpdated()
      onClose()
    } catch (err) {
      setError(err.message || 'Error rescheduling')
    } finally {
      setLoading(false)
    }
  }

  const startDate = new Date(appointment.startTime)
  const endDate = new Date(appointment.endTime)

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[var(--dash-surface)] border-border text-foreground max-w-lg p-6">
        <DialogHeader className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
              <Hash className="w-3.5 h-3.5 text-[var(--dash-brand)]" />
              {appointment.confirmationNumber}
            </span>
            <Badge
              variant="outline"
              className={STATUS_COLORS[appointment.status] || 'bg-muted text-foreground/85'}
            >
              {STATUS_LABELS[appointment.status] || appointment.status}
            </Badge>
          </div>
          <DialogTitle className="text-xl font-bold font-serif text-foreground">
            Appointment Details
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Created via {appointment.createdBy || 'System'} on{' '}
            {formatFullDate(new Date(appointment.createdAt))}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 bg-red-950/50 border border-red-800 text-red-300 text-xs rounded-md">
            {error}
          </div>
        )}

        <div className="space-y-4 my-2 text-sm">
          {/* Customer Info */}
          <div className="p-3.5 rounded-lg bg-card border border-border space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--dash-brand)] flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Customer Info
            </div>
            <div className="text-base font-bold text-foreground">
              {appointment.customer
                ? `${appointment.customer.firstName} ${appointment.customer.lastName}`
                : 'Customer'}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-foreground/85">
              {appointment.customer?.phone && (
                <a
                  href={`tel:${appointment.customer.phone?.replace(/\D/g, "")}`}
                  className="flex items-center gap-1 hover:text-[var(--dash-brand)] transition-colors"
                >
                  <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                  {appointment.customer.phone}
                </a>
              )}
              {appointment.customer?.email && (
                <a
                  href={`mailto:${appointment.customer.email}`}
                  className="flex items-center gap-1 hover:text-[var(--dash-brand)] transition-colors"
                >
                  <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                  {appointment.customer.email}
                </a>
              )}
            </div>
          </div>

          {/* Service & Barber */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-card border border-border space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <Scissors className="w-3 h-3 text-[var(--dash-brand)]" /> Service
              </span>
              <div className="font-semibold text-foreground">
                {appointment.service?.name || 'Service'}
              </div>
              <div className="text-xs text-muted-foreground">
                {appointment.service?.duration
                  ? formatDuration(appointment.service.duration)
                  : ''}{' '}
                •{' '}
                {appointment.service?.price !== undefined
                  ? formatPrice(appointment.service.price)
                  : ''}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-card border border-border space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <User className="w-3 h-3 text-[var(--dash-brand)]" /> Barber
              </span>
              <div className="font-semibold text-foreground">
                {appointment.barber?.name || 'Barber'}
              </div>
              <div className="text-xs text-muted-foreground">
                {appointment.barber?.specialty || 'Staff'}
              </div>
            </div>
          </div>

          {/* Date & Time */}
          <div className="p-3.5 rounded-lg bg-card border border-border space-y-2">
            <div className="flex items-center justify-between text-xs text-foreground/85">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Calendar className="w-3.5 h-3.5 text-[var(--dash-brand)]" />
                {formatFullDate(startDate)}
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-[var(--dash-brand)]">
                <Clock className="w-3.5 h-3.5" />
                {formatTime(startDate)} - {formatTime(endDate)}
              </span>
            </div>
          </div>

          {/* Customer Notes */}
          {appointment.customerNotes && (
            <div className="p-3 rounded-lg bg-card/60 border border-border space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <FileText className="w-3 h-3 text-muted-foreground" /> Customer Notes
              </span>
              <p className="text-xs text-foreground/85 italic">{appointment.customerNotes}</p>
            </div>
          )}

          {/* Appointment Notes & Intake */}
          {(appointment.customerNotes || appointment.intakeResponses?.length > 0) && (
            <div className="space-y-3 rounded-lg border border-border bg-card p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--dash-brand)]">
                <FileText className="h-3.5 w-3.5" /> Appointment Notes &amp; Intake
              </div>
              {appointment.customerNotes && (
                <div>
                  <div className="text-[11px] font-medium text-muted-foreground">Customer notes</div>
                  <p className="text-xs italic text-foreground/85">{appointment.customerNotes}</p>
                </div>
              )}
              {appointment.intakeResponses?.map((response) => (
                <div key={response.id || response.questionKey} className="border-t border-border pt-2">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    {response.questionLabel}
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-foreground">
                    {Array.isArray(response.answer) ? response.answer.join(', ') : String(response.answer ?? '—')}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Payment info notice */}
          <div className="p-2.5 rounded bg-[var(--dash-brand-soft)] border border-[var(--dash-brand-border)] flex items-center gap-2 text-xs text-[var(--dash-brand)]">
            <CreditCard className="w-4 h-4 text-[var(--dash-brand)] shrink-0" />
            <span>
              Payment due in person ({formatPrice(appointment.service?.price || 0)})
            </span>
          </div>

          {/* Cancel Reason Input area */}
          {showCancelReasonInput && (
            <div className="p-3 rounded-lg bg-red-950/30 border border-red-900/50 space-y-3">
              <Label htmlFor="cancel-reason" className="text-xs text-red-300">
                Reason for cancellation (optional):
              </Label>
              <Input
                id="cancel-reason"
                placeholder="e.g. Client called to cancel"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="bg-[var(--dash-surface)] border-border text-xs text-foreground"
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowCancelReasonInput(false)}
                  className="text-xs text-muted-foreground"
                >
                  Back
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={loading}
                  onClick={() => handleStatusChange('CANCELLED', cancelReason)}
                  className="text-xs bg-red-600 hover:bg-red-500"
                >
                  Confirm Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Reschedule inline form */}
          {isRescheduling && (
            <div className="p-3.5 rounded-lg bg-card border border-[var(--dash-brand-border)] space-y-3">
              <div className="text-xs font-semibold text-[var(--dash-brand)] flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4" /> Reschedule Appointment
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">New Date</Label>
                  <Input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="bg-[var(--dash-surface)] border-border text-xs text-foreground"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">New Time</Label>
                  <Input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="bg-[var(--dash-surface)] border-border text-xs text-foreground"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsRescheduling(false)}
                  className="text-xs text-muted-foreground"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={loading}
                  onClick={handleReschedule}
                  className="text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                >
                  Save Reschedule
                </Button>
              </div>
            </div>
          )}
        </div>

        <Separator className="bg-muted my-2" />

        {/* Action Buttons Footer */}
        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          {!showCancelReasonInput && !isRescheduling && (
            <div className="flex flex-wrap gap-2 w-full justify-between">
              <div className="flex flex-wrap gap-2">
                {appointment.status !== 'CONFIRMED' && appointment.status !== 'COMPLETED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    onClick={() => handleStatusChange('CONFIRMED')}
                    className="bg-green-950/40 border-green-800/60 text-green-400 hover:bg-green-900/50 hover:text-green-300 text-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    Confirm
                  </Button>
                )}

                {appointment.status !== 'COMPLETED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    onClick={() => handleStatusChange('COMPLETED')}
                    className="bg-blue-950/40 border-blue-800/60 text-blue-400 hover:bg-blue-900/50 hover:text-blue-300 text-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    Mark Completed
                  </Button>
                )}

                {appointment.status !== 'CANCELLED' && appointment.status !== 'COMPLETED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    onClick={() => setIsRescheduling(true)}
                    className="bg-purple-950/40 border-purple-800/60 text-purple-300 hover:bg-purple-900/50 text-xs"
                  >
                    <CalendarClock className="w-3.5 h-3.5 mr-1" />
                    Reschedule
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {appointment.status !== 'NO_SHOW' && appointment.status !== 'COMPLETED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    onClick={() => handleStatusChange('NO_SHOW')}
                    className="bg-card border-input text-muted-foreground hover:text-foreground text-xs"
                  >
                    <AlertOctagon className="w-3.5 h-3.5 mr-1" />
                    No-Show
                  </Button>
                )}

                {appointment.status !== 'CANCELLED' && appointment.status !== 'COMPLETED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading}
                    onClick={() => setShowCancelReasonInput(true)}
                    className="bg-red-950/40 border-red-800/60 text-red-400 hover:bg-red-900/50 text-xs"
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1" />
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
