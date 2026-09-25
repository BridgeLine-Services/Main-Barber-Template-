export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCustomerIntelligence, getRebookingSuggestion } from '@/lib/customer-intelligence'
import { handleApiError } from '@/lib/api-errors'

// GET /api/dashboard/customers/[id]/intelligence
// Returns customer behavioral history + rebooking suggestion
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    // Verify customer belongs to this business
    const customer = await prisma.customer.findFirst({
      where: { id: params.id, businessId },
      select: { id: true },
    })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    const [intelligence, rebooking] = await Promise.all([
      getCustomerIntelligence(params.id, businessId),
      getRebookingSuggestion(params.id, businessId),
    ])
    return NextResponse.json({ intelligence, rebooking })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/customers/[id]/intelligence')
  }
}
