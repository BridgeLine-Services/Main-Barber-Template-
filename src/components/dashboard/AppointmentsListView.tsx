'use client'

import { useState } from 'react'
import { AppointmentDetailsDialog } from '@/components/dashboard/AppointmentDetailsDialog'
import { AddAppointmentDialog } from '@/components/dashboard/AddAppointmentDialog'
import { RecurringDialog } from '@/components/dashboard/RecurringDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/constants'
import {formatTime, formatPrice } from '@/lib/utils'
import {
  Search,Download,
  Plus,
  CalendarDays,Repeat } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { CalendarAppointment } from '@/lib/dashboard-appointment'

/** Serialized dashboard appointment (dates ISO strings) matching what
 * /dashboard/appointments passes down after its findMany + include. */
export interface AppointmentListItem {
  id: string
  status: string
  startTime: string
  endTime?: string | null
  confirmationNumber?: string | null
  barberId?: string | null
  customer: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null } | null
  barber: { id: string; name: string; specialty?: string | null } | null
  service: { id: string; name: string; price?: number | null; duration?: number | null } | null
}

interface AppointmentsListViewProps {
  initialAppointments: AppointmentListItem[]
  barbers: Array<{ id: string; name: string }>
  userRole: string
}

export function AppointmentsListView({
  initialAppointments,
  barbers,
  userRole,
}: AppointmentsListViewProps) {
  const router = useRouter()
  const [appointments, setAppointments] = useState(initialAppointments)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [barberFilter, setBarberFilter] = useState('ALL')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [, setRefreshing] = useState(false)

  // Dialogs
  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [recurringOpen, setRecurringOpen] = useState(false)

  const isOwner = userRole === 'OWNER'

  const refreshData = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/dashboard/appointments')
      if (res.ok) {
        const data = await res.json()
        setAppointments(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setRefreshing(false)
      router.refresh()
    }
  }

  // Filter appointments client-side
  const filteredAppointments = appointments.filter((appt) => {
    // Search
    if (search.trim()) {
      const query = search.toLowerCase()
      const custName = `${appt.customer?.firstName || ''} ${appt.customer?.lastName || ''}`.toLowerCase()
      const custPhone = appt.customer?.phone || ''
      const custEmail = (appt.customer?.email || '').toLowerCase()
      const confNum = (appt.confirmationNumber || '').toLowerCase()
      const serviceName = (appt.service?.name || '').toLowerCase()

      if (
        !custName.includes(query) &&
        !custPhone.includes(query) &&
        !custEmail.includes(query) &&
        !confNum.includes(query) &&
        !serviceName.includes(query)
      ) {
        return false
      }
    }

    // Status
    if (statusFilter !== 'ALL' && appt.status !== statusFilter) {
      return false
    }

    // Barber
    if (barberFilter !== 'ALL' && appt.barberId !== barberFilter) {
      return false
    }

    // Date range
    const apptDate = new Date(appt.startTime)
    if (startDate) {
      const s = new Date(startDate + 'T00:00:00')
      if (apptDate < s) return false
    }
    if (endDate) {
      const e = new Date(endDate + 'T23:59:59')
      if (apptDate > e) return false
    }

    return true
  })

  // Export to CSV function
  const exportToCSV = () => {
    const headers = [
      'Confirmation #',
      'Date',
      'Time',
      'Customer',
      'Phone',
      'Email',
      'Service',
      'Barber',
      'Price',
      'Status',
    ]

    const rows = filteredAppointments.map((a) => {
      const d = new Date(a.startTime)
      return [
        a.confirmationNumber,
        d.toLocaleDateString(),
        formatTime(d),
        a.customer ? `"${a.customer.firstName} ${a.customer.lastName}"` : 'N/A',
        a.customer?.phone || 'N/A',
        a.customer?.email || 'N/A',
        a.service ? `"${a.service.name}"` : 'N/A',
        a.barber ? `"${a.barber.name}"` : 'N/A',
        a.service?.price || 0,
        a.status,
      ]
    })

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `appointments_export_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-serif text-foreground flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-[var(--dash-brand)]" />
            <span>All Appointments</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Search, filter, manage, and export shop bookings.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportToCSV}
            className="bg-[var(--dash-surface)] border-border text-foreground/85 hover:bg-card text-xs h-9 gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-[var(--dash-brand)]" />
            Export CSV
          </Button>

          <Button
            size="sm"
            onClick={() => setAddDialogOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs h-9 gap-1.5 shadow-lg shadow-black/10"
          >
            <Plus className="w-4 h-4" />
            New Appointment
          </Button>
          <Button
            size="sm"
            onClick={() => setRecurringOpen(true)}
            variant="outline"
            className="bg-card border-border text-foreground/85 hover:bg-[var(--dash-hover)] font-semibold text-xs h-9 gap-1.5"
          >
            <Repeat className="w-4 h-4 text-[var(--dash-brand)]" />
            Recurring
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-[var(--dash-surface)] border border-border rounded-2xl p-4 space-y-3">
        <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {/* Search Input */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search customer, phone, confirmation #..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card border-border text-xs text-foreground h-9"
            />
          </div>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-card border-border text-xs text-foreground h-9">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-foreground">
              <SelectItem value="ALL" className="text-xs">All Statuses</SelectItem>
              <SelectItem value="CONFIRMED" className="text-xs">Confirmed</SelectItem>
              <SelectItem value="PENDING" className="text-xs">Pending</SelectItem>
              <SelectItem value="COMPLETED" className="text-xs">Completed</SelectItem>
              <SelectItem value="CANCELLED" className="text-xs">Cancelled</SelectItem>
              <SelectItem value="NO_SHOW" className="text-xs">No-Show</SelectItem>
            </SelectContent>
          </Select>

          {/* Barber Filter (if owner) */}
          {isOwner && (
            <Select value={barberFilter} onValueChange={setBarberFilter}>
              <SelectTrigger className="bg-card border-border text-xs text-foreground h-9">
                <SelectValue placeholder="Barber" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground">
                <SelectItem value="ALL" className="text-xs">All Barbers</SelectItem>
                {barbers.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="text-xs">
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Date range inputs */}
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Start date"
            className="min-w-0 bg-card border-border text-xs text-foreground h-9"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="End date"
            className="min-w-0 bg-card border-border text-xs text-foreground h-9"
          />
        </div>
      </div>

      {/* Appointments Table */}
      <div className="bg-[var(--dash-surface)] border border-border rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-foreground/85">
            <thead className="bg-card/80 uppercase font-semibold text-muted-foreground border-b border-border">
              <tr>
                <th className="p-3.5 pl-4">Confirmation</th>
                <th className="p-3.5">Date & Time</th>
                <th className="p-3.5">Customer</th>
                <th className="p-3.5">Service</th>
                <th className="p-3.5">Barber</th>
                <th className="p-3.5">Price</th>
                <th className="p-3.5 pr-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredAppointments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    No appointments match your search criteria.
                  </td>
                </tr>
              ) : (
                filteredAppointments.map((appt) => {
                  const st = new Date(appt.startTime)
                  return (
                    <tr
                      key={appt.id}
                      onClick={() => {
                        // List rows are a subset of the full appointment the dialog renders.
                        setSelectedAppointment(appt as unknown as CalendarAppointment)
                        setDetailsOpen(true)
                      }}
                      className="hover:bg-card/70 transition-colors cursor-pointer group"
                    >
                      <td className="p-3.5 pl-4 font-mono text-[var(--dash-brand)] font-semibold">
                        {appt.confirmationNumber}
                      </td>
                      <td className="p-3.5">
                        <div className="font-medium text-foreground">
                          {st.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{formatTime(st)}</div>
                      </td>
                      <td className="p-3.5">
                        <div className="font-semibold text-foreground group-hover:text-[var(--dash-brand)] transition-colors">
                          {appt.customer
                            ? `${appt.customer.firstName} ${appt.customer.lastName}`
                            : 'Unknown'}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{appt.customer?.phone}</div>
                      </td>
                      <td className="p-3.5 font-medium text-foreground">
                        {appt.service?.name}
                      </td>
                      <td className="p-3.5 text-muted-foreground">
                        {appt.barber?.name || 'Unassigned'}
                      </td>
                      <td className="p-3.5 font-mono text-foreground/85">
                        {formatPrice(appt.service?.price || 0)}
                      </td>
                      <td className="p-3.5 pr-4">
                        <Badge
                          variant="outline"
                          className={`${STATUS_COLORS[appt.status] || 'bg-muted text-foreground/85'} text-[10px]`}
                        >
                          {STATUS_LABELS[appt.status] || appt.status}
                        </Badge>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dialogs */}
      <AppointmentDetailsDialog
        appointment={selectedAppointment}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onUpdated={refreshData}
      />

      <AddAppointmentDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onSuccess={refreshData}
      />

      <RecurringDialog
        open={recurringOpen}
        onOpenChange={setRecurringOpen}
        barbers={barbers}
        services={[]}
      />
    </div>
  )
}
