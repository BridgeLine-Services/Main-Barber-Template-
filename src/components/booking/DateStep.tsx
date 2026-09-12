'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isBefore,
  startOfDay,
  addDays,
  isAfter,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DateStepProps {
  selectedDate: Date | null
  onSelect: (date: Date) => void
  serviceId?: string
  barberId?: string
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function DateStep({ selectedDate, onSelect, serviceId, barberId }: DateStepProps) {
  const today = startOfDay(new Date())
  const maxBookingDate = addDays(today, 30)
  const [currentMonth, setCurrentMonth] = useState<Date>(selectedDate || today)
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, boolean>>({})
  const [checking, setChecking] = useState(false)

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(monthStart)
  const calendarStart = startOfWeek(monthStart)
  const calendarEnd = endOfWeek(monthEnd)

  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  // Fetch availability indicators for the current month
  const fetchAvailability = useCallback(async () => {
    if (!serviceId) return
    setChecking(true)
    try {
      const monthStr = format(currentMonth, 'yyyy-MM')
      const params = new URLSearchParams({
        serviceId,
        month: monthStr,
      })
      if (barberId) params.set('barberId', barberId)

      const res = await fetch(`/api/availability/check?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setAvailabilityMap(data.dates || {})
      }
    } catch {
      // Silently fail — calendar still works, just no indicators
    } finally {
      setChecking(false)
    }
  }, [serviceId, barberId, currentMonth])

  useEffect(() => {
    fetchAvailability()
  }, [fetchAvailability])

  const handlePrevMonth = () => {
    const prev = subMonths(currentMonth, 1)
    if (!isBefore(endOfMonth(prev), today)) {
      setCurrentMonth(prev)
    }
  }

  const handleNextMonth = () => {
    const next = addMonths(currentMonth, 1)
    if (!isAfter(startOfMonth(next), maxBookingDate)) {
      setCurrentMonth(next)
    }
  }

  const isPrevDisabled = isBefore(endOfMonth(subMonths(currentMonth, 1)), today)
  const isNextDisabled = isAfter(startOfMonth(addMonths(currentMonth, 1)), maxBookingDate)

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <div className="mb-6 text-center md:text-left">
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Select a Date</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Dates with available slots are highlighted. Choose a day to see times.
        </p>
      </div>

      <Card className="p-5 bg-card/80 border-border shadow-xl shadow-black/10">
        {/* Month Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-semibold text-foreground">
              {format(currentMonth, 'MMMM yyyy')}
            </h3>
            {checking && (
              <span className="w-3 h-3 rounded-full border-2 border-accent/30 border-t-amber-500 animate-spin ml-1" />
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={isPrevDisabled}
              onClick={handlePrevMonth}
              className="h-8 w-8 border-border bg-background text-foreground/70 hover:text-white hover:bg-secondary disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={isNextDisabled}
              onClick={handleNextMonth}
              className="h-8 w-8 border-border bg-background text-foreground/70 hover:text-white hover:bg-secondary disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-1 text-center mb-2">
          {WEEKDAYS.map((day) => (
            <div key={day} className="text-xs font-semibold text-muted-foreground py-1 uppercase">
              {day}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((day) => {
            const isToday = isSameDay(day, today)
            const isSelected = selectedDate ? isSameDay(day, selectedDate) : false
            const isCurrentMonthDay = day.getMonth() === currentMonth.getMonth()
            const isPast = isBefore(day, today)
            const isBeyondMax = isAfter(day, maxBookingDate)
            const isDisabled = isPast || isBeyondMax || !isCurrentMonthDay
            const dateKey = format(day, 'yyyy-MM-dd')
            const hasAvailability = availabilityMap[dateKey] === true
            const isFullyBooked = availabilityMap[dateKey] === false && !isDisabled

            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={isDisabled}
                onClick={() => onSelect(day)}
                aria-label={`${format(day, 'EEEE, MMMM d')}${hasAvailability ? ', has available slots' : isFullyBooked ? ', fully booked' : ''}${isDisabled && isCurrentMonthDay ? ', unavailable' : ''}`}
                className={cn(
                  'h-11 rounded-lg text-sm font-medium transition-all flex flex-col items-center justify-center relative focus:outline-none focus:ring-2 focus:ring-amber-500/50',
                  !isCurrentMonthDay && 'opacity-20 pointer-events-none',
                  isDisabled && isCurrentMonthDay && 'text-muted-foreground/70 bg-background/40 cursor-not-allowed',
                  !isDisabled &&
                    !isSelected &&
                    hasAvailability &&
                    'text-foreground bg-background/80 hover:bg-accent/20 hover:text-accent border border-accent/30',
                  !isDisabled &&
                    !isSelected &&
                    !hasAvailability &&
                    isFullyBooked &&
                    'text-muted-foreground bg-background/40 border border-border/40 line-through opacity-50',
                  !isDisabled &&
                    !isSelected &&
                    !hasAvailability &&
                    !isFullyBooked &&
                    'text-foreground/80 bg-background/80 hover:bg-accent/20 hover:text-accent hover:border-accent/40 border border-border/80',
                  isSelected &&
                    'bg-accent text-accent-foreground font-bold border-amber-400 shadow-md shadow-amber-500/20 scale-105'
                )}
              >
                <span>{format(day, 'd')}</span>
                {/* Availability indicator dot */}
                {hasAvailability && !isSelected && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute bottom-1" />
                )}
                {/* Today indicator */}
                {isToday && !isSelected && !hasAvailability && (
                  <span className="w-1 h-1 rounded-full bg-accent absolute bottom-1" />
                )}
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div className="mt-5 pt-4 border-t border-border flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Available</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-zinc-600" />
            <span>Limited or full</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent" />
            <span>Today</span>
          </div>
        </div>

        {selectedDate && (
          <div className="mt-3 pt-3 border-t border-border text-center">
            <p className="text-xs text-muted-foreground">
              Selected date:{' '}
              <strong className="text-accent">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</strong>
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}
