import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { requireBusinessAdmin, logAudit } from '@/lib/auth-helpers'
import { checkRateLimit } from '@/lib/rate-limit'
import { disableTwoFactor } from '@/lib/two-factor-enrollment'
import { handleApiError } from '@/lib/api-errors'

// ============================================================================
// Turn two-factor OFF. Requires the account password AND a current code (or one
// unused recovery code), so a hijacked session alone cannot strip protection
// from the account.
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response

    const limited = await checkRateLimit(req, '2fa-disable', { windowMs: 60_000, maxRequests: 8 })
    if (limited) return NextResponse.json(limited.body, { status: limited.status })

    const body = await req.json().catch(() => ({}))
    const password = typeof body.password === 'string' ? body.password : ''
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim() : ''

    if (!password || (!code && !recoveryCode)) {
      return NextResponse.json(
        { error: 'Enter your password and either the current 6-digit code or one of your recovery codes.' },
        { status: 400 },
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { passwordHash: true, twoFactorEnabled: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'We could not find your account.' }, { status: 404 })
    }
    if (!user.twoFactorEnabled) {
      return NextResponse.json({ message: 'Two-factor authentication is already off for this account.' })
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash)
    if (!passwordOk) {
      return NextResponse.json({ error: 'That password did not match. Please try again.' }, { status: 400 })
    }

    const ok = await disableTwoFactor(auth.user.id, {
      ...(code ? { token: code } : {}),
      ...(recoveryCode ? { recoveryCode } : {}),
    })
    if (!ok) {
      return NextResponse.json(
        { error: 'That code did not match. Use the current code from your authenticator app or one of your recovery codes.' },
        { status: 400 },
      )
    }

    await logAudit({
      userId: auth.user.id,
      businessId: auth.user.businessId,
      action: 'TWO_FACTOR_DISABLED',
      newValues: { method: code ? 'totp' : 'recovery_code' },
    })

    return NextResponse.json({
      enabled: false,
      message: 'Two-factor authentication is off. You can turn it back on at any time.',
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/security/2fa/disable')
  }
}
