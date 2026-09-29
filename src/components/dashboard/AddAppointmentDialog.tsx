'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UserPlus, Calendar, Clock, Scissors, User, Plus, Search, Check } from 'lucide-react'

interface AddAppointmentDialogProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  initialDate?: string
  initialBarberId?: string
}

export function AddAppointmentDialog({
  open,
  onClose,
  onSuccess,
  initialDate,
  initialBarberId,
}: AddAppointmentDialogProps) {
  const [isNewCustomer, setIsNewCustomer] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [customers, setCustomers] = useState<any[]>([])

  // New Customer Form State
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')

  // Appointment State
  const [barbers, setBarbers] = useState<any[]>([])
  const [services, setServices] = useState<any[]>([])
  const [selectedBarberId, setSelectedBarberId] = useState(initialBarberId || '')
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [date, setDate] = useState(initialDate || new Date().toISOString().split('T')[0])
  const [time, setTime] = useState('10:00')
  const [notes, setNotes] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch initial barbers, services, and customers when opened
   
  useEffect(() => {
    if (open) {
      fetchBarbers()
      fetchServices()
      fetchCustomers()
      if (initialDate) setDate(initialDate)
      if (initialBarberId) setSelectedBarberId(initialBarberId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDate, initialBarberId])

  const fetchBarbers = async () => {
    try {
      const res = await fetch('/api/dashboard/barbers')
      if (res.ok) {
        const data = await res.json()
        setBarbers(data)
        if (data.length > 0 && !selectedBarberId) {
          setSelectedBarberId(data[0].id)
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  const fetchServices = async () => {
    try {
      const res = await fetch('/api/dashboard/services')
      if (res.ok) {
        const data = await res.json()
        setServices(data.filter((s: any) => s.isActive))
        if (data.length > 0) {
          setSelectedServiceId(data[0].id)
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  const fetchCustomers = async () => {
    try {
      const res = await fetch('/api/dashboard/customers?limit=100')
      if (res.ok) {
        const data = await res.json()
        setCustomers(data.customers || [])
      }
    } catch (e) {
      console.error(e)
    }
  }

  const filteredCustomers = customers.filter((c) => {
    const query = customerSearch.toLowerCase()
    return (
      c.firstName.toLowerCase().includes(query) ||
      c.lastName.toLowerCase().includes(query) ||
      c.phone.includes(query) ||
      c.email.toLowerCase().includes(query)
    )
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!selectedBarberId) {
      setError('Please select a barber')
      return
    }
    if (!selectedServiceId) {
      setError('Please select a service')
      return
    }
    if (!date || !time) {
      setError('Please select date and time')
      return
    }

    if (isNewCustomer) {
      if (!firstName || !lastName || !phone || !email) {
        setError('Please fill in all new customer fields')
        return
      }
    } else {
      if (!selectedCustomerId) {
        setError('Please select an existing customer or create a new one')
        return
      }
    }

    setLoading(true)

    try {
      const startTime = new Date(`${date}T${time}`)

      const body: any = {
        barberId: selectedBarberId,
        serviceId: selectedServiceId,
        startTime: startTime.toISOString(),
        notes,
      }

      if (isNewCustomer) {
        body.customerData = {
          firstName,
          lastName,
          phone,
          email,
        }
      } else {
        body.customerId = selectedCustomerId
      }

      const res = await fetch('/api/dashboard/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create appointment')
      }

      if (onSuccess) onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to add appointment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-lg p-6">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold font-serif text-zinc-100 flex items-center gap-2">
            <Plus className="w-5 h-5 text-amber-500" /> Manual Appointment
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-xs">
            Add an appointment directly into the shop schedule.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 bg-red-950/50 border border-red-800 text-red-300 text-xs rounded-md">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 my-2 text-sm">
          {/* Barber & Service */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Barber</Label>
              <Select value={selectedBarberId} onValueChange={setSelectedBarberId}>
                <SelectTrigger className="bg-zinc-900 border-zinc-800 text-zinc-100 text-xs">
                  <SelectValue placeholder="Select barber" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                  {barbers.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Service</Label>
              <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                <SelectTrigger className="bg-zinc-900 border-zinc-800 text-zinc-100 text-xs">
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {s.name} (${s.price})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-zinc-900 border-zinc-800 text-zinc-100 text-xs"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Start Time</Label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="bg-zinc-900 border-zinc-800 text-zinc-100 text-xs"
                required
              />
            </div>
          </div>

          {/* Customer Selection Header */}
          <div className="pt-2 border-t border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold text-amber-400">Customer Details</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsNewCustomer(!isNewCustomer)}
                className="text-xs text-amber-400 hover:text-amber-300 h-6 px-2"
              >
                {isNewCustomer ? 'Select Existing Customer' : '+ New Customer'}
              </Button>
            </div>

            {isNewCustomer ? (
              <div className="space-y-2 bg-zinc-900/60 p-3 rounded-lg border border-zinc-800">
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="First Name *"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="bg-zinc-950 border-zinc-800 text-xs"
                    required
                  />
                  <Input
                    placeholder="Last Name *"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="bg-zinc-950 border-zinc-800 text-xs"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Phone *"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="bg-zinc-950 border-zinc-800 text-xs"
                    required
                  />
                  <Input
                    placeholder="Email *"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-zinc-950 border-zinc-800 text-xs"
                    required
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <Input
                    placeholder="Search existing customer by name, phone..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="pl-9 bg-zinc-900 border-zinc-800 text-xs"
                  />
                </div>

                <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                  <SelectTrigger className="bg-zinc-900 border-zinc-800 text-zinc-100 text-xs">
                    <SelectValue placeholder="Choose customer" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-h-48">
                    {filteredCustomers.length === 0 ? (
                      <div className="p-2 text-xs text-zinc-500">No customers found</div>
                    ) : (
                      filteredCustomers.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.firstName} {c.lastName} ({c.phone})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label className="text-xs text-zinc-300">Appointment Notes (Optional)</Label>
            <Textarea
              placeholder="e.g. Requested low skin fade with beard trim"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-zinc-900 border-zinc-800 text-xs h-16"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-xs text-zinc-400"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs"
            >
              {loading ? 'Creating...' : 'Create Appointment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
