'use client'

import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ChevronDown, ChevronUp, LayoutGrid, Settings2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ALWAYS_ON_MODULES,
  resolveHomeModules,
  isSafeProfileUrl,
  type HomeModule,
  type HomeModuleId,
  type ModuleSettings,
  type StoredHomeModules,
} from '@/lib/home-modules'

// ─────────────────────────────────────────────────────────────────────────────
// Homepage sections manager — owner-facing module system UI.
//
// Controls WHICH sections render on the public homepage and in what ORDER,
// plus bounded per-section settings (heading, blurb, item count; the social
// gallery adds handle / profile link / follow toggle). Saves as a DRAFT via
// the settings save flow; publish makes it live.
//
// Hero is structural: always on, always first (the list reflects that).
// Server-side validation re-checks every bound on save.
// ─────────────────────────────────────────────────────────────────────────────

type WebsiteContentMap = Record<string, unknown>

const MODULE_META: Record<HomeModuleId, { label: string; description: string; hasSettings: boolean }> = {
  hero: {
    label: 'Hero',
    description: 'The top banner with your shop name and booking call-to-action.',
    hasSettings: false,
  },
  shopStatus: {
    label: 'Open/Closed status',
    description: 'A compact strip showing whether the shop is open right now.',
    hasSettings: false,
  },
  featuredWork: {
    label: 'Featured work',
    description: 'An editorial grid of your published portfolio photos.',
    hasSettings: true,
  },
  services: {
    label: 'Services',
    description: 'Your service menu with prices and durations.',
    hasSettings: true,
  },
  team: {
    label: 'Meet the barbers',
    description: 'Portraits and profiles of your barbers.',
    hasSettings: true,
  },
  beforeAfter: {
    label: 'Before & after',
    description: 'Side-by-side transformation sliders from your Before/After manager.',
    hasSettings: true,
  },
  reviews: {
    label: 'Reviews',
    description: 'Featured customer reviews.',
    hasSettings: true,
  },
  socialGallery: {
    label: 'Portfolio gallery strip',
    description: 'A social-style grid of portfolio photos with an optional profile link.',
    hasSettings: true,
  },
  shopExperience: {
    label: 'Inside the shop',
    description: 'Photos of your shop interior (Upload Media → shop photos).',
    hasSettings: true,
  },
  visit: {
    label: 'Location & hours',
    description: 'Address, hours, phone, and the embedded map.',
    hasSettings: true,
  },
  finalCta: {
    label: 'Final call-to-action',
    description: 'The closing booking prompt at the bottom of the page.',
    hasSettings: true,
  },
}

interface HomeModulesCardProps {
  websiteContent: WebsiteContentMap
  setWebsiteContent: (next: WebsiteContentMap) => void
}

export function HomeModulesCard({ websiteContent, setWebsiteContent }: HomeModulesCardProps) {
  // Effective configuration as the public site renders it (stored config →
  // legacy show* toggles → defaults). The owner edits this draft in place.
  const effective = useMemo(() => resolveHomeModules(websiteContent), [websiteContent])
  const [expanded, setExpanded] = useState<HomeModuleId | null>(null)

  const modules: HomeModule[] = effective.modules
  const dirty = !effective.fromLegacyDefaults

  const commit = (next: HomeModule[]) => {
    // Only ever save the full, ordered configuration; server validates bounds.
    setWebsiteContent({ ...websiteContent, homeModules: { modules: next } as StoredHomeModules })
  }

  const setEnabled = (id: HomeModuleId, enabled: boolean) => {
    if (ALWAYS_ON_MODULES.includes(id)) return // hero is structural
    commit(modules.map((m) => (m.id === id ? { ...m, enabled } : m)))
  }

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 1 || target >= modules.length) return // index 0 = hero, locked
    const next = [...modules]
    ;[next[index], next[target]] = [next[target], next[index]]
    commit(next)
  }

  const setSettings = (id: HomeModuleId, patch: Partial<ModuleSettings>) => {
    commit(
      modules.map((m) =>
        m.id === id ? { ...m, settings: { ...m.settings, ...patch } } : m
      )
    )
  }

  const setSocial = (patch: Partial<NonNullable<ModuleSettings['social']>>) => {
    commit(
      modules.map((m) =>
        m.id === 'socialGallery' && m.settings.social
          ? { ...m, settings: { ...m.settings, social: { ...m.settings.social, ...patch } } }
          : m
      )
    )
  }

  const inputClass =
    'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none'

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <LayoutGrid className="h-5 w-5 text-amber-500" aria-hidden="true" />
          Homepage Sections
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-400">
          Choose which sections appear on your homepage and in what order. Changes save as a{' '}
          <span className="font-semibold text-zinc-200">draft</span> and go live when you publish.
          {!dirty && (
            <span className="mt-1 block text-xs text-zinc-500">
              You are currently viewing your site&apos;s existing configuration (derived from the
              legacy section toggles). Any change here replaces it with an explicit section layout.
            </span>
          )}
        </p>

        <ol className="space-y-2" aria-label="Homepage section order">
          {modules.map((m, index) => {
            const meta = MODULE_META[m.id]
            const locked = ALWAYS_ON_MODULES.includes(m.id)
            const isOpen = expanded === m.id
            const canExpand = meta.hasSettings
            return (
              <li
                key={m.id}
                className={cn(
                  'rounded-lg border bg-zinc-950/50',
                  m.enabled ? 'border-zinc-700' : 'border-zinc-800 opacity-70'
                )}
              >
                <div className="flex items-center gap-3 p-3">
                  <span className="w-6 text-center text-xs tabular-nums text-zinc-500" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-100">{meta.label}</span>
                      {locked && (
                        <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                          Always on
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-zinc-500">{meta.description}</p>
                  </div>
                  {canExpand && (
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : m.id)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${meta.label} settings`}
                      className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      <Settings2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index <= 1}
                      aria-label={`Move ${meta.label} up`}
                      className="rounded-sm p-0.5 text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index >= modules.length - 1}
                      aria-label={`Move ${meta.label} down`}
                      className="rounded-sm p-0.5 text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <Switch
                    checked={m.enabled}
                    disabled={locked}
                    onCheckedChange={(checked) => setEnabled(m.id, checked)}
                    aria-label={`Show ${meta.label} on homepage`}
                  />
                </div>

                {canExpand && isOpen && (
                  <div className="space-y-3 border-t border-zinc-800 p-3">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-zinc-300">
                        Heading <span className="text-zinc-500">(optional — leave blank for the default)</span>
                      </span>
                      <Input
                        value={m.settings.heading}
                        maxLength={80}
                        onChange={(e) => setSettings(m.id, { heading: e.target.value })}
                        className={inputClass}
                        placeholder="Default heading"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-zinc-300">
                        Description <span className="text-zinc-500">(optional)</span>
                      </span>
                      <Textarea
                        value={m.settings.blurb}
                        maxLength={400}
                        rows={2}
                        onChange={(e) => setSettings(m.id, { blurb: e.target.value })}
                        className={inputClass}
                        placeholder="Default description"
                      />
                    </label>
                    <label className="block max-w-[12rem]">
                      <span className="mb-1 block text-xs font-medium text-zinc-300">
                        Items to show
                      </span>
                      <Input
                        type="number"
                        min={1}
                        max={12}
                        value={m.settings.count}
                        onChange={(e) => setSettings(m.id, { count: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
                        className={inputClass}
                      />
                    </label>

                    {m.id === 'socialGallery' && m.settings.social && (
                      <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                          Gallery strip options
                        </p>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-zinc-300">
                            Display name / handle
                          </span>
                          <Input
                            value={m.settings.social.handle}
                            maxLength={40}
                            onChange={(e) => setSocial({ handle: e.target.value })}
                            className={inputClass}
                            placeholder="@yourshop"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-zinc-300">
                            Profile link <span className="text-zinc-500">(https://… — blank hides the link)</span>
                          </span>
                          <Input
                            type="url"
                            value={m.settings.social.profileUrl}
                            maxLength={300}
                            onChange={(e) =>
                              setSocial({
                                profileUrl: e.target.value,
                              })
                            }
                            className={cn(inputClass, m.settings.social.profileUrl && !isSafeProfileUrl(m.settings.social.profileUrl) && 'border-red-500')}
                            placeholder="https://instagram.com/yourshop"
                          />
                          {m.settings.social.profileUrl && !isSafeProfileUrl(m.settings.social.profileUrl) && (
                            <span className="mt-1 block text-xs text-red-400">
                              Links must start with http:// or https://.
                            </span>
                          )}
                        </label>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={m.settings.social.followEnabled}
                            onCheckedChange={(checked) => setSocial({ followEnabled: checked })}
                            aria-label="Show profile link button"
                          />
                          <span className="text-xs text-zinc-300">Show the &quot;View profile&quot; link</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>

        <div className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-zinc-400">
            Sections render only when they have content: portfolio sections stay hidden
            until you upload photos (Upload Media), and Before/After needs pairs from the
            Content tab. Reviews show only your featured reviews.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
