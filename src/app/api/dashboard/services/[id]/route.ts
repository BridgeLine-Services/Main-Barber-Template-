export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { updateServiceSchema } from '@/lib/validation'
import { handleApiError, validationError } from '@/lib/api-errors'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const service = await prisma.service.findFirst({
      where: { id: params.id, businessId },
      include: { barbers: { include: { barber: true } } },
    })
    if (!service) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(service)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/services/[id]')
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ((session.user as any)?.role !== 'OWNER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const businessId = (session.user as any)?.businessId
    const body = await req.json()
    const parseResult = updateServiceSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: validationError(parseResult.error).message, details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    const { name, description, duration, price, isActive, order, barberIds } = parseResult.data
    // Verify ownership
    const existing = await prisma.service.findFirst({ where: { id: params.id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Update barber assignments if provided
    if (barberIds !== undefined) {
      await prisma.barberService.deleteMany({ where: { serviceId: params.id } })
      if (barberIds.length > 0) {
        await prisma.barberService.createMany({
          data: barberIds.map((id: string) => ({ serviceId: params.id, barberId: id })),
        })
      }
    }
    const service = await prisma.service.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(duration !== undefined && { duration }),
        ...(price !== undefined && { price }),
        ...(isActive !== undefined && { isActive }),
        ...(order !== undefined && { order }),
      },
      include: { barbers: { include: { barber: true } } },
    })
    return NextResponse.json(service)
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/services/[id]')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ((session.user as any)?.role !== 'OWNER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const businessId = (session.user as any)?.businessId
    const existing = await prisma.service.findFirst({ where: { id: params.id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const appointments = await prisma.appointment.count({ where: { serviceId: params.id } })
    if (appointments > 0) {
      // Soft delete
      await prisma.service.update({ where: { id: params.id }, data: { isActive: false } })
      return NextResponse.json({ success: true, message: 'Deactivated (has existing appointments)' })
    }
    await prisma.barberService.deleteMany({ where: { serviceId: params.id } })
    await prisma.service.delete({ where: { id: params.id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/services/[id]')
  }
}
