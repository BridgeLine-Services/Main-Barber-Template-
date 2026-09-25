'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import {
  Upload, Trash2, Edit3, X, Image as ImageIcon, Star, Eye, EyeOff,
  GripVertical, Plus
} from 'lucide-react'

interface MediaAsset {
  id: string
  type: string
  url: string
  altText?: string | null
  caption?: string | null
  sortOrder: number
  isPublished: boolean
  barberId?: string | null
  serviceId?: string | null
}

interface ServiceOption {
  id: string
  name: string
}

const MEDIA_TYPES = [
  { value: 'LOGO', label: 'Logo', icon: Star },
  { value: 'HERO', label: 'Hero Image', icon: ImageIcon },
  { value: 'SHOP_PHOTO', label: 'Shop Photos', icon: ImageIcon },
  { value: 'GALLERY', label: 'Gallery', icon: ImageIcon },
  { value: 'BARBER_PHOTO', label: 'Barber Photos', icon: ImageIcon },
  { value: 'BARBER_PORTFOLIO', label: 'Barber Portfolio', icon: ImageIcon },
  { value: 'SERVICE_PHOTO', label: 'Service Photos', icon: ImageIcon },
  { value: 'OG_IMAGE', label: 'OG Image', icon: ImageIcon },
  { value: 'FAVICON', label: 'Favicon', icon: ImageIcon },
]

export default function MediaPage({ initialType = 'GALLERY', title = 'Media Gallery', description = 'Upload and manage images for your shop.' }: { initialType?: string; title?: string; description?: string }) {
  const { toast } = useToast()
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [services, setServices] = useState<ServiceOption[]>([])
  const [loading, setLoading] = useState(true)
  const [activeType, setActiveType] = useState(initialType)
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<MediaAsset | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchMedia = useCallback(async (type: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/dashboard/media?type=${type}`)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || 'Failed to load media')
  setMedia(data?.media || [])
  setServices(data?.services || [])
    } catch (err) {
      toast({
        title: 'Failed to load media',
        description: err instanceof Error ? err.message : 'Unknown error. Please refresh to retry.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void fetchMedia(activeType)
  }, [activeType, fetchMedia])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', activeType)

      const res = await fetch('/api/dashboard/media/upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Upload failed')

      if (!data?.url) throw new Error('Upload response did not include a URL')

      // Now create the media asset record
      const createRes = await fetch('/api/dashboard/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: data.url,
          type: activeType,
          altText: file.name.replace(/\.[^/.]+$/, ''),
          sortOrder: media.length,
        }),
      })
      const created = await createRes.json().catch(() => null)
      if (!createRes.ok) throw new Error(created?.error || 'Failed to save media record')
      setMedia([...media, created.media])
      toast({ title: 'Image uploaded successfully' })
    } catch (err) {
      toast({
        title: 'Upload failed',
        description: err instanceof Error ? err.message : 'Unknown error. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this image?')) return
    try {
      const res = await fetch('/api/dashboard/media', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to delete')
      setMedia(media.filter(m => m.id !== id))
      toast({ title: 'Image deleted' })
    } catch (err) {
      toast({
        title: 'Failed to delete',
        description: err instanceof Error ? err.message : 'Unknown error. Please try again.',
        variant: 'destructive',
      })
    }
  }

  const handleUpdate = async (asset: MediaAsset) => {
    try {
      const res = await fetch('/api/dashboard/media', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: asset.id,
          altText: asset.altText,
          caption: asset.caption,
          sortOrder: asset.sortOrder,
          isPublished: asset.isPublished,
          serviceId: asset.serviceId || null,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to update')
      if (data?.media) {
        setMedia(media.map(m => m.id === asset.id ? data.media : m))
        setEditing(null)
        toast({ title: 'Image updated' })
      } else {
        throw new Error('Update response was not recognized')
      }
    } catch (err) {
      toast({
        title: 'Failed to update',
        description: err instanceof Error ? err.message : 'Unknown error. Please try again.',
        variant: 'destructive',
      })
    }
  }

  const togglePublish = async (asset: MediaAsset) => {
    await handleUpdate({ ...asset, isPublished: !asset.isPublished })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="text-sm text-zinc-400 mt-1">{description}</p>
        </div>
        <Button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="bg-amber-500 text-black hover:bg-amber-400"
        >
          <Upload className="mr-2 h-4 w-4" />
          {uploading ? 'Uploading...' : 'Upload Image'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="hidden"
        />
      </div>

      {/* Type Filter */}
      <div className="flex flex-wrap gap-2">
        {MEDIA_TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => setActiveType(t.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeType === t.value
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Media Grid */}
      {loading ? (
        <p className="text-zinc-400">Loading...</p>
      ) : media.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="py-12 text-center">
            <ImageIcon className="h-12 w-12 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-400">No images in this category yet.</p>
            <Button
              onClick={() => fileRef.current?.click()}
              className="mt-4 bg-amber-500 text-black hover:bg-amber-400"
            >
              <Plus className="mr-2 h-4 w-4" />
              Upload First Image
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {media.map(asset => (
            <Card key={asset.id} className="bg-zinc-900 border-zinc-800 overflow-hidden group">
              <div className="relative aspect-square bg-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.url}
                  alt={asset.altText || ''}
                  className="w-full h-full object-cover"
                />
                {/* Overlay actions */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(asset)}
                    className="text-white hover:bg-white/20"
                  >
                    <Edit3 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => togglePublish(asset)}
                    className="text-white hover:bg-white/20"
                  >
                    {asset.isPublished ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(asset.id)}
                    className="text-red-400 hover:bg-red-500/20"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {/* Unpublished badge */}
                {!asset.isPublished && (
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-red-500/80 text-white text-[10px] font-bold">
                    HIDDEN
                  </span>
                )}
              </div>
              <div className="p-3 space-y-1">
                <p className="text-xs text-zinc-400 truncate">{asset.altText || 'No description'}</p>
                {asset.serviceId && services.some(svc => svc.id === asset.serviceId) && (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/90 truncate">
                    {services.find(svc => svc.id === asset.serviceId)?.name}
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <Card className="bg-zinc-900 border-zinc-800 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Edit Image</CardTitle>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={editing.url} alt={editing.altText || ''} className="w-full rounded-lg border border-zinc-700" />
              <div>
                <Label className="text-zinc-400">Alt Text</Label>
                <Input
                  value={editing.altText || ''}
                  onChange={e => setEditing({ ...editing, altText: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                  placeholder="Describe the image for accessibility"
                />
              </div>
              <div>
                <Label className="text-zinc-400">Caption</Label>
                <Textarea
                  value={editing.caption || ''}
                  onChange={e => setEditing({ ...editing, caption: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1 min-h-[60px]"
                  placeholder="Optional caption"
                />
              </div>
              {(editing.type === 'BARBER_PORTFOLIO' || editing.type === 'SERVICE_PHOTO') && (
                <div>
                  <Label className="text-zinc-400">Linked Service (optional)</Label>
                  <select
                    value={editing.serviceId || ''}
                    onChange={e => setEditing({ ...editing, serviceId: e.target.value || null })}
                    className="w-full mt-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
                    aria-label="Linked service"
                  >
                    <option value="">Not linked to a service</option>
                    {services.map(svc => (
                      <option key={svc.id} value={svc.id}>{svc.name}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Links this work to a service — customers can filter portfolio by service.
                  </p>
                </div>
              )}
              <div>
                <Label className="text-zinc-400">Sort Order</Label>
                <Input
                  type="number"
                  value={editing.sortOrder}
                  onChange={e => setEditing({ ...editing, sortOrder: parseInt(e.target.value) || 0 })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-zinc-200">Published</Label>
                <input
                  type="checkbox"
                  checked={editing.isPublished}
                  onChange={e => setEditing({ ...editing, isPublished: e.target.checked })}
                  className="h-4 w-4"
                />
              </div>
              <Button
                onClick={() => handleUpdate(editing)}
                className="w-full bg-amber-500 text-black hover:bg-amber-400"
              >
                Save Changes
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
