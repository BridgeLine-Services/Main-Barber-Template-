import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { requireBusinessAdmin, logAudit } from '@/lib/auth-helpers'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { handleApiError } from '@/lib/api-errors'

// ============================================================================
// POST /api/dashboard/security/sessions/revoke
//
// "Sign out of all devices." Sets the account's cutoff to now; every session
// whose sign-in stamp is older than that becomes dead on its next request
// (enforced in the jwt callback, not in the UI).
//
// Requires the account password so a stolen-but-unattended session cannot be
// used to knock the real owner out at will.
//
// This signs out the CURRENT device too, deliberately. Keeping one device alive
// means deciding which session is "the safe one" from inside a possibly
// compromised session, and the obvious shortcut ("cutoff = a moment ago") leaves
// a session signed in seconds earlier untouched. Signing everything out and
// asking for the password again is unambiguous, and the owner is redirected to
// the sign-in page by the UI.
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response

    const limited = await checkRateLimit(req, 'sessions-revoke', { windowMs: 60_000, maxRequests: 5 })
    if (limited) return rateLimitResponse(limited)

    const body = await req.json().catch(() => ({}))
    const password = typeof body.password === 'string' ? body.password : ''

    if (!password) {
      return NextResponse.json({ error: 'Enter your password to sign out of every device.' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { passwordHash: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'We could not find your account.' }, { status: 404 })
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.json({ error: 'That password did not match. Please try again.' }, { status: 400 })
    }

    // Strictly-before comparison: every session that already exists carries a
    // stamp in the past, so a cutoff of "now" kills all of them, this one
    // included, while a sign-in performed after this call (a later timestamp)
    // survives. A cutoff placed in the future would also kill the owner's
    // immediate re-login, which is why it is not used here.
    const cutoff = new Date()

    await prisma.user.update({
      where: { id: auth.user.id },
      data: { sessionsValidAfter: cutoff },
    })

    await logAudit({
      userId: auth.user.id,
      businessId: auth.user.businessId,
      action: 'SESSIONS_REVOKED',
      newValues: { revokedAllSessions: true },
    })

    return NextResponse.json({
      ok: true,
      message: 'Every device has been signed out, including this one. Please sign in again.',
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/security/sessions/revoke')
  }
}
