/**
 * Membership cancellation.
 *   POST /api/dashboard/memberships/[id]/cancel — staff cancels for a customer,
 *   or with ?self=1 a customer cancels their own membership via the portal.
 *
 * PENDING memberships end immediately; ACTIVE memberships keep benefits until
 * period end (auto-renew off). Tenant-scoped by session business.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { cancelMembership } from '@/lib/memberships'
import { z } from 'zod'

const bodySchema = z.object({ reason: z.string().trim().max(500).nullable().optional() })

type SessionUser = { id?: string; role: string; businessId?: string | null }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }
    const membership = await cancelMembership(
      user.businessId,
      id,
      parsed.data.reason ?? null
    )
    return NextResponse.json({ success: true, status: membership.status })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    if (code === 'BAD_STATE') return NextResponse.json({ error: (error as Error).message }, { status: 409 })
    return handleApiError(error, 'POST /api/dashboard/memberships/[id]/cancel')
  }
}
