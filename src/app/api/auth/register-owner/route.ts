export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { timingSafeEqual } from 'crypto'
import { passwordPolicySchema, normalizeEmail } from '@/lib/validation'

// ============================================================================
// OWNER PROVISIONING — the only path that creates an OWNER, and it is NOT
// public. Requires an explicit provisioning token: the request must carry a
// header (x-provisioning-token) matching the server-side secret
// OWNER_PROVISIONING_TOKEN, verified with a constant-time comparison. When
// the secret is not configured the endpoint is fully closed (fail-closed).
//
// A public request can never obtain OWNER through /api/auth/register
// (always CUSTOMER) or the staff invitation lifecycle (staff roles only).
// The seeded/authorized owner then completes shop setup via onboarding.
// ============================================================================

const registerOwnerSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  password: passwordPolicySchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  // No role field — role is OWNER by definition of this endpoint.
})

export async function POST(req: NextRequest) {
  // ── Authorized provisioning check (server-side, fail-closed) ──────────
  // The token is held only by the platform operator / provisioning process.
  // No query parameter, body field, or client state can substitute for it.
  const expected = process.env.OWNER_PROVISIONING_TOKEN
  const provided = req.headers.get('x-provisioning-token') ?? ''
  const authorized =
    !!expected &&
    provided.length === expected.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  if (!authorized) {
    // Same response whether the secret is unset or merely wrong — no signal.
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404 }
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

    // Authorized provisioning: create owner with no business — they'll set
    // up their shop via onboarding after their first login.
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
