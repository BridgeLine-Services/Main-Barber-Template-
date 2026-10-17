import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAnalytics } from '@/lib/analytics'
import { handleApiError } from '@/lib/api-errors'

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.user?.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const user = session.user
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden — owner access required' }, { status: 403 })
    }
    const { searchParams } = new URL(request.url)
    const parsedDays = Number.parseInt(searchParams.get('days') || '30', 10)
    const rangeDays = Number.isInteger(parsedDays) ? Math.min(Math.max(parsedDays, 1), 366) : 30
    const startParam = searchParams.get('start')
    const endParam = searchParams.get('end')
    const start = startParam ? new Date(`${startParam}T00:00:00.000Z`) : undefined
    const end = endParam ? new Date(`${endParam}T23:59:59.999Z`) : undefined
    if ((startParam && Number.isNaN(start?.getTime())) || (endParam && Number.isNaN(end?.getTime()))) {
      return NextResponse.json({ error: 'Invalid analytics date range' }, { status: 400 })
    }
    if ((start && end && start > end) || Boolean(start) !== Boolean(end)) {
      return NextResponse.json({ error: 'Analytics range must include a valid start and end' }, { status: 400 })
    }
    try {
      const result = await getAnalytics(user.businessId, rangeDays, start && end ? { start, end } : undefined)
      return NextResponse.json(result)
    } catch (error) {
      console.error('Analytics error:', error)
      return NextResponse.json({ error: 'Failed to compute analytics' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/analytics')
  }
}
