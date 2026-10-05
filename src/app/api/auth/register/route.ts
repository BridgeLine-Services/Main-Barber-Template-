export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { passwordPolicySchema, normalizeEmail } from '@/lib/validation'

// ============================================================================
// PUBLIC SIGNUP — creates a CUSTOMER account.
//
// The role is determined SERVER-SIDE and is always CUSTOMER. Any role value
// supplied by the browser is ignored (and rejected by the schema — this
// endpoint accepts no role field at all). Staff accounts are created only
// through the invitation lifecycle; owner accounts only through the
// token-gated provisioning endpoint (/api/auth/register-owner).
// ============================================================================

const registerSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  password: passwordPolicySchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  // Deliberately NO role field: a public request can never select a role.
})

export async function POST(req: NextRequest) {
  // 3 signups/min per IP by default; test environments (E2E suites make
  // several signup calls back-to-back) can raise it via env without
  // weakening the production default.
  const registerLimit = Number(process.env.RATE_LIMIT_REGISTER_MAX ?? 3) || 3
  const rateLimitResult = checkRateLimit(req, 'register', { windowMs: 60_000, maxRequests: registerLimit })
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

    const { email, password, name } = parsed.data

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)

    // Role is fixed server-side: a public signup is ALWAYS a customer.
    const customer = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'CUSTOMER',
      },
      select: { id: true, email: true, name: true, role: true },
    })

    return NextResponse.json({
      success: true,
      user: { id: customer.id, email: customer.email, name: customer.name, role: customer.role },
      message: 'Account created. You can now sign in.',
    }, { status: 201 })

  } catch (error) {
    console.error('Customer registration error:', error)

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
