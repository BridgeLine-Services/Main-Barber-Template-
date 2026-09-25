export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sendRebookingReminder } from '@/lib/rebooking-engine'
import { handleApiError } from '@/lib/api-errors'

// POST /api/dashboard/rebooking/send
// Sends a rebooking reminder to a customer
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const userId = (session.user as any)?.id
    const body = await req.json()
    const { customerId, channel } = body
    if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 })
    const result = await sendRebookingReminder(businessId, customerId, channel || 'SMS')
    // Log to audit log
    try {
      const { prisma } = await import('@/lib/prisma')
      await prisma.auditLog.create({
        data: {
          businessId,
          userId,
          action: 'REBOOKING_REMINDER_SENT',
          entityType: 'Customer',
          entityId: customerId,
          newValues: { channel: channel || 'SMS', success: result.success },
        },
      })
    } catch (e) {
      // Non-critical
    }
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/rebooking/send')
  }
}
