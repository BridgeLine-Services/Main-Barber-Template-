export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { updateBarberServiceSchema } from '@/lib/validation'
import { handleApiError } from '@/lib/api-errors'

/**
 * GET /api/dashboard/barber-services?barberId=xxx
 * Returns all BarberService links for a barber, including the service details
 * and any price/duration overrides.
 * - BARBER: can only view their own service links
 * - OWNER: can view any barber's service links
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const sessionBarberId = (session.user as any)?.barberId
    const businessId = (session.user as any)?.businessId
    const { searchParams } = new URL(req.url)
    const urlBarberId = searchParams.get('barberId')
    const targetBarberId = role === 'BARBER' ? sessionBarberId : urlBarberId
    if (!targetBarberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 })
    // Verify barber belongs to this business
    const barber = await prisma.barber.findFirst({
      where: { id: targetBarberId, businessId },
    })
    if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    const barberServices = await prisma.barberService.findMany({
      where: { barberId: targetBarberId },
      include: { service: true },
      orderBy: { sortOrder: 'asc' },
    })
    return NextResponse.json(barberServices)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/barber-services')
  }
}

/**
 * PATCH /api/dashboard/barber-services
 * Update a barber-service link (price override, duration override, isActive, sortOrder).
 * - BARBER: can only update their own service links
 * - OWNER: can update any barber's service links
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const sessionBarberId = (session.user as any)?.barberId
    const businessId = (session.user as any)?.businessId
    const userId = (session.user as any)?.id
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    const parseResult = updateBarberServiceSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    const { serviceId, ...updateData } = parseResult.data
    // Determine which barber this is for
    let barberId: string
    if (role === 'BARBER') {
      if (!sessionBarberId) return NextResponse.json({ error: 'No barber profile' }, { status: 400 })
      barberId = sessionBarberId
    } else {
      // OWNER must pass barberId in body
      const bodyBarberId = (body as any).barberId
      if (!bodyBarberId) return NextResponse.json({ error: 'barberId required for owner' }, { status: 400 })
      // Verify barber belongs to this business
      const barber = await prisma.barber.findFirst({
        where: { id: bodyBarberId, businessId },
      })
      if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
      barberId = bodyBarberId
    }
    // Verify the service belongs to this business
    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId },
    })
    if (!service) return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    // Upsert the barber-service link
    const result = await prisma.barberService.upsert({
      where: {
        barberId_serviceId: { barberId, serviceId },
      },
      create: {
        barberId,
        serviceId,
        priceOverride: updateData.priceOverride ?? null,
        durationOverride: updateData.durationOverride ?? null,
        isActive: updateData.isActive ?? true,
        sortOrder: updateData.sortOrder ?? 0,
      },
      update: {
        ...(updateData.priceOverride !== undefined && { priceOverride: updateData.priceOverride }),
        ...(updateData.durationOverride !== undefined && { durationOverride: updateData.durationOverride }),
        ...(updateData.isActive !== undefined && { isActive: updateData.isActive }),
        ...(updateData.sortOrder !== undefined && { sortOrder: updateData.sortOrder }),
      },
    })
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/barber-services')
  }
}

/**
 * POST /api/dashboard/barber-services
 * Create a new barber-service link (barber opts into offering a service).
 * - BARBER: can only add services to themselves
 * - OWNER: can add services to any barber
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const sessionBarberId = (session.user as any)?.barberId
    const businessId = (session.user as any)?.businessId
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    const { serviceId, barberId: bodyBarberId } = body as { serviceId?: string; barberId?: string }
    if (!serviceId) return NextResponse.json({ error: 'serviceId required' }, { status: 400 })
    let barberId: string
    if (role === 'BARBER') {
      if (!sessionBarberId) return NextResponse.json({ error: 'No barber profile' }, { status: 400 })
      barberId = sessionBarberId
    } else {
      if (!bodyBarberId) return NextResponse.json({ error: 'barberId required for owner' }, { status: 400 })
      const barber = await prisma.barber.findFirst({
        where: { id: bodyBarberId, businessId },
      })
      if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
      barberId = bodyBarberId
    }
    // Verify the service belongs to this business
    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId },
    })
    if (!service) return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    try {
      const result = await prisma.barberService.create({
        data: {
          barberId,
          serviceId,
          isActive: true,
          sortOrder: 0,
        },
      })
      return NextResponse.json(result, { status: 201 })
    } catch (error: any) {
      // Already exists
      if (error.code === 'P2002') {
        return NextResponse.json({ error: 'This service is already linked to this barber' }, { status: 409 })
      }
      throw error
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/barber-services')
  }
}

/**
 * DELETE /api/dashboard/barber-services?barberId=xxx&serviceId=xxx
 * Remove a barber-service link.
 * - BARBER: can only remove from themselves
 * - OWNER: can remove from any barber
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const sessionBarberId = (session.user as any)?.barberId
    const businessId = (session.user as any)?.businessId
    const { searchParams } = new URL(req.url)
    const urlBarberId = searchParams.get('barberId')
    const serviceId = searchParams.get('serviceId')
    if (!serviceId) return NextResponse.json({ error: 'serviceId required' }, { status: 400 })
    const barberId = role === 'BARBER' ? sessionBarberId : urlBarberId
    if (!barberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 })
    // Verify barber belongs to this business
    const barber = await prisma.barber.findFirst({
      where: { id: barberId, businessId },
    })
    if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    const link = await prisma.barberService.findFirst({
      where: { barberId, serviceId },
    })
    if (!link) return NextResponse.json({ error: 'Service is not assigned to this barber' }, { status: 404 })
    await prisma.barberService.delete({
      where: { barberId_serviceId: { barberId, serviceId } },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/barber-services')
  }
}
