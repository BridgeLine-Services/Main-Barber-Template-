'use client'

// ============================================================================
// DASHBOARD PREVIEW — shown inside Appearance settings.
//
// Renders a miniature of the owner dashboard (sidebar + header + content
// card + buttons) styled by the SAME resolver that themes the real dashboard
// (generateDashboardThemeCSS), scoped to '.dash-preview' so previewing a DRAFT
// preset never restyles the live dashboard or leaks to other tenants.
//
// The real dashboard follows the PUBLISHED preset; this preview reflects the
// currently selected DRAFT so owners can see how a preset changes their
// control room BEFORE publishing it.
// ============================================================================

import { useMemo } from 'react'
import { generateDashboardThemeCSS } from '@/lib/dashboard-theme'
import type { VisualStyle } from '@/lib/visual-style'

interface DashboardPreviewProps {
  preset: VisualStyle
  accentColor?: string | null
  fontFamily?: string | null
}

export function DashboardPreview({ preset, accentColor, fontFamily }: DashboardPreviewProps) {
  const css = useMemo(
    () =>
      generateDashboardThemeCSS(
        { visualPreset: preset, accentColor: accentColor ?? null, fontFamily: fontFamily ?? null },
        '.dash-preview',
      ),
    [preset, accentColor, fontFamily],
  )

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="dash-preview overflow-hidden rounded-lg border border-border bg-background text-foreground text-xs">
        <div className="flex">
          {/* Mini sidebar */}
          <div className="hidden w-28 shrink-0 flex-col border-r border-border bg-[var(--dash-surface)] p-2 sm:flex">
            <div className="mb-2 flex items-center gap-1.5">
              <div className="flex h-5 w-5 items-center justify-center rounded bg-[var(--dash-brand-soft)] border border-[var(--dash-brand-border)] text-[var(--dash-brand)] text-[8px] font-bold">
                B
              </div>
              <div className="truncate text-[10px] font-semibold text-foreground [font-family:var(--dash-display-font)]">
                Shop name
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 rounded border border-[var(--dash-brand-border)] bg-[var(--dash-brand-soft)] px-1.5 py-1 font-medium text-foreground">
                <span aria-hidden className="h-2.5 w-0.5 rounded-r bg-[var(--dash-brand)]" />
                Overview
              </div>
              <div className="px-1.5 py-1 text-muted-foreground">Appointments</div>
              <div className="px-1.5 py-1 text-muted-foreground">Services</div>
              <div className="px-1.5 py-1 text-muted-foreground">Customers</div>
            </div>
          </div>

          {/* Mini main area */}
          <div className="min-w-0 flex-1">
            {/* Mini header */}
            <div className="flex items-center justify-between border-b border-border bg-[var(--dash-header)] px-3 py-1.5">
              <span className="truncate text-[10px] font-semibold text-foreground [font-family:var(--dash-display-font)]">
                Shop name
              </span>
              <span className="rounded-full border border-[var(--dash-brand-border)] bg-[var(--dash-brand-soft)] px-1.5 py-0.5 text-[8px] font-semibold text-[var(--dash-brand)] capitalize">
                owner
              </span>
            </div>
            {/* Mini content */}
            <div className="space-y-2 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-foreground">Today&apos;s appointments</span>
                <span className="rounded-full bg-primary px-2 py-0.5 text-[8px] font-medium text-primary-foreground">
                  New booking
                </span>
              </div>
              <div className="rounded border border-border bg-card p-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">9:00 — Fade</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[8px] text-muted-foreground">confirmed</span>
                </div>
                <div className="mt-1.5 space-y-1" aria-hidden>
                  <div className="h-1 rounded bg-muted" style={{ width: '70%' }} />
                  <div className="h-1 rounded bg-muted" style={{ width: '45%' }} />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-muted px-2 py-0.5 text-[8px] text-foreground">Open site</span>
                <span className="text-[8px] text-muted-foreground">Draft saved — publish to go live</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
