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
    const user = session.user as any
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden — owner access required' }, { status: 403 })
    }
    const { searchParams } = new URL(request.url)
    const rangeDays = parseInt(searchParams.get('days') || '30', 10)
    try {
      const result = await getAnalytics(user.businessId, rangeDays)
      return NextResponse.json(result)
    } catch (error) {
      console.error('Analytics error:', error)
      return NextResponse.json({ error: 'Failed to compute analytics' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/analytics')
  }
}
