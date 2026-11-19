/**
 * Custom navigation for the public site, approved 2026-11-18.
 *
 * Null means "derive from the enabled sections", which is exactly what every existing
 * site does today, so no site changes behaviour until an owner saves a menu. A stored
 * menu is validated on read as well as on write: a bad row falls back to the derived
 * menu rather than rendering a broken or hostile link.
 */

export interface NavSection {
  key: string
  label: string
  href: string
  enabled: boolean
}

export interface NavItem {
  label: string
  href: string
  visible: boolean
}

export const MAX_NAV_ITEMS = 8
export const MAX_LABEL = 24

export function deriveNav(sections: NavSection[]): NavItem[] {
  return sections.filter((s) => s.enabled).map((s) => ({ label: s.label, href: s.href, visible: true }))
}

/** Same-site paths only. A shop menu that points off-site is a mistake or a compromise. */
export function isSafeHref(href: string): boolean {
  if (!href.startsWith('/')) return false
  if (href.startsWith('//')) return false
  if (/[\s\\]/.test(href)) return false
  if (/^\/\s*javascript:/i.test(href)) return false
  return true
}

export interface NavValidation {
  items: NavItem[]
  rejected: string[]
  ok: boolean
}

export function validateNav(raw: unknown): NavValidation {
  const rejected: string[] = []
  if (!Array.isArray(raw)) return { items: [], rejected: ['Not a list of menu items.'], ok: false }
  if (raw.length > MAX_NAV_ITEMS) return { items: [], rejected: [`At most ${MAX_NAV_ITEMS} menu items.`], ok: false }

  const items: NavItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      rejected.push('A menu item was not readable.')
      continue
    }
    const e = entry as Record<string, unknown>
    const label = typeof e.label === 'string' ? e.label.trim() : ''
    const href = typeof e.href === 'string' ? e.href.trim() : ''
    if (label.length === 0 || label.length > MAX_LABEL) {
      rejected.push(`"${label || 'Untitled'}" needs a name of 1 to ${MAX_LABEL} characters.`)
      continue
    }
    if (!isSafeHref(href)) {
      rejected.push(`"${label}" points somewhere that is not part of your site.`)
      continue
    }
    items.push({ label, href, visible: e.visible !== false })
  }
  return { items, rejected, ok: rejected.length === 0 }
}

export interface ResolveResult {
  items: NavItem[]
  source: 'custom' | 'derived'
  note: string | null
}

export function resolveNav(stored: unknown, sections: NavSection[]): ResolveResult {
  if (stored === null || stored === undefined) {
    return { items: deriveNav(sections), source: 'derived', note: null }
  }
  const checked = validateNav(stored)
  if (!checked.ok) {
    return {
      items: deriveNav(sections),
      source: 'derived',
      note: 'Your saved menu could not be used, so the menu built from your sections is showing instead.',
    }
  }
  const visible = checked.items.filter((i) => i.visible)
  if (visible.length === 0) {
    return { items: deriveNav(sections), source: 'derived', note: 'Every menu item is hidden, so the default menu is showing.' }
  }
  return { items: visible, source: 'custom', note: null }
}
