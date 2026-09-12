'use client'

import React, { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, cn } from '@/lib/utils'
import { Sparkles, Check, User, Zap, Clock, Loader2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'

export interface BarberItem {
  id: string
  name: string
  photo?: string | null
  specialty?: string | null
  bio?: string | null
  isActive?: boolean
  services?: Array<{ serviceId: string }> | Array<{ service?: { id: string } }>
}

export interface EarliestSlot {
  date: string
  time: string
  barberId: string
  barberName: string
}

interface BarberStepProps {
  barbers: BarberItem[]
  selectedId: string | null
  onSelect: (barberId: string) => void
  onSelectFirstAvailable?: (slot: EarliestSlot) => void
  serviceId?: string | null
}

export function BarberStep({ barbers, selectedId, onSelect, onSelectFirstAvailable, serviceId }: BarberStepProps) {
  const [earliestSlot, setEarliestSlot] = useState<EarliestSlot | null>(null)
  const [loadingEarliest, setLoadingEarliest] = useState(false)

  // Fetch earliest available slot across all barbers (searches next 30 days)
  useEffect(() => {
    if (!serviceId) return

    setLoadingEarliest(true)
    fetch(`/api/availability/earliest?serviceId=${encodeURIComponent(serviceId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.date && data.time) {
          setEarliestSlot({
            date: data.date,
            time: data.time,
            barberId: data.barberId,
            barberName: data.barberName,
          })
        } else {
          setEarliestSlot(null)
        }
      })
      .catch(() => setEarliestSlot(null))
      .finally(() => setLoadingEarliest(false))
  }, [serviceId])

  // Filter barbers client-side based on whether they offer the selected service
  const filteredBarbers = barbers.filter((barber) => {
    if (barber.isActive === false) return false
    if (!serviceId) return true
    if (!barber.services || barber.services.length === 0) return true

    return barber.services.some((s: any) => {
      if (typeof s.serviceId === 'string') return s.serviceId === serviceId
      if (s.service && typeof s.service.id === 'string') return s.service.id === serviceId
      return false
    })
  })

  const handleFirstAvailable = () => {
    if (earliestSlot && onSelectFirstAvailable) {
      onSelectFirstAvailable(earliestSlot)
    } else {
      onSelect('any')
    }
  }

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Select a Barber</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Pick your preferred barber or choose any available team member.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* First Available — earliest slot across all barbers */}
        <Card
          role="button"
          tabIndex={0}
          onClick={handleFirstAvailable}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFirstAvailable() } }}
          aria-pressed={selectedId === 'first-available'}
          className={cn(
            'relative cursor-pointer transition-all duration-200 p-5 bg-card border-amber-500/40 hover:border-accent hover:bg-accent/15 focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:outline-none md:col-span-2',
            selectedId === 'first-available' &&
              'border-amber-500 bg-amber-500/15 ring-1 ring-amber-500/50 shadow-lg shadow-amber-500/20'
          )}
        >
          {selectedId === 'first-available' && (
            <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center">
              <Check className="w-4 h-4 stroke-[3]" />
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-accent/20 border border-amber-500/40 flex items-center justify-center text-accent shrink-0">
              <Zap className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-foreground">First Available</h3>
                <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded bg-accent/20 text-accent border border-accent/30">
                  Earliest
                </span>
              </div>
              {loadingEarliest ? (
                <div className="flex items-center gap-2 mt-1">
                  <Loader2 className="w-3 h-3 text-accent/60 animate-spin" />
                  <p className="text-xs text-muted-foreground">Finding the earliest slot...</p>
                </div>
              ) : earliestSlot ? (
                <p className="text-xs text-foreground/70 mt-1">
                  <span className="text-accent font-semibold">{earliestSlot.time}</span>
                  {' on '}
                  <span className="text-accent font-semibold">
                    {format(parseISO(earliestSlot.date), 'EEE, MMM d')}
                  </span>
                  {' with '}
                  <span className="text-foreground font-medium">{earliestSlot.barberName}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  No availability in the next 30 days.
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* Any Available Barber option */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => onSelect('any')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect('any') } }}
          aria-pressed={selectedId === 'any'}
          className={cn(
            'relative cursor-pointer transition-all duration-200 p-5 bg-card border-accent/30 hover:border-accent hover:bg-card focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:outline-none md:col-span-2',
            selectedId === 'any' &&
              'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40 shadow-lg shadow-amber-500/10'
          )}
        >
          {selectedId === 'any' && (
            <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center">
              <Check className="w-4 h-4 stroke-[3]" />
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-accent/20 border border-amber-500/40 flex items-center justify-center text-accent shrink-0">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-foreground">Any Available Barber</h3>
                <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded bg-accent/20 text-accent border border-accent/30">
                  Flexible
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Show available times across our whole team for maximum schedule flexibility.
              </p>
            </div>
          </div>
        </Card>

        {/* Individual barbers */}
        {filteredBarbers.map((barber) => {
          const isSelected = selectedId === barber.id

          return (
            <Card
              key={barber.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(barber.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(barber.id) } }}
              aria-pressed={isSelected}
              className={cn(
                'relative cursor-pointer transition-all duration-200 p-5 bg-card/70 border-border hover:border-accent/50 hover:bg-card focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:outline-none flex items-center gap-4',
                isSelected &&
                  'border-accent bg-accent/5 ring-1 ring-accent/30 shadow-lg shadow-amber-500/10'
              )}
            >
              {isSelected && (
                <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center">
                  <Check className="w-4 h-4 stroke-[3]" />
                </div>
              )}

              <Avatar className="w-14 h-14 border border-border bg-secondary shrink-0">
                {barber.photo ? (
                  <AvatarImage src={barber.photo} alt={barber.name} className="object-cover" />
                ) : null}
                <AvatarFallback className="bg-amber-500/10 text-accent font-semibold text-base">
                  {getInitials(barber.name)}
                </AvatarFallback>
              </Avatar>

              <div className="pr-6 min-w-0">
                <h3 className="text-base font-semibold text-foreground truncate">{barber.name}</h3>
                {barber.specialty && (
                  <p className="text-xs text-accent/90 font-medium mt-0.5 truncate">
                    {barber.specialty}
                  </p>
                )}
                {barber.bio && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-tight">
                    {barber.bio}
                  </p>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
