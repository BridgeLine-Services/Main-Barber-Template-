import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAdmin } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { listSessions } from '@/lib/session-registry'
import type { JWT } from 'next-auth/jwt'
import { getToken } from 'next-auth/jwt'
import { SID_CLAIM } from '@/lib/session-registry'

// ============================================================================
// GET /api/dashboard/security/sessions
//
// The devices currently signed in to this account, so an owner can recognise an
// old phone and end just that one.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response

    const limited = await checkRateLimit(req, 'sessions-list', { windowMs: 60_000, maxRequests: 30 })
    if (limited) return rateLimitResponse(limited)

    // Which of these is the caller's own device.
    let currentSessionId: string | null = null
    try {
      const token = (await getToken({ req: req as never, secret: process.env.NEXTAUTH_SECRET })) as JWT | null
      currentSessionId = (token?.[SID_CLAIM] as string | undefined) ?? null
    } catch {
      // If the cookie cannot be read, the list still renders without a marker.
    }

    const sessions = await listSessions({ userId: auth.user.id, currentSessionId })

    return NextResponse.json({ sessions })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/security/sessions')
  }
}
