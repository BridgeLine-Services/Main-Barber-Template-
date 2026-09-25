export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, logAudit } from '@/lib/auth-helpers'
import { updateBarberProfileSchema } from '@/lib/validation'
import { getClientIP } from '@/lib/rate-limit'
import { handleApiError } from '@/lib/api-errors'

/**
 * GET /api/dashboard/profile
 * Returns the barber's own profile (BARBER self-service) or owner's user info.
 * For BARBER role: resolves barberId from session.user.barberId.
 * For OWNER role: returns owner user info.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    try {
      if (auth.user.role === 'BARBER') {
        if (!auth.user.barberId) {
          return NextResponse.json({ error: 'No barber profile linked to your account' }, { status: 400 })
        }
        const barber = await prisma.barber.findUnique({
          where: { id: auth.user.barberId },
          include: {
            services: {
              include: { service: true },
              orderBy: { sortOrder: 'asc' },
            },
            mediaAssets: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        })
        if (!barber) {
          return NextResponse.json({ error: 'Barber profile not found' }, { status: 404 })
        }
        // Verify the barber belongs to the same business
        if (barber.businessId !== auth.user.businessId) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        return NextResponse.json({ barber })
      } else {
        // OWNER: return user info
        return NextResponse.json({ user: auth.user })
      }
    } catch (error: any) {
      console.error('Profile fetch error:', error)
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/profile')
  }
}

/**
 * PATCH /api/dashboard/profile
 * Barber updates their own profile (self-service).
 * Owner can also update a barber's profile by passing barberId.
 *
 * Security: barbers can only edit their OWN profile, not other barbers'.
 * The barberId is resolved from session.user.barberId, NOT from request params.
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    try {
      const body = await req.json()
      const parseResult = updateBarberProfileSchema.safeParse(body)
      if (!parseResult.success) {
        return NextResponse.json(
          { error: 'Invalid profile data', details: parseResult.error.flatten().fieldErrors },
          { status: 400 }
        )
      }
      let barberId: string
      if (auth.user.role === 'BARBER') {
        // Barbers can only edit their own profile — resolved from session, never from request
        if (!auth.user.barberId) {
          return NextResponse.json({ error: 'No barber profile linked to your account' }, { status: 400 })
        }
        barberId = auth.user.barberId
      } else if (auth.user.role === 'OWNER') {
        // Owner can edit any barber's profile — barberId must be provided
        const targetBarberId = body.barberId
        if (!targetBarberId) {
          return NextResponse.json({ error: 'barberId is required for owner edits' }, { status: 400 })
        }
        // Verify the barber belongs to the owner's business
        const targetBarber = await prisma.barber.findFirst({
          where: { id: targetBarberId, businessId: auth.user.businessId },
        })
        if (!targetBarber) {
          return NextResponse.json({ error: 'Barber not found in your business' }, { status: 404 })
        }
        barberId = targetBarberId
      } else {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      // Capture old values for audit
      const oldBarber = await prisma.barber.findUnique({ where: { id: barberId } })
      // updateData is the Zod-validated fields (no barberId in schema)
      const updateData = { ...parseResult.data }
      const updatePayload: any = { ...updateData }
      // Handle slug: manual slug from barber takes priority, otherwise auto-generate from name
      if (updateData.slug) {
        // Barber manually set a slug — validate uniqueness (excluding self)
        const slugConflict = await prisma.barber.findFirst({
          where: { slug: updateData.slug, NOT: { id: barberId } },
        })
        if (slugConflict) {
          return NextResponse.json({ error: 'This URL slug is already taken. Please choose another.' }, { status: 409 })
        }
      } else if (updateData.name && !oldBarber?.slug) {
        // Auto-generate slug from name if no slug exists yet
        const slugBase = updateData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const existing = await prisma.barber.findFirst({
          where: { slug: slugBase, NOT: { id: barberId } },
        })
        if (!existing) {
          updatePayload.slug = slugBase
        } else {
          let counter = 1
          let uniqueSlug = `${slugBase}-${counter}`
          while (await prisma.barber.findFirst({ where: { slug: uniqueSlug, NOT: { id: barberId } } })) {
            counter++
            uniqueSlug = `${slugBase}-${counter}`
          }
          updatePayload.slug = uniqueSlug
        }
      }
      const updated = await prisma.barber.update({
        where: { id: barberId },
        data: updatePayload,
      })
      await logAudit({
        userId: auth.user.id,
        businessId: auth.user.businessId || undefined,
        action: 'BARBER_PROFILE_UPDATED',
        entityType: 'Barber',
        entityId: barberId,
        oldValues: oldBarber,
        newValues: updateData,
        ipAddress: getClientIP(req) || undefined,
        userAgent: req.headers.get('user-agent') || undefined,
      })
      return NextResponse.json({ barber: updated })
    } catch (error: any) {
      console.error('Profile update error:', error)
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/profile')
  }
}
