'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Loader2, UserCircle, Mail, Lock, Sparkles, Image, CheckCircle2 } from 'lucide-react'

interface BarberFormProps {
  barber?: {
    id: string
    name: string
    specialty?: string | null
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
  const [bio, setBio] = useState(barber?.bio || '')
  const [photo, setPhoto] = useState(barber?.photo || '')
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
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif text-amber-400 flex items-center gap-2">
            <UserCircle className="w-5 h-5 text-amber-500" />
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
            <Label className="text-xs text-zinc-300">Barber Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marcus Vance"
              className="bg-zinc-900 border-zinc-800 text-xs focus:border-amber-500"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-300">Specialty / Title</Label>
            <Input
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="e.g. Master Barber • Skin Fades & Hot Towel Shaves"
              className="bg-zinc-900 border-zinc-800 text-xs focus:border-amber-500"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-300">Photo URL</Label>
            <Input
              value={photo}
              onChange={(e) => setPhoto(e.target.value)}
              placeholder="https://images.unsplash.com/photo-..."
              className="bg-zinc-900 border-zinc-800 text-xs focus:border-amber-500 font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-300">Bio / About</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short bio for client booking page..."
              className="bg-zinc-900 border-zinc-800 text-xs focus:border-amber-500 min-h-[70px]"
            />
          </div>

          {!isEdit && (
            <div className="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl space-y-3">
              <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> Login Credentials for Barber
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Email Address *</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="barber@barbershop.com"
                  className="bg-zinc-950 border-zinc-800 text-xs focus:border-amber-500"
                  required={!isEdit}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Initial Password *</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="bg-zinc-950 border-zinc-800 text-xs focus:border-amber-500"
                  required={!isEdit}
                />
              </div>
            </div>
          )}

          {isEdit && (
            <div className="flex items-center justify-between p-3 bg-zinc-900/60 border border-zinc-800/80 rounded-xl">
              <div>
                <p className="text-xs font-semibold text-zinc-200">Active Status</p>
                <p className="text-[11px] text-zinc-400">Allows booking appointments with this barber</p>
              </div>
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isActive ? 'bg-amber-500' : 'bg-zinc-700'
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

          <DialogFooter className="pt-4 border-t border-zinc-800/80">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs gap-2"
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
