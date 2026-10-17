import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBusinessAdmin, getBusinessIdForUser } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
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

export async function GET() {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response
    const businessId = await getBusinessIdForUser(auth.user)
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
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response
    const businessId = await getBusinessIdForUser(auth.user)
    const body = await req.json().catch(() => null)
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
