'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { BarberForm } from '@/components/dashboard/BarberForm'
import { UserCircle, Plus, Edit2, Calendar, CheckCircle2, XCircle, Scissors, Clock, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getInitials } from '@/lib/utils'

interface BarbersClientProps {
  initialBarbers: any[]
}

export function BarbersClient({ initialBarbers }: BarbersClientProps) {
  const router = useRouter()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingBarber, setEditingBarber] = useState<any | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null) // barber id being deleted
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null) // barber pending confirmation

  const handleOpenAdd = () => {
    setEditingBarber(null)
    setIsFormOpen(true)
  }

  const handleOpenEdit = (barber: any) => {
    setEditingBarber(barber)
    setIsFormOpen(true)
  }

  const handleSaved = () => {
    router.refresh()
  }

  const handleToggleActive = async (barber: any) => {
    setLoadingId(barber.id)
    try {
      const res = await fetch(`/api/dashboard/barbers/${barber.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !barber.isActive }),
      })

      if (!res.ok) {
        alert('Failed to update barber status')
        return
      }

      router.refresh()
    } catch (err) {
      console.error(err)
      alert('An error occurred while updating status')
    } finally {
      setLoadingId(null)
    }
  }

  const handleDelete = async (barber: any) => {
    if (deleting) return
    setDeleting(barber.id)
    try {
      const res = await fetch(`/api/dashboard/barbers/${barber.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error || 'Failed to delete barber')
        return
      }
      if (data.deactivated) {
        // Barber had history — server deactivated them instead of deleting
        alert(data.message || `${barber.name} has appointment history, so they were deactivated instead of deleted.`)
      } else if (data.warning) {
        alert(data.warning)
      }
      router.refresh()
    } catch (err) {
      console.error(err)
      alert('An error occurred while deleting this barber')
    } finally {
      setDeleting(null)
      setConfirmDelete(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-serif text-zinc-100 flex items-center gap-2">
            <UserCircle className="w-6 h-6 text-amber-500" />
            <span>Barbers Directory</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Manage shop barbers, staff accounts, profiles, and schedules
          </p>
        </div>

        <Button
          onClick={handleOpenAdd}
          className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs gap-1.5 shadow-lg shadow-amber-500/10 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> Add Barber
        </Button>
      </div>

      {/* Barbers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {initialBarbers.length === 0 ? (
          <div className="col-span-full p-8 text-center text-zinc-500 bg-zinc-950 border border-zinc-800 rounded-2xl">
            No barbers found. Click "Add Barber" to set up your team.
          </div>
        ) : (
          initialBarbers.map((barber) => {
            const apptCount = barber._count?.appointments ?? barber.appointmentsCount ?? 0

            return (
              <div
                key={barber.id}
                className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-4 hover:border-zinc-700 transition-colors group"
              >
                <div className="space-y-4">
                  {/* Avatar & Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {barber.photo ? (
                        <img
                          src={barber.photo}
                          alt={barber.name}
                          className="w-14 h-14 rounded-full object-cover border-2 border-amber-500/30"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-lg font-serif">
                          {getInitials(barber.name)}
                        </div>
                      )}
                      <div>
                        <h2 className="text-base font-bold font-serif text-zinc-100 group-hover:text-amber-400 transition-colors">
                          {barber.name}
                        </h2>
                        <p className="text-xs text-amber-500/90 font-medium">
                          {barber.specialty || 'General Barber'}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleToggleActive(barber)}
                      disabled={loadingId === barber.id}
                      className="focus:outline-none"
                      title="Click to toggle active status"
                    >
                      {barber.isActive ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full hover:bg-emerald-500/20 transition-colors">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-full hover:bg-zinc-800 transition-colors">
                          <XCircle className="w-3 h-3" /> Inactive
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Bio */}
                  {barber.bio && (
                    <p className="text-xs text-zinc-400 line-clamp-2 italic">
                      "{barber.bio}"
                    </p>
                  )}

                  {/* Stats */}
                  <div className="flex items-center justify-between p-3 bg-zinc-900/60 border border-zinc-800/80 rounded-xl text-xs">
                    <span className="text-zinc-400">Total Bookings</span>
                    <span className="font-mono font-bold text-amber-400">{apptCount}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                  <Link
                    href={`/dashboard/schedule?barberId=${barber.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-300 hover:text-amber-400 transition-colors"
                  >
                    <Clock className="w-3.5 h-3.5 text-amber-500" /> Manage Schedule
                  </Link>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(barber)}
                      className="h-8 text-xs text-zinc-400 hover:text-amber-400 hover:bg-zinc-900 gap-1"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit Profile
                    </Button>
                    {confirmDelete?.id === barber.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(barber)}
                          disabled={deleting === barber.id}
                          className="h-8 text-xs gap-1"
                        >
                          {deleting === barber.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm delete'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDelete(null)}
                          className="h-8 text-xs text-zinc-400"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(barber)}
                        className="h-8 text-xs text-zinc-500 hover:text-red-400 hover:bg-zinc-900 gap-1"
                        title="Delete or deactivate this barber"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {isFormOpen && (
        <BarberForm
          barber={editingBarber}
          isOpen={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          onSave={handleSaved}
        />
      )}
    </div>
  )
}
