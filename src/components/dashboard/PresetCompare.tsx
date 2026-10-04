'use client'

/**
 * PresetCompare — owner-only five-preset comparison (master instruction
 * Priority 1). Renders the SAME real shop data through each preset's
 * default configuration, side by side, so owners can see how Black Label /
 * Barber Heritage / Street Cut / Clean Club / Modern Classic actually
 * differ in composition — not just colors.
 *
 * Internal to the dashboard appearance settings; never public.
 * Data comes from /api/dashboard/appearance/compare (session-scoped,
 * read-only). Nothing is invented: missing content shows honest
 * owner-facing setup prompts.
 */

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PRESET_META } from '@/components/dashboard/AppearanceTab'
import { resolveVisualConfig } from '@/lib/visual-config'
import { VISUAL_STYLES, type VisualStyle } from '@/lib/visual-style'
import { formatPrice } from '@/lib/utils'

type CompareData = {
  shop: {
    name: string
    heroEyebrow: string | null
    heroTitle: string | null
    heroDescription: string | null
    heroImageUrl: string | null
  }
  services: { name: string; price: number; duration: number }[]
  barbers: { name: string; photo: string | null; specialty: string | null }[]
  gallery: { url: string; altText: string | null }[]
}

/* ── One preset's frame: real data through that preset's defaults ──────── */
function PresetFrame({ preset, data, mobile }: { preset: VisualStyle; data: CompareData; mobile: boolean }) {
  const meta = PRESET_META[preset]
  const [bg, accent, surface, light] = meta.swatches
  const resolved = resolveVisualConfig(preset) // preset defaults, no overrides
  const radius = resolved.buttonStyle === 'pill' ? 'rounded-full' : resolved.buttonStyle === 'soft' ? 'rounded-md' : 'rounded-none'
  const imgRadius = resolved.imageShape === 'rounded' ? 'rounded-md' : resolved.imageShape === 'full-bleed' ? 'rounded-none' : 'rounded-sm'
  const heading = resolved.headingFont ?? (preset === 'street-cut' ? 'var(--font-display)' : undefined)
  const hSize = 'text-[13px] sm:text-[15px]'
  const label = 'mb-1 text-[7px] font-semibold uppercase tracking-widest opacity-60'

  const heroTitle = data.shop.heroTitle || data.shop.name
  const heroEyebrow = data.shop.heroEyebrow || meta.blurb.split(',')[0]

  /* hero composition per preset default */
  const hero =
    resolved.heroLayout === 'poster' ? (
      <div className={cn('relative flex min-h-[110px] flex-col justify-end overflow-hidden', imgRadius)} style={{ background: bg }}>
        {data.shop.heroImageUrl && <img src={data.shop.heroImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />}
        <div className="relative p-2.5">
          <p className="text-[7px] font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>{heroEyebrow}</p>
          <p className={cn(hSize, 'font-black uppercase leading-[0.95]')} style={{ color: light, fontFamily: heading }}>{heroTitle}</p>
        </div>
      </div>
    ) : resolved.heroLayout === 'split' ? (
      <div className={cn('grid grid-cols-5 gap-2 overflow-hidden', imgRadius)} style={{ background: surface }}>
        <div className="col-span-3 flex flex-col justify-center gap-1 p-2.5">
          <p className="text-[7px] font-semibold uppercase tracking-widest" style={{ color: accent }}>{heroEyebrow}</p>
          <p className={cn(hSize, 'font-bold leading-tight')} style={{ color: light, fontFamily: heading }}>{heroTitle}</p>
        </div>
        <div className="relative col-span-2 min-h-[110px] overflow-hidden">
          {data.shop.heroImageUrl ? (
            <img src={data.shop.heroImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0" style={{ background: `${accent}22` }} />
          )}
        </div>
      </div>
    ) : (
      <div className={cn('relative flex min-h-[130px] flex-col items-center justify-center overflow-hidden text-center', imgRadius)} style={{ background: bg }}>
        {data.shop.heroImageUrl && <img src={data.shop.heroImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
        <div className="relative p-2.5">
          <p className="text-[7px] font-semibold uppercase tracking-[0.25em]" style={{ color: accent }}>{heroEyebrow}</p>
          <p className={cn(hSize, 'font-semibold leading-tight')} style={{ color: light, fontFamily: heading }}>{heroTitle}</p>
          <span className={cn('mt-2 inline-block px-3 py-1 text-[7px] font-semibold', radius)} style={{ background: accent, color: bg }}>Book</span>
        </div>
      </div>
    )

  /* services per preset default */
  const services =
    data.services.length === 0 ? (
      <p className="text-[7px] italic opacity-50">Add services to preview them here.</p>
    ) : resolved.serviceLayout === 'visual-menu' ? (
      <div className="grid grid-cols-3 gap-1">
        {data.services.map((s) => (
          <div key={s.name} className="overflow-hidden">
            <div className={cn('aspect-[4/3]', imgRadius)} style={{ background: `${accent}33` }} />
            <p className="mt-0.5 truncate text-[6px] font-medium" style={{ color: light }}>{s.name}</p>
            <p className="text-[6px]" style={{ color: accent }}>{formatPrice(s.price)}</p>
          </div>
        ))}
      </div>
    ) : resolved.serviceLayout === 'cards' ? (
      <div className="grid grid-cols-2 gap-1">
        {data.services.map((s) => (
          <div key={s.name} className={cn('p-1', imgRadius)} style={{ background: surface }}>
            <p className="truncate text-[6px] font-semibold" style={{ color: light }}>{s.name}</p>
            <p className="text-[6px]" style={{ color: accent }}>{formatPrice(s.price)}</p>
          </div>
        ))}
      </div>
    ) : (
      <div className="flex flex-col gap-0.5">
        {data.services.map((s) => (
          <div key={s.name} className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[6px] font-medium" style={{ color: light }}>{s.name}</span>
            <span className="h-px flex-1" style={{ background: `${accent}44` }} />
            <span className="text-[6px]" style={{ color: accent }}>{formatPrice(s.price)}</span>
          </div>
        ))}
      </div>
    )

  /* barbers per preset default */
  const team =
    data.barbers.length === 0 ? (
      <p className="text-[7px] italic opacity-50">Add barbers to preview them here.</p>
    ) : resolved.barberLayout === 'portrait-grid' ? (
      <div className={cn('grid gap-1', mobile ? 'grid-cols-3' : 'grid-cols-3')}>
        {data.barbers.map((b) => (
          <div key={b.name}>
            {b.photo ? (
              <img src={b.photo} alt={b.name} className={cn('aspect-[3/4] w-full object-cover', imgRadius)} />
            ) : (
              <div className={cn('flex aspect-[3/4] items-center justify-center', imgRadius)} style={{ background: `${accent}22` }}>
                <span className="text-[8px] font-bold" style={{ color: accent }}>{b.name.slice(0, 1)}</span>
              </div>
            )}
            <p className="mt-0.5 truncate text-center text-[6px]" style={{ color: light }}>{b.name}</p>
          </div>
        ))}
      </div>
    ) : resolved.barberLayout === 'large-profile' ? (
      <div className="flex flex-col gap-1.5">
        {data.barbers.slice(0, 1).map((b) => (
          <div key={b.name} className="flex gap-1.5">
            {b.photo ? (
              <img src={b.photo} alt={b.name} className={cn('aspect-[3/4] w-1/3 shrink-0 object-cover', imgRadius)} />
            ) : (
              <div className={cn('w-1/3 shrink-0', imgRadius)} style={{ background: `${accent}33` }} />
            )}
            <div className="flex flex-col justify-center gap-0.5">
              <span className="text-[8px] font-bold uppercase" style={{ color: light, fontFamily: heading }}>{b.name}</span>
              {b.specialty && <span className="text-[6px]" style={{ color: accent }}>{b.specialty}</span>}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="flex flex-col gap-1">
        {data.barbers.map((b) => (
          <div key={b.name} className="flex items-center gap-1.5 p-1" style={{ background: surface }}>
            {b.photo ? (
              <img src={b.photo} alt={b.name} className={cn('h-7 w-7 shrink-0 object-cover', imgRadius)} />
            ) : (
              <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center', imgRadius)} style={{ background: `${accent}22` }}>
                <span className="text-[7px] font-bold" style={{ color: accent }}>{b.name.slice(0, 1)}</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-[6px] font-semibold" style={{ color: light }}>{b.name}</p>
              {b.specialty && <p className="truncate text-[5px]" style={{ color: accent }}>{b.specialty}</p>}
            </div>
          </div>
        ))}
      </div>
    )

  /* gallery per preset default */
  const gallery =
    data.gallery.length === 0 ? (
      <p className="text-[7px] italic opacity-50">Add gallery photos to preview them here.</p>
    ) : resolved.galleryLayout === 'filmstrip' ? (
      <div className="flex gap-1 overflow-hidden">
        {data.gallery.map((g, i) => (
          <img key={i} src={g.url} alt={g.altText || ''} className={cn('h-9 w-8 shrink-0 object-cover', imgRadius)} />
        ))}
      </div>
    ) : resolved.galleryLayout === 'masonry' ? (
      <div className="grid grid-cols-3 gap-1">
        {data.gallery.slice(0, 3).map((g, i) => (
          <img key={i} src={g.url} alt={g.altText || ''} className={cn('w-full object-cover', imgRadius)} style={{ height: 28 + i * 10 }} />
        ))}
      </div>
    ) : (
      <div className="grid grid-cols-4 gap-1">
        {data.gallery.map((g, i) => (
          <img key={i} src={g.url} alt={g.altText || ''} className={cn('aspect-square w-full object-cover', imgRadius)} />
        ))}
      </div>
    )

  return (
    <div className={cn('overflow-hidden rounded-md border', mobile ? 'mx-auto max-w-[180px]' : '')} style={{ borderColor: `${accent}33`, background: `${bg}11` }} data-visual-style={preset}>
      {/* mini nav — mobile mode honors the preset's mobile nav focus */}
      <div className="flex items-center justify-between border-b p-2" style={{ borderColor: `${accent}22`, background: bg }}>
        <span className="truncate text-[8px] font-bold uppercase tracking-widest" style={{ color: light }}>{data.shop.name}</span>
        <span className={cn('px-2 py-0.5 text-[6px] font-semibold', radius)} style={{ background: accent, color: bg }}>
          {mobile && resolved.mobileNavMode === 'walk-in' ? 'Walk-ins' : 'Book'}
        </span>
      </div>
      <div className="space-y-2.5 p-2.5">
        {hero}
        <div>
          <p className={label} style={{ color: light }}>Services</p>
          {services}
        </div>
        <div>
          <p className={label} style={{ color: light }}>Team</p>
          {team}
        </div>
        <div>
          <p className={label} style={{ color: light }}>Gallery</p>
          {gallery}
        </div>
      </div>
    </div>
  )
}

/* ── The comparison card: every preset, same real data ─────────────────── */
export function PresetCompare() {
  const [data, setData] = useState<CompareData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mobile, setMobile] = useState(false)

  const load = useCallback(() => {
    fetch('/api/dashboard/appearance/compare')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load your shop data'))))
      .then((d: CompareData) => { setData(d); setError(null) })
      .catch(() => setError('Could not load your shop data for the comparison.'))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Compare all styles</span>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={mobile}
            onClick={() => setMobile((m) => !m)}
          >
            {mobile ? 'Mobile view' : 'Desktop view'}
          </Button>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          The same pages rendered with each style&apos;s default layouts, using your real services,
          barbers, and photos. Layouts you override for your chosen style still apply to your site —
          this comparison shows the styles as customers would first experience them.
        </p>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={load}>Retry</Button>
          </div>
        )}
        {!error && !data && <p className="text-sm text-muted-foreground">Loading your shop data…</p>}
        {data && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {VISUAL_STYLES.map((preset) => (
              <div key={preset} className="space-y-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{PRESET_META[preset].blurb.split('.')[0]}</p>
                  <p className="text-xs text-muted-foreground">{PRESET_META[preset].type}</p>
                </div>
                <PresetFrame preset={preset} data={data} mobile={mobile} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
