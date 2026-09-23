'use client'

import { useState } from 'react'
import { Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RecurringDialog } from '@/components/dashboard/RecurringDialog'

export function RecurringPageClient({
  barbers,
  services,
}: {
  barbers: { id: string; name: string }[]
  services: { id: string; name: string; duration: number; price: number }[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold text-zinc-100">Recurring Appointments</h1>
          <p className="mt-1 text-sm text-zinc-400">Schedule a repeat appointment series with availability checks.</p>
        </div>
        <Button onClick={() => setOpen(true)} className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400">
          <Repeat className="mr-2 h-4 w-4" /> Create recurring series
        </Button>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 text-sm text-zinc-400">
        Choose a barber, service, date, and interval to preview conflicts before creating the series.
      </div>
      <RecurringDialog open={open} onOpenChange={setOpen} barbers={barbers} services={services} />
    </div>
  )
}
