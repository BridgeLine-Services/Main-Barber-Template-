// ============================================================================
// Platform administration API — PLATFORM_OWNER only.
//
// Server-side enforced: every request re-resolves the caller's role from
// the database via requirePlatformOwner(). Business owners, barbers,
// customers, and anonymous callers get 401/403 and an audit entry.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { requirePlatformOwner, logAudit } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

const createSchema = z.object({
  name: z.string().min(1, 'Business name required').max(100),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, digits, and hyphens'),
  timezone: z.string().min(1).default('America/Los_Angeles'),
  ownerEmail: z.string().email('Valid owner email required'),
  ownerName: z.string().min(1).max(100),
})

const actionSchema = z.object({
  businessId: z.string().min(1),
  action: z.enum(['deactivate', 'reactivate']),
})

/** GET — list every business with operational status. Platform owner only. */
export async function GET() {
  const auth = await requirePlatformOwner()
  if (!auth.success) return auth.response

  const businesses = await prisma.business.findMany({
    select: {
      id: true, name: true, slug: true, deactivatedAt: true,
      onboardingCompleted: true, createdAt: true,
      _count: { select: { users: true, appointments: true, barbers: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const owners = await prisma.user.findMany({
    where: { role: 'OWNER' },
    select: { email: true, name: true, businessId: true },
  })
  const ownerByBusiness = new Map(owners.map((o) => [o.businessId, o]))

  return NextResponse.json({
    businesses: businesses.map((b) => ({
      id: b.id, name: b.name, slug: b.slug,
      status: b.deactivatedAt ? 'DEACTIVATED' : 'ACTIVE',
      onboardingCompleted: b.onboardingCompleted,
      createdAt: b.createdAt,
      staffCount: b._count.users,
      appointmentCount: b._count.appointments,
      barberCount: b._count.barbers,
      owner: ownerByBusiness.get(b.id)
        ? { email: ownerByBusiness.get(b.id)!.email, name: ownerByBusiness.get(b.id)!.name }
        : null,
    })),
  })
}

/** POST — create a business with its initial owner. Platform owner only. */
export async function POST(req: NextRequest) {
  const auth = await requirePlatformOwner()
  if (!auth.success) return auth.response

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const { name, slug, timezone, ownerEmail, ownerName } = parsed.data

  const [slugTaken, emailTaken] = await Promise.all([
    prisma.business.findUnique({ where: { slug }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } }),
  ])
  if (slugTaken) return NextResponse.json({ error: 'Slug already in use' }, { status: 409 })
  if (emailTaken) return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 })

  // Generated one-time password; the owner must change it on first sign-in.
  const tempPassword = `BL-${crypto.randomUUID().slice(0, 8).toUpperCase()}!`
  const passwordHash = await bcrypt.hash(tempPassword, 12)

  const business = await prisma.business.create({
    data: {
      name, slug, timezone,
      users: {
        create: {
          email: ownerEmail, name: ownerName, role: 'OWNER',
          passwordHash, mustChangePassword: true,
        },
      },
    },
    select: { id: true, name: true, slug: true },
  })

  await logAudit({
    userId: auth.user.id,
    businessId: business.id,
    action: 'PLATFORM_BUSINESS_CREATED',
    entityType: 'Business',
    entityId: business.id,
    newValues: { name, slug, ownerEmail },
  })

  // The temp password is returned ONCE, only to the platform owner.
  return NextResponse.json({ business, initialPassword: tempPassword }, { status: 201 })
}

/** PATCH — deactivate / reactivate a business. Platform owner only. */
export async function PATCH(req: NextRequest) {
  const auth = await requirePlatformOwner()
  if (!auth.success) return auth.response

  const parsed = actionSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const { businessId, action } = parsed.data

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, deactivatedAt: true } })
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 })

  if (action === 'deactivate' && business.deactivatedAt) {
    return NextResponse.json({ error: 'Business is already deactivated' }, { status: 409 })
  }
  if (action === 'reactivate' && !business.deactivatedAt) {
    return NextResponse.json({ error: 'Business is already active' }, { status: 409 })
  }

  await prisma.business.update({
    where: { id: businessId },
    data: action === 'deactivate'
      ? { deactivatedAt: new Date() }
      : { deactivatedAt: null },
  })

  await logAudit({
    userId: auth.user.id,
    businessId,
    action: action === 'deactivate' ? 'BUSINESS_DEACTIVATED' : 'BUSINESS_REACTIVATED',
    entityType: 'Business',
    entityId: businessId,
    newValues: { by: 'PLATFORM_OWNER', name: business.name },
  })

  return NextResponse.json({ ok: true, status: action === 'deactivate' ? 'DEACTIVATED' : 'ACTIVE' })
}
