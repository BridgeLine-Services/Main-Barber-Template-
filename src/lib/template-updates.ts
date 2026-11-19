/**
 * The controlled update pathway (Part 8.2), as pure logic.
 *
 * A client copy must never change because the master changed. So the answer to "is there
 * an update?" is not a version number alone: it is a classification of what actually
 * differs, and a decision about who has to say yes before anything is applied.
 *
 * This module decides:
 *  - whether there is anything to do at all,
 *  - which changed files are database migrations (never applied automatically),
 *  - which are security-relevant (they raise the approval bar, not lower it),
 *  - which are dependencies,
 *  - which files a client is likely to have customised, so a merge would conflict,
 *  - the risk level, and the steps in order.
 *
 * It performs no I/O and applies nothing. The script that calls it only reports.
 */

export interface ChangedFile {
  /** Repository-relative path, e.g. "src/proxy.ts". */
  path: string
  status: 'added' | 'modified' | 'removed'
}

export interface VersionStamp {
  version: string
  sourceCommit?: string | null
}

export type UpdateRisk = 'none' | 'low' | 'review' | 'approval'

export interface UpdateAssessment {
  hasUpdate: boolean
  fromVersion: string | null
  toVersion: string | null
  counts: { total: number; added: number; modified: number; removed: number }
  /** Migration files in the update. Never applied automatically. */
  migrations: string[]
  /** Files that change how the site is protected. */
  security: string[]
  /** True when package.json or a lockfile changed. */
  dependencies: boolean
  /** Files a client probably owns, which would need a human merge. */
  conflicts: string[]
  risk: UpdateRisk
  /** What a person should do, in order. */
  steps: string[]
  /** One sentence for an owner. */
  summary: string
}

/** Paths that carry a security decision. A change here always needs a person. */
const SECURITY_PATHS = [
  'src/proxy.ts',
  'src/lib/auth-helpers.ts',
  'src/lib/permissions.ts',
  'src/lib/tenant.ts',
  'src/lib/passwords.ts',
  'src/lib/auth.ts',
  'prisma/rls/',
  'src/lib/rate-limit.ts',
  'src/lib/encryption',
]

/** Files a client installation normally customises. A merge touching these needs care. */
export const DEFAULT_CLIENT_OWNED = [
  '.env',
  '.env.local',
  '.env.production',
  'TEMPLATE-VERSION.json',
  'vercel.json',
  'next.config',
  'config/',
]

const MIGRATION_PREFIX = 'prisma/migrations/'
const DEPENDENCY_FILES = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']

function isMigration(path: string): boolean {
  return path.startsWith(MIGRATION_PREFIX)
}

function isSecurity(path: string): boolean {
  return SECURITY_PATHS.some((prefix) => path === prefix || path.startsWith(prefix))
}

function isDependency(path: string): boolean {
  return DEPENDENCY_FILES.includes(path)
}

function isClientOwned(path: string, clientOwned: string[]): boolean {
  return clientOwned.some((entry) => path === entry || path.startsWith(entry))
}

/**
 * Classify an update. `clientOwned` lets an installation declare extra paths it has
 * changed; the defaults cover the files that hold a shop's own configuration.
 */
export function assessUpdate(
  local: VersionStamp | null,
  remote: VersionStamp | null,
  files: ChangedFile[],
  clientOwned: string[] = DEFAULT_CLIENT_OWNED,
): UpdateAssessment {
  const counts = {
    total: files.length,
    added: files.filter((f) => f.status === 'added').length,
    modified: files.filter((f) => f.status === 'modified').length,
    removed: files.filter((f) => f.status === 'removed').length,
  }

  const migrations = files.filter((f) => isMigration(f.path)).map((f) => f.path)
  const security = files.filter((f) => isSecurity(f.path)).map((f) => f.path)
  const dependencies = files.some((f) => isDependency(f.path))
  const conflicts = files.filter((f) => isClientOwned(f.path, clientOwned)).map((f) => f.path)

  const sameVersion = Boolean(local && remote && local.version === remote.version)
  const hasUpdate = files.length > 0 && !sameVersion

  let risk: UpdateRisk = 'none'
  if (hasUpdate) {
    if (migrations.length > 0 || security.length > 0) risk = 'approval'
    else if (dependencies || conflicts.length > 0 || counts.removed > 0) risk = 'review'
    else risk = 'low'
  }

  const steps: string[] = []
  if (!hasUpdate) {
    steps.push('Nothing to do. Your copy is at the same version as the source you checked.')
  } else {
    steps.push(`Read the ${counts.total} changed file${counts.total === 1 ? '' : 's'} listed below.`)
    if (migrations.length > 0) {
      steps.push(
        `Back up the database, then review ${migrations.length} migration${migrations.length === 1 ? '' : 's'} before applying anything. Migrations are never applied automatically.`,
      )
    }
    if (security.length > 0) {
      steps.push(`Review the ${security.length} security file${security.length === 1 ? '' : 's'} with the person responsible for access control.`)
    }
    if (dependencies) steps.push('Run the full test suite after the dependency change, not before.')
    if (conflicts.length > 0) {
      steps.push(`Merge ${conflicts.length} file${conflicts.length === 1 ? '' : 's'} by hand. These are yours to own, not the template's.`)
    }
    steps.push('Apply the change on a branch, run the tests, and only then deploy through your normal process.')
    if (risk === 'approval') steps.push('Get explicit approval before deploying: this update touches the database or the way the site is protected.')
  }

  const summary = !hasUpdate
    ? 'Your copy is up to date with the version you checked.'
    : risk === 'approval'
      ? `An update from ${local?.version ?? 'your version'} to ${remote?.version ?? 'the newer version'} touches ${migrations.length > 0 ? 'your database' : 'how your site is protected'}. It needs approval before it is deployed.`
      : `An update from ${local?.version ?? 'your version'} to ${remote?.version ?? 'the newer version'} is available. ${counts.total} file${counts.total === 1 ? '' : 's'} change, and nothing here is applied for you.`

  return {
    hasUpdate,
    fromVersion: local?.version ?? null,
    toVersion: remote?.version ?? null,
    counts,
    migrations,
    security,
    dependencies,
    conflicts,
    risk,
    steps,
    summary,
  }
}
