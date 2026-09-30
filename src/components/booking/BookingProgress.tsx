'use client'

import React from 'react'
import { Check } from 'lucide-react'
import { BOOKING_FLOW_STEPS } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface BookingProgressProps {
  currentStep: number
  totalSteps?: number
  onStepClick?: (step: number) => void
}

// Editorial appointment progression. The current stage is visually dominant
// (accent, weight); completed stages quiet down to checks; upcoming stages
// stay visible but subdued. Completed steps remain clickable for back
// navigation, with visible focus states. No card chrome, no heavy track.
export function BookingProgress({ currentStep, onStepClick }: BookingProgressProps) {
  return (
    <div className="w-full py-4" aria-label={`Step ${currentStep} of ${BOOKING_FLOW_STEPS.length}`}>
      {/* Mobile: compact editorial progress — stage name + thin accent rule */}
      <div className="block md:hidden">
        <div className="flex items-baseline justify-between mb-2.5">
          <p className="text-xs text-muted-foreground">
            <span className="tabular-nums text-muted-foreground/70">
              {String(currentStep).padStart(2, '0')} / {String(BOOKING_FLOW_STEPS.length).padStart(2, '0')}
            </span>
            {'  ·  '}
            <strong className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-primary">
              {BOOKING_FLOW_STEPS[currentStep - 1]?.label}
            </strong>
          </p>
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground/70">
            {Math.round((currentStep / BOOKING_FLOW_STEPS.length) * 100)}%
          </span>
        </div>
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted" role="progressbar">
          <div
            className="h-full bg-primary transition-all duration-ui ease-editorial"
            style={{ width: `${(currentStep / BOOKING_FLOW_STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Desktop: editorial stage list — dominant current, quiet completed */}
      <div className="hidden md:block">
        <nav aria-label="Appointment progress">
          <ol role="list" className="flex items-center justify-between w-full">
            {BOOKING_FLOW_STEPS.map((step, idx) => {
              const isCompleted = currentStep > step.id
              const isCurrent = currentStep === step.id
              const isClickable = onStepClick && step.id < currentStep

              return (
                <li
                  key={step.id}
                  className={cn(
                    'relative flex-1 flex flex-col items-center',
                    idx !== BOOKING_FLOW_STEPS.length - 1 && 'pr-2'
                  )}
                >
                  {/* Hairline connector */}
                  {idx < BOOKING_FLOW_STEPS.length - 1 && (
                    <div
                      className={cn(
                        'absolute top-[7px] left-[calc(50%+22px)] right-[calc(-50%+22px)] h-px transition-colors duration-ui',
                        currentStep > step.id ? 'bg-primary/50' : 'bg-border'
                      )}
                      aria-hidden="true"
                    />
                  )}

                  <button
                    type="button"
                    disabled={!isClickable}
                    onClick={() => isClickable && onStepClick(step.id)}
                    aria-current={isCurrent ? 'step' : undefined}
                    className={cn(
                      'relative z-10 flex flex-col items-center rounded-sm transition-transform duration-micro focus-ring',
                      isClickable && 'cursor-pointer hover:scale-105',
                      !isClickable && 'cursor-default'
                    )}
                  >
                    {/* Stage marker: current is a dominant accent dot;
                        completed a quiet check; upcoming a hollow hairline */}
                    <span
                      className={cn(
                        'flex items-center justify-center rounded-full border transition-all duration-ui',
                        isCurrent && 'h-4 w-4 border-[3px] border-primary bg-background',
                        isCompleted &&
                          'h-4 w-4 border border-primary/60 bg-primary/15 text-primary',
                        !isCompleted && !isCurrent && 'h-4 w-4 border border-border bg-transparent'
                      )}
                    >
                      {isCompleted && <Check className="h-2.5 w-2.5 stroke-[4]" aria-hidden="true" />}
                    </span>
                    <span
                      className={cn(
                        'mt-2.5 text-center transition-colors duration-ui',
                        isCurrent &&
                          'font-display text-sm font-semibold uppercase tracking-[0.1em] text-primary',
                        isCompleted && 'text-xs font-medium text-muted-foreground hover:text-foreground',
                        !isCompleted && !isCurrent && 'text-xs font-medium text-muted-foreground/60'
                      )}
                    >
                      {step.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
      </div>
    </div>
  )
}
