'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { HelpCircle, Plus, Trash2, GripVertical } from 'lucide-react'

interface Faq {
  id: string
  category: string
  question: string
  answer: string
  sortOrder: number
  isActive: boolean
}

export function FaqManager() {
  const { toast } = useToast()
  const [faqs, setFaqs] = useState<Faq[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [newFaq, setNewFaq] = useState({ category: '', question: '', answer: '' })
  const [creating, setCreating] = useState(false)

  const load = () => {
    fetch('/api/dashboard/faqs')
      .then(r => r.json())
      .then(data => {
        setFaqs(data.faqs || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!newFaq.category.trim() || !newFaq.question.trim() || !newFaq.answer.trim()) {
      toast({ title: 'Category, question, and answer are required', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/dashboard/faqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFaq),
      })
      const data = await res.json()
      if (data.faq) {
        setFaqs([...faqs, data.faq])
        setNewFaq({ category: '', question: '', answer: '' })
        toast({ title: 'FAQ added' })
      } else {
        toast({ title: 'Failed to add FAQ', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Failed to add FAQ', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const handleUpdate = async (faq: Faq) => {
    setSavingId(faq.id)
    try {
      const res = await fetch(`/api/dashboard/faqs/${faq.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: faq.category,
          question: faq.question,
          answer: faq.answer,
          isActive: faq.isActive,
        }),
      })
      const data = await res.json()
      if (data.faq) {
        toast({ title: 'FAQ saved' })
      } else {
        toast({ title: 'Failed to save', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Failed to save FAQ', variant: 'destructive' })
    } finally {
      setSavingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this FAQ?')) return
    try {
      const res = await fetch(`/api/dashboard/faqs/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setFaqs(faqs.filter(f => f.id !== id))
        toast({ title: 'FAQ deleted' })
      } else {
        const data = await res.json()
        toast({ title: 'Failed to delete', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Failed to delete FAQ', variant: 'destructive' })
    }
  }

  const updateField = (id: string, field: keyof Faq, value: string | boolean) => {
    setFaqs(faqs.map(f => f.id === id ? { ...f, [field]: value } : f))
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading FAQs...</p>
  }

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <HelpCircle className="h-5 w-5 text-amber-500" />
            Frequently Asked Questions
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Manage the FAQs shown on your public FAQ page. Group by category — customers see them exactly as ordered here.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {faqs.length === 0 && (
            <p className="text-sm text-muted-foreground">No custom FAQs yet — your site is showing default placeholder FAQs. Add your own below.</p>
          )}

          {faqs.map(faq => (
            <div key={faq.id} className="rounded-lg border border-border bg-[var(--dash-surface)] p-4 space-y-3">
              <div className="flex items-start gap-3">
                <GripVertical className="h-4 w-4 text-muted-foreground mt-2 shrink-0" />
                <div className="flex-1 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-1">
                      <Label className="text-muted-foreground text-xs">Category</Label>
                      <Input
                        value={faq.category}
                        onChange={e => updateField(faq.id, 'category', e.target.value)}
                        className="bg-muted border-input mt-1"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-muted-foreground text-xs">Question</Label>
                      <Input
                        value={faq.question}
                        onChange={e => updateField(faq.id, 'question', e.target.value)}
                        className="bg-muted border-input mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Answer</Label>
                    <Textarea
                      value={faq.answer}
                      onChange={e => updateField(faq.id, 'answer', e.target.value)}
                      className="bg-muted border-input mt-1 min-h-[70px]"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={faq.isActive}
                        onCheckedChange={v => updateField(faq.id, 'isActive', v)}
                      />
                      <span className="text-xs text-muted-foreground">{faq.isActive ? 'Visible on site' : 'Hidden'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-input text-foreground/85 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/40"
                        onClick={() => handleDelete(faq.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        className="bg-amber-500 text-black hover:bg-amber-400"
                        disabled={savingId === faq.id}
                        onClick={() => handleUpdate(faq)}
                      >
                        {savingId === faq.id ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5 text-amber-500" />
            Add New FAQ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <Label className="text-muted-foreground text-xs">Category</Label>
              <Input
                value={newFaq.category}
                onChange={e => setNewFaq({ ...newFaq, category: e.target.value })}
                className="bg-muted border-input mt-1"
                placeholder="Booking & Appointments"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-muted-foreground text-xs">Question</Label>
              <Input
                value={newFaq.question}
                onChange={e => setNewFaq({ ...newFaq, question: e.target.value })}
                className="bg-muted border-input mt-1"
                placeholder="How do I book an appointment?"
              />
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs">Answer</Label>
            <Textarea
              value={newFaq.answer}
              onChange={e => setNewFaq({ ...newFaq, answer: e.target.value })}
              className="bg-muted border-input mt-1 min-h-[70px]"
              placeholder="You can book online in under 60 seconds..."
            />
          </div>
          <div className="flex justify-end">
            <Button
              className="bg-amber-500 text-black hover:bg-amber-400"
              disabled={creating}
              onClick={handleCreate}
            >
              <Plus className="mr-2 h-4 w-4" />
              {creating ? 'Adding...' : 'Add FAQ'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
