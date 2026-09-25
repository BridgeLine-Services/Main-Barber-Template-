export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createBlockedTimeSchema } from '@/lib/validation'
import { handleApiError } from '@/lib/api-errors'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const role = (session.user as any)?.role
    const barberId = (session.user as any)?.barberId
    const { searchParams } = new URL(req.url)
    const queryBarberId = searchParams.get('barberId')
    const targetBarberId = role === 'BARBER' ? barberId : queryBarberId
    const where: any = { businessId }
    if (targetBarberId) where.barberId = targetBarberId
    const blockedTimes = await prisma.blockedTime.findMany({
      where,
      orderBy: { startTime: 'asc' },
    })
    return NextResponse.json(blockedTimes)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/blocked-times')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const body = await req.json()
    const parseResult = createBlockedTimeSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid blocked time data', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    const { barberId, startTime, endTime, reason } = parseResult.data
    const blockedTime = await prisma.blockedTime.create({
      data: {
        businessId,
        barberId: barberId || null,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        reason: reason || null,
      },
    })
    return NextResponse.json(blockedTime)
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/blocked-times')
  }
}
