'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Scissors, Save } from 'lucide-react'

type BarberService = {
  serviceId: string
  isActive: boolean
  priceOverride: number | null
  durationOverride: number | null
  service: { id: string; name: string; description: string | null; price: number; duration: number }
}

export function BarberServicesClient() {
  const [services, setServices] = useState<BarberService[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/barber-services')
      .then((response) => response.json())
      .then((data) => setServices(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [])

  const saveCurrent = (serviceId: string) => {
    const current = services.find((item) => item.serviceId === serviceId)
    if (current) void update(current, {})
  }

  const update = async (service: BarberService, changes: Partial<BarberService>) => {
    setSaving(service.serviceId)
    const next = { ...service, ...changes }
    setServices((current) => current.map((item) => item.serviceId === service.serviceId ? next : item))
    const response = await fetch('/api/dashboard/barber-services', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: service.serviceId,
        isActive: next.isActive,
        priceOverride: next.priceOverride,
        durationOverride: next.durationOverride,
      }),
    })
    if (!response.ok) setServices((current) => current.map((item) => item.serviceId === service.serviceId ? service : item))
    setSaving(null)
  }

  if (loading) return <p className="text-muted-foreground">Loading your services...</p>

  return (
    <div className="max-w-4xl flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">My Services</h1>
        <p className="text-sm text-muted-foreground mt-1">Control your availability, pricing, and timing without changing the shop catalog.</p>
      </header>
      {services.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No services are assigned to your profile yet.</CardContent></Card>
      ) : services.map((item) => {
        const price = item.priceOverride ?? item.service.price
        const duration = item.durationOverride ?? item.service.duration
        return (
          <Card key={item.serviceId}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2"><Scissors className="size-5" />{item.service.name}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">{item.service.description || 'Shop service'}</p>
              </div>
              <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">Offer</span><Switch checked={item.isActive} onCheckedChange={(checked) => update(item, { isActive: checked })} /></div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">Price
                <Input type="number" min="0" step="0.01" value={item.priceOverride ?? ''} placeholder={`Inherited: $${item.service.price.toFixed(2)}`} onChange={(event) => setServices((current) => current.map((entry) => entry.serviceId === item.serviceId ? { ...entry, priceOverride: event.target.value === '' ? null : Number(event.target.value) } : entry))} onBlur={() => saveCurrent(item.serviceId)} />
                <span className="text-xs text-muted-foreground">Effective: ${price.toFixed(2)} {item.priceOverride === null ? '(inherited)' : '(custom)'}</span>
              </label>
              <label className="flex flex-col gap-2 text-sm">Duration (minutes)
                <Input type="number" min="5" max="480" step="5" value={item.durationOverride ?? ''} placeholder={`Inherited: ${item.service.duration} minutes`} onChange={(event) => setServices((current) => current.map((entry) => entry.serviceId === item.serviceId ? { ...entry, durationOverride: event.target.value === '' ? null : Number(event.target.value) } : entry))} onBlur={() => saveCurrent(item.serviceId)} />
                <span className="text-xs text-muted-foreground">Effective: {duration} minutes {item.durationOverride === null ? '(inherited)' : '(custom)'}</span>
              </label>
              {saving === item.serviceId && <span className="text-xs text-muted-foreground flex items-center gap-2"><Save className="size-3" />Saving...</span>}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
