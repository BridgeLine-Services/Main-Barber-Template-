'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Loader2, UserCircle,Lock,Upload } from 'lucide-react'

interface BarberFormProps {
  barber?: {
    id: string
    name: string
    specialty?: string | null
    yearsExperience?: number | null
    bio?: string | null
    photo?: string | null
    isActive?: boolean
    email?: string | null
  } | null
  isOpen: boolean
  onClose: () => void
  onSave: () => void
}

export function BarberForm({ barber, isOpen, onClose, onSave }: BarberFormProps) {
  const isEdit = Boolean(barber?.id)

  const [name, setName] = useState(barber?.name || '')
  const [specialty, setSpecialty] = useState(barber?.specialty || '')
  const [yearsExperience, setYearsExperience] = useState<string>(
    barber?.yearsExperience != null ? String(barber.yearsExperience) : ''
  )
  const [bio, setBio] = useState(barber?.bio || '')
  const [photo, setPhoto] = useState(barber?.photo || '')
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Photo upload — EXISTING media upload system (type BARBER_PHOTO).
  // URL paste remains supported; if storage isn't configured the server
  // returns a clear message shown below the field.
  const handlePhotoSelected = async (file: File) => {
    setPhotoUploadError(null)
    setPhotoUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('type', 'BARBER_PHOTO')
      const res = await fetch('/api/dashboard/media/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setPhoto(data.url)
    } catch (err) {
      setPhotoUploadError(
        `${err.message}. You can paste a photo URL instead until file storage is configured.`
      )
    } finally {
      setPhotoUploading(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }
  const [email, setEmail] = useState(barber?.email || '')
  const [password, setPassword] = useState('')
  const [isActive, setIsActive] = useState(barber?.isActive ?? true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Barber name is required')
      return
    }

    if (!isEdit && !email.trim()) {
      setError('Email is required for creating a new barber account')
      return
    }

    if (!isEdit && (!password || password.length < 8)) {
      setError('Password must be at least 8 characters long for new account')
      return
    }

    setLoading(true)

    try {
      if (isEdit) {
        const res = await fetch(`/api/dashboard/barbers/${barber!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            specialty: specialty.trim() || null,
            yearsExperience: yearsExperience.trim() === '' ? null : Number(yearsExperience),
            bio: bio.trim() || null,
            photo: photo.trim() || null,
            isActive,
          }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to update barber')
        }
      } else {
        const res = await fetch('/api/dashboard/barbers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            specialty: specialty.trim() || null,
            yearsExperience: yearsExperience.trim() === '' ? null : Number(yearsExperience),
            bio: bio.trim() || null,
            photo: photo.trim() || null,
            email: email.trim(),
            password,
          }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to create barber profile')
        }
      }

      onSave()
      onClose()
    } catch (err) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="bg-[var(--dash-surface)] border-border text-foreground max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif text-[var(--dash-brand)] flex items-center gap-2">
            <UserCircle className="w-5 h-5 text-[var(--dash-brand)]" />
            {isEdit ? 'Edit Barber Profile' : 'Add New Barber'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/85">Barber Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marcus Vance"
              className="bg-card border-border text-xs focus:border-ring"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/85">Specialty / Title</Label>
            <Input
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="e.g. Master Barber • Skin Fades & Hot Towel Shaves"
              className="bg-card border-border text-xs focus:border-ring"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/85">Years of experience</Label>
            <Input
              type="number"
              min={0}
              max={80}
              value={yearsExperience}
              onChange={(e) => setYearsExperience(e.target.value)}
              placeholder="e.g. 8 — leave empty if unknown"
              className="bg-card border-border text-xs focus:border-ring"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/85">Photo</Label>
            <div className="flex gap-2">
              <Input
                value={photo}
                onChange={(e) => setPhoto(e.target.value)}
                placeholder="https://… or upload a file"
                className="bg-card border-border text-xs focus:border-ring font-mono"
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
                size="sm"
                className="shrink-0 border-input text-foreground/85"
                disabled={photoUploading || loading}
                onClick={() => photoInputRef.current?.click()}
              >
                {photoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </Button>
            </div>
            {photoUploadError && <p className="text-xs text-red-400">{photoUploadError}</p>}
            {photo && (
               
              <img src={photo} alt="Barber photo preview" className="h-16 w-16 rounded-lg object-cover border border-input" />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/85">Bio / About</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short bio for client booking page..."
              className="bg-card border-border text-xs focus:border-ring min-h-[70px]"
            />
          </div>

          {!isEdit && (
            <div className="p-3 bg-card/80 border border-border rounded-xl space-y-3">
              <p className="text-xs font-semibold text-[var(--dash-brand)] flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> Login Credentials for Barber
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs text-foreground/85">Email Address *</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="barber@barbershop.com"
                  className="bg-[var(--dash-surface)] border-border text-xs focus:border-ring"
                  required={!isEdit}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-foreground/85">Initial Password *</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="bg-[var(--dash-surface)] border-border text-xs focus:border-ring"
                  required={!isEdit}
                />
              </div>
            </div>
          )}

          {isEdit && (
            <div className="flex items-center justify-between p-3 bg-card/60 border border-border/80 rounded-xl">
              <div>
                <p className="text-xs font-semibold text-foreground">Active Status</p>
                <p className="text-[11px] text-muted-foreground">Allows booking appointments with this barber</p>
              </div>
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isActive ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isActive ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          )}

          <DialogFooter className="pt-4 border-t border-border/80">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="bg-card border-border text-foreground/85 hover:bg-[var(--dash-hover)] text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs gap-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? 'Save Profile' : 'Create Barber'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
