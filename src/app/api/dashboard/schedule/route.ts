export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/auth-helpers'
import { updateScheduleSchema } from '@/lib/validation'
import { getClientIP } from '@/lib/rate-limit'
import { AuditAction } from '@prisma/client'
import { handleApiError } from '@/lib/api-errors'

/**
 * GET /api/dashboard/schedule?barberId=xxx
 * Returns the weekly schedule for a barber.
 * - BARBER role: can only view their own schedule (barberId from session)
 * - OWNER role: can view any barber's schedule (barberId from query param)
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
    // BARBER can only access their own schedule
    const targetBarberId = role === 'BARBER' ? sessionBarberId : urlBarberId
    if (!targetBarberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 })
    // Verify barber belongs to this business (tenant isolation)
    const barber = await prisma.barber.findFirst({
      where: { id: targetBarberId, businessId },
    })
    if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    const schedules = await prisma.schedule.findMany({
      where: { barberId: targetBarberId },
      orderBy: { dayOfWeek: 'asc' },
    })
    return NextResponse.json(schedules)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/schedule')
  }
}

/**
 * PUT /api/dashboard/schedule?barberId=xxx
 * Updates the weekly recurring schedule for a barber.
 * - BARBER role: can only update their own schedule
 * - OWNER role: can update any barber's schedule
 *
 * Uses Zod validation (updateScheduleSchema) — no raw body access.
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const sessionBarberId = (session.user as any)?.barberId
    const businessId = (session.user as any)?.businessId
    const userId = (session.user as any)?.id
    const { searchParams } = new URL(req.url)
    const urlBarberId = searchParams.get('barberId')
    const targetBarberId = role === 'BARBER' ? sessionBarberId : urlBarberId
    if (!targetBarberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 })
    // Verify barber belongs to this business (tenant isolation)
    const barber = await prisma.barber.findFirst({
      where: { id: targetBarberId, businessId },
    })
    if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    // Validate input with Zod
    const body = await req.json()
    const parseResult = updateScheduleSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid schedule data', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    const { schedules } = parseResult.data
    // Capture old values for audit
    const oldSchedules = await prisma.schedule.findMany({
      where: { barberId: targetBarberId },
      orderBy: { dayOfWeek: 'asc' },
    })
    // Delete existing and recreate in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.schedule.deleteMany({ where: { barberId: targetBarberId } })
      if (schedules && schedules.length > 0) {
        await tx.schedule.createMany({
          data: schedules.map(s => ({
            barberId: targetBarberId,
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime || '09:00',
            endTime: s.endTime || '18:00',
            isOff: s.isOff ?? false,
            breaks: s.breaks || [],
          })),
        })
      }
    })
    await logAudit({
      userId,
      businessId,
      action: AuditAction.BARBER_SCHEDULE_UPDATED,
      entityType: 'Schedule',
      entityId: targetBarberId,
      oldValues: oldSchedules,
      newValues: schedules,
      ipAddress: getClientIP(req),
      userAgent: req.headers.get('user-agent') || undefined,
    })
    const updated = await prisma.schedule.findMany({
      where: { barberId: targetBarberId },
      orderBy: { dayOfWeek: 'asc' },
    })
    return NextResponse.json(updated)
  } catch (error) {
    return handleApiError(error, 'PUT /api/dashboard/schedule')
  }
}
