import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireBusinessAdmin } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'

// ============================================================================
// Two-factor authentication status for the signed-in account.
//
// Account-level (not shop-level): every staff member who can reach this route
// sees only their own enrolment state. Nothing here reveals the secret, the
// ciphertext, or any recovery code.
// ============================================================================

export async function GET() {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response

    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: {
        twoFactorEnabled: true,
        twoFactorEnabledAt: true,
        twoFactorSecretEnc: true,
        twoFactorRecoveryCodes: { select: { usedAt: true } },
      },
    })
    if (!user) {
      return NextResponse.json({ error: 'We could not find your account.' }, { status: 404 })
    }

    const remaining = user.twoFactorRecoveryCodes.filter((c) => c.usedAt === null).length

    return NextResponse.json({
      enabled: user.twoFactorEnabled,
      enabledAt: user.twoFactorEnabledAt,
      // A stored secret without confirmation means an abandoned setup attempt.
      setupStarted: !user.twoFactorEnabled && Boolean(user.twoFactorSecretEnc),
      recoveryCodesRemaining: user.twoFactorEnabled ? remaining : 0,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/security/2fa')
  }
}
