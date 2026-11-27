/**
 * Membership cancellation.
 *   POST /api/dashboard/memberships/[id]/cancel — staff cancels a membership for a customer.
 *
 * PENDING memberships end immediately; ACTIVE memberships keep benefits until
 * period end (auto-renew off). Tenant-scoped by session business.
 */
import { NextResponse } from 'next/server'
import { requireStaff } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { cancelMembership } from '@/lib/memberships'
import { z } from 'zod'

const bodySchema = z.object({ reason: z.string().trim().max(500).nullable().optional() })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const auth = await requireStaff()
    if (!auth.success) return auth.response
    const user = auth.user
    if (!user.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
