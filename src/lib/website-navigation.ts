/**
 * Website navigation (Section 8.1 of the platform brief).
 *
 * The schema has stored a custom navigation list since the first version, but nothing
 * ever read it, so an editor would have been decoration. These are the rules: what a
 * link may point at, what a label may say, and how a stored value is read back safely
 * when it may have been written by an older version or by hand.
 */

export interface NavLink {
  label: string
  href: string
  visible: boolean
}

export const NAV_LINK_LIMIT = 12
export const NAV_LABEL_MAX = 32

/** An internal path: one leading slash, never two (which browsers read as a host). */
const INTERNAL = /^\/(?!\/)[A-Za-z0-9\-._~/?#@!$&'()*+,;=%[\]]*$/
/** An absolute web address over https. Plain http is refused: the public site is https. */
const EXTERNAL = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/

export function isSafeNavigationHref(href: string): boolean {
  const value = (href ?? '').trim()
  if (value.length === 0 || value.length > 300) return false
  if (INTERNAL.test(value)) return true
  return EXTERNAL.test(value)
}

export function isInternalNavigationHref(href: string): boolean {
  return INTERNAL.test((href ?? '').trim())
}

/**
 * Read whatever is stored into links, dropping anything unrecognisable. A malformed row
 * must not break the public site, so junk is ignored rather than thrown.
 */
export function parseNavigation(value: unknown): NavLink[] {
  if (!Array.isArray(value)) return []
  const links: NavLink[] = []
  for (const entry of value) {
    if (links.length >= NAV_LINK_LIMIT) break
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    const href = typeof record.href === 'string' ? record.href.trim() : ''
    if (label.length === 0 || href.length === 0) continue
    links.push({ label, href, visible: record.visible !== false })
  }
  return links
}

export interface NavigationValidation {
  valid: boolean
  errors: string[]
}

export function validateNavigation(links: NavLink[]): NavigationValidation {
  const errors: string[] = []
  if (links.length > NAV_LINK_LIMIT) errors.push(`A menu can hold at most ${NAV_LINK_LIMIT} links.`)

  const hrefs = new Set<string>()
  const labels = new Set<string>()
  links.forEach((link, index) => {
    const position = `Link ${index + 1}`
    const label = link.label.trim()
    const href = link.href.trim()
    if (label.length === 0) errors.push(`${position} needs a name.`)
    else if (label.length > NAV_LABEL_MAX) errors.push(`${position} has a name longer than ${NAV_LABEL_MAX} characters.`)
    if (!isSafeNavigationHref(href)) {
      errors.push(`${position} must point at a page on this site (starting with /) or a secure https address.`)
    }
    if (hrefs.has(href.toLowerCase())) errors.push(`${position} points at the same place as an earlier link.`)
    if (labels.has(label.toLowerCase())) errors.push(`${position} repeats an earlier name.`)
    hrefs.add(href.toLowerCase())
    labels.add(label.toLowerCase())
  })

  return { valid: errors.length === 0, errors }
}

export function normaliseNavigation(links: NavLink[]): NavLink[] {
  return links.slice(0, NAV_LINK_LIMIT).map((link) => ({
    label: link.label.trim().slice(0, NAV_LABEL_MAX),
    href: link.href.trim(),
    visible: link.visible !== false,
  }))
}

export function moveNavigationItem(links: NavLink[], index: number, direction: 'up' | 'down'): NavLink[] {
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= links.length || target < 0 || target >= links.length) return links
  const next = links.slice()
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}

/** The links the public site shows: the custom menu when there is one, else the defaults. */
export function visibleNavigation(links: NavLink[]): NavLink[] {
  return links.filter((link) => link.visible !== false)
}

export function describeNavigation(links: NavLink[]): string {
  const shown = visibleNavigation(links).length
  if (links.length === 0) return 'The site uses its standard menu.'
  const hidden = links.length - shown
  const base = `A custom menu of ${shown} ${shown === 1 ? 'link' : 'links'}.`
  return hidden > 0 ? `${base} ${hidden} hidden.` : base
}
