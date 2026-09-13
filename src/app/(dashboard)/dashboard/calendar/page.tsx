'use client'

import { useState, useEffect } from 'react'
import { CalendarDayView } from '@/components/dashboard/CalendarDayView'
import { CalendarWeekView } from '@/components/dashboard/CalendarWeekView'
import { CalendarMonthView } from '@/components/dashboard/CalendarMonthView'
import { AppointmentDetailsDialog } from '@/components/dashboard/AppointmentDetailsDialog'
import { AddAppointmentDialog } from '@/components/dashboard/AddAppointmentDialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { formatFullDate } from '@/lib/utils'

export default function CalendarPage() {
  const [view, setView] = useState<'day' | 'week' | 'month'>('day')
  const [currentDate, setCurrentDate] = useState<Date>(new Date())

  // Support landing on a specific date via ?date=YYYY-MM-DD (used by the
  // Daily Operations dashboard's Book/View schedule actions).
  useEffect(() => {
    const dateParam = new URLSearchParams(window.location.search).get('date')
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const [y, m, d] = dateParam.split('-').map(Number)
      const parsed = new Date(y, m - 1, d, 12, 0, 0)
      if (!Number.isNaN(parsed.getTime())) setCurrentDate(parsed)
    }
  }, [])
  const [appointments, setAppointments] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  // Dialog states
  const [selectedAppointment, setSelectedAppointment] = useState<any | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addInitialDate, setAddInitialDate] = useState<string>('')

  // Fetch appointments based on view & date
  const fetchAppointments = async () => {
    setLoading(true)
    try {
      const dateStr = currentDate.toISOString().split('T')[0]
      const res = await fetch(`/api/dashboard/appointments?date=${dateStr}&view=${view}`)
      if (res.ok) {
        const data = await res.json()
        setAppointments(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAppointments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate, view])

  const handlePrev = () => {
    const newDate = new Date(currentDate)
    if (view === 'day') newDate.setDate(newDate.getDate() - 1)
    else if (view === 'week') newDate.setDate(newDate.getDate() - 7)
    else if (view === 'month') newDate.setMonth(newDate.getMonth() - 1)
    setCurrentDate(newDate)
  }

  const handleNext = () => {
    const newDate = new Date(currentDate)
    if (view === 'day') newDate.setDate(newDate.getDate() + 1)
    else if (view === 'week') newDate.setDate(newDate.getDate() + 7)
    else if (view === 'month') newDate.setMonth(newDate.getMonth() + 1)
    setCurrentDate(newDate)
  }

  const handleToday = () => {
    setCurrentDate(new Date())
  }

  const handleSelectAppointment = (appt: any) => {
    setSelectedAppointment(appt)
    setDetailsOpen(true)
  }

  const handleOpenAddForDate = (dateStr: string) => {
    setAddInitialDate(dateStr)
    setAddDialogOpen(true)
  }

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setCurrentDate(new Date(e.target.value + 'T00:00:00'))
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-serif text-zinc-100 flex items-center gap-2">
            <CalendarIcon className="w-6 h-6 text-amber-500" />
            <span>Master Calendar</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            {view === 'day' && formatFullDate(currentDate)}
            {view === 'week' && `Week of ${currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
            {view === 'month' && currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* View Switcher Tabs */}
          <Tabs value={view} onValueChange={(v) => setView(v as any)} className="w-auto">
            <TabsList className="bg-zinc-950 border border-zinc-800 text-zinc-400 p-1 h-9">
              <TabsTrigger value="day" className="data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-950 text-xs px-3 py-1">
                Day
              </TabsTrigger>
              <TabsTrigger value="week" className="data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-950 text-xs px-3 py-1">
                Week
              </TabsTrigger>
              <TabsTrigger value="month" className="data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-950 text-xs px-3 py-1">
                Month
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Navigation Controls */}
          <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded-lg p-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePrev}
              className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToday}
              className="h-7 text-xs text-zinc-300 hover:text-amber-400 px-2.5 font-medium"
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNext}
              className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Date Picker Direct Input */}
          <Input
            type="date"
            value={currentDate.toISOString().split('T')[0]}
            onChange={handleDateChange}
            className="w-36 bg-zinc-950 border-zinc-800 text-xs text-zinc-100 h-9"
          />

          <Button
            size="sm"
            onClick={() => handleOpenAddForDate(currentDate.toISOString().split('T')[0])}
            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs h-9 gap-1 shadow-lg shadow-amber-500/10"
          >
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </div>
      </div>

      {/* Main View Render */}
      {loading ? (
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-500 text-xs flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-amber-500" />
          Loading calendar appointments...
        </div>
      ) : (
        <>
          {view === 'day' && (
            <CalendarDayView
              date={currentDate}
              appointments={appointments}
              onSelectAppointment={handleSelectAppointment}
              onSelectSlot={(timeStr) => handleOpenAddForDate(currentDate.toISOString().split('T')[0])}
            />
          )}

          {view === 'week' && (
            <CalendarWeekView
              currentDate={currentDate}
              appointments={appointments}
              onSelectAppointment={handleSelectAppointment}
              onSelectDay={(dateStr) => handleOpenAddForDate(dateStr)}
            />
          )}

          {view === 'month' && (
            <CalendarMonthView
              currentDate={currentDate}
              appointments={appointments}
              onSelectDay={(d) => {
                setCurrentDate(d)
                setView('day')
              }}
              onSelectAppointment={handleSelectAppointment}
            />
          )}
        </>
      )}

      {/* Dialogs */}
      <AppointmentDetailsDialog
        appointment={selectedAppointment}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onUpdated={fetchAppointments}
      />

      <AddAppointmentDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onSuccess={fetchAppointments}
        initialDate={addInitialDate}
      />
    </div>
  )
}
