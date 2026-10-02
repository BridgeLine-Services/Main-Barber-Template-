// ─────────────────────────────────────────────────────────────────────────────
// Image-role system
//
// Every image role a shop uses has its own rendering contract: aspect ratio,
// object-fit, priority, and fallback treatment. Role-aware components use
// these defaults so a hero never gets a square crop and a barber portrait
// never gets stretched. Per-asset focal points (MediaAsset.focalX/focalY,
// 0-100 percent) override the default object-position.
// ─────────────────────────────────────────────────────────────────────────────

export type ImageRole =
  | 'hero'
  | 'barber'
  | 'service'
  | 'shop'
  | 'portfolio'
  | 'before-after'

export interface ImageRoleSpec {
  /** Tailwind aspect class for the rendered frame. */
  aspect: string
  /** object-fit for the image inside the frame. */
  fit: 'cover' | 'contain'
  /** Default object-position when no focal point is set on the asset. */
  position: string
  /** Next.js <Image> priority (above-the-fold, LCP-relevant roles only). */
  priority: boolean
  /** Placeholder treatment while loading / when missing. */
  fallback: 'gradient' | 'initial'
  /** Whether a per-asset focal point is applied to object-position. */
  focalAware: boolean
}

export const IMAGE_ROLES: Record<ImageRole, ImageRoleSpec> = {
  hero: {
    aspect: 'aspect-[21/9] lg:aspect-[2/1]',
    fit: 'cover',
    position: 'object-center',
    priority: true,
    fallback: 'gradient',
    focalAware: true,
  },
  barber: {
    aspect: 'aspect-[3/4]',
    fit: 'cover',
    position: 'object-center lg:object-top',
    priority: false,
    fallback: 'initial',
    focalAware: true,
  },
  service: {
    aspect: 'aspect-[4/3]',
    fit: 'cover',
    position: 'object-center',
    priority: false,
    fallback: 'gradient',
    focalAware: true,
  },
  shop: {
    aspect: 'aspect-[16/10]',
    fit: 'cover',
    position: 'object-center',
    priority: false,
    fallback: 'gradient',
    focalAware: true,
  },
  portfolio: {
    aspect: 'aspect-[4/5]',
    fit: 'cover',
    position: 'object-center',
    priority: false,
    fallback: 'initial',
    focalAware: true,
  },
  'before-after': {
    aspect: 'aspect-[4/5] sm:aspect-[3/4]',
    fit: 'cover',
    position: 'object-center',
    priority: false,
    fallback: 'gradient',
    focalAware: true,
  },
}

/**
 * object-position for an asset with optional focal point (percent 0-100).
 * Focal point wins when present; otherwise the role default.
 */
export function objectPositionFor(role: ImageRole, focalX?: number | null, focalY?: number | null): string {
  const spec = IMAGE_ROLES[role]
  if (spec.focalAware && typeof focalX === 'number' && typeof focalY === 'number') {
    const x = Math.min(Math.max(Math.round(focalX), 0), 100)
    const y = Math.min(Math.max(Math.round(focalY), 0), 100)
    return `object-[${x}%_${y}%]`
  }
  return spec.position
}
