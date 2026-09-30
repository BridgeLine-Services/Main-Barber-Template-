export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { registrationConfig } from '@/lib/app-config'
import { passwordPolicySchema, normalizeEmail } from '@/lib/validation'

// ============================================================================
// OWNER ONBOARDING SIGNUP — the ONLY public path that creates an OWNER.
//
// Gated by the deployment-level OWNER_REGISTRATION_MODE switch. This is the
// "create your barbershop" entry: the new owner is sent into onboarding to
// build their shop. A public request can never obtain OWNER through
// /api/auth/register (customers) or the staff invitation lifecycle (staff).
// ============================================================================

const registerOwnerSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  password: passwordPolicySchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  // No role field — role is OWNER by definition of this endpoint.
})

export async function POST(req: NextRequest) {
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

  const rateLimitResult = checkRateLimit(req, 'register-owner', { windowMs: 60_000, maxRequests: 3 })
  if (rateLimitResult) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a minute and try again.' },
      { status: rateLimitResult.status }
    )
  }

  try {
    const body = await req.json().catch(() => null)
    const parsed = registerOwnerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { email, password, name } = parsed.data

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
      select: { id: true, email: true, name: true, role: true },
    })

    return NextResponse.json({
      success: true,
      user: { id: owner.id, email: owner.email, name: owner.name, role: owner.role },
      message: 'Account created. You can now sign in.',
    }, { status: 201 })

  } catch (error) {
    console.error('Owner registration error:', error)

    if (error?.code === 'P1001' || error?.code === 'P1017') {
      return NextResponse.json(
        { error: 'Registration service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      )
    }
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: 'Registration failed. Please try again.' },
      { status: 500 }
    )
  }
}
