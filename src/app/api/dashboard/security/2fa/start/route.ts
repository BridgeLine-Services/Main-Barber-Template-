import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireBusinessAdmin } from '@/lib/auth-helpers'
import { checkRateLimit } from '@/lib/rate-limit'
import { beginEnrollment } from '@/lib/two-factor-enrollment'
import { handleApiError } from '@/lib/api-errors'

// ============================================================================
// Step 1 of enrolment: create a fresh secret and hand back the otpauth URI the
// authenticator app needs. The account stays DISABLED until a real code from
// that app is verified in /confirm, so an abandoned setup can never lock an
// owner out of their own shop.
//
// Re-starting replaces any previous unconfirmed secret. An ENABLED account must
// disable first, so this endpoint cannot silently swap out a working secret.
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response

    const limited = await checkRateLimit(req, '2fa-start', { windowMs: 60_000, maxRequests: 10 })
    if (limited) return NextResponse.json(limited.body, { status: limited.status })

    const existing = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { twoFactorEnabled: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'We could not find your account.' }, { status: 404 })
    }
    if (existing.twoFactorEnabled) {
      return NextResponse.json(
        { error: 'Two-factor authentication is already on for this account. Turn it off first if you want to set it up again.' },
        { status: 409 },
      )
    }

    const { secret, otpauthUrl } = await beginEnrollment(auth.user.id)

    return NextResponse.json({
      secret,
      otpauthUrl,
      instructions:
        'Open your authenticator app and either scan the QR code or type this setup key. Then enter the 6-digit code it shows to finish.',
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/security/2fa/start')
  }
}
