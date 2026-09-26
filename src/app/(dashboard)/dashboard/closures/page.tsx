'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Trash2, Plus, CalendarOff, Loader2, AlertCircle, Pencil } from 'lucide-react'

interface Closure {
  id: string
  title: string
  description: string | null
  startDate: string
  endDate: string
  isAllDay: boolean
  startTime: string | null
  endTime: string | null
  isActive: boolean
}

export default function ClosuresPage() {
  const [closures, setClosures] = useState<Closure[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    isAllDay: true,
    startTime: '',
    endTime: '',
  })

  useEffect(() => {
    fetchClosures()
  }, [])

  const fetchClosures = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/closures')
      const data = await res.json()
      setClosures(data.closures || [])
    } catch {
      setClosures([])
    } finally {
      setLoading(false)
    }
  }

  const toInputDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const openEdit = (closure: Closure) => {
    setEditingId(closure.id)
    setForm({
      title: closure.title,
      description: closure.description || '',
      startDate: toInputDate(closure.startDate),
      endDate: toInputDate(closure.endDate),
      isAllDay: closure.isAllDay,
      startTime: closure.startTime || '',
      endTime: closure.endTime || '',
    })
    setShowForm(true)
    setError('')
  }

  const resetForm = () => {
    setForm({
      title: '', description: '', startDate: '', endDate: '',
      isAllDay: true, startTime: '', endTime: '',
    })
    setEditingId(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const isEdit = !!editingId
      const res = await fetch(
        isEdit ? `/api/dashboard/closures/${editingId}` : '/api/dashboard/closures',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }
      )

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || (isEdit ? 'Failed to update closure' : 'Failed to create closure'))
        return
      }

      if (isEdit) {
        setClosures(closures.map(c => (c.id === editingId ? { ...c, ...data } : c)))
      } else {
        setClosures([...closures, data.closure])
      }
      resetForm()
      setShowForm(false)
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this closure?')) return

    try {
      await fetch(`/api/dashboard/closures/${id}`, { method: 'DELETE' })
      setClosures(closures.filter(c => c.id !== id))
    } catch {
      // ignore
    }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Holiday Closures</h1>
          <p className="text-sm text-zinc-400 mt-1">Manage holidays, vacations, and special hours.</p>
        </div>
        {!showForm && (
          <Button
            onClick={() => setShowForm(true)}
            className="bg-amber-500 text-black hover:bg-amber-400"
          >
            <Plus className="w-4 h-4 mr-2" /> Add Closure
          </Button>
        )}
      </div>

      
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {showForm && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-zinc-100">{editingId ? 'Edit Closure' : 'New Closure'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Christmas Day, Summer Vacation"
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g. Shop closed for the holiday"
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">End Date</label>
                  <input
                    type="date"
                    required
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isAllDay"
                  checked={form.isAllDay}
                  onChange={(e) => setForm({ ...form, isAllDay: e.target.checked })}
                  className="rounded border-zinc-600 bg-zinc-800"
                />
                <label htmlFor="isAllDay" className="text-sm text-zinc-300">All day</label>
              </div>

              {!form.isAllDay && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">Start Time</label>
                    <input
                      type="time"
                      value={form.startTime}
                      onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-1">End Time</label>
                    <input
                      type="time"
                      value={form.endTime}
                      onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button type="submit" disabled={submitting} className="bg-amber-500 text-black hover:bg-amber-400">
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {editingId ? 'Save Changes' : 'Create Closure'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetForm() }}
                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {closures.length === 0 && !showForm ? (
          <Card className="bg-zinc-900 border-zinc-800 p-12 text-center">
            <CalendarOff className="w-10 h-10 mx-auto text-zinc-600 mb-3" />
            <p className="text-zinc-400">No closures scheduled. Your shop is open every working day.</p>
          </Card>
        ) : (
          closures.map((closure) => (
            <Card key={closure.id} className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-zinc-100">{closure.title}</h3>
                  {closure.description && (
                    <p className="text-sm text-zinc-400 mt-0.5">{closure.description}</p>
                  )}
                  <p className="text-sm text-amber-400/70 mt-1">
                    {formatDate(closure.startDate)}
                    {closure.endDate !== closure.startDate && ` — ${formatDate(closure.endDate)}`}
                    {!closure.isAllDay && closure.startTime && ` · ${closure.startTime}–${closure.endTime}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEdit(closure)}
                    className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    title="Edit closure"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(closure.id)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-950/30"
                    title="Delete closure"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
