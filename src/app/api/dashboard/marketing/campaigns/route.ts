export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createCampaign, resolveCampaignAudience } from '@/lib/marketing'

// GET /api/dashboard/marketing/campaigns — list all campaigns
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const businessId = (session.user as any)?.businessId

  const campaigns = await prisma.marketingCampaign.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(campaigns)
}

// POST /api/dashboard/marketing/campaigns — create a new campaign, or preview audience size
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const businessId = (session.user as any)?.businessId
  const userId = (session.user as any)?.id
  const userRole = (session.user as any)?.role

  // Marketing operations (preview AND creation) require OWNER role
  if (userRole !== 'OWNER') {
    return NextResponse.json({ error: 'Only owners can manage marketing campaigns' }, { status: 403 })
  }

  const body = await req.json()
  const { name, subject, body: campaignBody, audience, audienceConfig, preview } = body

  if (!audience) return NextResponse.json({ error: 'audience required' }, { status: 400 })

  if (preview) {
    // Preview the audience size without creating the campaign
    const targets = await resolveCampaignAudience(businessId, audience, audienceConfig)
    return NextResponse.json({ recipientCount: targets.length, sample: targets.slice(0, 5) })
  }

  if (!name || !subject || !campaignBody) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const campaign = await createCampaign(businessId, {
    name,
    subject,
    body: campaignBody,
    audience,
    audienceConfig,
    createdBy: userId,
  })

  return NextResponse.json(campaign)
}
