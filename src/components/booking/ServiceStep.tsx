'use client'

import React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDuration, formatPrice, cn } from '@/lib/utils'
import { Clock, Check, Scissors } from 'lucide-react'

export interface ServiceItem {
  id: string
  name: string
  description?: string | null
  duration: number
  price: number
  isActive?: boolean
}

interface ServiceStepProps {
  services: ServiceItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ServiceStep({ services, selectedId, onSelect }: ServiceStepProps) {
  const activeServices = services.filter((s) => s.isActive !== false)

  if (activeServices.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Scissors className="w-12 h-12 mx-auto text-muted-foreground/70 mb-3" />
        <p>No services currently available for booking.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Select a Service</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose from our haircut and grooming offerings.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {activeServices.map((service) => {
          const isSelected = selectedId === service.id

          return (
            <Card
              key={service.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(service.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(service.id)
                }
              }}
              aria-pressed={isSelected}
              className={cn(
                'relative cursor-pointer transition-all duration-200 p-5 bg-card/70 border-border hover:border-accent/50 hover:bg-card focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:outline-none',
                isSelected &&
                  'border-accent bg-accent/5 ring-1 ring-accent/30 shadow-lg shadow-amber-500/10'
              )}
            >
              {isSelected && (
                <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center">
                  <Check className="w-4 h-4 stroke-[3]" />
                </div>
              )}

              <div className="pr-8">
                <h3 className="text-lg font-semibold text-foreground group-hover:text-accent transition-colors">
                  {service.name}
                </h3>
                {service.description && (
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                    {service.description}
                  </p>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-border/80 flex items-center justify-between">
                <div className="flex items-center text-xs text-muted-foreground gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-accent/80" />
                  <span>{formatDuration(service.duration)}</span>
                </div>
                <Badge variant="outline" className="border-accent/30 text-accent font-semibold text-sm">
                  {formatPrice(service.price)}
                </Badge>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
