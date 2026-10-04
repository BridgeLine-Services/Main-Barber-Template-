'use client'

// ─── Quick booking / availability finder (homepage module) ──────────────────
// A premium "find your time" module that connects DIRECTLY into the existing
// booking engine — it never duplicates it:
//   • selections are handed to /book as serviceId / barberId / date params
//   • availability comes from the existing /api/availability endpoint
//   • with JS disabled the form still submits to /book (progressive
//     enhancement — the booking page shows its own calendar)
// All data arrives as props from the server (tenant-scoped queries); this
// component invents nothing.

import { useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'

export interface QuickBookService {
  id: string
  name: string
  durationLabel: string
}

export interface QuickBookBarber {
  id: string
  name: string
}

interface QuickBookSectionProps {
  services: QuickBookService[]
  barbers: QuickBookBarber[]
  buttonShape: string
}

type SlotState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; slots: string[] }
  | { status: 'none' }
  | { status: 'error' }

const BOOKING_WINDOW_DAYS = 30

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function maxDateStr(): string {
  const d = new Date()
  d.setDate(d.getDate() + BOOKING_WINDOW_DAYS)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function QuickBookSection({ services, barbers, buttonShape }: QuickBookSectionProps) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '')
  const [barberId, setBarberId] = useState('any')
  const [date, setDate] = useState(todayStr())
  const [state, setState] = useState<SlotState>({ status: 'idle' })
  const [liveBarberId, setLiveBarberId] = useState('any')

  // Everything the booking page needs as query params — the single handoff
  // point into the existing flow.
  const bookHref = (chosenDate: string, chosenBarber: string, chosenTime?: string) =>
    `/book?serviceId=${encodeURIComponent(serviceId)}${chosenBarber !== 'any' ? `&barberId=${encodeURIComponent(chosenBarber)}` : ''}&date=${encodeURIComponent(chosenDate)}${chosenTime ? `&time=${encodeURIComponent(chosenTime)}` : ''}`

  const findTimes = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!serviceId || !date) return
    setState({ status: 'loading' })
    setLiveBarberId(barberId)
    try {
      const params = new URLSearchParams({ serviceId, date })
      if (barberId === 'any') params.set('any', 'true')
      else params.set('barberId', barberId)
      const res = await fetch(`/api/availability?${params.toString()}`)
      if (!res.ok) throw new Error('availability failed')
      const data = await res.json()
      const slots: string[] = Array.isArray(data.slots)
        ? data.slots.filter((t: unknown): t is string => typeof t === 'string')
        : []
      setState(slots.length > 0 ? { status: 'ready', slots } : { status: 'none' })
    } catch {
      setState({ status: 'error' })
    }
  }

  const selectClass =
    'w-full min-h-11 rounded-md border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:border-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const labelClass =
    'mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground'

  return (
    <section className="visual-quickbook w-full border-y border-border/60 bg-card/40">
      <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 lg:py-16">
        <form
          action="/book"
          method="get"
          onSubmit={findTimes}
          className="quickbook-panel rounded-lg border border-border/70 bg-card/80 p-5 shadow-sm sm:p-7"
          aria-label="Find an available time"
        >
          {/* No-JS path: plain named inputs submit straight to /book */}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.8fr_auto] lg:items-end lg:gap-4">
            <div>
              <label htmlFor="qb-service" className={labelClass}>
                Service
              </label>
              <select
                id="qb-service"
                name="serviceId"
                value={serviceId}
                onChange={(e) => {
                  setServiceId(e.target.value)
                  setState({ status: 'idle' })
                }}
                required
                className={selectClass}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.durationLabel}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="qb-barber" className={labelClass}>
                Barber
              </label>
              <select
                id="qb-barber"
                name="barberId"
                value={barberId}
                onChange={(e) => {
                  setBarberId(e.target.value)
                  setState({ status: 'idle' })
                }}
                className={selectClass}
              >
                <option value="any">First available</option>
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="qb-date" className={labelClass}>
                Date
              </label>
              <input
                id="qb-date"
                name="date"
                type="date"
                value={date}
                min={todayStr()}
                max={maxDateStr()}
                onChange={(e) => {
                  setDate(e.target.value)
                  setState({ status: 'idle' })
                }}
                required
                className={selectClass}
              />
            </div>

            <button
              type="submit"
              disabled={state.status === 'loading'}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-6 py-3 text-sm font-semibold tracking-wide text-accent-foreground transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 ${buttonShape}`}
            >
              {state.status === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Clock className="h-4 w-4" aria-hidden="true" />
              )}
              See Available Times
            </button>
          </div>

          {/* Results — real slots from the existing availability engine */}
          <div aria-live="polite">
            {state.status === 'ready' && (
              <div className="mt-6 border-t border-border/60 pt-5">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Open times
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {state.slots.map((slot) => (
                    <a
                      key={slot}
                      href={bookHref(date, liveBarberId, slot)}
                      className="inline-flex min-h-10 items-center rounded-md border border-border/70 bg-card px-4 py-2 text-sm font-medium tabular-nums text-foreground transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {slot}
                    </a>
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Pick a time to finish booking — details and confirmation on the next step.
                </p>
              </div>
            )}

            {state.status === 'none' && (
              <div className="mt-6 border-t border-border/60 pt-5">
                <p className="text-sm text-muted-foreground">
                  No openings that day.{' '}
                  <a
                    href={bookHref(date, liveBarberId)}
                    className="font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Check other dates in full booking
                  </a>
                  .
                </p>
              </div>
            )}

            {state.status === 'error' && (
              <div className="mt-6 border-t border-border/60 pt-5">
                <p className="text-sm text-muted-foreground">
                  Couldn&apos;t load times right now.{' '}
                  <a
                    href={bookHref(date, liveBarberId)}
                    className="font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Continue to full booking
                  </a>
                  .
                </p>
              </div>
            )}
          </div>
        </form>
      </div>
    </section>
  )
}
