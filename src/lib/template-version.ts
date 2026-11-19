/**
 * Which version of the template this installation is running (Part 8.1).
 *
 * One constant, mirrored by `TEMPLATE-VERSION.json` at the repository root. The JSON is
 * what an update check reads from upstream; this constant is what the running app can
 * display without touching the filesystem. A test asserts the two agree, so they cannot
 * drift apart silently.
 *
 * `sourceCommit` is filled by `npm run template:stamp` at release time. Until it is, the
 * value is null and the UI says the release commit is not stamped rather than inventing
 * one.
 */

export interface TemplateVersion {
  template: string
  /** Semantic version of the template itself, not of the customer's site. */
  version: string
  /** ISO date this template version was released. */
  releasedAt: string
  /** Commit this version was cut from, or null when not stamped yet. */
  sourceCommit: string | null
  /** The application version this template version belongs to. */
  compatibleAppVersion: string
  /** Minimum Node.js major version required to run it. */
  requiredNodeMajor: number
  /** How many database migrations this version contains. */
  schemaMigrationCount: number
  notes: string
}

export const TEMPLATE_VERSION: TemplateVersion = {
  template: 'Main Barber Template',
  version: '1.1.0',
  releasedAt: '2026-11-19',
  sourceCommit: null,
  compatibleAppVersion: '1.0.0',
  requiredNodeMajor: 24,
  schemaMigrationCount: 61,
  notes:
    'Business Growth Center (five stages), vendor support sources with checked dates, security sweep, template version identity and controlled update pathway.',
}

/** Plain sentence for an owner who wants to know what they are running. */
export function describeTemplateVersion(version: TemplateVersion = TEMPLATE_VERSION): string {
  const commit = version.sourceCommit ? ` (release ${version.sourceCommit.slice(0, 7)})` : ' (release commit not stamped)'
  return `${version.template} ${version.version}, released ${version.releasedAt}${commit}.`
}

/** True when the running Node.js major is at least the template's requirement. */
export function nodeIsSufficient(nodeVersion: string, required = TEMPLATE_VERSION.requiredNodeMajor): boolean | null {
  const match = /^v?(\d+)/.exec(String(nodeVersion ?? '').trim())
  if (!match) return null
  return Number(match[1]) >= required
}
