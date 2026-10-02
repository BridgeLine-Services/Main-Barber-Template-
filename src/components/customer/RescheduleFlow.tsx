'use client'

// ============================================================================
// Shared reschedule UI — one flow, two entry points:
//   1. The public token flow (appointment page) posts to the token endpoint.
//   2. The authenticated customer portal posts to the session-scoped
//      /api/portal/appointments/[id] route.
// The caller supplies the `submit` function, so neither flow trusts client
// ids and both reuse the same accessible date/time picker.
// ============================================================================

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { CalendarClock, CheckCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  serviceId: string
  barberId: string
  currentStartTime: string
  /** Performs the reschedule; should throw an Error with the server message on failure. */
  submit: (startTime: string) => Promise<{ startTime: string }>
  /** Optional refresh callback after a successful reschedule. */
  onRescheduled?: () => void | Promise<void>
  buttonLabel?: string
}

interface Slot {
  time: string
  available: boolean
}

export default function RescheduleFlow({
  serviceId,
  barberId,
  currentStartTime,
  submit,
  onRescheduled,
  buttonLabel = 'Reschedule',
}: Props) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(format(new Date(currentStartTime), 'yyyy-MM-dd'))
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedTime, setSelectedTime] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!open || !date) return
    let cancelled = false
    setLoading(true)
    setMessage('')
    setSelectedTime('')
    fetch(`/api/availability?barberId=${encodeURIComponent(barberId)}&serviceId=${encodeURIComponent(serviceId)}&date=${date}`)
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Availability is unavailable.')
        if (!cancelled) setSlots((data.slots || []).filter((slot: Slot) => slot.available))
      })
      .catch((error: Error) => { if (!cancelled) setMessage(error.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, date, barberId, serviceId])

  const save = async () => {
    if (!selectedTime) return
    setSaving(true)
    setMessage('')
    try {
      const result = await submit(`${date}T${selectedTime}:00`)
      setSuccess(true)
      setMessage(`New appointment: ${format(new Date(result.startTime), 'EEEE, MMMM d')} at ${format(new Date(result.startTime), 'h:mm a')}`)
      await onRescheduled?.()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reschedule. Please call the shop.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full border-accent/50 text-foreground hover:bg-accent/10 sm:w-auto"
      >
        <CalendarClock data-icon="inline-start" /> {buttonLabel}
      </Button>
    )
  }

  return (
    // basis-full: inside the portal card's flex-wrap row the open panel
    // occupies its own full-width line instead of squeezing the action column.
    <div className="w-full basis-full rounded-lg border border-border bg-popover p-4 text-left sm:min-w-[26rem]">
      <div className="flex items-center gap-2">
        {success ? <CheckCircle className="text-emerald-400" /> : <CalendarClock className="text-accent" />}
        <h2 className="font-semibold">{success ? 'Appointment rescheduled' : 'Choose a new time'}</h2>
      </div>
      {!success && <>
        <label htmlFor="reschedule-date" className="mt-4 block text-sm text-foreground/80">New date</label>
        <input id="reschedule-date" type="date" min={format(new Date(), 'yyyy-MM-dd')} value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        <p className="mt-4 text-sm text-muted-foreground">Available times</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {loading ? <div className="col-span-full flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="animate-spin" /> Checking availability...</div> : slots.length ? slots.map((slot) => <button key={slot.time} type="button" onClick={() => setSelectedTime(slot.time)} className={`rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${selectedTime === slot.time ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:border-accent/60'}`}>{slot.time}</button>) : <p className="col-span-full py-3 text-sm text-muted-foreground">No times available for this date.</p>}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><Button type="button" onClick={save} disabled={!selectedTime || saving}>{saving ? 'Saving...' : 'Confirm new time'}</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button></div>
      </>}
      {message && <p role={success ? 'status' : 'alert'} className={`mt-3 text-sm ${success ? 'text-emerald-300' : 'text-red-300'}`}>{message}</p>}
    </div>
  )
}
