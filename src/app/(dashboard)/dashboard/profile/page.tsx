'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import {
  Save, User, Phone,Globe, Camera, Upload,
  Instagram, Facebook, Music2, Link as LinkIcon
} from 'lucide-react'

interface BarberProfile {
  id?: string
  name: string
  email?: string
  bio?: string | null
  photo?: string | null
  slug?: string
  specialty?: string | null
  phone?: string | null
  website?: string | null
  facebook?: string | null
  instagram?: string | null
  tiktok?: string | null
}

export default function ProfilePage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<BarberProfile | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/dashboard/profile')
      .then(r => r.json())
      .then(data => {
        setProfile(data.barber || data.user)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/dashboard/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      const data = await res.json()
      if (data.barber) {
        setProfile(data.barber)
        toast({ title: 'Profile saved successfully' })
      } else {
        toast({ title: 'Failed to save', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Failed to save profile', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', 'BARBER_PHOTO')

      const res = await fetch('/api/dashboard/media/upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()

      if (data.url) {
        // Save as media asset
        await fetch('/api/dashboard/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: data.url,
            type: 'BARBER_PHOTO',
            altText: `${profile.name} profile photo`,
            sortOrder: 0,
          }),
        })

        // Update profile photo
        const updated = { ...profile, photo: data.url }
        setProfile(updated)

        // Auto-save the photo
        const saveRes = await fetch('/api/dashboard/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photo: data.url }),
        })
        const saveData = await saveRes.json()
        if (saveData.barber) setProfile(saveData.barber)

        toast({ title: 'Profile photo updated' })
      } else {
        toast({ title: 'Upload failed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Upload failed', variant: 'destructive' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-zinc-400">Loading profile...</p>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <p className="text-zinc-400">No profile found.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">My Profile</h1>
          <p className="text-sm text-zinc-400 mt-1">Update your information that customers see.</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-amber-500 text-black hover:bg-amber-400">
          <Save className="mr-2 h-4 w-4" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Profile Photo */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Camera className="h-5 w-5 text-amber-500" />
            Profile Photo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="relative">
              {profile.photo ? (
                 
                <img
                  src={profile.photo}
                  alt={profile.name}
                  className="h-24 w-24 rounded-full object-cover border-2 border-zinc-700"
                />
              ) : (
                <div className="h-24 w-24 rounded-full bg-zinc-800 border-2 border-zinc-700 flex items-center justify-center">
                  <User className="h-10 w-10 text-zinc-600" />
                </div>
              )}
            </div>
            <div>
              <Button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                variant="outline"
                className="border-zinc-700 text-zinc-300"
              >
                <Upload className="mr-2 h-4 w-4" />
                {uploading ? 'Uploading...' : 'Upload Photo'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <p className="text-xs text-zinc-500 mt-2">JPG, PNG, or WebP. Max 5MB.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Basic Info */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5 text-amber-500" />
            Basic Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-zinc-400">Display Name</Label>
            <Input
              value={profile.name || ''}
              onChange={e => setProfile({ ...profile, name: e.target.value })}
              className="bg-zinc-800 border-zinc-700 mt-1"
            />
          </div>
          <div>
            <Label className="text-zinc-400">Specialty</Label>
            <Input
              value={profile.specialty || ''}
              onChange={e => setProfile({ ...profile, specialty: e.target.value })}
              className="bg-zinc-800 border-zinc-700 mt-1"
              placeholder="e.g., Fades, Beard Sculpting, Hot Towel Shaves"
            />
          </div>
          <div>
            <Label className="text-zinc-400">Bio</Label>
            <Textarea
              value={profile.bio || ''}
              onChange={e => setProfile({ ...profile, bio: e.target.value })}
              className="bg-zinc-800 border-zinc-700 mt-1 min-h-[120px]"
              placeholder="Tell clients about your experience and style..."
            />
          </div>
          <div>
            <Label className="text-zinc-400">URL Slug</Label>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-zinc-500 whitespace-nowrap">/barbers/</span>
              <Input
                value={profile.slug || ''}
                onChange={e => setProfile({ ...profile, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                className="bg-zinc-800 border-zinc-700 flex-1"
                placeholder="your-name"
              />
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              Your public profile URL. Use lowercase letters, numbers, and hyphens only.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Contact (barber-specific, not shop) */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Phone className="h-5 w-5 text-amber-500" />
            Personal Contact (Optional)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-zinc-400">Phone</Label>
              <Input
                value={profile.phone || ''}
                onChange={e => setProfile({ ...profile, phone: e.target.value })}
                className="bg-zinc-800 border-zinc-700 mt-1"
                placeholder="(555) 555-0199"
              />
            </div>
            <div>
              <Label className="text-zinc-400">Email</Label>
              <Input
                type="email"
                value={profile.email || ''}
                onChange={e => setProfile({ ...profile, email: e.target.value })}
                className="bg-zinc-800 border-zinc-700 mt-1"
                placeholder="your@email.com"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Social Links */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe className="h-5 w-5 text-amber-500" />
            Social Links
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-zinc-400 flex items-center gap-1.5">
              <Instagram className="h-4 w-4" /> Instagram
            </Label>
            <Input
              value={profile.instagram || ''}
              onChange={e => setProfile({ ...profile, instagram: e.target.value })}
              className="bg-zinc-800 border-zinc-700 mt-1"
              placeholder="@yourhandle"
            />
          </div>
          <div>
            <Label className="text-zinc-400 flex items-center gap-1.5">
              <Facebook className="h-4 w-4" /> Facebook
            </Label>
            <Input
              value={profile.facebook || ''}
              onChange={e => setProfile({ ...profile, facebook: e.target.value })}
              className="bg-zinc-800 border-zinc-700 mt-1"
              placeholder="facebook.com/yourpage"
            />
          </div>
          <div>
            <Label className="text-zinc-400 flex items-center gap-1.5">
              <Music2 className="h-4 w-4" /> TikTok
            </Label>
            <Input
              value={profile.tiktok || ''}
              onChange={e => setProfile({ ...profile, tiktok: e.target.value })}
              className="bg-zinc-800 border-zinc-700 mt-1"
              placeholder="@yourhandle"
            />
          </div>
          <div>
            <Label className="text-zinc-400 flex items-center gap-1.5">
              <LinkIcon className="h-4 w-4" /> Website
            </Label>
            <Input
              value={profile.website || ''}
              onChange={e => setProfile({ ...profile, website: e.target.value })}
              className="bg-zinc-800 border-zinc-700 mt-1"
              placeholder="https://yourwebsite.com"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
