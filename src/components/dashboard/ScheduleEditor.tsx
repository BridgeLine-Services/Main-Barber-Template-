'use client'

import { useState, useEffect } from 'react'
import { DAYS_OF_WEEK } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Clock, Plus, Trash2, Save, Loader2, CheckCircle2 } from 'lucide-react'

interface ScheduleItem {
  dayOfWeek: number
  startTime: string
  endTime: string
  isOff: boolean
  breaks: Array<{ start: string; end: string }>
}

interface ScheduleEditorProps {
  barberId: string
  initialSchedules: any[]
}

export function ScheduleEditor({ barberId, initialSchedules }: ScheduleEditorProps) {
  const [schedules, setSchedules] = useState<ScheduleItem[]>(() => {
    return Array.from({ length: 7 }, (_, day) => {
      const existing = initialSchedules.find((s) => s.dayOfWeek === day)
      if (existing) {
        return {
          dayOfWeek: day,
          startTime: existing.startTime || '09:00',
          endTime: existing.endTime || '18:00',
          isOff: Boolean(existing.isOff),
          breaks: Array.isArray(existing.breaks) ? existing.breaks : [],
        }
      }
      return {
        dayOfWeek: day,
        startTime: '09:00',
        endTime: '18:00',
        isOff: day === 0, // Sunday off by default
        breaks: [],
      }
    })
  })

  useEffect(() => {
    setSchedules(
      Array.from({ length: 7 }, (_, day) => {
        const existing = initialSchedules.find((s) => s.dayOfWeek === day)
        if (existing) {
          return {
            dayOfWeek: day,
            startTime: existing.startTime || '09:00',
            endTime: existing.endTime || '18:00',
            isOff: Boolean(existing.isOff),
            breaks: Array.isArray(existing.breaks) ? existing.breaks : [],
          }
        }
        return {
          dayOfWeek: day,
          startTime: '09:00',
          endTime: '18:00',
          isOff: day === 0,
          breaks: [],
        }
      })
    )
  }, [barberId, initialSchedules])

  const [saving, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleToggleOff = (dayOfWeek: number) => {
    setSchedules((prev) =>
      prev.map((item) =>
        item.dayOfWeek === dayOfWeek ? { ...item, isOff: !item.isOff } : item
      )
    )
  }

  const handleTimeChange = (dayOfWeek: number, field: 'startTime' | 'endTime', value: string) => {
    setSchedules((prev) =>
      prev.map((item) =>
        item.dayOfWeek === dayOfWeek ? { ...item, [field]: value } : item
      )
    )
  }

  const handleAddBreak = (dayOfWeek: number) => {
    setSchedules((prev) =>
      prev.map((item) => {
        if (item.dayOfWeek === dayOfWeek) {
          return {
            ...item,
            breaks: [...item.breaks, { start: '12:00', end: '13:00' }],
          }
        }
        return item
      })
    )
  }

  const handleBreakChange = (
    dayOfWeek: number,
    breakIndex: number,
    field: 'start' | 'end',
    value: string
  ) => {
    setSchedules((prev) =>
      prev.map((item) => {
        if (item.dayOfWeek === dayOfWeek) {
          const newBreaks = [...item.breaks]
          newBreaks[breakIndex] = { ...newBreaks[breakIndex], [field]: value }
          return { ...item, breaks: newBreaks }
        }
        return item
      })
    )
  }

  const handleRemoveBreak = (dayOfWeek: number, breakIndex: number) => {
    setSchedules((prev) =>
      prev.map((item) => {
        if (item.dayOfWeek === dayOfWeek) {
          return {
            ...item,
            breaks: item.breaks.filter((_, idx) => idx !== breakIndex),
          }
        }
        return item
      })
    )
  }

  const handleSave = async () => {
    setLoading(true)
    setSuccess(false)
    setError(null)

    try {
      const res = await fetch(`/api/dashboard/schedule?barberId=${barberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barberId,
          schedules,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save weekly schedule')
      }

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err.message || 'Error updating schedule')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div>
          <h2 className="text-lg font-bold font-serif text-zinc-100 flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" />
            <span>Weekly Work Schedule</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Configure working hours and break periods for each day of the week
          </p>
        </div>

        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs gap-2 shadow-lg shadow-amber-500/10"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Working Hours
        </Button>
      </div>

      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Schedule saved successfully!
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="divide-y divide-zinc-800/60">
        {schedules.map((schedule) => {
          const dayName = DAYS_OF_WEEK[schedule.dayOfWeek]

          return (
            <div key={schedule.dayOfWeek} className="py-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3 w-36">
                  <button
                    type="button"
                    onClick={() => handleToggleOff(schedule.dayOfWeek)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      !schedule.isOff ? 'bg-amber-500' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        !schedule.isOff ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <span className={`text-sm font-semibold ${schedule.isOff ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>
                    {dayName}
                  </span>
                </div>

                {!schedule.isOff ? (
                  <div className="flex flex-wrap items-center gap-3 flex-1 sm:justify-end">
                    <div className="flex items-center gap-2 text-xs text-zinc-300">
                      <span>Start:</span>
                      <Input
                        type="time"
                        value={schedule.startTime}
                        onChange={(e) => handleTimeChange(schedule.dayOfWeek, 'startTime', e.target.value)}
                        className="bg-zinc-900 border-zinc-800 text-xs text-zinc-100 w-28 h-8 font-mono focus:border-amber-500"
                      />
                    </div>

                    <div className="flex items-center gap-2 text-xs text-zinc-300">
                      <span>End:</span>
                      <Input
                        type="time"
                        value={schedule.endTime}
                        onChange={(e) => handleTimeChange(schedule.dayOfWeek, 'endTime', e.target.value)}
                        className="bg-zinc-900 border-zinc-800 text-xs text-zinc-100 w-28 h-8 font-mono focus:border-amber-500"
                      />
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddBreak(schedule.dayOfWeek)}
                      className="bg-zinc-900 border-zinc-800 text-amber-400 hover:bg-zinc-800 text-xs h-8 gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Break
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-zinc-500 italic">Day Off</span>
                )}
              </div>

              {/* Breaks list */}
              {!schedule.isOff && schedule.breaks.length > 0 && (
                <div className="pl-4 sm:pl-36 space-y-2">
                  <p className="text-[11px] font-semibold text-amber-500/90 uppercase tracking-wider">Scheduled Breaks</p>
                  <div className="space-y-2">
                    {schedule.breaks.map((brk, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-zinc-900/60 p-2 rounded-lg border border-zinc-800 max-w-sm">
                        <span className="text-xs text-zinc-400">Break {idx + 1}:</span>
                        <Input
                          type="time"
                          value={brk.start}
                          onChange={(e) => handleBreakChange(schedule.dayOfWeek, idx, 'start', e.target.value)}
                          className="bg-zinc-950 border-zinc-800 text-xs text-zinc-200 w-24 h-7 font-mono"
                        />
                        <span className="text-xs text-zinc-500">to</span>
                        <Input
                          type="time"
                          value={brk.end}
                          onChange={(e) => handleBreakChange(schedule.dayOfWeek, idx, 'end', e.target.value)}
                          className="bg-zinc-950 border-zinc-800 text-xs text-zinc-200 w-24 h-7 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveBreak(schedule.dayOfWeek, idx)}
                          className="text-zinc-500 hover:text-red-400 ml-auto p-1"
                          title="Remove Break"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
