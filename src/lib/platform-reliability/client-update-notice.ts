/**
 * Client update notifications (Priority 1, part H).
 *
 * An owner is not a release manager. This turns the technical update assessment into a
 * notice they can act on, and keeps five things distinct: information, a recommendation, a
 * security fix, something only the owner can decide, and something that needs a migration
 * or a deployment. It also states, every time, that nothing is applied for them.
 *
 * Pure: it reads the assessment and returns notices.
 */

import type { UpdateAssessment } from '@/lib/template-updates'

export type NoticeKind = 'informational' | 'recommended' | 'security' | 'action-required' | 'migration-required' | 'deployment-required'

export interface ClientUpdateNotice {
  kind: NoticeKind
  title: string
  body: string
  /** What the owner has to do, or null when nothing is required of them. */
  ownerAction: string | null
  /** True when the change needs a database step. */
  needsMigration: boolean
  /** True when the change needs a deploy. */
  needsDeployment: boolean
  /** Always false: no notice in this module can apply itself. */
  appliedAutomatically: false
}

export interface ClientUpdateNoticeSet {
  hasUpdate: boolean
  headline: string
  detail: string
  notices: ClientUpdateNotice[]
  /** The single next step, in the owner's words. */
  nextStep: string | null
  appliedAutomatically: false
}

function notice(kind: NoticeKind, title: string, body: string, ownerAction: string | null, needsMigration = false, needsDeployment = false): ClientUpdateNotice {
  return { kind, title, body, ownerAction, needsMigration, needsDeployment, appliedAutomatically: false }
}

export function buildClientUpdateNotices(assessment: UpdateAssessment): ClientUpdateNoticeSet {
  if (!assessment.hasUpdate) {
    return {
      hasUpdate: false,
      headline: 'You are running the same version as the one you checked.',
      detail: 'There is nothing to review and nothing to do.',
      notices: [],
      nextStep: null,
      appliedAutomatically: false,
    }
  }

  const notices: ClientUpdateNotice[] = []

  if (assessment.security.length > 0) {
    notices.push(
      notice(
        'security',
        'A security improvement is available',
        `${assessment.security.length} file${assessment.security.length === 1 ? '' : 's'} that protect your site changed. These are worth applying before the next busy period.`,
        'Ask the person responsible for access control to review this update.',
        assessment.migrations.length > 0,
        true,
      ),
    )
  }

  if (assessment.migrations.length > 0) {
    notices.push(
      notice(
        'migration-required',
        'This update changes your database',
        `${assessment.migrations.length} database step${assessment.migrations.length === 1 ? '' : 's'} must be applied in order, after a backup. This is never applied automatically.`,
        'Take a backup, verify it can be restored, then apply the database step through your normal process.',
        true,
        true,
      ),
    )
  }

  if (assessment.conflicts.length > 0) {
    notices.push(
      notice(
        'action-required',
        'You have your own changes in this update',
        `${assessment.conflicts.length} file${assessment.conflicts.length === 1 ? '' : 's'} changed upstream that you may have customised. They need a person to merge them by hand.`,
        'Merge these files by hand; do not overwrite your own settings.',
        false,
        true,
      ),
    )
  }

  if (assessment.dependencies) {
    notices.push(
      notice(
        'deployment-required',
        'The software your site runs on is updated',
        'Packages changed, so the site must be rebuilt and deployed for the change to take effect. Run the full test suite first.',
        'Run the tests, then deploy through your normal process.',
        false,
        true,
      ),
    )
  }

  if (notices.length === 0) {
    notices.push(
      notice(
        assessment.risk === 'low' ? 'informational' : 'recommended',
        assessment.risk === 'low' ? 'A small update is available' : 'An update is worth reviewing',
        `${assessment.counts.total} file${assessment.counts.total === 1 ? '' : 's'} changed. Nothing here changes how your site is protected or how your database works.`,
        'Review the change when it suits you.',
      ),
    )
  }

  const headline = assessment.risk === 'approval'
    ? 'An update is available and it needs a decision from you.'
    : assessment.risk === 'review'
      ? 'An update is available and it needs a careful look.'
      : 'A small update is available.'

  const detail = 'Nothing is applied to your site automatically. You or your support provider choose when, and you can decline.'

  const nextStep = notices.find((n) => n.kind === 'security')?.ownerAction
    ?? notices.find((n) => n.kind === 'migration-required')?.ownerAction
    ?? notices.find((n) => n.ownerAction)?.ownerAction
    ?? null

  return { hasUpdate: true, headline, detail, notices, nextStep, appliedAutomatically: false }
}
