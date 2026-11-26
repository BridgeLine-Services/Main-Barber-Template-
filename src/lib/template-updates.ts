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

/**
 * Section 15 asks for a six-way classification rather than one risk word, and for a change
 * report a person reads before anything is deployed. `assessUpdate` answers "how much does
 * this need signing off"; this layer answers "what is this file, and what do I do with it".
 */
export type ChangeClass = 'safe' | 'review' | 'conflict' | 'migration' | 'security' | 'blocked'

export interface ClassifiedChange {
  path: string
  status: ChangedFile['status']
  changeClass: ChangeClass
  /** Why it landed in that class, in words an owner can act on. */
  why: string
  /** What to do about it. */
  action: string
}

/** Files an update must never overwrite: a shop's own secrets and hosting configuration. */
const NEVER_OVERWRITE = ['.env', 'vercel.json', 'config/', 'TEMPLATE-VERSION.json']

function isNeverOverwritten(path: string): boolean {
  return NEVER_OVERWRITE.some((entry) => path === entry || path.startsWith(entry) || path.startsWith('.env'))
}

/**
 * Classify one changed file. Precedence is deliberate: security outranks everything, a
 * migration outranks a conflict, and a file that must never be overwritten is blocked
 * rather than merely conflicting.
 */
export function classifyChange(file: ChangedFile, clientOwned: string[] = DEFAULT_CLIENT_OWNED): ClassifiedChange {
  const base = { path: file.path, status: file.status }
  if (isSecurity(file.path)) {
    return {
      ...base,
      changeClass: 'security',
      why: 'This file decides how the site is protected.',
      action: 'Read the diff, get explicit approval, then apply it at a maintenance window.',
    }
  }
  if (isMigration(file.path)) {
    return {
      ...base,
      changeClass: 'migration',
      why: 'This changes the database.',
      action: 'Back up first. Never applied automatically; apply it deliberately and verify.',
    }
  }
  if (isNeverOverwritten(file.path)) {
    return {
      ...base,
      changeClass: 'blocked',
      why: 'This holds your own secrets or hosting settings and must not be overwritten.',
      action: 'Do not copy it. Re-apply anything relevant by hand.',
    }
  }
  if (isClientOwned(file.path, clientOwned)) {
    return {
      ...base,
      changeClass: 'conflict',
      why: 'You may have customised this file, so a straight overwrite could lose your work.',
      action: 'Compare both versions and merge by hand.',
    }
  }
  if (file.status === 'removed') {
    return {
      ...base,
      changeClass: 'review',
      why: 'This file is being removed, and something here may still use it.',
      action: 'Check nothing you rely on imports it before accepting the removal.',
    }
  }
  if (isDependency(file.path)) {
    return {
      ...base,
      changeClass: 'review',
      why: 'This changes installed dependencies.',
      action: 'Install, then run the test suite and the build before deploying.',
    }
  }
  return {
    ...base,
    changeClass: 'safe',
    why: 'An ordinary source change with no database, security or configuration effect.',
    action: 'Apply with the rest of the safe changes.',
  }
}

export interface Blocker {
  code: string
  detail: string
}

/**
 * Reasons an update cannot proceed yet, as opposed to reasons it needs approval. A blocker
 * is something only a person can resolve; it is not a risk level.
 */
export function findBlockers(input: {
  local: VersionStamp | null
  remote: VersionStamp | null
  runningNodeMajor: number | null
  requiredNodeMajor?: number | null
  localMigrationCount?: number | null
  remoteMigrationCount?: number | null
}): Blocker[] {
  const blockers: Blocker[] = []
  const { local, remote } = input
  if (!local) {
    blockers.push({ code: 'no-local-version', detail: 'This copy cannot say which version it is running.' })
  }
  if (!remote) {
    blockers.push({ code: 'no-upstream-version', detail: 'The source could not be read, so there is nothing to compare against.' })
  }
  if (local && remote && !local.sourceCommit) {
    blockers.push({ code: 'unstamped-local', detail: 'This copy has no release commit, so the changed files cannot be trusted.' })
  }
  if (local && remote && !remote.sourceCommit) {
    blockers.push({ code: 'unstamped-upstream', detail: 'The upstream release has no commit recorded.' })
  }
  if (input.requiredNodeMajor !== null && input.requiredNodeMajor !== undefined && input.runningNodeMajor !== null) {
    if (input.runningNodeMajor < input.requiredNodeMajor) {
      blockers.push({
        code: 'node-too-old',
        detail: `This update needs Node.js ${input.requiredNodeMajor} or newer; this server runs ${input.runningNodeMajor}.`,
      })
    }
  }
  if (
    typeof input.localMigrationCount === 'number' &&
    typeof input.remoteMigrationCount === 'number' &&
    input.remoteMigrationCount < input.localMigrationCount
  ) {
    blockers.push({
      code: 'schema-ahead',
      detail: 'This copy already has migrations the update does not contain, so it is not a clean forward move.',
    })
  }
  return blockers
}

const CLASS_ORDER: ChangeClass[] = ['blocked', 'security', 'migration', 'conflict', 'review', 'safe']

const CLASS_HEADING: Record<ChangeClass, string> = {
  blocked: 'Do not overwrite (blocked)',
  security: 'Security critical',
  migration: 'Migration required',
  conflict: 'Your customisations (conflict)',
  review: 'Requires review',
  safe: 'Safe',
}

/**
 * The change report an owner reads before deploying. Plain Markdown, no build step, and it
 * lists every changed file under exactly one class so nothing is quietly dropped.
 */
export function renderChangeReport(
  assessment: UpdateAssessment,
  changes: ClassifiedChange[],
  blockers: Blocker[] = [],
): string {
  const lines: string[] = []
  lines.push('# Update change report')
  lines.push('')
  lines.push(`From: ${assessment.fromVersion ?? 'unknown'}  `)
  lines.push(`To: ${assessment.toVersion ?? 'unknown'}  `)
  lines.push(`Risk: ${assessment.risk}  `)
  lines.push(`Changed files: ${assessment.counts.total}`)
  lines.push('')
  lines.push(assessment.summary)
  lines.push('')
  if (blockers.length > 0) {
    lines.push('## Blocked: resolve these first')
    lines.push('')
    for (const blocker of blockers) lines.push(`- **${blocker.code}**: ${blocker.detail}`)
    lines.push('')
  }
  if (!assessment.hasUpdate && changes.length === 0) {
    lines.push('Nothing to do: this copy matches the source you checked.')
    return lines.join('\n')
  }
  for (const changeClass of CLASS_ORDER) {
    const group = changes.filter((change) => change.changeClass === changeClass)
    if (group.length === 0) continue
    lines.push(`## ${CLASS_HEADING[changeClass]} (${group.length})`)
    lines.push('')
    for (const change of group) {
      lines.push(`- \`${change.path}\` (${change.status})`)
      lines.push(`  - Why: ${change.why}`)
      lines.push(`  - Do: ${change.action}`)
    }
    lines.push('')
  }
  lines.push('## Order of work')
  lines.push('')
  assessment.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`))
  lines.push('')
  return lines.join('\n')
}
