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
import { formatFullDate, formatTime, formatPrice } from '@/lib/utils'
import {
  Search,
  Filter,
  Download,
  Plus,
  CalendarDays,
  User,
  Scissors,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Repeat,
} from 'lucide-react'
import { useRouter } from 'next/navigation'

interface AppointmentsListViewProps {
  initialAppointments: any[]
  barbers: any[]
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
  const [refreshing, setRefreshing] = useState(false)

  // Dialogs
  const [selectedAppointment, setSelectedAppointment] = useState<any | null>(null)
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
          <h1 className="text-2xl font-bold font-serif text-zinc-100 flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-amber-500" />
            <span>All Appointments</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Search, filter, manage, and export shop bookings.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportToCSV}
            className="bg-zinc-950 border-zinc-800 text-zinc-300 hover:bg-zinc-900 text-xs h-9 gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            Export CSV
          </Button>

          <Button
            size="sm"
            onClick={() => setAddDialogOpen(true)}
            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs h-9 gap-1.5 shadow-lg shadow-amber-500/10"
          >
            <Plus className="w-4 h-4" />
            New Appointment
          </Button>
          <Button
            size="sm"
            onClick={() => setRecurringOpen(true)}
            variant="outline"
            className="bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 font-semibold text-xs h-9 gap-1.5"
          >
            <Repeat className="w-4 h-4 text-amber-400" />
            Recurring
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 space-y-3">
        <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {/* Search Input */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <Input
              placeholder="Search customer, phone, confirmation #..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-zinc-900 border-zinc-800 text-xs text-zinc-100 h-9"
            />
          </div>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-zinc-900 border-zinc-800 text-xs text-zinc-100 h-9">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
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
              <SelectTrigger className="bg-zinc-900 border-zinc-800 text-xs text-zinc-100 h-9">
                <SelectValue placeholder="Barber" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
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
            className="min-w-0 bg-zinc-900 border-zinc-800 text-xs text-zinc-100 h-9"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="End date"
            className="min-w-0 bg-zinc-900 border-zinc-800 text-xs text-zinc-100 h-9"
          />
        </div>
      </div>

      {/* Appointments Table */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/80 uppercase font-semibold text-zinc-400 border-b border-zinc-800">
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
            <tbody className="divide-y divide-zinc-800/60">
              {filteredAppointments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-zinc-500">
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
                        setSelectedAppointment(appt)
                        setDetailsOpen(true)
                      }}
                      className="hover:bg-zinc-900/70 transition-colors cursor-pointer group"
                    >
                      <td className="p-3.5 pl-4 font-mono text-amber-400 font-semibold">
                        {appt.confirmationNumber}
                      </td>
                      <td className="p-3.5">
                        <div className="font-medium text-zinc-100">
                          {st.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div className="text-[11px] text-zinc-500">{formatTime(st)}</div>
                      </td>
                      <td className="p-3.5">
                        <div className="font-semibold text-zinc-100 group-hover:text-amber-400 transition-colors">
                          {appt.customer
                            ? `${appt.customer.firstName} ${appt.customer.lastName}`
                            : 'Unknown'}
                        </div>
                        <div className="text-[11px] text-zinc-500">{appt.customer?.phone}</div>
                      </td>
                      <td className="p-3.5 font-medium text-zinc-200">
                        {appt.service?.name}
                      </td>
                      <td className="p-3.5 text-zinc-400">
                        {appt.barber?.name || 'Unassigned'}
                      </td>
                      <td className="p-3.5 font-mono text-zinc-300">
                        {formatPrice(appt.service?.price || 0)}
                      </td>
                      <td className="p-3.5 pr-4">
                        <Badge
                          variant="outline"
                          className={`${STATUS_COLORS[appt.status] || 'bg-zinc-800 text-zinc-300'} text-[10px]`}
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
