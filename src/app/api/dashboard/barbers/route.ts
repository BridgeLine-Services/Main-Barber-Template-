export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createBarberSchema } from '@/lib/validation'
import bcrypt from 'bcryptjs'
import { handleApiError, validationError } from '@/lib/api-errors'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const barbers = await prisma.barber.findMany({
      where: { businessId },
      include: {
        services: { include: { service: true } },
        _count: { select: { appointments: true } },
      },
      orderBy: { order: 'asc' },
    })
    return NextResponse.json(barbers)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/barbers')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ((session.user as any)?.role !== 'OWNER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const businessId = (session.user as any)?.businessId
    if (!businessId) return NextResponse.json({ error: 'Business setup required' }, { status: 409 })
    const body = await req.json().catch(() => null)
    // Validate barber fields (password/email are separate, not in schema)
    const parseResult = createBarberSchema.safeParse(body)
    if (!parseResult.success) {
      const { message, fieldErrors } = validationError(parseResult.error)
      return NextResponse.json(
        { error: message, details: fieldErrors },
        { status: 400 }
      )
    }
    const { name, specialty, bio, photo, isActive, order, serviceIds } = parseResult.data
    const { email, password } = body
    // Tenant isolation: linked services must belong to THIS business
    if (serviceIds?.length) {
      const owned = await prisma.service.count({
        where: { id: { in: serviceIds }, businessId },
      })
      if (owned !== serviceIds.length) {
        return NextResponse.json(
          { error: 'One or more selected services do not belong to this shop' },
          { status: 403 }
        )
      }
    }
    // Optional login account: normalize the email and pre-check duplicates
    // BEFORE creating anything so a failure can never orphan a barber.
    let normalizedEmail: string | undefined
    if (typeof email === 'string' && email.trim()) {
      normalizedEmail = email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return NextResponse.json({ error: 'A valid email is required to create a login account' }, { status: 400 })
      }
      if (typeof password !== 'string' || password.length < 8) {
        return NextResponse.json({ error: 'A password of at least 8 characters is required to create a login account' }, { status: 400 })
      }
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } })
      if (existingUser) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Use a different email.' },
          { status: 409 }
        )
      }
    }
    // Create the barber and the optional user account atomically: a
    // duplicate-email race fails the whole transaction (no orphaned barber).
    const passwordHash = normalizedEmail ? await bcrypt.hash(password, 10) : undefined
    const barber = await prisma.$transaction(async (tx) => {
      const created = await tx.barber.create({
        data: {
          businessId,
          name,
          specialty: specialty || null,
          bio: bio || null,
          photo: photo || null,
          isActive: isActive ?? true,
          order: order ?? 0,
          services: serviceIds?.length
            ? { create: serviceIds.map((id: string) => ({ serviceId: id })) }
            : undefined,
        },
      })
      if (normalizedEmail && passwordHash) {
        await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            name,
            role: 'BARBER',
            businessId,
            barberId: created.id,
          },
        })
      }
      return created
    })
    return NextResponse.json(barber)
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/barbers')
  }
}
