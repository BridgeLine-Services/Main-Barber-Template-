/**
 * Dependency update automation (Priority 1, part B).
 *
 * The automation this module describes prepares work; it never performs it. It groups
 * updates into batches a person can reason about, names the tests each batch needs, and
 * states the rollback before anything is touched. Two fields are typed as literal `false`
 * on purpose: no plan this module can produce is ever auto-merged or auto-deployed, so a
 * caller cannot turn that on by passing an option.
 *
 * Pure: no network, no git, no clock.
 */

import { majorOf } from './compatibility'

export type UpdateKind = 'security' | 'major' | 'minor' | 'patch' | 'unknown'

export interface DependencyState {
  name: string
  installed: string | null
  latest: string | null
  /** True when a published advisory affects the installed version. */
  hasAdvisory?: boolean
  /** True for packages that run in production, false for build/test-only tooling. */
  runtime?: boolean
}

export interface PlannedUpdate {
  name: string
  installed: string
  latest: string
  kind: UpdateKind
  breaking: boolean
  runtime: boolean
  /** Why this update is being proposed, in one sentence. */
  reason: string
  /** Commands that must pass before this batch is proposed for approval. */
  tests: string[]
}

export interface UpdatePlan {
  generatedAt: string
  /** Updates safe to prepare together. */
  batch: PlannedUpdate[]
  /** Updates that need their own change because they can break behaviour. */
  deferred: PlannedUpdate[]
  risk: 'low' | 'medium' | 'high'
  /** Literal: a prepared plan always needs a person. */
  requiresApproval: true
  autoMerge: false
  autoDeploy: false
  testsToRun: string[]
  /** Exactly how to undo this batch. */
  rollback: string
  branch: string
  prTitle: string
  prBody: string
  summary: string
  /** Updates that could not be classified, listed so they are not silently dropped. */
  unclassified: string[]
}

function parsedVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function isNewerVersion(installed: string, latest: string): boolean | null {
  const from = parsedVersion(installed)
  const to = parsedVersion(latest)
  if (!from || !to) return null
  for (let index = 0; index < from.length; index++) {
    if (to[index] > from[index]) return true
    if (to[index] < from[index]) return false
  }
  return false
}

export function classifyUpdate(dep: DependencyState): PlannedUpdate | null {
  if (!dep.installed || !dep.latest) return null
  const from = majorOf(dep.installed)
  const to = majorOf(dep.latest)
  const installedParts = /^(\d+)\.(\d+)\.(\d+)$/.exec(dep.installed)
  const latestParts = /^(\d+)\.(\d+)\.(\d+)$/.exec(dep.latest)
  let kind: UpdateKind = 'unknown'
  if (from === null || to === null || !installedParts || !latestParts) kind = 'unknown'
  else if (to > from) kind = dep.hasAdvisory ? 'security' : 'major'
  else if (to === from) {
    const fromMinor = Number(installedParts[2])
    const toMinor = Number(latestParts[2])
    const fromPatch = Number(installedParts[3])
    const toPatch = Number(latestParts[3])
    if (toMinor > fromMinor) kind = dep.hasAdvisory ? 'security' : 'minor'
    else if (toMinor === fromMinor && toPatch > fromPatch) kind = dep.hasAdvisory ? 'security' : 'patch'
    else kind = 'unknown'
  } else kind = 'unknown'
  if (dep.hasAdvisory && kind !== 'unknown') kind = 'security'

  const breaking = kind === 'major' || kind === 'unknown' || (kind === 'security' && to !== from)
  const runtime = dep.runtime !== false
  const reason = dep.hasAdvisory
    ? 'A published security advisory affects the installed version.'
    : kind === 'major'
      ? 'A new major version is available. It can change behaviour.'
      : kind === 'unknown'
        ? 'The version could not be read, so the change is treated as risky.'
        : 'A newer release in the same major version is available.'

  const tests = dep.hasAdvisory || breaking
    ? ['npm run typecheck', 'npm run test:ci', 'npm run build']
    : ['npm run typecheck', 'npm run test:ci']

  return {
    name: dep.name,
    installed: dep.installed,
    latest: dep.latest,
    kind,
    breaking,
    runtime,
    reason,
    tests,
  }
}

export interface UpdatePlanOptions {
  branchPrefix?: string
  maxBatchSize?: number
}

export function buildUpdatePlan(deps: DependencyState[], generatedAt: string, options: UpdatePlanOptions = {}): UpdatePlan {
  const planned: PlannedUpdate[] = []
  const unclassified: string[] = []
  for (const dep of deps) {
    if (!dep.installed || !dep.latest) {
      unclassified.push(dep.name)
      continue
    }
    const newer = isNewerVersion(dep.installed, dep.latest)
    if (newer === false) continue
    if (newer === null) {
      unclassified.push(dep.name)
      continue
    }
    const item = classifyUpdate(dep)
    if (item) planned.push(item)
    else unclassified.push(dep.name)
  }

  const maxBatchSize = Math.max(1, options.maxBatchSize ?? 10)
  const routine = planned.filter((p) => !p.breaking && p.kind !== 'security').slice(0, maxBatchSize)
  const deferred = planned.filter((p) => p.breaking || p.kind === 'security')
  const overflow = planned.filter((p) => !p.breaking && p.kind !== 'security').slice(maxBatchSize)

  const hasSecurity = planned.some((p) => p.kind === 'security')
  const hasBreaking = planned.some((p) => p.breaking)
  const risk: UpdatePlan['risk'] = hasSecurity || hasBreaking ? 'high' : routine.length > 0 ? 'low' : 'low'

  const testsToRun = Array.from(new Set(routine.flatMap((p) => p.tests)))

  const batchNames = routine.map((p) => `${p.name} ${p.installed} -> ${p.latest}`)
  const deferredNames = [...deferred, ...overflow].map((p) => `${p.name} ${p.installed} -> ${p.latest}`)

  const branch = `${options.branchPrefix ?? 'chore/dependency-update'}-${generatedAt.slice(0, 10)}`

  const prBody = [
    '## What this changes',
    batchNames.length ? batchNames.map((n) => `- ${n}`).join('\n') : 'Nothing in this batch.',
    '',
    '## What this does not change',
    'No database migration, no configuration change and no customer data are touched by this plan.',
    '',
    '## Tests that must pass before approval',
    testsToRun.length ? testsToRun.map((t) => `- \`${t}\``).join('\n') : '- none recorded',
    '',
    '## Rollback',
    'Before merge, close the pull request and remove its branch after review. After merge, revert the merge commit and restore the previous lockfile. No customer data is changed by a dependency plan.',
    '',
    '## Held back deliberately',
    deferredNames.length ? deferredNames.map((n) => `- ${n}`).join('\n') : '- nothing',
    '',
    'This pull request was prepared automatically. It has not been merged or deployed, and it will not be.',
  ].join('\n')

  const knownSummary = planned.length === 0
    ? 'Every dependency is already at the version that was checked.'
    : routine.length > 0
      ? `${routine.length} routine update${routine.length === 1 ? '' : 's'} can be prepared together. ${deferredNames.length} change${deferredNames.length === 1 ? '' : 's'} need${deferredNames.length === 1 ? 's' : ''} their own approval.`
      : `No routine updates. ${deferredNames.length} change${deferredNames.length === 1 ? '' : 's'} need${deferredNames.length === 1 ? 's' : ''} individual approval because they can change behaviour.`
  const summary = unclassified.length > 0
    ? planned.length === 0
      ? `${unclassified.length} dependency update candidate${unclassified.length === 1 ? '' : 's'} could not be classified. No change is recommended until the version is confirmed.`
      : `${knownSummary} ${unclassified.length} other package update candidate${unclassified.length === 1 ? '' : 's'} could not be classified, so the report is not fully verified.`
    : knownSummary

  return {
    generatedAt,
    batch: routine,
    deferred: [...deferred, ...overflow],
    risk,
    requiresApproval: true,
    autoMerge: false,
    autoDeploy: false,
    testsToRun,
    rollback: `Revert the branch and restore the lockfile. Nothing outside the repository is touched, so no data restore is required.`,
    branch,
    prTitle: batchNames.length ? `Dependency updates: ${routine.length} routine change${routine.length === 1 ? '' : 's'}` : 'Dependency updates: nothing routine to apply',
    prBody,
    summary,
    unclassified,
  }
}
