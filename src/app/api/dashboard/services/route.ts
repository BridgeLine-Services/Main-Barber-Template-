export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createServiceSchema } from '@/lib/validation'
import { handleApiError, validationError } from '@/lib/api-errors'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const services = await prisma.service.findMany({
      where: { businessId },
      include: { barbers: { include: { barber: true } } },
      orderBy: { order: 'asc' },
    })
    return NextResponse.json(services)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/services')
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
    const parseResult = createServiceSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: validationError(parseResult.error).message, details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    const { name, description, duration, price, isActive, barberIds, order } = parseResult.data
    // Tenant isolation: linked barbers must belong to THIS business
    if (barberIds?.length) {
      const owned = await prisma.barber.count({
        where: { id: { in: barberIds }, businessId },
      })
      if (owned !== barberIds.length) {
        return NextResponse.json(
          { error: 'One or more selected barbers do not belong to this shop' },
          { status: 403 }
        )
      }
    }
    const service = await prisma.service.create({
      data: {
        businessId,
        name,
        description: description || null,
        duration,
        price,
        isActive: isActive ?? true,
        order: order ?? 0,
        barbers: barberIds?.length
          ? { create: barberIds.map((id: string) => ({ barberId: id })) }
          : undefined,
      },
      include: { barbers: true },
    })
    return NextResponse.json(service)
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/services')
  }
}
