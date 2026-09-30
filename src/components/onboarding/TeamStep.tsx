'use client'

// Onboarding Step — Team.
// The owner adds their barbers, each with a full weekly schedule (working
// days, hours, and optional breaks). Everything persists immediately to the
// authenticated owner's business, so leaving and returning resumes here.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, ArrowRight, Copy, Loader2, Pencil,Trash2, Upload, UserRound, X } from 'lucide-react'

export interface ScheduleDay {
  dayOfWeek: number // 0 = Sunday … 6 = Saturday
  isOff: boolean
  startTime: string // "HH:MM"
  endTime: string // "HH:MM"
  breaks: { start: string; end: string }[]
}

export interface BarberItem {
  id: string
  name: string
  specialty: string | null
  bio: string | null
  photo: string | null
  isActive: boolean
  schedules?: (ScheduleDay & { id?: string })[]
}

interface TeamStepProps {
  submitting: boolean
  serverError: string | null
  onContinue: () => void
  onBack: () => void
}

interface BarberForm {
  name: string
  specialty: string
  bio: string
  photo: string
  isActive: boolean
  schedule: ScheduleDay[]
}

/** Display order: Monday → Sunday (dayOfWeek 1…6, 0). */
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0]
const DAY_NAMES: Record<number, string> = {
  0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday',
  4: 'Thursday', 5: 'Friday', 6: 'Saturday',
}

function defaultSchedule(): ScheduleDay[] {
  return DISPLAY_DAYS.map((d) => ({
    dayOfWeek: d,
    isOff: d === 0, // Sunday off by default; owner adjusts freely
    startTime: '09:00',
    endTime: '18:00',
    breaks: [],
  }))
}

function scheduleFromApi(entries: (ScheduleDay & { id?: string })[] | undefined): ScheduleDay[] {
  const byDay = new Map(entries?.map((e) => [e.dayOfWeek, e]))
  return DISPLAY_DAYS.map((d) => {
    const e = byDay.get(d)
    return {
      dayOfWeek: d,
      isOff: e?.isOff ?? d === 0,
      startTime: e?.startTime ?? '09:00',
      endTime: e?.endTime ?? '18:00',
      breaks: (e?.breaks as { start: string; end: string }[]) ?? [],
    }
  })
}

const emptyBarberForm = (): BarberForm => ({
  name: '',
  specialty: '',
  bio: '',
  photo: '',
  isActive: true,
  schedule: defaultSchedule(),
})

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Client-side mirror of the server's schedule validation. */
function validateSchedule(schedule: ScheduleDay[]): string | null {
  for (const day of schedule) {
    if (day.isOff) continue
    if (toMinutes(day.startTime) >= toMinutes(day.endTime)) {
      return `${DAY_NAMES[day.dayOfWeek]}: start time must be before end time`
    }
    for (const b of day.breaks) {
      if (toMinutes(b.start) >= toMinutes(b.end)) return 'A break must start before it ends'
      if (toMinutes(b.start) < toMinutes(day.startTime) || toMinutes(b.end) > toMinutes(day.endTime)) {
        return `${DAY_NAMES[day.dayOfWeek]}: a break falls outside working hours`
      }
    }
    const sorted = [...day.breaks].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    for (let i = 1; i < sorted.length; i++) {
      if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) {
        return `${DAY_NAMES[day.dayOfWeek]}: breaks overlap — adjust the times`
      }
    }
  }
  return null
}

export function TeamStep({ submitting, serverError, onContinue, onBack }: TeamStepProps) {
  const [barbers, setBarbers] = useState<BarberItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<BarberForm>(emptyBarberForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Photo upload — goes through the EXISTING media upload system
  // (/api/dashboard/media/upload with type BARBER_PHOTO). A photo URL is also
  // supported. If storage isn't configured the server returns a clear message
  // and the owner can paste a URL instead.
  const handlePhotoSelected = useCallback(async (file: File) => {
    setPhotoUploadError(null)
    setPhotoUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('type', 'BARBER_PHOTO')
      const res = await fetch('/api/dashboard/media/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setForm((f) => ({ ...f, photo: data.url }))
    } catch (err) {
      setPhotoUploadError(
        `${err.message}. You can paste a photo URL instead below until file storage is configured.`
      )
    } finally {
      setPhotoUploading(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }, [])
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/onboarding/team')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load your team')
      setBarbers(json.barbers || [])
    } catch (err) {
      setLoadError(err.message || 'Something went wrong loading your team.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const activeCount = barbers.filter((b) => b.isActive).length

  function resetForm() {
    setEditingId(null)
    setForm(emptyBarberForm())
    setErrors({})
    setActionError(null)
  }

  function startEdit(b: BarberItem) {
    setEditingId(b.id)
    setForm({
      name: b.name,
      specialty: b.specialty || '',
      bio: b.bio || '',
      photo: b.photo || '',
      isActive: b.isActive,
      schedule: scheduleFromApi(b.schedules),
    })
    setErrors({})
    setActionError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function updateDay(dayOfWeek: number, patch: Partial<ScheduleDay>) {
    setForm((f) => ({
      ...f,
      schedule: f.schedule.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)),
    }))
  }

  function addBreak(dayOfWeek: number) {
    updateDay(dayOfWeek, { breaks: [{ start: '12:00', end: '13:00' }] })
  }

  function removeBreak(dayOfWeek: number, index: number) {
    setForm((f) => ({
      ...f,
      schedule: f.schedule.map((d) =>
        d.dayOfWeek === dayOfWeek ? { ...d, breaks: d.breaks.filter((_, i) => i !== index) } : d
      ),
    }))
  }

  /** Apply one day's hours (and breaks) to every day of the week.
   *  Day-off checkboxes are left untouched — only times change. */
  function copyDayToAll(source: ScheduleDay) {
    setForm((f) => ({
      ...f,
      schedule: f.schedule.map((d) =>
        d.dayOfWeek === source.dayOfWeek
          ? d
          : { ...d, startTime: source.startTime, endTime: source.endTime, breaks: source.breaks.map((b) => ({ ...b })) }
      ),
    }))
  }

  function updateBreak(dayOfWeek: number, index: number, key: 'start' | 'end', value: string) {
    setForm((f) => ({
      ...f,
      schedule: f.schedule.map((d) =>
        d.dayOfWeek === dayOfWeek
          ? { ...d, breaks: d.breaks.map((b, i) => (i === index ? { ...b, [key]: value } : b)) }
          : d
      ),
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const e1: Record<string, string> = {}
    if (!form.name.trim()) e1.name = 'Barber name is required'
    else if (form.name.trim().length > 100) e1.name = 'Keep the name under 100 characters'
    if (form.photo && !(/^https?:\/\/.+/.test(form.photo) || form.photo.startsWith('/'))) {
      e1.photo = 'Photo must be an https URL or an uploaded file'
    }
    const scheduleError = validateSchedule(form.schedule)
    if (scheduleError) e1.schedule = scheduleError
    setErrors(e1)
    if (Object.keys(e1).length > 0) return

    setBusy(true)
    setActionError(null)
    const payload = {
      name: form.name.trim(),
      specialty: form.specialty.trim() || null,
      bio: form.bio.trim() || null,
      photo: form.photo.trim() || null,
      isActive: form.isActive,
      schedules: form.schedule.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        isOff: d.isOff,
        startTime: d.startTime,
        endTime: d.endTime,
        breaks: d.breaks,
      })),
    }
    try {
      if (editingId) {
        const res = await fetch(`/api/dashboard/onboarding/team/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to update barber')
        setBarbers((prev) => prev.map((b) => (b.id === editingId ? json.barber : b)))
      } else {
        const res = await fetch('/api/dashboard/onboarding/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to add barber')
        setBarbers((prev) => [...prev, json.barber])
      }
      resetForm()
    } catch (err) {
      setActionError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this barber? Their schedule and profile will be removed.')) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/dashboard/onboarding/team/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || 'Failed to delete barber')
      }
      setBarbers((prev) => prev.filter((b) => b.id !== id))
      if (editingId === id) resetForm()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
        <p className="mt-3 text-sm">Loading your team…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm text-red-300">{loadError}</p>
        <Button variant="outline" className="mt-4" onClick={load}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/60 max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-zinc-100">Team</CardTitle>
        <CardDescription>
          Add your barbers and set their weekly hours. Customers can only book barbers who are
          active.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-400">
            {barbers.length === 0
              ? 'No barbers yet'
              : `${barbers.length} barber${barbers.length === 1 ? '' : 's'} · ${activeCount} active`}
          </p>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancel edit
            </Button>
          )}
        </div>

        {/* Barber list */}
        {barbers.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-12 text-center">
            <UserRound className="h-8 w-8 text-zinc-600" />
            <p className="mt-3 text-sm font-medium text-zinc-300">No barbers yet</p>
            <p className="mt-1 text-xs text-zinc-500">Add your first barber using the form below.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {barbers.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-zinc-100">{b.name}</p>
                    {!b.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {b.specialty || 'No specialty set'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(b)} disabled={busy}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-400 hover:text-red-300"
                    onClick={() => handleDelete(b.id)}
                    disabled={busy}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Add / edit form */}
        <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
          <p className="text-sm font-medium text-zinc-200">{editingId ? 'Edit barber' : 'Add a barber'}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-zinc-300">Name</Label>
              <Input
                className="mt-1.5"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Marcus"
              />
              {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
            </div>
            <div>
              <Label className="text-zinc-300">Specialty (optional)</Label>
              <Input
                className="mt-1.5"
                value={form.specialty}
                onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                placeholder="e.g. Fades · Tapers · Beard work"
              />
            </div>
          </div>

          <div>
            <Label className="text-zinc-300">Bio (optional)</Label>
            <Textarea
              className="mt-1.5"
              rows={2}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder="A short intro customers will see on the barber's public page"
            />
          </div>

          <div>
            <Label className="text-zinc-300">Photo (optional)</Label>
            <div className="flex gap-2 mt-1.5">
              <Input
                value={form.photo}
                onChange={(e) => setForm({ ...form, photo: e.target.value })}
                placeholder="https://… or upload a file"
              />
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoSelected(f) }}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0 border-zinc-700 text-zinc-300"
                disabled={photoUploading}
                onClick={() => photoInputRef.current?.click()}
              >
                {photoUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{form.photo ? 'Replace' : 'Upload'}</span>
              </Button>
            </div>
            {photoUploadError && <p className="mt-1 text-xs text-red-400">{photoUploadError}</p>}
            {errors.photo && <p className="mt-1 text-xs text-red-400">{errors.photo}</p>}
            {form.photo && (
               
              <img src={form.photo} alt="Barber photo preview" className="mt-2 h-16 w-16 rounded-lg object-cover border border-zinc-700" />
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 rounded border-zinc-700"
            />
            Active (available for booking)
          </label>

          {/* Weekly schedule editor */}
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-200">Weekly hours</p>
            {errors.schedule && <p className="mb-2 text-xs text-red-400">{errors.schedule}</p>}
            <div className="space-y-2">
              {form.schedule.map((day) => (
                <div key={day.dayOfWeek} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex w-32 shrink-0 items-center gap-2 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={!day.isOff}
                        onChange={(e) => updateDay(day.dayOfWeek, { isOff: !e.target.checked })}
                        className="h-4 w-4 rounded border-zinc-700"
                      />
                      {DAY_NAMES[day.dayOfWeek]}
                    </label>
                    {day.isOff ? (
                      <span className="text-xs text-zinc-500">Day off</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={day.startTime}
                          onChange={(e) => updateDay(day.dayOfWeek, { startTime: e.target.value })}
                          className="h-8 w-[118px] text-xs"
                        />
                        <span className="text-zinc-600">→</span>
                        <Input
                          type="time"
                          value={day.endTime}
                          onChange={(e) => updateDay(day.dayOfWeek, { endTime: e.target.value })}
                          className="h-8 w-[118px] text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => (day.breaks.length === 0 ? addBreak(day.dayOfWeek) : updateDay(day.dayOfWeek, { breaks: [] }))}
                        >
                          {day.breaks.length === 0 ? '+ Break' : 'Remove breaks'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-zinc-500 hover:text-zinc-300"
                          title="Copy these hours to every day"
                          onClick={() => copyDayToAll(day)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {day.breaks.length > 0 && !day.isOff && (
                    <div className="mt-2 space-y-1.5 pl-[140px]">
                      {day.breaks.map((b, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-zinc-500">Break</span>
                          <Input
                            type="time"
                            value={b.start}
                            onChange={(e) => updateBreak(day.dayOfWeek, i, 'start', e.target.value)}
                            className="h-7 w-[110px] text-xs"
                          />
                          <span className="text-zinc-600">→</span>
                          <Input
                            type="time"
                            value={b.end}
                            onChange={(e) => updateBreak(day.dayOfWeek, i, 'end', e.target.value)}
                            className="h-7 w-[110px] text-xs"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-zinc-500"
                            onClick={() => removeBreak(day.dayOfWeek, i)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {actionError && <p className="text-sm text-red-400">{actionError}</p>}

          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Save changes' : 'Add barber'}
            </Button>
          </div>
        </form>

        {serverError && <p className="text-sm text-red-400">{serverError}</p>}

        {/* Navigation */}
        <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
          <Button variant="outline" onClick={onBack} disabled={submitting}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={onContinue} disabled={submitting || busy}>
              Continue <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
            {activeCount === 0 && (
              <p className="text-xs text-amber-400">Add at least one active barber to finish setup.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
