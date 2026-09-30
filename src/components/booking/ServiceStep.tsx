'use client'

import React from 'react'
import { formatDuration, formatPrice, cn } from '@/lib/utils'
import { Clock, Check, Scissors, ArrowRight } from 'lucide-react'

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

// Service selection as an editorial menu — hairline-separated rows with
// large service names, quiet metadata, and an unmistakable selected state.
// A selected service reads as "chosen" through structure (accent bar,
// check mark, tint) — never color alone.
export function ServiceStep({ services, selectedId, onSelect }: ServiceStepProps) {
  const activeServices = services.filter((s) => s.isActive !== false)

  if (activeServices.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Scissors className="w-12 h-12 mx-auto text-muted-foreground/70 mb-3" aria-hidden="true" />
        <p>No services currently available for booking.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <p className="eyebrow-accent mb-3">The Menu</p>
        <h2 className="display-heading text-display-3 text-foreground">Select a Service</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Choose from our haircut and grooming offerings.
        </p>
      </div>

      {/* Editorial service rows — one per hairline. Tap anywhere on a row
          to select it; the row is a single large touch target (44px+). */}
      <ul role="listbox" aria-label="Services" className="border-t border-border/60">
        {activeServices.map((service) => {
          const isSelected = selectedId === service.id

          return (
            <li key={service.id} role="none" className="border-b border-border/60">
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelect(service.id)}
                className={cn(
                  'group relative w-full text-left px-4 sm:px-5 py-5 sm:py-6 -mx-4 sm:-mx-5',
                  'transition-colors duration-micro focus-ring rounded-sm',
                  'hover:bg-primary/[0.04]',
                  isSelected && 'bg-primary/[0.06]'
                )}
              >
                {/* Accent selection bar — structural selected cue */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute left-0 top-3 bottom-3 w-[3px] rounded-full transition-colors duration-micro',
                    isSelected ? 'bg-primary' : 'bg-transparent'
                  )}
                />

                <div className="flex items-start justify-between gap-4 pl-2 sm:pl-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <h3
                        className={cn(
                          'font-display text-xl sm:text-2xl font-semibold tracking-tight transition-colors duration-micro',
                          isSelected ? 'text-foreground' : 'text-foreground/85 group-hover:text-foreground'
                        )}
                      >
                        {service.name}
                      </h3>
                      {isSelected && (
                        <Check
                          className="h-5 w-5 shrink-0 text-primary stroke-[3]"
                          aria-label="Selected"
                        />
                      )}
                    </div>
                    {service.description && (
                      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed line-clamp-2">
                        {service.description}
                      </p>
                    )}
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatDuration(service.duration)}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 self-center">
                    <span className="font-display text-lg sm:text-xl font-bold text-foreground tabular-nums">
                      {formatPrice(service.price)}
                    </span>
                    <ArrowRight
                      className="h-4 w-4 text-muted-foreground/50 transition-all duration-micro group-hover:translate-x-0.5 group-hover:text-primary"
                      aria-hidden="true"
                    />
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
