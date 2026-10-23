'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Type } from 'lucide-react'
import { VISUAL_STYLES, VISUAL_STYLE_CONFIG, type VisualStyle } from '@/lib/visual-style'
import { resolveVisualConfig, type VisualOverrideKey } from '@/lib/visual-config'
import { FONT_FAMILY_OPTIONS, mapFontFamily } from '@/lib/theme'

// ─────────────────────────────────────────────────────────────────────────────
// Typography tab — heading and body font overrides for the public website.
//
// Both settings are INDEPENDENT and optional. When unset ('' = Preset
// default) the visual preset's built-in mapping applies — the established
// production default: headings use the preset's display voice (Playfair
// Display serif when no brand font is chosen), body text stays in Inter.
// Only curated, self-hosted font ids are accepted (lib/theme.ts); invalid
// ids safely fall back through the same mapping used by the real site.
//
// Saves as a DRAFT through the normal settings flow; publish makes it live.
// ─────────────────────────────────────────────────────────────────────────────

type WebsiteContentMap = Record<string, unknown>

interface TypographyTabProps {
  websiteContent: WebsiteContentMap
  setWebsiteContent: (next: WebsiteContentMap) => void
}

export function TypographyTab({ websiteContent, setWebsiteContent }: TypographyTabProps) {
  const preset = (typeof websiteContent.visualPreset === 'string' ? websiteContent.visualPreset : '') as VisualStyle | ''
  const overrides = (websiteContent.visualConfig && typeof websiteContent.visualConfig === 'object'
    ? websiteContent.visualConfig
    : {}) as Record<string, string>
  const selectedPreset: VisualStyle = preset && (VISUAL_STYLES as readonly string[]).includes(preset) ? preset : 'modern-classic'
  const resolved = resolveVisualConfig(selectedPreset, overrides)

  const setOverride = (key: VisualOverrideKey, value: string) => {
    const next = { ...overrides }
    if (!value) delete next[key] // '' = follow preset default
    else next[key] = value
    setWebsiteContent({ ...websiteContent, visualConfig: next })
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Type className="h-5 w-5 text-[var(--dash-brand)]" />
          Typography
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <p className="text-sm text-muted-foreground">
          Heading and body fonts for your public website are independent. Leave either on
          <span className="font-semibold text-foreground"> Preset default</span> and the{' '}
          {VISUAL_STYLE_CONFIG[selectedPreset].label} preset&apos;s built-in typography applies — the same
          production defaults every shop gets before choosing. Changes save as a{' '}
          <span className="font-semibold text-foreground">draft</span> and go live when you publish.
        </p>

        {/* ── Font selects ──────────────────────────────────────────── */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">Fonts</h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Optionally override the preset&apos;s fonts. The heading font applies to display
            headings; the body font applies to paragraphs, buttons, and forms.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground/85">Heading font</span>
              <select
                value={overrides.headingFont ?? ''}
                onChange={(e) => setOverride('headingFont' as VisualOverrideKey, e.target.value)}
                className="w-full rounded-md border border-input bg-[var(--dash-surface)] px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
              >
                <option value="">Preset default</option>
                {FONT_FAMILY_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label} — {f.description}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground/85">Body font</span>
              <select
                value={overrides.bodyFont ?? ''}
                onChange={(e) => setOverride('bodyFont' as VisualOverrideKey, e.target.value)}
                className="w-full rounded-md border border-input bg-[var(--dash-surface)] px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
              >
                <option value="">Preset default</option>
                {FONT_FAMILY_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label} — {f.description}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Your dashboard font (Branding &amp; Theme → Font Family) keeps working exactly as before —
            these overrides shape the customer-facing website.
          </p>
        </div>

        {/* ── Live font preview (real font mapping, not a disconnected example) ── */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">Live preview</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Rendered with the exact font mapping the public site uses.
          </p>
          <div className="rounded-lg border border-border bg-[var(--dash-surface)]/50 p-4" aria-hidden="true">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Heading — {resolved.headingFont ? FONT_FAMILY_OPTIONS.find((f) => f.value === resolved.headingFont)?.label : 'Preset default'}
            </p>
            <p
              className="mt-1 text-2xl font-semibold tracking-tight text-foreground"
              style={{ fontFamily: resolved.headingFont ? mapFontFamily(resolved.headingFont) : undefined }}
            >
              Sharp looks, honest craft.
            </p>
            <p className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">
              Body — {resolved.bodyFont ? FONT_FAMILY_OPTIONS.find((f) => f.value === resolved.bodyFont)?.label : 'Preset default'}
            </p>
            <p
              className="mt-1 text-sm text-muted-foreground"
              style={{ fontFamily: resolved.bodyFont ? mapFontFamily(resolved.bodyFont) : undefined }}
            >
              Fades, beard work, and classic cuts — done right, every visit. Book your chair in under a minute.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
