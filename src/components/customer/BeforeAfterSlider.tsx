'use client'

// Customer-facing Before/After comparison slider (gap 2).
//
// Real paired images from the shop's assets, revealed by a draggable
// vertical divider. Pointer (mouse + touch) AND keyboard accessible
// (slider role, arrow/Home/End keys), respects reduced motion, keeps
// both images aligned in one comparison frame, and never lets a drag
// select surrounding content or scroll the page.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focalPositionStyle } from '@/lib/image-roles'

export interface BeforeAfterData {
  id: string
  before: { url: string; alt: string; focalX?: number | null; focalY?: number | null }
  after: { url: string; alt: string; focalX?: number | null; focalY?: number | null }
  caption?: string | null
  details?: string | null
  barberName?: string | null
  barberId?: string | null
  serviceName?: string | null
  serviceId?: string | null
}

type Props = {
  pair: BeforeAfterData
  /** Fallback alt prefix, e.g. the shop name. */
  contextLabel: string
  /** Booking link honoring barber/service attribution. */
  bookHref: string
  bookLabel?: string
  className?: string
}

export function BeforeAfterSlider({ pair, contextLabel, bookHref, bookLabel = 'Book this look', className }: Props) {
  const [position, setPosition] = useState(50) // percent revealed on the "after" side
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const sliderLabelId = useId()

  const updateFromClientX = useCallback((clientX: number) => {
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    if (rect.width === 0) return
    const pct = ((clientX - rect.left) / rect.width) * 100
    setPosition(Math.min(Math.max(pct, 0), 100))
  }, [])

  // Pointer events cover mouse + touch in one code path; `touch-action`
  // none on the handle keeps drags from scrolling the page.
  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      e.preventDefault()
      updateFromClientX(e.clientX)
    }
    const up = () => setDragging(false)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging, updateFromClientX])

  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    // Keyboard alternative to dragging: reveal/hide in 5% steps.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      setPosition((p) => Math.max(p - 5, 0))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      setPosition((p) => Math.min(p + 5, 100))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setPosition(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setPosition(100)
    }
  }

  const beforeAlt = pair.before.alt || `${contextLabel} — before`
  const afterAlt = pair.after.alt || `${contextLabel} — after`

  return (
    <figure className={cn('not-prose', className)}>
      <div
        ref={frameRef}
        className="relative aspect-[3/4] w-full select-none overflow-hidden rounded-lg border border-border/60 bg-muted sm:aspect-[4/5]"
        style={{ touchAction: 'pan-y' }} // frame stays scrollable vertically; the handle opts out
      >
        {/* Both images share the frame (identical crop box), so they stay
            perfectly aligned; only the reveal window differs. Focal framing
            comes from the AFTER asset — the pair must share one crop or the
            comparison illusion breaks. */}
        { }
        <img
          src={pair.after.url}
          alt={afterAlt}
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
          style={focalPositionStyle(pair.after.focalX, pair.after.focalY)}
          loading="lazy"
        />
        {/* BEFORE image clipped to the left of the divider */}
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${position}%` }}>
          { }
          <img
            src={pair.before.url}
            alt={beforeAlt}
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              width: position > 0 ? `${(100 / position) * 100}%` : '100%',
              ...focalPositionStyle(pair.after.focalX, pair.after.focalY),
            }}
            loading="lazy"
          />
        </div>

        {/* Labels */}
        <span
          aria-hidden="true"
          className="absolute left-3 top-3 z-10 rounded-sm bg-foreground/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-background"
        >
          Before
        </span>
        <span
          aria-hidden="true"
          className="absolute right-3 top-3 z-10 rounded-sm bg-accent px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-accent-foreground"
        >
          After
        </span>

        {/* Divider + draggable handle */}
        <div
          className="absolute inset-y-0 z-10"
          style={{ left: `${position}%` }}
        >
          <div className="absolute inset-y-0 -left-px w-0.5 bg-background shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
          <button
            type="button"
            role="slider"
            aria-labelledby={sliderLabelId}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(position)}
            aria-valuetext={`${Math.round(position)}% after image shown`}
            aria-orientation="horizontal"
            onKeyDown={onHandleKeyDown}
            onPointerDown={(e) => {
              e.preventDefault()
              setDragging(true)
              updateFromClientX(e.clientX)
            }}
            className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-full border-2 border-background bg-foreground text-background shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span aria-hidden="true" className="flex items-center gap-0.5 text-xs font-bold">
              <span>◀</span>
              <span>▶</span>
            </span>
          </button>
        </div>
        <span id={sliderLabelId} className="sr-only">
          Before and after comparison — drag or use arrow keys to reveal more of the after image
        </span>
      </div>

      <figcaption className="mt-3 flex flex-col gap-2">
        {(pair.barberName || pair.serviceName || pair.caption || pair.details) && (
          <div>
            {pair.caption && <p className="text-sm font-medium text-foreground">{pair.caption}</p>}
            {pair.details && <p className="text-sm text-muted-foreground">{pair.details}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {pair.barberName && <>Cut by {pair.barberName}{pair.serviceName && ' · '}</>}
              {pair.serviceName && <>{pair.serviceName}</>}
            </p>
          </div>
        )}
        <a
          href={bookHref}
          className="inline-flex w-fit items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
          {bookLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  )
}
