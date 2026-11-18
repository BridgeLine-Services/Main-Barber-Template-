/**
 * SEO health report: what is missing, in an owner's words.
 *
 * Part 6.3 of the program asks for an understandable report. Two rules govern
 * this module and both are enforced by tests:
 *
 *   1. It never invents anything. Every finding is computed from records the
 *      business actually has. Nothing is scored, guessed or benchmarked against
 *      another shop, and no ranking is ever promised.
 *   2. It never blocks. Findings are advisory: a missing description does not
 *      stop a website working, it only costs a little search visibility, and the
 *      wording says exactly that.
 *
 * Pure module: takes data in, returns findings. No database, no fetch, no React.
 * The caller decides how to display it.
 */

export type SeoIssueId =
  | 'missing-title'
  | 'missing-description'
  | 'title-too-long'
  | 'description-too-long'
  | 'missing-phone'
  | 'missing-address'
  | 'missing-hours'
  | 'no-services'
  | 'service-without-description'
  | 'barber-without-bio'
  | 'no-photos'
  | 'missing-canonical'

export type SeoIssueSeverity = 'worth-fixing' | 'nice-to-have'

export interface SeoIssue {
  id: SeoIssueId
  /** Short label a non-technical owner can scan. */
  title: string
  /** What it means for the shop, in business language. */
  why: string
  /** The single next action. */
  fix: string
  severity: SeoIssueSeverity
}

export interface SeoHealthService {
  name: string
  description?: string | null
}

export interface SeoHealthBarber {
  name: string
  bio?: string | null
  image?: string | null
}

export interface SeoHealthInput {
  /** The computed page title for the public homepage, if any. */
  pageTitle?: string | null
  /** The meta description, if any. */
  description?: string | null
  businessName?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  hours?: Record<string, { open?: string; close?: string; isOff?: boolean }> | null
  services?: SeoHealthService[] | null
  barbers?: SeoHealthBarber[] | null
  /** True when the shop has at least one gallery or portfolio photo. */
  hasPhotos?: boolean
  /** The canonical base URL the site will actually be served from. */
  canonicalBase?: string | null
}

export interface SeoHealthReport {
  /** Plain-language verdict, never a promise about ranking. */
  summary: string
  issues: SeoIssue[]
  /** How many of the checks passed, for an honest progress line. */
  checksPassed: number
  /** How many checks ran in total (passed + failed). */
  checksRun: number
  /** True when nothing is wrong. Never means "you will rank first". */
  isHealthy: boolean
}

const TITLE_MAX = 60
const DESCRIPTION_MIN = 50
const DESCRIPTION_MAX = 160

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hasOpenHours(hours: SeoHealthInput['hours']): boolean {
  if (!hours) return false
  return Object.values(hours).some((d) => d && d.isOff !== true && (text(d.open) || text(d.close)))
}

function isRealBase(value: unknown): boolean {
  const v = text(value)
  if (!v) return false
  if (v.includes('.invalid')) return false
  return /^https?:\/\//i.test(v) && !v.includes('localhost') && !v.includes('127.0.0.1')
}

/**
 * Build the report. Unknown or missing fields produce a finding, never an error.
 */
export function buildSeoHealthReport(input: SeoHealthInput = {}): SeoHealthReport {
  const data = input ?? {}
  const issues: SeoIssue[] = []
  let checksPassed = 0
  let checksRun = 0

  const check = (passes: boolean, issue: SeoIssue) => {
    checksRun += 1
    if (passes) checksPassed += 1
    else issues.push(issue)
  }

  const title = text(data.pageTitle)
  check(Boolean(title), {
    id: 'missing-title',
    title: 'Your homepage has no page title',
    why: 'The page title is the blue line Google shows. Without one, Google picks a line for you, and it is usually the shop name only.',
    fix: 'Add a page title that says what you do and where, for example "Precision fades in Camden".',
    severity: 'worth-fixing',
  })
  if (title) {
    check(title.length <= TITLE_MAX, {
      id: 'title-too-long',
      title: 'Your page title is long enough to be cut off',
      why: 'Search results truncate long titles, so the end of yours may not be shown.',
      fix: `Shorten the title to about ${TITLE_MAX} characters, keeping the most important words first.`,
      severity: 'nice-to-have',
    })
  }

  const description = text(data.description)
  check(description.length >= DESCRIPTION_MIN, {
    id: 'missing-description',
    title: 'Your homepage description is missing or very short',
    why: 'The description is the grey paragraph under the title in search results. A short one gives people little reason to click.',
    fix: 'Write two sentences about who you are, what you cut and where you are.',
    severity: 'worth-fixing',
  })
  if (description.length > DESCRIPTION_MAX) {
    issues.push({
      id: 'description-too-long',
      title: 'Your homepage description is long enough to be trimmed',
      why: 'Search results cut descriptions off after roughly 160 characters.',
      fix: 'Trim the description so the important part comes first.',
      severity: 'nice-to-have',
    })
    checksRun += 1
  } else if (description.length >= DESCRIPTION_MIN) {
    checksRun += 1
    checksPassed += 1
  }

  check(Boolean(text(data.phone)), {
    id: 'missing-phone',
    title: 'No phone number on the business record',
    why: 'Phone numbers appear in your search listing and in the "call" button on a phone. Without one, mobile visitors have to hunt.',
    fix: 'Add the shop phone number in business settings.',
    severity: 'worth-fixing',
  })

  check(Boolean(text(data.address)) || Boolean(text(data.city)), {
    id: 'missing-address',
    title: 'No address or city on the business record',
    why: 'Search engines use the address to show your shop for local searches like "barber near me".',
    fix: 'Add the street address and city in business settings.',
    severity: 'worth-fixing',
  })

  check(hasOpenHours(data.hours), {
    id: 'missing-hours',
    title: 'No opening hours recorded',
    why: 'Opening hours appear in your search listing and tell customers when they can walk in.',
    fix: 'Set your opening hours in business settings.',
    severity: 'nice-to-have',
  })

  const services = Array.isArray(data.services) ? data.services.filter((s) => s && text(s.name)) : []
  check(services.length > 0, {
    id: 'no-services',
    title: 'No services listed',
    why: 'Service names and prices are what people search for, and what search engines can list for you.',
    fix: 'Add at least your main services with prices.',
    severity: 'worth-fixing',
  })
  const thinService = services.find((s) => !text(s.description))
  if (thinService) {
    issues.push({
      id: 'service-without-description',
      title: `"${text(thinService.name)}" has no description`,
      why: 'A one-line description is often what a search engine shows for that service.',
      fix: 'Add a sentence to that service describing what the customer gets.',
      severity: 'nice-to-have',
    })
    checksRun += 1
  } else if (services.length > 0) {
    checksRun += 1
    checksPassed += 1
  }

  const barbers = Array.isArray(data.barbers) ? data.barbers.filter((b) => b && text(b.name)) : []
  const thinBarber = barbers.find((b) => !text(b.bio))
  if (thinBarber) {
    issues.push({
      id: 'barber-without-bio',
      title: `${text(thinBarber.name)} has no profile description`,
      why: 'A barber profile is a page people can find when they search for a name.',
      fix: 'Add a short profile description for that barber.',
      severity: 'nice-to-have',
    })
    checksRun += 1
  } else if (barbers.length > 0) {
    checksRun += 1
    checksPassed += 1
  }

  check(data.hasPhotos === true, {
    id: 'no-photos',
    title: 'No shop or work photos',
    why: 'Photos describe work faster than words, and image searches bring visitors too.',
    fix: 'Add a few photos of finished cuts or the shop itself.',
    severity: 'nice-to-have',
  })

  check(isRealBase(data.canonicalBase), {
    id: 'missing-canonical',
    title: 'The site address used for links is not set',
    why: 'Without a real site address, the links search engines record may point at the wrong place. This is set up once when the site goes live.',
    fix: 'Set the public website address in the environment configuration (owner setup step).',
    severity: 'worth-fixing',
  })

  const worthFixing = issues.filter((i) => i.severity === 'worth-fixing').length
  const niceToHave = issues.length - worthFixing
  const summary = issues.length === 0
    ? 'Your website listing is complete. Nothing is missing from what search engines read. This does not guarantee a ranking; it means nothing is being lost for a fixable reason.'
    : `${worthFixing === 0 ? 'Nothing urgent.' : `${worthFixing} thing${worthFixing === 1 ? '' : 's'} worth fixing.`}${niceToHave ? ` ${niceToHave} improvement${niceToHave === 1 ? '' : 's'} you could make later.` : ''} Your site still works while these are open.`

  return {
    summary,
    issues,
    checksPassed,
    checksRun,
    isHealthy: issues.length === 0,
  }
}

/** Group findings so a screen can show "worth fixing" before "nice to have". */
export function groupSeoIssues(report: SeoHealthReport): { worthFixing: SeoIssue[]; niceToHave: SeoIssue[] } {
  const worthFixing = report.issues.filter((i) => i.severity === 'worth-fixing')
  const niceToHave = report.issues.filter((i) => i.severity !== 'worth-fixing')
  return { worthFixing, niceToHave }
}
