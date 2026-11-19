export const dynamic = 'force-dynamic'

/**
 * POST /api/dashboard/growth-stage — record the business stage the owner is heading for.
 *
 * Part 4.2. The tenant always comes from the authenticated session; a business id in the
 * request body is ignored on purpose, so one shop can never write another shop's plan.
 * This endpoint changes one nullable text column and nothing else: no permission, no
 * feature flag, no billing state.
 *
 * Body: { stage: 'starting' | 'growing' | 'established' | 'multi-location' | 'franchise' | null }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner, getBusinessIdForUser, logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { isBusinessStage, type BusinessStage } from '@/lib/growth/stages'
import { readIntendedStage, saveIntendedStage } from '@/lib/growth/stage-store'

export async function GET() {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await getBusinessIdForUser(auth.user)
    const stage = await readIntendedStage(businessId)
    return NextResponse.json({ stage })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/growth-stage')
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'That request could not be read. Please try again.' }, { status: 400 })
    }

    const raw = (body as { stage?: unknown } | null)?.stage
    const stage: BusinessStage | null =
      raw === null || raw === undefined ? null : isBusinessStage(raw) ? raw : null

    if (raw !== null && raw !== undefined && !isBusinessStage(raw)) {
      return NextResponse.json(
        { error: 'That is not one of the stages. Please choose one of the options shown.' },
        { status: 400 },
      )
    }

    const businessId = await getBusinessIdForUser(auth.user)
    const previous = await readIntendedStage(businessId)
    const result = await saveIntendedStage(businessId, stage)

    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            result.reason === 'invalid'
              ? 'That is not one of the stages. Please choose one of the options shown.'
              : 'Your plan could not be saved just now. A small database update is still pending on this site. Nothing else was changed.',
        },
        { status: result.reason === 'invalid' ? 400 : 503 },
      )
    }

    // Recorded so a later reader can see who declared the direction and when. The stage
    // is a plan, not a permission, so this is a settings event.
    await logAudit({
      userId: auth.user.id,
      businessId,
      action: 'SETTINGS_UPDATED',
      entityType: 'Business',
      entityId: businessId,
      oldValues: { intendedStage: previous },
      newValues: { intendedStage: result.stage },
    })

    return NextResponse.json({ ok: true, stage: result.stage })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/growth-stage')
  }
}
