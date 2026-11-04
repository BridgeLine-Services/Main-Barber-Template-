import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { handleApiError } from '@/lib/api-errors'

// ============================================================================
// POST /api/auth/2fa/required
//
// The sign-in form needs to know whether a failed sign-in should be followed by
// "enter your code" or by "wrong password". Asking that question must not
// reveal which accounts exist or which are protected, so this endpoint answers
// only when the supplied password is CORRECT for the account:
//
//   correct password, 2FA on   -> { required: true }
//   correct password, 2FA off  -> { required: false }   (the client retries the
//                                  normal sign-in, which should then succeed)
//   wrong password / unknown   -> identical 401 in both cases
//
// Rate-limited like a sign-in so it cannot become a password oracle.
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const limited = await checkRateLimit(req, 'auth-2fa-required', RATE_LIMITS.AUTH)
    if (limited) return rateLimitResponse(limited)

    const body = await req.json().catch(() => ({}))
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) {
      return NextResponse.json({ error: 'Please enter your email and password.' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, twoFactorEnabled: true, isActive: true },
    })

    // Identical response for "no such account" and "wrong password".
    const invalid = () => NextResponse.json({ error: 'We could not verify that password.' }, { status: 401 })
    if (!user || user.isActive === false) return invalid()

    const passwordValid = await bcrypt.compare(password, user.passwordHash)
    if (!passwordValid) return invalid()

    return NextResponse.json({ required: user.twoFactorEnabled })
  } catch (error) {
    return handleApiError(error, 'POST /api/auth/2fa/required')
  }
}
