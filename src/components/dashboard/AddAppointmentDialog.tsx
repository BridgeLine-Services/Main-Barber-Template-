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
import {Plus, Search } from 'lucide-react'

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
  // Lightweight shapes of the dashboard API list responses used by this dialog
interface DialogCustomer { id: string; firstName: string; lastName: string; phone: string; email: string }
interface DialogBarber { id: string; name: string }
interface DialogService { id: string; name: string; price: number; duration?: number; isActive: boolean }

const [customers, setCustomers] = useState<DialogCustomer[]>([])

  // New Customer Form State
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')

  // Appointment State
  const [barbers, setBarbers] = useState<DialogBarber[]>([])
  const [services, setServices] = useState<DialogService[]>([])
  const [selectedBarberId, setSelectedBarberId] = useState(initialBarberId || '')
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [date, setDate] = useState(initialDate || new Date().toISOString().split('T')[0])
  const [time, setTime] = useState('10:00')
  const [notes, setNotes] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        const data: DialogService[] = await res.json()
        setServices(data.filter((s) => s.isActive))
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

  // Sync prop -> state during render (React's adjust-state-during-render
  // pattern) so re-opening the dialog with a different date/barber resets it
  // without a synchronous setState inside the effect.
  const [prevDateProp, setPrevDateProp] = useState(initialDate)
  if (initialDate && initialDate !== prevDateProp) {
    setPrevDateProp(initialDate)
    setDate(initialDate)
  }
  const [prevBarberProp, setPrevBarberProp] = useState(initialBarberId)
  if (initialBarberId && initialBarberId !== prevBarberProp) {
    setPrevBarberProp(initialBarberId)
    setSelectedBarberId(initialBarberId)
  }

  // Fetch barbers, services, and customers when the dialog opens
  useEffect(() => {
    if (open) {
      void fetchBarbers()
      void fetchServices()
      void fetchCustomers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDate, initialBarberId])


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

      const body: {
        barberId: string | null
        serviceId: string | null
        startTime: string
        notes: string
        customerData?: { firstName: string; lastName: string; phone: string; email: string }
        customerId?: string | null
      } = {
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
    } catch (err) {
      setError(err.message || 'Failed to add appointment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[var(--dash-surface)] border-border text-foreground max-w-lg p-6">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold font-serif text-foreground flex items-center gap-2">
            <Plus className="w-5 h-5 text-[var(--dash-brand)]" /> Manual Appointment
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
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
              <Label className="text-xs text-foreground/85">Barber</Label>
              <Select value={selectedBarberId} onValueChange={setSelectedBarberId}>
                <SelectTrigger className="bg-card border-border text-foreground text-xs">
                  <SelectValue placeholder="Select barber" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  {barbers.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/85">Service</Label>
              <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                <SelectTrigger className="bg-card border-border text-foreground text-xs">
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
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
              <Label className="text-xs text-foreground/85">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-card border-border text-foreground text-xs"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/85">Start Time</Label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="bg-card border-border text-foreground text-xs"
                required
              />
            </div>
          </div>

          {/* Customer Selection Header */}
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold text-[var(--dash-brand)]">Customer Details</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsNewCustomer(!isNewCustomer)}
                className="text-xs text-[var(--dash-brand)] hover:text-[var(--dash-brand)] h-6 px-2"
              >
                {isNewCustomer ? 'Select Existing Customer' : '+ New Customer'}
              </Button>
            </div>

            {isNewCustomer ? (
              <div className="space-y-2 bg-card/60 p-3 rounded-lg border border-border">
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="First Name *"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="bg-[var(--dash-surface)] border-border text-xs"
                    required
                  />
                  <Input
                    placeholder="Last Name *"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="bg-[var(--dash-surface)] border-border text-xs"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Phone *"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="bg-[var(--dash-surface)] border-border text-xs"
                    required
                  />
                  <Input
                    placeholder="Email *"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-[var(--dash-surface)] border-border text-xs"
                    required
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search existing customer by name, phone..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="pl-9 bg-card border-border text-xs"
                  />
                </div>

                <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                  <SelectTrigger className="bg-card border-border text-foreground text-xs">
                    <SelectValue placeholder="Choose customer" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground max-h-48">
                    {filteredCustomers.length === 0 ? (
                      <div className="p-2 text-xs text-muted-foreground">No customers found</div>
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
            <Label className="text-xs text-foreground/85">Appointment Notes (Optional)</Label>
            <Textarea
              placeholder="e.g. Requested low skin fade with beard trim"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-card border-border text-xs h-16"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-xs text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs"
            >
              {loading ? 'Creating...' : 'Create Appointment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
