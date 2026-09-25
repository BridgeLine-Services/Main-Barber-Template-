export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sendCampaign } from '@/lib/marketing'
import { handleApiError } from '@/lib/api-errors'

// POST /api/dashboard/marketing/campaigns/[id]/send
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const userRole = (session.user as any)?.role
    if (userRole !== 'OWNER') {
      return NextResponse.json({ error: 'Only owners can send campaigns' }, { status: 403 })
    }
    try {
      const result = await sendCampaign(businessId, params.id)
      return NextResponse.json(result)
    } catch (e: any) {
      return NextResponse.json({ error: 'Failed to send the campaign. It may have no eligible recipients, or the audience could not be resolved. Check the campaign and try again.' }, { status: 400 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/marketing/campaigns/[id]/send')
  }
}
