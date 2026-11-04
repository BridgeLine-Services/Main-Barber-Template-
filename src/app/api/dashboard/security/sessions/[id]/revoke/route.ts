import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAdmin, logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { revokeSession } from '@/lib/session-registry'

// ============================================================================
// POST /api/dashboard/security/sessions/[id]/revoke
//
// End ONE device. The row belongs to the caller (checked in the query, not just
// here), so an id from another account simply does not match.
//
// No password is required to end a single device: the damage a stolen session
// could do with this control is limited to signing devices out, which is the
// protective direction, and it is audited.
// ============================================================================

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'That device could not be found.' }, { status: 400 })
    }

    const limited = await checkRateLimit(_req, 'sessions-revoke-one', { windowMs: 60_000, maxRequests: 10 })
    if (limited) return rateLimitResponse(limited)

    const revoked = await revokeSession(id, auth.user.id)
    if (!revoked) {
      // Either it never existed, was already revoked, or belongs to someone
      // else. The answer is the same on purpose.
      return NextResponse.json({ error: 'That device is no longer signed in.' }, { status: 404 })
    }

    await logAudit({
      userId: auth.user.id,
      businessId: auth.user.businessId,
      action: 'SESSIONS_REVOKED',
      newValues: { sessionId: id, scope: 'single-device' },
    })

    return NextResponse.json({
      ok: true,
      message: 'That device has been signed out. It will need the password to sign in again.',
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/security/sessions/[id]/revoke')
  }
}
