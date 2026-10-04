'use client'

// Gallery compositions + accessible lightbox for the public gallery.
// All layouts render real published MediaAsset records; the lightbox shows
// each image's caption plus its associated barber / service when set.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Calendar, Scissors, User, X } from 'lucide-react'
import type { GalleryLayout } from '@/lib/visual-config'

export type GalleryImage = {
  id: string
  url: string
  altText?: string | null
  caption?: string | null
  barber?: { id: string; name: string; slug: string | null } | null
  service?: { id: string; name: string } | null
}

type Props = {
  images: GalleryImage[]
  layout: GalleryLayout
  /** Fallback alt text prefix, e.g. the shop name. */
  contextLabel: string
}

/* ── Lightbox ────────────────────────────────────────────────────────────── */

function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: GalleryImage[]
  index: number
  onClose: () => void
  onNavigate: (nextIndex: number) => void
}) {
  const image = images[index]
  const dialogRef = useRef<HTMLDivElement>(null)
  const prevButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && index < images.length - 1) onNavigate(index + 1)
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    prevButtonRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [index, images.length, onClose, onNavigate])

  if (!image) return null

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={image.altText || 'Gallery image enlarged'}
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
    >
      {/* Header: context + close */}
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {index + 1} of {images.length}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-ring"
          aria-label="Close image viewer"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Close
        </button>
      </div>

      {/* Image */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4 sm:p-8">
        {index > 0 && (
          <button
            ref={prevButtonRef}
            type="button"
            onClick={() => onNavigate(index - 1)}
            className="absolute left-3 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-card/80 text-foreground transition-colors hover:bg-accent focus-ring"
            aria-label="Previous image"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt={image.altText || `${contextLabelPlaceholder(image)} gallery photo`}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
        {index < images.length - 1 && (
          <button
            type="button"
            onClick={() => onNavigate(index + 1)}
            className="absolute right-3 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-card/80 text-foreground transition-colors hover:bg-accent focus-ring"
            aria-label="Next image"
          >
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Metadata: caption + associated barber / service */}
      <div className="border-t border-border/60 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {image.caption && (
              <p className="text-sm leading-relaxed text-foreground/80">{image.caption}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {image.barber && `By ${image.barber.name}`}
              {image.barber && image.service && ' · '}
              {image.service && image.service.name}
              {!image.barber && !image.service && 'From our gallery'}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {image.barber?.slug && (
              <Link
                href={`/barbers/${image.barber.slug}`}
                onClick={onClose}
                className="card-cta inline-flex items-center gap-1.5 text-xs font-semibold text-primary focus-ring"
              >
                <User className="h-3.5 w-3.5" aria-hidden="true" />
                {image.barber.name}
              </Link>
            )}
            {image.service && (
              <Link
                href={`/book?serviceId=${image.service.id}${image.barber ? `&barberId=${image.barber.id}` : ''}`}
                onClick={onClose}
                className="card-cta inline-flex items-center gap-1.5 text-xs font-semibold text-primary focus-ring"
              >
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                Book {image.service.name}
              </Link>
            )}
            {image.service && (
              <Link
                href={`/gallery?service=${image.service.id}`}
                onClick={onClose}
                className="card-cta inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground focus-ring"
              >
                <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                More like this
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function contextLabelPlaceholder(image: GalleryImage) {
  return image.barber?.name || 'Shop'
}

/* ── Layouts ─────────────────────────────────────────────────────────────── */

export function GalleryGrid({ images, layout, contextLabel }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const open = useCallback((i: number) => setOpenIndex(i), [])
  const close = useCallback(() => setOpenIndex(null), [])
  const navigate = useCallback((i: number) => setOpenIndex(i), [])

  const altFor = (image: GalleryImage, i: number) =>
    image.altText || `${contextLabel} gallery photo ${i + 1}`

  return (
    <>
      {/* GRID — uniform cards in a 1/2/3-column grid */}
      {layout === 'grid' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              onClick={() => open(i)}
              className="group focus-ring overflow-hidden rounded-xl border border-border/70 bg-card/60 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl hover:shadow-black/20"
              aria-label={`Open image: ${altFor(image, i)}`}
            >
              <div className="aspect-[4/3] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={altFor(image, i)}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover transition-transform duration-slow group-hover:scale-[1.03]"
                />
              </div>
              {image.caption && (
                <p className="px-4 py-3 text-sm leading-6 text-muted-foreground line-clamp-2">{image.caption}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* MASONRY — CSS columns with natural aspect ratios */}
      {layout === 'masonry' && (
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4">
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              onClick={() => open(i)}
              className="group focus-ring block w-full overflow-hidden rounded-xl border border-border/70 bg-card/60 text-left shadow-sm transition-all duration-300 hover:border-accent/40 hover:shadow-xl hover:shadow-black/20"
              aria-label={`Open image: ${altFor(image, i)}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={altFor(image, i)}
                loading="lazy"
                decoding="async"
                className="w-full object-cover transition-transform duration-slow group-hover:scale-[1.02]"
              />
              {image.caption && (
                <p className="px-3 py-2 text-xs leading-5 text-muted-foreground">{image.caption}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* EDITORIAL — alternating feature rows: image and caption side by side */}
      {layout === 'editorial' && (
        <div className="flex flex-col gap-10">
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              onClick={() => open(i)}
              className={`group focus-ring grid gap-4 overflow-hidden rounded-xl border border-border/70 bg-card/60 text-left shadow-sm transition-all duration-300 hover:border-accent/40 hover:shadow-lg sm:grid-cols-2 ${
                i % 2 === 1 ? 'sm:[&>figure]:order-2' : ''
              }`}
              aria-label={`Open image: ${altFor(image, i)}`}
            >
              <figure className="aspect-[4/3] overflow-hidden bg-muted sm:aspect-auto sm:min-h-[16rem]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={altFor(image, i)}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover transition-transform duration-slow group-hover:scale-[1.02]"
                />
              </figure>
              <figcaption className="flex flex-col justify-center gap-2 p-6">
                {image.caption && (
                  <p className="text-sm leading-relaxed text-foreground/80">{image.caption}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {image.barber && `By ${image.barber.name}`}
                  {image.service && image.barber && ' · '}
                  {image.service && image.service.name}
                </p>
              </figcaption>
            </button>
          ))}
        </div>
      )}

      {/* FILMSTRIP — horizontal scrolling strip of poster crops */}
      {layout === 'filmstrip' && (
        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              onClick={() => open(i)}
              className="group focus-ring relative w-64 shrink-0 snap-center overflow-hidden rounded-xl border border-border/70 bg-card/60 text-left shadow-sm transition-all duration-300 hover:border-accent/40 hover:shadow-xl hover:shadow-black/20 sm:w-72"
              aria-label={`Open image: ${altFor(image, i)}`}
            >
              <div className="aspect-[3/4] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={altFor(image, i)}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover transition-transform duration-slow group-hover:scale-[1.03]"
                />
              </div>
              {image.caption && (
                <p className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-background/90 to-transparent px-4 py-3 text-xs text-foreground/90">
                  {image.caption}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {openIndex !== null && (
        <Lightbox images={images} index={openIndex} onClose={close} onNavigate={navigate} />
      )}
    </>
  )
}
