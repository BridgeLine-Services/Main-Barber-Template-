export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner, getBusinessIdForUser } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await getBusinessIdForUser(auth.user)
    const query = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80)
    if (query.length < 2) return NextResponse.json({ customers: [] })

    const customers = await prisma.customer.findMany({
      where: {
        businessId,
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 20,
    })
    return NextResponse.json({ customers })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/referrals/customers')
  }
}
