/**
 * Review Requests (Prompt 9) — shop-level configuration.
 *
 * GET  /api/dashboard/review-requests/settings — current config + summary
 * PUT  /api/dashboard/review-requests/settings — update config
 *
 * The system is fail-closed: BOTH the platform feature flag
 * ('reviewRequests') and the owner master switch (settings.enabled) must be
 * on before anything is enqueued or sent. The destination must be a real
 * HTTPS review page the owner pasted — the system never invents one.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import {
  getReviewRequestSettings,
  getReviewRequestSummary,
  previewReviewMessage,
  updateReviewRequestSettings,
  ReviewRequestError,
  REVIEW_DELAY_DEFAULT_HOURS,
} from '@/lib/review-requests'

const settingsSchema = z.object({
  enabled: z.boolean(),
  destinationUrl: z.string().trim().max(2048).nullable().optional(),
  delayHours: z.number().int().min(0).max(168).default(REVIEW_DELAY_DEFAULT_HOURS),
  emailSubject: z.string().trim().max(200).nullable().optional(),
  messageTemplate: z.string().trim().max(2000).nullable().optional(),
})

type SessionUser = { role: string; businessId?: string | null }

export async function GET() {
  try {
    const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = user.businessId
    const [settings, summary] = await Promise.all([
      getReviewRequestSettings(businessId),
      getReviewRequestSummary(businessId),
    ])
    return NextResponse.json({ settings, summary, preview: previewReviewMessage(settings.messageTemplate) })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/review-requests/settings')
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = user.businessId

    const body = await req.json().catch(() => ({}))
    const parsed = settingsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid settings payload' }, { status: 400 })
    }

    const result = await updateReviewRequestSettings(businessId, parsed.data)
    return NextResponse.json({
      settings: result.settings,
      warnings: result.warnings,
      preview: previewReviewMessage(result.settings.messageTemplate),
    })
  } catch (error) {
    if (error instanceof ReviewRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 })
    }
    return handleApiError(error, 'PUT /api/dashboard/review-requests/settings')
  }
}
