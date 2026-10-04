'use client'

import React, { useEffect, useState } from 'react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, cn } from '@/lib/utils'
import { Sparkles, Check, Zap, Loader2 } from 'lucide-react'
import { rankBarbersForService } from '@/lib/specialty-match'
import { format, parseISO } from 'date-fns'

export interface BarberItem {
  id: string
  name: string
  photo?: string | null
  specialty?: string | null
  bio?: string | null
  isActive?: boolean
  services?: Array<{ serviceId?: string; service?: { id?: string } }>
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
  /**
   * First Available is a RECOMMENDATION, never an auto-selection. The
   * customer explicitly confirms with "Use This Appointment" or keeps
   * browsing with the other two actions.
   */
  onUseFirstAvailable?: (slot: EarliestSlot) => void
  onChooseAnotherDate?: (slot: EarliestSlot) => void
  serviceId?: string | null
  /** Name of the selected service — used for specialty-match ranking. */
  serviceName?: string | null
}

interface FlexRowProps {
  icon: React.ReactNode
  title: string
  badge: string
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}

// Shared presentation for the two schedule-flexibility rows — hoisted to
// module level so no component is created during render (react-compiler
// rule); it renders purely from props.
function FlexRow({ icon, title, badge, selected, onClick, children }: FlexRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      aria-pressed={selected}
      className={cn(
        'group relative cursor-pointer w-full text-left px-4 sm:px-5 py-4 -mx-4 sm:-mx-5',
        'transition-colors duration-micro focus-ring rounded-sm',
        'hover:bg-primary/[0.04]',
        selected && 'bg-primary/[0.06]'
      )}
    >
      {selected && (
        <span aria-hidden="true" className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-primary" />
      )}
      <div className="flex items-center gap-4 pl-2 sm:pl-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors duration-micro',
            selected
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-border bg-secondary/60 text-muted-foreground group-hover:text-primary'
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
            <span className="rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
              {badge}
            </span>
            {selected && <Check className="h-4 w-4 text-primary stroke-[3]" aria-label="Selected" />}
          </div>
          <div className="mt-0.5">{children}</div>
        </div>
      </div>
    </div>
  )
}

// Barber selection as human profiles — hairline-separated editorial rows,
// portrait-forward where photos exist, with specialty/bio where available.
// All selection logic (earliest-slot fetch, service filtering,
// specialty-match ranking) is unchanged from the previous implementation.
export function BarberStep({ barbers, selectedId, onSelect, onUseFirstAvailable, onChooseAnotherDate, serviceId, serviceName }: BarberStepProps) {
  const [earliestSlot, setEarliestSlot] = useState<EarliestSlot | null>(null)
  const [loadingEarliest, setLoadingEarliest] = useState(false)
  const [showSuggestion, setShowSuggestion] = useState(false)

  // Fetch earliest available slot across all barbers (searches next 30 days).
  // Skipped entirely when the "First available" option is disabled for this
  // business (the wizard passes no onSelectFirstAvailable handler).
  useEffect(() => {
    if (!serviceId || !onUseFirstAvailable) return

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
  }, [serviceId, onUseFirstAvailable])

  // Filter barbers client-side based on whether they offer the selected service
  const filteredBarbers = barbers.filter((barber) => {
    if (barber.isActive === false) return false
    if (!serviceId) return true
    if (!barber.services || barber.services.length === 0) return true

    return barber.services.some((s) => {
      if (typeof s.serviceId === 'string') return s.serviceId === serviceId
      if (s.service && typeof s.service.id === 'string') return s.service.id === serviceId
      return false
    })
  })

  return (
    <div>
      <div className="mb-8">
        <p className="eyebrow-accent mb-3">Your Barber</p>
        <h2 className="display-heading text-display-3 text-foreground">Select a Barber</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Pick your preferred barber or choose any available team member.
        </p>
      </div>

      <div className="border-t border-border/60">
        {/* First Available — a RECOMMENDATION, not an auto-selection.
            The row reveals a suggestion card; the customer explicitly picks
            "Use This Appointment" (which they can still edit at Review) or
            keeps browsing barbers/dates themselves.
            Rendered only when the owner allows it (handler passed). */}
        {onUseFirstAvailable && (
          <div className="border-b border-border/60">
            <FlexRow
              icon={<Zap className="h-5 w-5" aria-hidden="true" />}
              title="First Available"
              badge="Suggested"
              selected={showSuggestion}
              onClick={() => setShowSuggestion((v) => !v)}
            >
              {loadingEarliest ? (
                <div className="flex items-center gap-2 mt-1">
                  <Loader2 className="w-3 h-3 text-primary/60 animate-spin" aria-hidden="true" />
                  <p className="text-xs text-muted-foreground">Finding the earliest slot...</p>
                </div>
              ) : earliestSlot ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Earliest opening:{' '}
                  <span className="font-semibold text-primary">
                    {format(parseISO(earliestSlot.date), 'EEE, MMM d')}
                  </span>
                  {' at '}
                  <span className="font-semibold text-primary">{earliestSlot.time}</span>
                  {' with '}
                  <span className="font-medium text-foreground/80">{earliestSlot.barberName}</span>
                  {' — see it as a suggestion, you stay in control.'}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  No availability in the next 30 days.
                </p>
              )}
            </FlexRow>

            {/* Suggestion card — revealed by the customer, never auto-open */}
            {showSuggestion && earliestSlot && (
              <div
                role="group"
                aria-label="First available suggestion"
                className="mx-2 mb-4 rounded-lg border border-primary/30 bg-primary/[0.05] p-4 sm:p-5"
              >
                <p className="eyebrow-accent mb-3">First Available</p>
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <p className="font-display text-lg font-semibold text-foreground">
                      {earliestSlot.barberName}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {format(parseISO(earliestSlot.date), 'EEEE, MMMM d')}
                    </p>
                  </div>
                  <p className="font-display text-2xl font-bold text-foreground tabular-nums">
                    {earliestSlot.time}
                  </p>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Nothing is booked yet. Use this suggestion or keep choosing yourself —
                  you can change anything before confirming.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onUseFirstAvailable(earliestSlot)}
                    className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-ring"
                  >
                    Use This Appointment
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSuggestion(false)}
                    className="inline-flex min-h-10 items-center rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-ring"
                  >
                    Choose Another Barber
                  </button>
                  {onChooseAnotherDate && (
                    <button
                      type="button"
                      onClick={() => onChooseAnotherDate(earliestSlot)}
                      className="inline-flex min-h-10 items-center rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-ring"
                    >
                      Choose Another Date
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Any Available Barber option */}
        <div className="border-b border-border/60">
          <FlexRow
            icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
            title="Any Available Barber"
            badge="Flexible"
            selected={selectedId === 'any'}
            onClick={() => onSelect('any')}
          >
            <p className="text-xs text-muted-foreground mt-1">
              Show available times across our whole team for maximum schedule flexibility.
            </p>
          </FlexRow>
        </div>

        {/* Individual barbers — specialty matches ranked first (data-driven
            from the barber's own specialty text vs. the chosen service name;
            no-match barbers keep the existing `order asc` display order). */}
        {rankBarbersForService(filteredBarbers, serviceName).map(({ barber, match }) => {
          const isSelected = selectedId === barber.id

          return (
            <button
              key={barber.id}
              type="button"
              onClick={() => onSelect(barber.id)}
              aria-pressed={isSelected}
              className={cn(
                'group relative block w-full text-left px-4 sm:px-5 py-5 -mx-4 sm:-mx-5 border-b border-border/60',
                'transition-colors duration-micro focus-ring rounded-sm',
                'hover:bg-primary/[0.04]',
                isSelected && 'bg-primary/[0.06]'
              )}
            >
              {isSelected && (
                <span aria-hidden="true" className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-primary" />
              )}

              <div className="flex items-center gap-4 sm:gap-5 pl-2 sm:pl-3">
                <Avatar
                  className={cn(
                    'h-16 w-16 shrink-0 rounded-lg border transition-all duration-micro',
                    isSelected
                      ? 'border-primary ring-2 ring-primary/25'
                      : 'border-border group-hover:border-primary/40'
                  )}
                >
                  {barber.photo ? (
                    <AvatarImage src={barber.photo} alt={barber.name} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="rounded-lg bg-primary/10 font-display text-lg font-semibold text-primary">
                    {getInitials(barber.name)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <h3 className="font-display text-xl font-semibold tracking-tight text-foreground truncate">
                      {barber.name}
                    </h3>
                    {match.overlap > 0 && (
                      <span className="shrink-0 rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                        Specialty match
                      </span>
                    )}
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-primary stroke-[3]" aria-label="Selected" />}
                  </div>
                  {barber.specialty && (
                    <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-primary">
                      {barber.specialty}
                    </p>
                  )}
                  {barber.bio && (
                    <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed line-clamp-2">
                      {barber.bio}
                    </p>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
