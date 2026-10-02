'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RebookDialog } from '@/components/dashboard/RebookDialog'
import { Sparkles, CalendarPlus, MessageSquare, Star } from 'lucide-react'

export function CustomerProfileClient({ customerId }: { customerId: string }) {
  const [rebookOpen, setRebookOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const updateCustomer = async (payload: Record<string, unknown>) => {
    setSaving(true)
    try {
      const current = await fetch(`/api/dashboard/customers/${customerId}`).then((res) => res.json())
      const response = await fetch(`/api/dashboard/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error('Unable to save customer')
      return current
    } finally {
      setSaving(false)
    }
  }

  const addNote = async () => {
    const note = window.prompt('Add an internal note for this customer')
    if (note?.trim()) await updateCustomer({ notes: note.trim() })
  }

  const toggleVip = async () => {
    const current = await fetch(`/api/dashboard/customers/${customerId}`).then((res) => res.json())
    const tags = Array.isArray(current.tags) ? current.tags : []
    const nextTags = tags.includes('VIP') ? tags.filter((tag: string) => tag !== 'VIP') : [...tags, 'VIP']
    await updateCustomer({ tags: nextTags })
  }

  return (
    <>
      <Button
        onClick={() => setRebookOpen(true)}
        disabled={saving}
        className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-2"
        size="sm"
      >
        <Sparkles className="w-4 h-4" />
        Rebook
      </Button>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="bg-card border-border text-foreground/85 hover:bg-[var(--dash-hover)] gap-2"
      >
        <a href={`/dashboard/appointments?customer=${customerId}`}>
          <CalendarPlus className="w-4 h-4" />
          Book Appointment
        </a>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="bg-card border-border text-foreground/85 hover:bg-[var(--dash-hover)] gap-2"
        onClick={addNote}
        disabled={saving}
      >
        <MessageSquare className="w-4 h-4" />
        Add Note
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="bg-card border-border text-foreground/85 hover:bg-[var(--dash-hover)] gap-2"
        onClick={toggleVip}
        disabled={saving}
      >
        <Star className="w-4 h-4" />
        Mark VIP
      </Button>

      <RebookDialog customerId={customerId} open={rebookOpen} onOpenChange={setRebookOpen} />
    </>
  )
}
