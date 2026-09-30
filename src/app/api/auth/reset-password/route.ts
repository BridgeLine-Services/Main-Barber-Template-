export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { passwordPolicySchema } from '@/lib/validation'

/** Tokens are stored as SHA-256 hashes — never raw. */
function hashResetToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

const resetSchema = z.object({
  token: z.string().min(32, 'Invalid token'),
  // Shared password policy (same as registration/change-password)
  password: passwordPolicySchema,
})

/**
 * POST /api/auth/reset-password
 *
 * Completes a token-based password reset:
 *   - looks the token up BY HASH (never stored raw)
 *   - enforces the 1-hour expiry
 *   - single use: the token is cleared immediately on success
 *
 * On success: passwordHash updated, passwordResetToken/Expires cleared,
 * passwordChangedAt set, mustChangePassword cleared, audit recorded.
 */
export async function POST(req: NextRequest) {
  const rateLimitResult = checkRateLimit(req, 'auth-reset', RATE_LIMITS.PASSWORD_RESET)
  if (rateLimitResult) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: rateLimitResult.status })
  }

  try {
    const body = await req.json()
    const parsed = resetSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const tokenHash = hashResetToken(parsed.data.token)

    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: tokenHash,
        passwordResetExpires: { gt: new Date() },
      },
    })

    if (!user) {
      // Covers: unknown token, wrong hash, expired, already used.
      return NextResponse.json(
        { error: 'Invalid or expired reset token. Please request a new one.' },
        { status: 400 }
      )
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Token invalidated immediately — single use enforced
        passwordResetToken: null,
        passwordResetExpires: null,
        passwordChangedAt: new Date(),
        // A reset satisfies any forced-change requirement
        mustChangePassword: false,
      },
    })

    // Audit log
    await prisma.auditLog
      .create({
        data: {
          businessId: user.businessId,
          userId: user.id,
          action: 'USER_PASSWORD_CHANGED',
          entityType: 'User',
          entityId: user.id,
          newValues: { event: 'PASSWORD_RESET_COMPLETED' },
          ipAddress: req.headers.get('x-forwarded-for'),
          userAgent: req.headers.get('user-agent'),
        },
      })
      .catch(() => undefined) // audit must never break the reset flow

    return NextResponse.json({ success: true, message: 'Password reset successfully. Please log in.' })
  } catch (error) {
    if (error.code === 'P1001' || error.message?.includes('connect')) {
      return NextResponse.json({ error: 'Database connection error. Please try again.' }, { status: 503 })
    }
    console.error('Reset password error:', error)
    return NextResponse.json({ error: 'Failed to reset password. Please try again.' }, { status: 500 })
  }
}
