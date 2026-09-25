export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-helpers'
import { logAudit } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { z } from 'zod'
import { handleApiError } from '@/lib/api-errors'

const createShopSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  phone: z.string().min(7).max(30),
  email: z.string().email(),
  address: z.string().min(5).max(200),
  city: z.string().min(2).max(100),
  state: z.string().min(2).max(50),
  zipCode: z.string().min(3).max(20),
  timezone: z.string().default('America/New_York'),
})

/**
 * POST /api/dashboard/create-shop
 * Creates the owner's Business and links it to their User record.
 * This is called AFTER the owner has logged in (they created their account
 * via /setup which only creates a User with no Business).
 *
 * Only works if:
 * - User is authenticated as OWNER
 * - User does not already have a businessId
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    // Only owners can create a shop
    if (user.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Only owners can create a shop' },
        { status: 403 }
      )
    }
    // If they already have a business, don't let them create another
    if (user.businessId) {
      return NextResponse.json(
        { error: 'You already have a shop. Use Settings to modify it.' },
        { status: 409 }
      )
    }
    try {
      const body = await req.json()
      const parsed = createShopSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid input', details: parsed.error.flatten() },
          { status: 400 }
        )
      }
      const d = parsed.data
      // Check slug uniqueness
      const existingSlug = await prisma.business.findUnique({ where: { slug: d.slug } })
      if (existingSlug) {
        return NextResponse.json(
          { error: 'This URL slug is already taken. Please choose a different one.' },
          { status: 409 }
        )
      }
      // Create business and link to owner in a transaction
      const business = await prisma.$transaction(async (tx: any) => {
        const newBusiness = await tx.business.create({
          data: {
            name: d.name,
            slug: d.slug,
            phone: d.phone,
            email: d.email,
            address: d.address,
            city: d.city,
            state: d.state,
            zipCode: d.zipCode,
            timezone: d.timezone,
            primaryColor: '#1a1a1a',
            accentColor: '#d4af37',
            hours: {
              monday: { open: '09:00', close: '18:00', isOff: false },
              tuesday: { open: '09:00', close: '18:00', isOff: false },
              wednesday: { open: '09:00', close: '18:00', isOff: false },
              thursday: { open: '09:00', close: '18:00', isOff: false },
              friday: { open: '09:00', close: '18:00', isOff: false },
              saturday: { open: '09:00', close: '16:00', isOff: false },
              sunday: { open: '10:00', close: '15:00', isOff: true },
            },
            aboutText: `Welcome to ${d.name}! Update this text in Dashboard > Settings to tell customers about your shop.`,
            bookingPolicy: 'Appointments can be booked online up to 30 days in advance. No deposit required. Payment is collected in person after your service.',
            cancellationPolicy: 'Cancellations or modifications must be made at least 2 hours in advance of your scheduled slot.',
          },
        })
        // Link the business to the owner
        await tx.user.update({
          where: { id: user.id },
          data: { businessId: newBusiness.id },
        })
        return newBusiness
      })
      await logAudit({
        userId: user.id,
        businessId: business.id,
        action: 'CREATE',
        entityType: 'Business',
        entityId: business.id,
        newValues: { name: business.name, slug: business.slug },
        ipAddress: getClientIP(req),
        userAgent: req.headers.get('user-agent') || undefined,
      })
      return NextResponse.json({
        success: true,
        business: { id: business.id, name: business.name, slug: business.slug },
        message: 'Shop created successfully!',
      }, { status: 201 })
    } catch (error: any) {
      console.error('Create shop error:', error)
      if (error.code === 'P2002') {
        return NextResponse.json(
          { error: 'This URL slug is already taken. Please choose a different one.' },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to create shop. Please try again.' },
        { status: 500 }
      )
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/create-shop')
  }
}
