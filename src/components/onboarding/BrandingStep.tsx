'use client'

// Onboarding Step 3 — Branding.
// Configures: logo, primary/accent/secondary colors, theme mode, font family.
//
// All values persist to the authenticated business record via the onboarding
// API. Branding is OPTIONAL — "Skip for now" completes onboarding with the
// template's default styling (the public site fallback).
//
// Storage: logo uploads go through the EXISTING media upload system
// (/api/dashboard/media/upload → MediaAsset pipeline). A logo URL is also
// supported. To plug in a different storage provider later, only the upload
// endpoint's internals need to change — this component just consumes
// { url } responses.

import { useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { generateThemeCSS, FONT_FAMILY_OPTIONS, isValidHexColor, type ThemeSettings } from '@/lib/theme'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Image as ImageIcon,
  Link2,
  Loader2,
  Moon,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

export interface BrandingForm {
  logo: string | null
  primaryColor: string
  accentColor: string
  secondaryColor: string | null
  themeMode: 'dark' | 'light'
  fontFamily: string | null
}

interface BrandingStepProps {
  businessName: string
  initial: BrandingForm
  submitting: boolean
  serverError: string | null
  /** Save the current branding edits (completes onboarding). */
  onSave: (branding: BrandingForm) => void
  /** Complete onboarding WITHOUT applying unsaved edits (branding optional). */
  onSkip: () => void
  onBack: () => void
}

/** Logo value validation: https URL or uploaded asset path. */
function isLogoValueValid(v: string): boolean {
  return /^https?:\/\/.+/.test(v) || v.startsWith('/')
}

export function BrandingStep({
  businessName,
  initial,
  submitting,
  serverError,
  onSave,
  onSkip,
  onBack,
}: BrandingStepProps) {
  const [form, setForm] = useState<BrandingForm>(initial)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const setField = <K extends keyof BrandingForm>(key: K, value: BrandingForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // ─── Logo upload (existing media system) ────────────────────────────────
  const handleFileSelected = async (file: File) => {
    setUploadError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('type', 'LOGO')
      const res = await fetch('/api/dashboard/media/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed')
      }
      setField('logo', data.url)
    } catch (err: any) {
      setUploadError(
        `${err.message}. You can paste a logo URL instead below until file storage is configured.`
      )
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ─── Validation ──────────────────────────────────────────────────────────
  const colorErrors = useMemo(() => {
    const errs: Partial<Record<'primaryColor' | 'accentColor' | 'secondaryColor', string | null>> = {}
    if (!isValidHexColor(form.primaryColor)) errs.primaryColor = 'Use a #rrggbb hex value'
    if (!isValidHexColor(form.accentColor)) errs.accentColor = 'Use a #rrggbb hex value'
    if (form.secondaryColor && !isValidHexColor(form.secondaryColor)) errs.secondaryColor = 'Use a #rrggbb hex value'
    return errs
  }, [form])

  const logoError = form.logo && !isLogoValueValid(form.logo) ? 'Logo must be an https URL or an uploaded file' : null

  const isValid =
    !colorErrors.primaryColor &&
    !colorErrors.accentColor &&
    !colorErrors.secondaryColor &&
    !logoError

  // ─── Live preview (same code path as the public website) ────────────────
  const previewCSS = useMemo(
    () => generateThemeCSS(form as ThemeSettings, '.brand-preview-scope'),
    [form]
  )

  const previewName = businessName || 'Your Shop'

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <style dangerouslySetInnerHTML={{ __html: previewCSS }} />

      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader>
          <CardTitle className="text-zinc-100">Branding</CardTitle>
          <CardDescription>
            Make your shop yours. All of this is optional — skip ahead and the site uses the
            template default look. You can change it anytime in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {serverError && (
            <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              <X className="h-4 w-4 shrink-0" />
              {serverError}
            </div>
          )}

          {/* Logo */}
          <div>
            <div className="text-sm font-medium text-zinc-200 mb-1.5">Logo</div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {/* Current logo preview */}
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 overflow-hidden">
                {form.logo ? (
                   
                  <img src={form.logo} alt="Logo preview" className="h-full w-full object-contain p-1" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-zinc-600" />
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/avif,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleFileSelected(file)
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || submitting}
                    className="border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-1.5" />
                    )}
                    {uploading ? 'Uploading…' : 'Upload image'}
                  </Button>
                  {form.logo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setField('logo', null)}
                      disabled={submitting}
                      className="text-zinc-400 hover:text-red-300 hover:bg-zinc-800"
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" /> Remove
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-l-md border border-r-0 border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-500">
                    <Link2 className="h-4 w-4" />
                  </span>
                  <Input
                    value={form.logo || ''}
                    onChange={(e) => {
                      setField('logo', e.target.value.trim() || null)
                      setUploadError(null)
                    }}
                    placeholder="…or paste a logo URL (https://…)"
                    className={`rounded-l-none bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 ${
                      logoError ? 'border-red-500/70' : ''
                    }`}
                    disabled={uploading || submitting}
                  />
                </div>
                {uploadError && <p className="text-xs text-amber-400">{uploadError}</p>}
                {logoError && <p className="text-xs text-red-400">{logoError}</p>}
              </div>
            </div>
          </div>

          {/* Colors */}
          <div className="grid gap-5 sm:grid-cols-3">
            <ColorField
              label="Primary Color"
              hint="Backgrounds, dark surfaces"
              value={form.primaryColor}
              onChange={(v) => setField('primaryColor', v)}
              error={colorErrors.primaryColor}
              disabled={submitting}
            />
            <ColorField
              label="Accent Color"
              hint="Buttons, highlights"
              value={form.accentColor}
              onChange={(v) => setField('accentColor', v)}
              error={colorErrors.accentColor}
              disabled={submitting}
            />
            <ColorField
              label="Secondary Color"
              hint="Cards, muted surfaces (optional)"
              value={form.secondaryColor || ''}
              onChange={(v) => setField('secondaryColor', v || null)}
              error={colorErrors.secondaryColor}
              disabled={submitting}
              optional
            />
          </div>

          {/* Theme mode */}
          <div>
            <div className="text-sm font-medium text-zinc-200 mb-1.5">Theme Mode</div>
            <div className="inline-flex rounded-md border border-zinc-700 bg-zinc-950 p-1">
              <ThemeModeButton
                active={form.themeMode === 'dark'}
                onClick={() => setField('themeMode', 'dark')}
                icon={<Moon className="h-4 w-4" />}
                label="Dark"
                disabled={submitting}
              />
              <ThemeModeButton
                active={form.themeMode === 'light'}
                onClick={() => setField('themeMode', 'light')}
                icon={<Sun className="h-4 w-4" />}
                label="Light"
                disabled={submitting}
              />
            </div>
          </div>

          {/* Font family */}
          <div>
            <div className="text-sm font-medium text-zinc-200 mb-1.5">Font Family</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <FontOption
                label="Default"
                description="Template font"
                active={!form.fontFamily}
                onClick={() => setField('fontFamily', null)}
                disabled={submitting}
                fontClass="font-sans"
              />
              {FONT_FAMILY_OPTIONS.map((f) => (
                <FontOption
                  key={f.value}
                  label={f.label}
                  description={f.description}
                  active={form.fontFamily === f.value}
                  onClick={() => setField('fontFamily', f.value)}
                  disabled={submitting}
                  fontClass="font-sans"
                />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              disabled={submitting}
              className="text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onSkip}
                disabled={submitting}
                className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              >
                Skip for now
              </Button>
              <Button
                type="button"
                onClick={() => onSave(form)}
                disabled={!isValid || submitting}
                className="bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    Save &amp; Continue <ArrowRight className="h-4 w-4 ml-1.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live preview — generated by the SAME theme code the public site uses */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Live Preview — how your site will look
        </p>
        <div className="brand-preview-scope overflow-hidden rounded-lg border border-zinc-800">
          <div className="px-6 py-8" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {form.logo ? (
                   
                  <img src={form.logo} alt="" className="h-10 w-10 rounded-full object-contain" />
                ) : (
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
                    style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
                  >
                    {(previewName || 'S').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold" style={{ fontFamily: 'var(--font-family)' }}>
                    {previewName}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    Cuts · Fades · Shaves
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
              >
                Book Now
              </button>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              {['Signature Cut', 'Beard Trim'].map((service) => (
                <div
                  key={service}
                  className="rounded-lg p-4"
                  style={{ background: 'var(--card)', color: 'var(--card-foreground)', border: '1px solid var(--border)' }}
                >
                  <p className="text-sm font-medium">{service}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>30 min</span>
                    <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
                      $35
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ColorField({
  label,
  hint,
  value,
  onChange,
  error,
  disabled,
  optional,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  error?: string | null
  disabled?: boolean
  optional?: boolean
}) {
  return (
    <div>
      <div className="text-sm font-medium text-zinc-200 mb-1.5">
        {label} {!optional && <span className="text-red-400">*</span>}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={isValidHexColor(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-11 shrink-0 cursor-pointer rounded border border-zinc-700 bg-zinc-950 p-1"
          aria-label={`${label} picker`}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder={optional ? 'Default' : '#d4af37'}
          maxLength={7}
          disabled={disabled}
          className={`bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 ${
            error ? 'border-red-500/70' : ''
          }`}
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-red-400">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>
      )}
    </div>
  )
}

function ThemeModeButton({
  active,
  onClick,
  icon,
  label,
  disabled,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors ${
        active ? 'bg-amber-500 text-zinc-950 font-medium' : 'text-zinc-400 hover:text-zinc-200'
      } disabled:opacity-50`}
    >
      {icon}
      {label}
    </button>
  )
}

function FontOption({
  label,
  description,
  active,
  onClick,
  disabled,
  fontClass,
}: {
  label: string
  description: string
  active: boolean
  onClick: () => void
  disabled?: boolean
  fontClass?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border p-3 text-left transition-colors disabled:opacity-50 ${
        active
          ? 'border-amber-500 bg-amber-500/10'
          : 'border-zinc-700 bg-zinc-950 hover:border-zinc-600'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium text-zinc-100 ${fontClass}`}>{label}</span>
        {active && <Check className="h-3.5 w-3.5 text-amber-400" />}
      </div>
      <p className="mt-0.5 text-[11px] leading-tight text-zinc-500">{description}</p>
    </button>
  )
}
