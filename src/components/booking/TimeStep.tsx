'use client'

import React, { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { Clock, AlertCircle, Loader2, RefreshCw, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Slot {
  time: string
  available: boolean
  barberId?: string
  barberName?: string
}

interface EarliestInfo {
  barberId: string
  barberName: string
  time: string
}

interface TimeStepProps {
  barberId: string
  serviceId: string
  selectedDate: Date | null
  selectedTime: string | null
  onSelect: (time: string, specificBarberId?: string) => void
}

export function TimeStep({
  barberId,
  serviceId,
  selectedDate,
  selectedTime,
  onSelect,
}: TimeStepProps) {
  const [slots, setSlots] = useState<Slot[]>([])
  const [earliest, setEarliest] = useState<EarliestInfo | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const formattedDateParam = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : ''

  // Treat 'first-available' the same as 'any' for fetching
  const isAnyMode = barberId === 'any' || barberId === 'first-available'

  const fetchAvailability = async () => {
    if (!selectedDate || !serviceId) return

    setLoading(true)
    setError(null)

    try {
      let url = ''
      if (isAnyMode) {
        url = `/api/availability?serviceId=${encodeURIComponent(
          serviceId
        )}&date=${formattedDateParam}&any=true`
      } else {
        url = `/api/availability?barberId=${encodeURIComponent(
          barberId
        )}&serviceId=${encodeURIComponent(
          serviceId
        )}&date=${formattedDateParam}`
      }

      const res = await fetch(url)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load availability')
      }

      setSlots(data.slots || [])
      setEarliest(data.earliest || null)
    } catch (err: any) {
      console.error('TimeStep fetch error:', err)
      setError(err.message || 'Error loading available times. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAvailability()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barberId, serviceId, formattedDateParam])

  if (!selectedDate) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Clock className="w-10 h-10 mx-auto text-muted-foreground/70 mb-2" />
        <p>Please select a date first.</p>
      </div>
    )
  }

  // Split slots into earliest (prominent) and remaining ("Other times")
  const isFirstAvailable = barberId === 'first-available'
  const availableSlots = slots.filter((s) => s.available)

  let prominentSlot: Slot | null = null
  let otherSlots: Slot[] = []

  if (isFirstAvailable && availableSlots.length > 0) {
    // Use the earliest from the API if available, otherwise the first available slot
    if (earliest) {
      prominentSlot = {
        time: earliest.time,
        available: true,
        barberId: earliest.barberId,
        barberName: earliest.barberName,
      }
      otherSlots = availableSlots.filter((s) => s.time !== earliest.time)
    } else {
      prominentSlot = availableSlots[0]
      otherSlots = availableSlots.slice(1)
    }
  }

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Select a Time</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Available appointments for{' '}
          <strong className="text-accent">
            {format(selectedDate, 'EEEE, MMMM d, yyyy')}
          </strong>
        </p>
      </div>

      {loading && (
        <Card className="p-12 bg-card/70 border-border flex flex-col items-center justify-center text-muted-foreground space-y-3">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
          <p className="text-sm">Checking real-time schedule availability...</p>
        </Card>
      )}

      {error && !loading && (
        <Card className="p-8 bg-red-950/20 border-red-900/50 text-center space-y-3">
          <AlertCircle className="w-10 h-10 mx-auto text-red-400" />
          <p className="text-sm text-red-200">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fetchAvailability}
            className="border-red-800 bg-red-950/40 text-red-200 hover:bg-red-900/50"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        </Card>
      )}

      {!loading && !error && slots.length === 0 && (
        <Card className="p-10 bg-card/70 border-border text-center space-y-3">
          <Clock className="w-10 h-10 mx-auto text-muted-foreground/70" />
          <h3 className="text-base font-semibold text-foreground/80">No Times Available</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            There are no available time slots on this date for the selected barber. Please choose a
            different date or try selecting &quot;Any Available Barber&quot;.
          </p>
        </Card>
      )}

      {/* First Available mode: earliest slot prominently at top, other times below */}
      {!loading && !error && isFirstAvailable && slots.length > 0 && prominentSlot && (
        <div className="space-y-6">
          {/* Prominent earliest slot */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold text-accent uppercase tracking-wider">
                Earliest Available
              </h3>
            </div>
            <Card
              className={cn(
                'p-6 bg-card border-accent/50 cursor-pointer transition-all duration-200 hover:border-accent hover:bg-accent/20',
                selectedTime === prominentSlot.time &&
                  'border-amber-500 bg-accent/20 ring-1 ring-amber-500/50 shadow-lg shadow-amber-500/20'
              )}
              onClick={() =>
                onSelect(prominentSlot!.time, prominentSlot!.barberId)
              }
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-accent/20 border border-amber-500/40 flex items-center justify-center text-accent shrink-0">
                    <Clock className="w-7 h-7" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-foreground">
                      {prominentSlot.time}
                    </div>
                    {prominentSlot.barberName && (
                      <div className="text-sm text-accent/90 font-medium mt-0.5">
                        with {prominentSlot.barberName}
                      </div>
                    )}
                  </div>
                </div>
                {selectedTime === prominentSlot.time && (
                  <div className="w-8 h-8 rounded-full bg-accent text-accent-foreground flex items-center justify-center shrink-0">
                    <span className="text-lg font-bold">✓</span>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Other times */}
          {otherSlots.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Other times
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {otherSlots.map((slot) => {
                  const isSelected = selectedTime === slot.time
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      onClick={() => onSelect(slot.time, slot.barberId)}
                      aria-label={`Book at ${slot.time}${slot.barberName ? ` with ${slot.barberName}` : ''}`}
                      className={cn(
                        'py-3 px-4 rounded-lg text-sm font-semibold transition-all flex flex-col items-center justify-center border focus:outline-none focus:ring-2 focus:ring-amber-500/50',
                        !isSelected &&
                          'bg-card border-border text-foreground/80 hover:border-accent/60 hover:text-accent hover:bg-secondary/80',
                        isSelected &&
                          'bg-amber-500 border-amber-400 text-zinc-950 font-bold shadow-lg shadow-amber-500/20 scale-105'
                      )}
                    >
                      <span>{slot.time}</span>
                      {slot.barberName && (
                        <span className={cn('text-[10px] mt-0.5 truncate max-w-full font-normal', isSelected ? 'text-zinc-900' : 'text-accent/80')}>
                          {slot.barberName}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Standard (non-First-Available) mode */}
      {!loading && !error && slots.length > 0 && !isFirstAvailable && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {slots.map((slot) => {
              const isSelected = selectedTime === slot.time

              return (
                <button
                  key={slot.time}
                  type="button"
                  disabled={!slot.available}
                  onClick={() => onSelect(slot.time, slot.barberId)}
                  className={cn(
                    'py-3 px-4 rounded-lg text-sm font-semibold transition-all flex flex-col items-center justify-center border focus:outline-none focus:ring-2 focus:ring-amber-500/50',
                    !slot.available &&
                      'bg-background/50 border-border text-muted-foreground/70 cursor-not-allowed line-through',
                    slot.available &&
                      !isSelected &&
                      'bg-card border-border text-foreground/80 hover:border-accent/60 hover:text-accent hover:bg-secondary/80',
                    isSelected &&
                      'bg-amber-500 border-amber-400 text-zinc-950 font-bold shadow-lg shadow-amber-500/20 scale-105'
                  )}
                >
                  <span>{slot.time}</span>
                  {slot.barberName && barberId === 'any' && (
                    <span className={cn('text-[10px] mt-0.5 truncate max-w-full font-normal', isSelected ? 'text-zinc-900' : 'text-accent/80')}>
                      {slot.barberName}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
