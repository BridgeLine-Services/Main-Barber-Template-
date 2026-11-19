/**
 * Where a support answer is allowed to come from (Part 5.1).
 *
 * The rule the directive sets is narrow and worth keeping narrow: a version is only
 * "supported" when an authoritative source said so, and every answer carries the source
 * and the date it was checked. Anything else is `unknown`, and unknown is printed as
 * "Could not check this information." — never as green.
 *
 * This module is pure data plus one pure function, so the reliability screen cannot
 * invent a source and a test can prove each component is pointed at the right one.
 */

import type { MonitoredComponent } from './dependency-monitor'

export interface SupportSource {
  id: string
  /** Named the way an owner would recognise it, not by URL alone. */
  label: string
  url: string
  /** What this source is allowed to answer. */
  answers: string
}

/** The sentence used whenever an answer could not be obtained. Never softened. */
export const UNCHECKED_SENTENCE = 'Could not check this information.'

export const SUPPORT_SOURCES: Record<string, SupportSource> = {
  node: {
    id: 'node',
    label: 'Node.js official release schedule',
    url: 'https://nodejs.org/en/about/previous-releases',
    answers: 'Which Node.js lines are current, in maintenance, or end-of-life, and on what date.',
  },
  next: {
    id: 'next',
    label: 'Next.js support policy and release notes',
    url: 'https://nextjs.org/docs/app/building-your-application/upgrading',
    answers: 'Which Next.js versions receive fixes, and what an upgrade changes.',
  },
  react: {
    id: 'react',
    label: 'React version policy',
    url: 'https://react.dev/versions',
    answers: 'Which React versions are supported and what a major release changes.',
  },
  prisma: {
    id: 'prisma',
    label: 'Database toolkit support and upgrade guide',
    url: 'https://www.prisma.io/docs/orm/more/upgrade-guides',
    answers: 'Which database toolkit versions are supported and what a version change requires.',
  },
  typescript: {
    id: 'typescript',
    label: 'TypeScript release notes',
    url: 'https://www.typescriptlang.org/docs/handbook/release-notes/overview.html',
    answers: 'What each TypeScript release changes, including new type errors.',
  },
  postgres: {
    id: 'postgres',
    label: 'PostgreSQL versioning policy',
    url: 'https://www.postgresql.org/support/versioning/',
    answers: 'How long each PostgreSQL major version receives fixes.',
  },
  npm: {
    id: 'npm',
    label: 'npm registry package metadata',
    url: 'https://registry.npmjs.org/',
    answers: 'The newest published version of a package and when it was published.',
  },
  advisories: {
    id: 'advisories',
    label: 'GitHub Advisory Database',
    url: 'https://github.com/advisories',
    answers: 'Published security advisories for installed packages, with severity.',
  },
}

/** Falls back to the npm registry, which can answer a version question for any package. */
export function sourceFor(component: string): SupportSource {
  const key = String(component ?? '').trim().toLowerCase()
  if (key === 'nodejs' || key === 'node') return SUPPORT_SOURCES.node
  if (key in SUPPORT_SOURCES) return SUPPORT_SOURCES[key]
  if (key === 'dependencies' || key === 'audit') return SUPPORT_SOURCES.advisories
  return SUPPORT_SOURCES.npm
}

/**
 * What changing this component would touch, in the shop's terms. Deliberately specific
 * per component: a generic "may affect your site" sentence is not a compatibility note.
 */
const COMPATIBILITY: Record<string, string> = {
  node: 'The runtime every page and background job runs on. A major change can alter how the app starts, so it needs a full test run and a rollback plan.',
  next: 'A minor Next.js release can change routing and caching defaults. Booking and payment flows must be re-tested before it is promoted.',
  react: 'React is the interface layer. A major release can change how components render, which is visible to customers immediately.',
  prisma: 'The Prisma client and command line must stay on the same version. Database migrations are never run automatically by an update.',
  typescript: 'A major TypeScript release can surface new type errors, which stop the build. It never changes behaviour at runtime.',
  postgres: 'The database server. A major version change requires a dump and restore, so it is a planned project with a rollback, not a patch.',
  npm: 'A dependency change can affect anything that imports it. The existing test suite is the check that matters.',
  advisories: 'Closing an advisory usually means updating the package that carries it, which brings that package’s own compatibility notes.',
}

const SECURITY: Record<string, string> = {
  supported: 'Security fixes are still being published for this version.',
  unsupported: 'Security fixes have stopped for this version. A known weakness will not be patched.',
  unknown: 'We cannot say whether security fixes are still being published, because the source could not be read.',
}

export type SupportStatus = 'supported' | 'unsupported' | 'unknown'

export interface SupportRecord {
  component: string
  installed: string
  /** The version or line the source recommends, or null when it could not be read. */
  recommended: string | null
  /** Human name of the source, e.g. "Node.js official release schedule". */
  source: string
  sourceUrl: string
  /** ISO timestamp of the check that produced this record. */
  checkedAt: string
  status: SupportStatus
  /** What this means for security, in one sentence. */
  security: string
  /** What changing it would affect, in one sentence. */
  compatibility: string
  /** What to do next, in one sentence. */
  action: string
}

function statusOf(component: MonitoredComponent): SupportStatus {
  if (component.supported === true) return 'supported'
  if (component.supported === false) return 'unsupported'
  return 'unknown'
}

/**
 * Assemble the record the directive requires for every component: component, installed
 * version, recommended version, source, date checked, support status, security and
 * compatibility implications, and the recommended action.
 *
 * A component with no readable support information produces `status: 'unknown'`,
 * `recommended: null` and the explicit "Could not check this information." sentence. It
 * never falls back to "fine".
 */
export function buildSupportRecord(component: MonitoredComponent, checkedAt: string): SupportRecord {
  const source = sourceFor(component.name)
  const status = statusOf(component)
  const recommended = component.latest ?? null
  const compatibility = COMPATIBILITY[source.id] ?? COMPATIBILITY.npm

  let action: string
  if (status === 'unsupported') {
    action = recommended
      ? `Move to ${recommended}, which the source still supports. Treat it as a planned upgrade: test first, then approve.`
      : `Move to a version the source still supports. ${UNCHECKED_SENTENCE} Open the source to confirm which one.`
  } else if (status === 'supported') {
    action = recommended && recommended !== component.installed
      ? `You are supported today. ${recommended} is available; update it in a maintenance window.`
      : 'No action needed.'
  } else {
    action = `${UNCHECKED_SENTENCE} Open the source and confirm the support status before planning any change.`
  }

  return {
    component: component.name,
    installed: component.installed,
    recommended,
    source: source.label,
    sourceUrl: source.url,
    checkedAt,
    status,
    security: SECURITY[status],
    compatibility,
    action,
  }
}

/** For the audit finding, which has no single package to point at. */
export function advisorySupportRecord(checkedAt: string, available: boolean): SupportRecord {
  const source = SUPPORT_SOURCES.advisories
  return {
    component: 'installed packages',
    installed: 'as installed today',
    recommended: null,
    source: source.label,
    sourceUrl: source.url,
    checkedAt,
    status: available ? 'supported' : 'unknown',
    security: available
      ? 'The advisory database answered for every installed package.'
      : `The advisory database did not answer. ${UNCHECKED_SENTENCE}`,
    compatibility: COMPATIBILITY.advisories,
    action: available ? 'No action needed.' : `${UNCHECKED_SENTENCE} Run the check again before assuming the packages are clean.`,
  }
}
