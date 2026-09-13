'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Users, Loader2, Phone, Mail, Clock, CheckCircle, XCircle, Bell, Zap, UserX, Trash2 } from 'lucide-react'
import { computeQueuePositions } from '@/lib/queue'

interface WaitlistEntry {
  isWalkInToday?: boolean
  id: string
  firstName: string
  lastName: string
  phone: string
  email: string
  preferredDate: string
  preferredTimeRange: string | null
  status: string
  notes: string | null
  notifiedAt: string | null
  createdAt: string
  barber?: { name: string } | null
  service?: { name: string; duration: number; price: number } | null
  customer?: { firstName: string; lastName: string; phone: string; email: string } | null
}

const STATUS_STYLES: Record<string, string> = {
  WAITING: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  NOTIFIED: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  BOOKED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  EXPIRED: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  CANCELLED: 'bg-red-500/10 text-red-400 border-red-500/30',
}

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    fetchWaitlist()
  }, [])

  const fetchWaitlist = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/waitlist')
      const data = await res.json()
      setEntries(data.entries || [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  const updateStatus = async (id: string, status: string) => {
    try {
      await fetch('/api/dashboard/waitlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      setEntries(entries.map(e => e.id === id ? { ...e, status } : e))
    } catch {
      // ignore
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const filtered = filter
    ? entries.filter(e => e.status === filter)
    : entries

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Waitlist</h1>
        <p className="text-sm text-zinc-400 mt-1">Customers waiting for a slot to open up.</p>
      </div>

      
      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {['WAITING', 'NOTIFIED', 'BOOKED', 'EXPIRED', 'CANCELLED'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(filter === s ? '' : s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filter === s
                ? STATUS_STYLES[s]
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
            }`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
            {entries.filter(e => e.status === s).length > 0 && (
              <span className="ml-1.5 opacity-60">({entries.filter(e => e.status === s).length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Today's Walk-In Queue — arrival order with operational actions */}
      {(() => {
        const walkIns = entries.filter(e => e.isWalkInToday)
        if (walkIns.length === 0) return null
        const positions = computeQueuePositions(walkIns)
        return (
          <section aria-label="Today's walk-in queue">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-amber-400" />
              <h2 className="text-lg font-semibold text-zinc-100">Today&apos;s Walk-In Queue</h2>
              <span className="text-xs text-zinc-500">
                {walkIns.filter(e => e.status === 'WAITING').length} waiting
              </span>
            </div>
            <div className="space-y-2">
              {walkIns
                .filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED')
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map((entry) => (
                  <Card key={entry.id} className="bg-zinc-900 border-amber-500/20">
                    <CardContent className="p-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400 text-sm font-bold">
                          {positions.get(entry.id) ?? '–'}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-zinc-100 truncate">
                            {entry.firstName} {entry.lastName}
                            {entry.status === 'NOTIFIED' && (
                              <span className="ml-2 text-xs text-amber-400">called</span>
                            )}
                          </p>
                          <p className="text-xs text-zinc-400 truncate">
                            {entry.service?.name} · {formatTime(entry.createdAt)}
                            {entry.barber && ` · wants ${entry.barber.name}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {entry.status === 'WAITING' && (
                          <Button
                            size="sm"
                            onClick={() => updateStatus(entry.id, 'NOTIFIED')}
                            className="bg-amber-500 text-black hover:bg-amber-400 text-xs"
                            aria-label={`Call ${entry.firstName} (next in queue)`}
                          >
                            <Bell className="w-3.5 h-3.5 mr-1" /> Call Next
                          </Button>
                        )}
                        {entry.status === 'NOTIFIED' && (
                          <Button
                            size="sm"
                            onClick={() => updateStatus(entry.id, 'BOOKED')}
                            className="bg-emerald-500 text-black hover:bg-emerald-400 text-xs"
                            aria-label={`Mark ${entry.firstName} as served`}
                          >
                            <CheckCircle className="w-3.5 h-3.5 mr-1" /> Served
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateStatus(entry.id, 'EXPIRED')}
                          className="border-zinc-700 text-zinc-400 hover:text-orange-300 hover:border-orange-700 text-xs"
                          aria-label={`Mark ${entry.firstName} as no-show`}
                          title="No-show"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateStatus(entry.id, 'CANCELLED')}
                          className="border-zinc-700 text-zinc-400 hover:bg-red-950/30 hover:text-red-300 hover:border-red-700 text-xs"
                          aria-label={`Remove ${entry.firstName} from queue`}
                          title="Remove from queue"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </section>
        )
      })()}

      {/* Waitlist entries */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card className="bg-zinc-900 border-zinc-800 p-12 text-center">
            <Users className="w-10 h-10 mx-auto text-zinc-600 mb-3" />
            <p className="text-zinc-400">
              {entries.length === 0 ? 'No waitlist entries yet.' : 'No entries match this filter.'}
            </p>
          </Card>
        ) : (
          filtered.map((entry) => (
            <Card key={entry.id} className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-zinc-100">
                        {entry.firstName} {entry.lastName}
                      </h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${STATUS_STYLES[entry.status] || ''}`}>
                        {entry.status.charAt(0) + entry.status.slice(1).toLowerCase()}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
                      {entry.service && (
                        <span className="flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" />
                          {entry.service.name} · ${entry.service.price}
                        </span>
                      )}
                      {entry.barber && (
                        <span>Barber: {entry.barber.name}</span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDate(entry.preferredDate)}
                      </span>
                      {entry.preferredTimeRange && (
                        <span>· {entry.preferredTimeRange === 'walk-in' ? 'Walk-in' : entry.preferredTimeRange}</span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
                      <a href={`tel:${entry.phone?.replace(/\D/g, "")}`} className="flex items-center gap-1 hover:text-amber-400">
                        <Phone className="w-3.5 h-3.5" /> {entry.phone}
                      </a>
                      <a href={`mailto:${entry.email}`} className="flex items-center gap-1 hover:text-amber-400">
                        <Mail className="w-3.5 h-3.5" /> {entry.email}
                      </a>
                    </div>

                    {entry.notes && (
                      <p className="text-sm text-zinc-500 italic mt-1">"{entry.notes}"</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {entry.status === 'WAITING' && (
                      <Button
                        size="sm"
                        onClick={() => updateStatus(entry.id, 'NOTIFIED')}
                        className="bg-amber-500 text-black hover:bg-amber-400 text-xs"
                      >
                        <Bell className="w-3.5 h-3.5 mr-1" /> Notify
                      </Button>
                    )}
                    {entry.status === 'NOTIFIED' && (
                      <Button
                        size="sm"
                        onClick={() => updateStatus(entry.id, 'BOOKED')}
                        className="bg-emerald-500 text-black hover:bg-emerald-400 text-xs"
                      >
                        <CheckCircle className="w-3.5 h-3.5 mr-1" /> Booked
                      </Button>
                    )}
                    {(entry.status === 'WAITING' || entry.status === 'NOTIFIED') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus(entry.id, 'CANCELLED')}
                        className="border-zinc-700 text-zinc-400 hover:bg-red-950/30 hover:text-red-300 hover:border-red-700 text-xs"
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
