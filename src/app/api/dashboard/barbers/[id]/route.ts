export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { updateBarberSchema } from '@/lib/validation'
import { handleApiError } from '@/lib/api-errors'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const barber = await prisma.barber.findFirst({
      where: { id: params.id, businessId },
      include: {
        services: { include: { service: true } },
        schedules: { orderBy: { dayOfWeek: 'asc' } },
      },
    })
    if (!barber) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(barber)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/barbers/[id]')
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ((session.user as any)?.role !== 'OWNER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const businessId = (session.user as any)?.businessId
    const existing = await prisma.barber.findFirst({ where: { id: params.id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const body = await req.json()
    const parseResult = updateBarberSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid barber data', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    const { name, specialty, bio, photo, isActive, order, serviceIds } = parseResult.data
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
    // Update services if provided
    if (serviceIds !== undefined) {
      await prisma.barberService.deleteMany({ where: { barberId: params.id } })
      if (serviceIds.length > 0) {
        await prisma.barberService.createMany({
          data: serviceIds.map((id: string) => ({ barberId: params.id, serviceId: id })),
        })
      }
    }
    const barber = await prisma.barber.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(specialty !== undefined && { specialty }),
        ...(bio !== undefined && { bio }),
        ...(photo !== undefined && { photo }),
        ...(isActive !== undefined && { isActive }),
        ...(order !== undefined && { order }),
      },
      include: { services: { include: { service: true } } },
    })
    return NextResponse.json(barber)
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/barbers/[id]')
  }
}
