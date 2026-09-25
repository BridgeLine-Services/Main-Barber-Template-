export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { handleApiError } from '@/lib/api-errors'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const role = (session.user as any)?.role
    const barberId = (session.user as any)?.barberId
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search') || ''
    const limit = parseInt(searchParams.get('limit') || '50')
    const skip = parseInt(searchParams.get('skip') || '0')
    const where: any = { businessId }
    // BARBER role: only customers who have appointments with them
    if (role === 'BARBER' && barberId) {
      where.appointments = { some: { barberId } }
    }
    // Search by name, phone, email
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }
    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          _count: { select: { appointments: true } },
          appointments: {
            orderBy: { startTime: 'desc' },
            take: 1,
            select: { startTime: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.customer.count({ where }),
    ])
    return NextResponse.json({
      customers: customers.map(c => ({
        ...c,
        appointmentCount: c._count.appointments,
        lastAppointment: c.appointments[0]?.startTime || null,
      })),
      total,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/customers')
  }
}
