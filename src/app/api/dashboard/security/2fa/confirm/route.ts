import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAdmin, logAudit } from '@/lib/auth-helpers'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { confirmEnrollment } from '@/lib/two-factor-enrollment'
import { handleApiError } from '@/lib/api-errors'

// ============================================================================
// Step 2 of enrolment: verify a code from the authenticator app, switch 2FA on,
// and return the recovery codes — the only time the plaintext codes are ever
// returned. Losing access to the app without storing these codes is the main
// way people lock themselves out, so the UI must present them prominently.
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response

    // Verification attempts are the brute-force surface: keep them tight.
    const limited = await checkRateLimit(req, '2fa-confirm', { windowMs: 60_000, maxRequests: 8 })
    if (limited) return rateLimitResponse(limited)

    const body = await req.json().catch(() => ({}))
    const token = typeof body.code === 'string' ? body.code.trim() : ''
    if (!/^\d{6}$/.test(token)) {
      return NextResponse.json({ error: 'Enter the 6-digit code from your authenticator app.' }, { status: 400 })
    }

    const result = await confirmEnrollment(auth.user.id, token)
    if ('error' in result) {
      // Deliberately identical for "no setup in progress" and "wrong code" so
      // the response cannot be used to probe another account's state.
      return NextResponse.json({ error: 'That code did not match. Check your authenticator app and try again.' }, { status: 400 })
    }

    await logAudit({
      userId: auth.user.id,
      businessId: auth.user.businessId,
      action: 'TWO_FACTOR_ENABLED',
      newValues: { recoveryCodesIssued: result.recoveryCodes.length },
    })

    return NextResponse.json({
      enabled: true,
      recoveryCodes: result.recoveryCodes,
      message:
        'Two-factor authentication is on. Save these recovery codes somewhere safe — each one works once if you ever lose your phone.',
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/security/2fa/confirm')
  }
}
