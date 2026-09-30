'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ServiceForm } from '@/components/dashboard/ServiceForm'
import { Scissors, Plus, Edit2, Trash2, CheckCircle2, XCircle, Clock,Users, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDuration, formatPrice } from '@/lib/utils'

// DTOs produced by the services page (Prisma rows serialized for the client)
interface ServiceBarberRef {
  barberId: string
  serviceId: string
  barberName: string | null
}

interface ServiceRow {
  id: string
  name: string
  description: string | null
  duration: number
  price: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  barbers: ServiceBarberRef[]
}

interface BarberOption {
  id: string
  name: string
  isActive: boolean
}

interface ServicesClientProps {
  initialServices: ServiceRow[]
  barbers: BarberOption[]
}

export function ServicesClient({ initialServices, barbers }: ServicesClientProps) {
  const router = useRouter()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingService, setEditingService] = useState<ServiceRow | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const handleOpenAdd = () => {
    setEditingService(null)
    setIsFormOpen(true)
  }

  const handleOpenEdit = (service: ServiceRow) => {
    setEditingService(service)
    setIsFormOpen(true)
  }

  const handleSaved = () => {
    router.refresh()
  }

  const handleToggleActive = async (service: ServiceRow) => {
    setLoadingId(service.id)
    try {
      const res = await fetch(`/api/dashboard/services/${service.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !service.isActive }),
      })

      if (!res.ok) {
        alert('Failed to update service status')
        return
      }

      router.refresh()
    } catch (err) {
      console.error(err)
      alert('An error occurred while updating service')
    } finally {
      setLoadingId(null)
    }
  }

  const handleDelete = async (service: ServiceRow) => {
    if (!confirm(`Are you sure you want to delete "${service.name}"?`)) return

    setLoadingId(service.id)
    try {
      const res = await fetch(`/api/dashboard/services/${service.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to delete service')
        return
      }

      router.refresh()
    } catch (err) {
      console.error(err)
      alert('An error occurred while deleting service')
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-serif text-zinc-100 flex items-center gap-2">
            <Scissors className="w-6 h-6 text-amber-500" />
            <span>Service Catalog</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Manage haircuts, treatments, pricing, and assigned barbers
          </p>
        </div>

        <Button
          onClick={handleOpenAdd}
          className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs gap-1.5 shadow-lg shadow-amber-500/10 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> Add Service
        </Button>
      </div>

      {/* Services Table */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/80 uppercase font-semibold text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="p-3.5 pl-4">Service Name</th>
                <th className="p-3.5">Duration</th>
                <th className="p-3.5">Price</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Assigned Barbers</th>
                <th className="p-3.5 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {initialServices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-zinc-500">
                    No services found. Click "Add Service" to create your first offering.
                  </td>
                </tr>
              ) : (
                initialServices.map((service) => {
                  const barbersCount = service.barbers?.length || 0
                  const barberNames = service.barbers?.map((b) => b.barberName).filter(Boolean).join(', ')

                  return (
                    <tr key={service.id} className="hover:bg-zinc-900/70 transition-colors">
                      <td className="p-3.5 pl-4">
                        <div className="font-bold text-zinc-100">{service.name}</div>
                        {service.description && (
                          <div className="text-[11px] text-zinc-400 line-clamp-1 max-w-xs mt-0.5">
                            {service.description}
                          </div>
                        )}
                      </td>

                      <td className="p-3.5 font-mono text-zinc-300">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-zinc-500" />
                          {formatDuration(service.duration)}
                        </span>
                      </td>

                      <td className="p-3.5 font-mono font-bold text-amber-400">
                        {formatPrice(service.price)}
                      </td>

                      <td className="p-3.5">
                        <button
                          onClick={() => handleToggleActive(service)}
                          disabled={loadingId === service.id}
                          className="focus:outline-none"
                          title="Click to toggle active state"
                        >
                          {service.isActive ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full hover:bg-emerald-500/20 transition-colors">
                              <CheckCircle2 className="w-3 h-3" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 bg-zinc-900 border border-zinc-800 px-2.5 py-0.5 rounded-full hover:bg-zinc-800 transition-colors">
                              <XCircle className="w-3 h-3" /> Inactive
                            </span>
                          )}
                        </button>
                      </td>

                      <td className="p-3.5 text-zinc-400">
                        <span className="inline-flex items-center gap-1 font-medium text-zinc-300" title={barberNames}>
                          <Users className="w-3 h-3 text-amber-500" />
                          {barbersCount} {barbersCount === 1 ? 'barber' : 'barbers'}
                        </span>
                      </td>

                      <td className="p-3.5 pr-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEdit(service)}
                            className="h-8 w-8 text-zinc-400 hover:text-amber-400 hover:bg-zinc-900"
                            title="Edit Service"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(service)}
                            disabled={loadingId === service.id}
                            className="h-8 w-8 text-zinc-400 hover:text-red-400 hover:bg-red-950/30"
                            title="Delete Service"
                          >
                            {loadingId === service.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isFormOpen && (
        <ServiceForm
          service={editingService}
          barbers={barbers}
          isOpen={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          onSave={handleSaved}
        />
      )}
    </div>
  )
}
