'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Megaphone,
  Plus,
  Send,
  Users,
  Loader2,
  X,
  Eye,
  Clock,
  CheckCircle2,
} from 'lucide-react'

interface Campaign {
  id: string
  name: string
  subject: string
  body: string
  audience: string
  status: string
  sentAt: string | null
  recipientCount: number | null
  createdAt: string
}

const AUDIENCE_OPTIONS = [
  { value: 'INACTIVE_30', label: 'Inactive 30+ days' },
  { value: 'INACTIVE_45', label: 'Inactive 45+ days' },
  { value: 'INACTIVE_60', label: 'Inactive 60+ days' },
  { value: 'INACTIVE_90', label: 'Inactive 90+ days' },
  { value: 'NOT_REBOOKED', label: "Haven't rebooked" },
  { value: 'CANCELLED', label: 'Have cancelled' },
  { value: 'NO_SHOWED', label: 'Have no-showed' },
  { value: 'NOT_VISITED_BARBER', label: "Haven't visited a specific barber" },
  { value: 'USED_SERVICE', label: 'Used a specific service' },
  { value: 'ALL_CUSTOMERS', label: 'All customers' },
]

export function MarketingClient({
  initialCampaigns,
  barbers,
  services,
  isOwner,
}: {
  initialCampaigns: Campaign[]
  barbers: { id: string; name: string }[]
  services: { id: string; name: string }[]
  isOwner: boolean
}) {
  const [campaigns, setCampaigns] = useState(initialCampaigns)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState('INACTIVE_30')
  const [barberId, setBarberId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const readError = async (res: Response): Promise<string> => {
    try {
      const data = await res.json()
      return data?.error || 'Something went wrong. Please try again.'
    } catch {
      return 'Something went wrong. Please try again.'
    }
  }

  const audienceConfig = () => {
    if (audience === 'NOT_VISITED_BARBER') return { barberId }
    if (audience === 'USED_SERVICE') return { serviceId }
    return undefined
  }

  const handlePreview = async () => {
    setPreviewing(true)
    setPreviewCount(null)
    try {
      const res = await fetch('/api/dashboard/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience, audienceConfig: audienceConfig(), preview: true }),
      })
      if (!res.ok) {
        setError(await readError(res))
        return
      }
      const data = await res.json()
      setPreviewCount(data.recipientCount ?? 0)
      setError(null)
    } catch {
      setError('Could not load the preview. Check your connection and try again.')
    } finally {
      setPreviewing(false)
    }
  }

  const handleCreate = async () => {
    if (!name || !subject || !body) return
    setCreating(true)
    try {
      const res = await fetch('/api/dashboard/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, subject, body, audience, audienceConfig: audienceConfig() }),
      })
      if (!res.ok) {
        setError(await readError(res))
        return
      }
      const newCampaign = await res.json()
      setCampaigns([newCampaign, ...campaigns])
      setShowForm(false)
      setName(''); setSubject(''); setBody(''); setPreviewCount(null)
      setError(null)
    } catch {
      setError('Could not create the campaign. Check your connection and try again.')
    } finally {
      setCreating(false)
    }
  }

  const handleSend = async (campaignId: string) => {
    setSendingId(campaignId)
    try {
      const res = await fetch(`/api/dashboard/marketing/campaigns/${campaignId}/send`, { method: 'POST' })
      if (!res.ok) {
        setError(await readError(res))
        return
      }
      const data = await res.json()
      setCampaigns(campaigns.map(c =>
        c.id === campaignId
          ? { ...c, status: 'SENT', sentAt: new Date().toISOString(), recipientCount: data.sent }
          : c
      ))
      setError(null)
    } catch {
      setError('Could not send the campaign. Check your connection and try again.')
    } finally {
      setSendingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-serif text-zinc-100 flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-amber-500" />
            Marketing Automation
          </h1>
          <p className="text-xs text-zinc-400 mt-1">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</p>
        </div>
        {isOwner && (
          <Button
            onClick={() => { setError(null); setShowForm(!showForm) }}
            className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
          >
            {showForm ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            {showForm ? 'Cancel' : 'New Campaign'}
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error" className="text-red-400/70 hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-100">Create Campaign</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400 font-medium">Campaign Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Summer Comeback"
                className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 font-medium">Audience</label>
              <select
                value={audience}
                onChange={e => { setAudience(e.target.value); setPreviewCount(null) }}
                className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100"
              >
                {AUDIENCE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {audience === 'NOT_VISITED_BARBER' && (
            <div>
              <label className="text-xs text-zinc-400 font-medium">Barber</label>
              <select
                value={barberId}
                onChange={e => { setBarberId(e.target.value); setPreviewCount(null) }}
                className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100"
              >
                <option value="">Select barber...</option>
                {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          {audience === 'USED_SERVICE' && (
            <div>
              <label className="text-xs text-zinc-400 font-medium">Service</label>
              <select
                value={serviceId}
                onChange={e => { setServiceId(e.target.value); setPreviewCount(null) }}
                className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100"
              >
                <option value="">Select service...</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-zinc-400 font-medium">Subject</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="We haven't seen you in a while!"
              className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 font-medium">Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Book your next cut and get 10% off..."
              rows={3}
              className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 resize-none"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handlePreview}
              disabled={previewing}
              variant="outline"
              size="sm"
              className="bg-zinc-900 border-zinc-800 text-zinc-300"
            >
              {previewing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Eye className="w-3.5 h-3.5 mr-1.5" />}
              Preview Audience
            </Button>
            {previewCount !== null && (
              <span className="text-xs text-amber-400 font-medium flex items-center gap-1">
                <Users className="w-3.5 h-3.5" /> {previewCount} customer{previewCount !== 1 ? 's' : ''} match
              </span>
            )}
            <div className="flex-1" />
            <Button
              onClick={handleCreate}
              disabled={creating || !name || !subject || !body}
              size="sm"
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Save Campaign
            </Button>
          </div>
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-12 text-center">
          <Megaphone className="w-10 h-10 mx-auto text-zinc-700 mb-3" />
          <p className="text-sm text-zinc-400 font-medium">No campaigns yet</p>
          <p className="text-xs text-zinc-500 mt-1">Create your first campaign to re-engage customers.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <div key={c.id} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-100">{c.name}</h3>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      c.status === 'SENT'
                        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                        : 'text-zinc-400 bg-zinc-800/60 border-zinc-700'
                    }`}>
                      {c.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{c.subject}</p>
                  <p className="text-xs text-zinc-400 mt-2">{c.body}</p>
                  <div className="flex items-center gap-3 mt-3 text-[11px] text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" /> {AUDIENCE_OPTIONS.find(a => a.value === c.audience)?.label || c.audience}
                    </span>
                    {c.recipientCount != null && (
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> {c.recipientCount} sent
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {new Date(c.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {isOwner && c.status === 'DRAFT' && (
                  <Button
                    onClick={() => handleSend(c.id)}
                    disabled={sendingId === c.id}
                    size="sm"
                    className="bg-amber-500 hover:bg-amber-600 text-black font-semibold shrink-0"
                  >
                    {sendingId === c.id ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Sending...</>
                    ) : (
                      <><Send className="w-3.5 h-3.5 mr-1.5" />Send</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
