export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { passwordPolicySchema, normalizeEmail } from '@/lib/validation'
import { isCustomerRegistrationOpen, isOwnerRegistrationOpen } from '@/lib/owner-registration'

// ============================================================================
// PUBLIC REGISTRATION — the single public account-creation endpoint.
//
// Two explicit flows, both decided entirely on the SERVER:
//
//   intent: 'customer' (default) → always creates a CUSTOMER. Public sign-up
//     can never mint an OWNER/staff role, no matter what the body contains.
//
//   intent: 'owner' → the self-service FIRST-OWNER bootstrap. Only succeeds
//     while owner registration is open (OWNER_REGISTRATION_MODE=onboarding
//     AND no OWNER exists). Once an owner exists the request is REJECTED with
//     a clear message — it never silently falls back to creating a CUSTOMER.
//     Two simultaneous first-owner attempts are serialized with a Postgres
//     advisory lock inside a transaction, so exactly one request can win.
//
// `intent` selects a flow, never a role: the role is derived server-side from
// the verified registration mode + owner lookup. Any client-supplied `role`
// field is ignored (stripped by the zod schema).
// ============================================================================

class RegistrationConflict extends Error {
  status = 409
}

const OWNER_REGISTRATION_CLOSED_MESSAGE =
  'Owner registration is already complete for this shop. Sign in as the owner, or create a customer account instead.'

const registerSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  password: passwordPolicySchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  intent: z.enum(['customer', 'owner']).optional().default('customer'),
  // Only read for the owner flow (the UI collects a password confirmation);
  // customer sign-up keeps its exact historical request shape.
  confirmPassword: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const registerLimit = Number(process.env.RATE_LIMIT_REGISTER_MAX ?? 3) || 3
  const rateLimitResult = await checkRateLimit(req, 'register', { windowMs: 60_000, maxRequests: registerLimit })
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

    const { email, password, name, intent } = parsed.data

    // Owner flow: password confirmation must match (existing policy schema).
    if (intent === 'owner' && parsed.data.confirmPassword !== password) {
      return NextResponse.json(
        { error: 'Passwords do not match' },
        { status: 400 }
      )
    }

    const existingOwner = await prisma.user.findFirst({
      where: { role: 'OWNER' },
      select: { id: true },
    })
    const ownerOnboardingOpen = isOwnerRegistrationOpen(process.env.OWNER_REGISTRATION_MODE, !!existingOwner)
    const customerRegistrationOpen = isCustomerRegistrationOpen(process.env.OWNER_REGISTRATION_MODE)

    if (intent === 'owner' && !ownerOnboardingOpen) {
      // Explicit owner request is rejected — NEVER silently downgraded to a
      // CUSTOMER account. Same safe message whether an owner exists or the
      // mode is closed, so the response leaks nothing about the database.
      return NextResponse.json(
        { error: OWNER_REGISTRATION_CLOSED_MESSAGE, code: 'OWNER_REGISTRATION_CLOSED' },
        { status: 409 }
      )
    }

    if (intent === 'customer' && !customerRegistrationOpen) {
      return NextResponse.json(
        { error: 'Registration is disabled for this public entry point.' },
        { status: 403 }
      )
    }

    const shouldCreateOwner = intent === 'owner'

    const createdUser = await prisma.$transaction(async (tx) => {
      if (shouldCreateOwner) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('owner-registration'))`

        const currentOwner = await tx.user.findFirst({
          where: { role: 'OWNER' },
          select: { id: true },
        })
        if (currentOwner) {
          throw Object.assign(new RegistrationConflict('Owner registration is no longer open'), {
            code: 'OWNER_EXISTS',
          })
        }
      }

      const existing = await tx.user.findUnique({ where: { email } })
      if (existing) {
        throw Object.assign(new RegistrationConflict('An account with this email already exists'), {
          code: 'EMAIL_EXISTS',
        })
      }

      const passwordHash = await bcrypt.hash(password, 10)
      return tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: shouldCreateOwner ? 'OWNER' : 'CUSTOMER',
        },
        select: { id: true, email: true, name: true, role: true },
      })
    })

    return NextResponse.json({
      success: true,
      user: { id: createdUser.id, email: createdUser.email, name: createdUser.name, role: createdUser.role },
      message: shouldCreateOwner
        ? 'Owner account created. You can now complete setup.'
        : 'Account created. You can now sign in.',
    }, { status: 201 })
  } catch (error) {
    console.error('Registration error:', error)

    if ((error as { code?: string })?.code === 'P1001' || (error as { code?: string })?.code === 'P1017') {
      return NextResponse.json(
        { error: 'Registration service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      )
    }
    // Specific codes win over the generic 409 so a lost first-owner race is
    // never misreported as a duplicate email (emails are unique per racer).
    if ((error as { code?: string })?.code === 'OWNER_EXISTS') {
      return NextResponse.json(
        { error: OWNER_REGISTRATION_CLOSED_MESSAGE, code: 'OWNER_REGISTRATION_CLOSED' },
        { status: 409 }
      )
    }
    if ((error as { status?: number })?.status === 409 || (error as { code?: string })?.code === 'EMAIL_EXISTS') {
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
