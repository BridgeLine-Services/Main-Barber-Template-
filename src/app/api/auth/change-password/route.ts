export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { AuditAction } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { passwordPolicySchema } from '@/lib/validation'

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    // Shared policy: min 10 chars, uppercase, lowercase, number
    newPassword: passwordPolicySchema,
    // Confirm is validated server-side too — never trust the client alone
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

/**
 * POST /api/auth/change-password
 * Changes the authenticated user's password and clears the
 * mustChangePassword flag. This is the exit route for the forced
 * password-change gate (Priority 2 in the dashboard access chain).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessionUser = session.user

  try {
    const body = await req.json()
    const parsed = changePasswordSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { currentPassword, newPassword } = parsed.data

    const user = await prisma.user.findUnique({
      where: sessionUser.id ? { id: sessionUser.id } : { email: sessionUser.email },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify the current password
    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    // New password must differ from the current one
    const samePassword = await bcrypt.compare(newPassword, user.passwordHash)
    if (samePassword) {
      return NextResponse.json(
        { error: 'New password must be different from the current password' },
        { status: 400 }
      )
    }

    // Update password, clear the forced-change flag, stamp the change,
    // and clear any temporary-password expiry.
    const passwordHash = await bcrypt.hash(newPassword, 10)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        temporaryPasswordExpiresAt: null,
      },
    })

    // Audit the password change (no password material logged)
    await logAudit({
      userId: user.id,
      businessId: user.businessId ?? undefined,
      action: AuditAction.USER_PASSWORD_CHANGED,
      entityType: 'User',
      entityId: user.id,
      newValues: { forced: user.mustChangePassword },
      ipAddress: getClientIP(req),
    }).catch(() => {}) // audit failures must not block the password change

    // Redirect target depends on onboarding status: an owner who hasn't
    // finished setup goes back to the wizard; everyone else to the dashboard.
    let redirectTo = '/dashboard'
    if (user.role === 'OWNER') {
      if (!user.businessId) {
        redirectTo = '/dashboard/onboarding'
      } else {
        const business = await prisma.business.findUnique({
          where: { id: user.businessId },
          select: { onboardingCompleted: true },
        })
        if (!business?.onboardingCompleted) redirectTo = '/dashboard/onboarding'
      }
    }

    return NextResponse.json({ success: true, redirectTo })
  } catch (error) {
    console.error('Change password error:', error)
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 })
  }
}
