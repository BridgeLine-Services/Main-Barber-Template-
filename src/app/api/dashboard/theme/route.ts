export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { AuditAction } from '@prisma/client'
import { z } from 'zod'

const updateThemeSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color').optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color').optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color').optional().nullable(),
  fontFamily: z.string().max(100).optional().nullable(),
  themeMode: z.enum(['dark', 'light']).optional(),
})

/**
 * GET /api/dashboard/theme
 * OWNER: returns the current theme settings
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const businessId = (session.user as any)?.businessId
  if (!businessId) return NextResponse.json({ error: 'No business on session' }, { status: 400 })

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      primaryColor: true,
      accentColor: true,
      secondaryColor: true,
      fontFamily: true,
      themeMode: true,
    },
  })

  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 })

  return NextResponse.json({ theme: business })
}

/**
 * PATCH /api/dashboard/theme
 * OWNER only: update theme colors, font, mode
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  if (user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden — owner only' }, { status: 403 })
  }

  const businessId = user.businessId
  if (!businessId) return NextResponse.json({ error: 'No business on session' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const parseResult = updateThemeSchema.safeParse(body)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid theme data', details: parseResult.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const oldBusiness = await prisma.business.findUnique({
    where: { id: businessId },
    select: { primaryColor: true, accentColor: true, secondaryColor: true, fontFamily: true, themeMode: true },
  })

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: parseResult.data,
    select: {
      primaryColor: true,
      accentColor: true,
      secondaryColor: true,
      fontFamily: true,
      themeMode: true,
    },
  })

  await logAudit({
    userId: user.id,
    businessId,
    action: AuditAction.BRANDING_UPDATED,
    entityType: 'Business',
    entityId: businessId,
    oldValues: oldBusiness,
    newValues: parseResult.data,
    ipAddress: getClientIP(req),
    userAgent: req.headers.get('user-agent') || undefined,
  })

  return NextResponse.json({ theme: updated })
}
