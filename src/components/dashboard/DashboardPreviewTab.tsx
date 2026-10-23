'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MonitorSmartphone } from 'lucide-react'
import { VISUAL_STYLES, type VisualStyle } from '@/lib/visual-style'
import { DashboardPreview } from '@/components/dashboard/DashboardPreview'

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Preview tab — how the CURRENT DRAFT brands the management
// dashboard, in its own dedicated section (not buried in Website Appearance).
//
// The preview is scoped ('.dash-preview') by generateDashboardThemeCSS:
// inspecting a draft NEVER restyles the live dashboard, never mutates real
// data, and cannot grant any permission. The real dashboard follows the
// PUBLISHED preset; custom brand colors and font (Branding & Theme) take
// precedence over preset defaults.
// ─────────────────────────────────────────────────────────────────────────────

type WebsiteContentMap = Record<string, unknown>

interface DashboardPreviewTabProps {
  websiteContent: WebsiteContentMap
  /** Saved business branding (Branding & Theme tab) — brand colors win over presets. */
  accentColor?: string | null
  fontFamily?: string | null
  themeMode?: string | null
}

export function DashboardPreviewTab({ websiteContent, accentColor, fontFamily, themeMode }: DashboardPreviewTabProps) {
  const preset = (typeof websiteContent.visualPreset === 'string' ? websiteContent.visualPreset : '') as VisualStyle | ''
  const selectedPreset: VisualStyle = preset && (VISUAL_STYLES as readonly string[]).includes(preset) ? preset : 'modern-classic'

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MonitorSmartphone className="h-5 w-5 text-[var(--dash-brand)]" />
          Dashboard Preview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Your dashboard follows the <span className="font-semibold text-foreground">published</span> preset. This
          shows how the control room&apos;s sidebar, header, buttons and cards will look with the current{' '}
          <span className="font-semibold text-foreground">draft</span> — publishing applies it there too. Your
          custom brand colors and font (Branding &amp; Theme tab) take precedence over preset defaults.
        </p>

        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">Draft dashboard</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            The design your staff and you will manage from, rendered with the same resolver that themes the real
            dashboard. Inspecting it changes nothing.
          </p>
          <DashboardPreview preset={selectedPreset} accentColor={accentColor} fontFamily={fontFamily} themeMode={themeMode} />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          A barber&apos;s dashboard keeps the same design language within their authorized feature set — the preview
          shows styling only; it never grants or changes any real permission, role, or data.
        </p>
      </CardContent>
    </Card>
  )
}
