export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCustomerLoyalty } from '@/lib/loyalty'
import { handleApiError } from '@/lib/api-errors'
import type { RewardTier } from '@/lib/loyalty'

// GET /api/dashboard/loyalty/customer?customerId=xxx
// Returns loyalty info for a specific customer
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user?.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const businessId = session.user?.businessId
    const { searchParams } = new URL(req.url)
    const customerId = searchParams.get('customerId')
    if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 })
    // Verify customer belongs to this business
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, businessId },
      select: { id: true },
    })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    // Get the active reward program
    const program = await prisma.businessRewardProgram.findFirst({
      where: { businessId, isActive: true },
      orderBy: { createdAt: 'desc' },
    })
    const programConfig = program ? {
      name: program.name,
      type: program.type as 'VISITS' | 'POINTS',
      tiers: Array.isArray(program.config) ? (program.config as unknown as RewardTier[]) : [],
      pointsPerDollar: program.pointsPerDollar || undefined,
    } : undefined
    const loyalty = await getCustomerLoyalty(customerId, businessId, programConfig)
    return NextResponse.json(loyalty)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/loyalty/customer')
  }
}
