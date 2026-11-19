/**
 * Reading and writing the business stage an owner says they are heading for.
 *
 * Part 4.2. Deliberately tiny and defensive, because of one real deployment risk: a
 * client copy can pull this release before it runs the migration that adds the column.
 * In that window `intendedStage` does not exist, and a naive select would throw and take
 * the whole Getting Started page down with it.
 *
 * So the read treats "column missing" as "the owner has not said", and the write refuses
 * with a sentence a person can act on. Nothing here grants a permission, enables a
 * feature or changes any other setting.
 */

import { prisma } from '@/lib/prisma'
import { isBusinessStage, type BusinessStage } from './stages'

/**
 * The declared stage, or null when the owner has not chosen one.
 *
 * A failed read is never allowed to look like a choice: any error (including a database
 * that predates the column) resolves to null, and the page falls back to evidence.
 */
export async function readIntendedStage(businessId: string): Promise<BusinessStage | null> {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { intendedStage: true },
    })
    const value = business?.intendedStage ?? null
    return isBusinessStage(value) ? value : null
  } catch {
    return null
  }
}

export interface SaveStageResult {
  ok: boolean
  /** Present when ok is true: the stage now stored (null means cleared). */
  stage?: BusinessStage | null
  /** Present when ok is false: why the write did not happen. */
  reason?: 'invalid' | 'unavailable'
}

/**
 * Record the owner's declared direction. `null` clears it, which is a legitimate choice
 * (back to evidence only).
 *
 * The business id always comes from the authenticated session at the call site; this
 * function never accepts a tenant from a request body.
 */
export async function saveIntendedStage(
  businessId: string,
  stage: BusinessStage | null,
): Promise<SaveStageResult> {
  if (stage !== null && !isBusinessStage(stage)) return { ok: false, reason: 'invalid' }
  try {
    await prisma.business.update({
      where: { id: businessId },
      data: { intendedStage: stage },
    })
    return { ok: true, stage }
  } catch {
    // Most likely the column does not exist yet on this deployment. Say so rather than
    // pretending the choice was saved.
    return { ok: false, reason: 'unavailable' }
  }
}
