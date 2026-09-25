import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CancellationReason } from '@prisma/client'
import { handleApiError } from '@/lib/api-errors'

// GET /api/dashboard/cancellations — list cancellation records with customer info
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = session.user as any
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    try {
      const cancellations = await prisma.cancellationRecord.findMany({
        where: { businessId: user.businessId },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, phone: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      // Aggregate stats
      const stats = {
        total: cancellations.length,
        byReason: cancellations.reduce((acc, c) => {
          acc[c.reason] = (acc[c.reason] || 0) + 1
          return acc
        }, {} as Record<string, number>),
        uniqueCustomers: new Set(cancellations.map(c => c.customerId)).size,
      }
      return NextResponse.json({ records: cancellations, stats })
    } catch (error) {
      console.error('Cancellation fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch cancellations' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/cancellations')
  }
}
