export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { passwordPolicySchema, normalizeEmail } from '@/lib/validation'
import { isCustomerRegistrationOpen, isOwnerRegistrationOpen } from '@/lib/owner-registration'

const registerSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  password: passwordPolicySchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
})

class RegistrationConflict extends Error {
  status = 409
}

export async function POST(req: NextRequest) {
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

    const existingOwner = await prisma.user.findFirst({
      where: { role: 'OWNER' },
      select: { id: true },
    })
    const ownerOnboardingOpen = isOwnerRegistrationOpen(process.env.OWNER_REGISTRATION_MODE, !!existingOwner)
    const customerRegistrationOpen = isCustomerRegistrationOpen(process.env.OWNER_REGISTRATION_MODE)
    const shouldCreateOwner = ownerOnboardingOpen && !existingOwner

    if (!shouldCreateOwner && !customerRegistrationOpen) {
      return NextResponse.json(
        { error: 'Registration is disabled for this public entry point.' },
        { status: 403 }
      )
    }

    const createdUser = await prisma.$transaction(async (tx) => {
      if (shouldCreateOwner) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('owner-registration'))`

        const currentOwner = await tx.user.findFirst({
          where: { role: 'OWNER', businessId: null },
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
    if ((error as { status?: number })?.status === 409 || (error as { code?: string })?.code === 'EMAIL_EXISTS') {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }
    if ((error as { code?: string })?.code === 'OWNER_EXISTS') {
      return NextResponse.json(
        { error: 'Owner registration is already complete for this shop.' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: 'Registration failed. Please try again.' },
      { status: 500 }
    )
  }
}
