// ─────────────────────────────────────────────────────────────────────────────
// Unified homepage module system
//
// One validated, per-business configuration controls which homepage
// sections render and in what order, with optional per-module settings.
//
// Owner settings → WebsiteContent.homeModules (draft) → publish snapshot
// → resolveHomeModules() → homepage renderer. The same config powers the
// dashboard module manager.
//
// Backward compatibility: when a business has never saved homeModules,
// the resolver DERIVES the configuration from the legacy show* toggles
// (showServices, showTeam, showReviews, showVisit, showFaq, showFinalCta)
// so existing sites render exactly as before. New modules (before/after,
// social gallery, featured work, shop experience, shop status) default to
// DISABLED, so introducing this system never changes a published site.
// ─────────────────────────────────────────────────────────────────────────────

export const HOME_MODULE_IDS = [
  'hero',
  'shopStatus',
  'featuredWork',
  'services',
  'team',
  'beforeAfter',
  'reviews',
  'socialGallery',
  'shopExperience',
  'visit',
  'finalCta',
] as const

export type HomeModuleId = (typeof HOME_MODULE_IDS)[number]

/** Modules that only ever make sense enabled-at-top; hero cannot be disabled. */
export const ALWAYS_ON_MODULES: readonly HomeModuleId[] = ['hero']

/** Legacy WebsiteContent toggle backing each module (pre-module-system UI). */
export const LEGACY_TOGGLE: Partial<Record<HomeModuleId, string>> = {
  services: 'showServices',
  team: 'showTeam',
  reviews: 'showReviews',
  visit: 'showVisit',
  finalCta: 'showFinalCta',
  // (showFaq drives the standalone /faq page, not a homepage module)
}

export interface SocialGallerySettings {
  /** Display name or social handle (e.g. "@clonecuts"). Bounded, sanitized. */
  handle: string
  /** Validated http(s) URL for the profile link. Empty = no link shown. */
  profileUrl: string
  heading: string
  blurb: string
  /** How many real portfolio images to display (1-12). */
  count: number
  /** Show the follow/profile-link action. */
  followEnabled: boolean
}

export interface ModuleSettings {
  /** Section heading override (bounded; empty = module default). */
  heading: string
  /** Section supporting copy override (bounded; empty = module default). */
  blurb: string
  /** Max items rendered (bounded per module). */
  count: number
  /** Social-gallery-specific settings (validated separately). */
  social?: SocialGallerySettings
}

export interface HomeModule {
  id: HomeModuleId
  enabled: boolean
  settings: ModuleSettings
}

export interface ResolvedHomeModules {
  modules: HomeModule[]
  /** True when derived from legacy toggles (never explicitly saved). */
  fromLegacyDefaults: boolean
}

/** Runtime shape of the stored homeModules JSON (all unknown/optional). */
export interface StoredHomeModules {
  modules?: unknown
}

const MAX_COUNT: Record<HomeModuleId, number> = {
  hero: 1,
  shopStatus: 1,
  featuredWork: 12,
  services: 24,
  team: 24,
  beforeAfter: 6,
  reviews: 12,
  socialGallery: 12,
  shopExperience: 12,
  visit: 1,
  finalCta: 1,
}

const DEFAULT_COUNT: Record<HomeModuleId, number> = {
  hero: 1,
  shopStatus: 1,
  featuredWork: 6,
  services: 12,
  team: 12,
  beforeAfter: 3,
  reviews: 3,
  socialGallery: 6,
  shopExperience: 4,
  visit: 1,
  finalCta: 1,
}

function boundedCount(value: unknown, id: HomeModuleId): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_COUNT[id]
  return Math.min(Math.max(n, 1), MAX_COUNT[id])
}

function boundedString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Safe profile URLs: http(s) only — never javascript:, data:, etc. */
export function isSafeProfileUrl(value: string): boolean {
  if (!value) return true // empty = no link
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function parseSettings(raw: unknown, id: HomeModuleId): ModuleSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const settings: ModuleSettings = {
    heading: boundedString(o.heading, 80),
    blurb: typeof o.blurb === 'string' ? o.blurb.trim().slice(0, 400) : '',
    count: boundedCount(o.count, id),
  }
  if (id === 'socialGallery') {
    const so = o.social && typeof o.social === 'object' && !Array.isArray(o.social) ? (o.social as Record<string, unknown>) : {}
    settings.social = {
      handle: boundedString(so.handle, 40),
      profileUrl: typeof so.profileUrl === 'string' && isSafeProfileUrl(so.profileUrl.trim()) ? so.profileUrl.trim().slice(0, 300) : '',
      heading: boundedString(so.heading, 80),
      blurb: typeof so.blurb === 'string' ? so.blurb.trim().slice(0, 400) : '',
      count: boundedCount(so.count, 'socialGallery'),
      followEnabled: so.followEnabled === true,
    }
  }
  return settings
}

function parseModule(raw: unknown): HomeModule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && (HOME_MODULE_IDS as readonly string[]).includes(o.id) ? (o.id as HomeModuleId) : null
  if (!id) return null
  return {
    id,
    enabled: o.enabled === true,
    settings: parseSettings(o.settings, id),
  }
}

/**
 * Resolve the effective homepage module configuration from a WebsiteContent
 * record (draft fields or published snapshot — both carry homeModules and
 * the legacy show* toggles).
 *
 * Precedence per module: stored entry → legacy show* toggle → default.
 * Render order: stored order first, then any missing modules in their
 * default order appended after (disabled unless a legacy toggle enables
 * them). Hero is always enabled and always first.
 */
export function resolveHomeModules(content: unknown): ResolvedHomeModules {
  const c = (content ?? {}) as {
    homeModules?: unknown
    showServices?: unknown
    showTeam?: unknown
    showReviews?: unknown
    showVisit?: unknown
    showFaq?: unknown
    showFinalCta?: unknown
  }

  const stored =
    c.homeModules && typeof c.homeModules === 'object' && !Array.isArray(c.homeModules)
      ? (c.homeModules as StoredHomeModules)
      : null
  const storedList = Array.isArray(stored?.modules) ? (stored as { modules: unknown[] }).modules : null

  const legacyEnabled = (id: HomeModuleId): boolean => {
    const key = LEGACY_TOGGLE[id]
    if (!key) return true
    const v = (c as Record<string, unknown>)[key]
    return v === undefined ? true : v === true
  }

  const defaultFor = (id: HomeModuleId): HomeModule => ({
    id,
    // New modules default off; legacy modules follow their toggles.
    enabled: id in LEGACY_TOGGLE ? legacyEnabled(id) : false,
    settings: parseSettings(undefined, id),
  })

  if (!storedList) {
    // Never configured: derive everything from the legacy toggles.
    return {
      modules: HOME_MODULE_IDS.map(defaultFor),
      fromLegacyDefaults: true,
    }
  }

  // Normalize the stored list: valid modules in stored order…
  const seen = new Set<HomeModuleId>()
  const modules: HomeModule[] = []
  for (const raw of storedList) {
    const m = parseModule(raw)
    if (!m || seen.has(m.id)) continue
    seen.add(m.id)
    modules.push(m)
  }
  // …then append anything missing in default order (legacy toggles decide
  // enabled for legacy modules; new modules stay off until configured).
  for (const id of HOME_MODULE_IDS) {
    if (!seen.has(id)) {
      const m = defaultFor(id)
      modules.push(m)
    }
  }

  // Hero is structural: always on, always first.
  const hero = modules.find((m) => m.id === 'hero')
  if (hero) {
    hero.enabled = true
    modules.splice(modules.indexOf(hero), 1)
    modules.unshift(hero)
  }

  return { modules, fromLegacyDefaults: false }
}

/**
 * Parse + validate an owner-submitted homeModules configuration for SAVING.
 * Returns only known module ids, deduped, with bounded settings; invalid
 * profile URLs are dropped (never stored). Used by the settings API.
 */
export function validateHomeModulesInput(input: unknown): { homeModules: StoredHomeModules | null } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { homeModules: null }
  const o = input as Record<string, unknown>
  if (!Array.isArray(o.modules)) return { homeModules: null }

  const seen = new Set<HomeModuleId>()
  const modules: HomeModule[] = []
  for (const raw of o.modules) {
    const m = parseModule(raw)
    if (!m || seen.has(m.id)) continue
    seen.add(m.id)
    modules.push(m)
  }
  if (modules.length === 0) return { homeModules: null }
  return { homeModules: { modules: modules as unknown as unknown[] } }
}
