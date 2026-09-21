export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { registrationConfig } from '@/lib/app-config'
import { passwordPolicySchema, normalizeEmail } from '@/lib/validation'

const registerSchema = z.object({
  // Trim before validating — typed whitespace shouldn't fail signup
  email: z.string().trim().email().transform(normalizeEmail),
  // Shared password policy (same as reset/change flows)
  password: passwordPolicySchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
})

/**
 * POST /api/auth/register
 * Creates an OWNER account with no business linked yet.
 * After registration, the owner logs in and gets redirected to
 * /dashboard/onboarding to create their shop.
 */
export async function POST(req: NextRequest) {
  // Deployment-level registration switch (OWNER_REGISTRATION_MODE).
  // The check lives server-side so the API is safe regardless of what the
  // UI shows; the UI only mirrors this setting.
  if (registrationConfig.isDisabled) {
    return NextResponse.json(
      { error: 'Registration is currently unavailable. Please contact your administrator.', code: 'REGISTRATION_DISABLED' },
      { status: 403 }
    )
  }
  if (registrationConfig.isInviteOnly) {
    return NextResponse.json(
      { error: 'Accounts can only be created through an invitation. Please contact your administrator.', code: 'REGISTRATION_INVITE_ONLY' },
      { status: 403 }
    )
  }

  // Rate limit
  const rateLimitResult = checkRateLimit(req, 'register', { windowMs: 60_000, maxRequests: 3 })
  if (rateLimitResult) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a minute and try again.' },
      { status: rateLimitResult.status }
    )
  }

  try {
    const body = await req.json().catch(() => null)
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    // Email is normalized (trim + lowercase) by the schema — so case
    // variants can never create duplicate accounts.
    const { email, password, name } = parsed.data

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)

    // Create owner with no business — they'll set up their shop via onboarding
    const owner = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'OWNER',
      },
    })

    return NextResponse.json({
      success: true,
      user: { id: owner.id, email: owner.email, name: owner.name },
      message: 'Account created. You can now sign in.',
    }, { status: 201 })

  } catch (error: any) {
    console.error('Registration error:', error)

    if (error?.code === 'P1001' || error?.code === 'P1017') {
      return NextResponse.json(
        { error: 'Registration service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      )
    }

    // Prisma unique constraint fallback
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    // Generic message — never expose internal error details to the client.
    return NextResponse.json(
      { error: 'Registration failed. Please try again.' },
      { status: 500 }
    )
  }
}
